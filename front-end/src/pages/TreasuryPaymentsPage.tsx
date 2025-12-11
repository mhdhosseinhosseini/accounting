import React, { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { IconButton, Tooltip, Button, TextField, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PrintIcon from '@mui/icons-material/Print';
import TableSortHeader from '../components/common/TableSortHeader';
import Pagination from '../components/common/Pagination';
import ConfirmDialog from '../components/common/ConfirmDialog';
import AlertDialog from '../components/common/AlertDialog';
import { getCurrentLang } from '../i18n';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import { listDetails } from '../services/details';
import JalaliDateRangePicker from '../components/common/JalaliDateRangePicker';
import SearchableSelect from '../components/common/SearchableSelect';
import { listPayments, deletePayment } from '../services/payments';

/**
 * TreasuryPaymentsPage
 * Mirrors ReceiptsPage UI: header search, date range filter, receiver filter,
 * status filter, sortable table with actions, pagination, and dialogs.
 */
const TreasuryPaymentsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRTL = (document?.documentElement?.dir || 'ltr') === 'ltr' ? false : true;
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);

  // ===================== Data & UI state =====================
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Filters (identical structure to receipts)
  const [filters, setFilters] = useState<{ startDate: string; endDate: string; detailId: string; status: string }>({
    startDate: '', endDate: '', detailId: '', status: ''
  });

  // Search terms (top header search)
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Sorting & pagination
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Dialogs
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [alertOpen, setAlertOpen] = useState<boolean>(false);
  const [alertTitle, setAlertTitle] = useState<string | undefined>(undefined);
  const [alertMessage, setAlertMessage] = useState<string>('');
  const [alertType, setAlertType] = useState<'success' | 'error' | 'info' | 'warning' | undefined>('info');

  // Details for receiver display
  const [detailOptions, setDetailOptions] = useState<Array<{ id: string | number; name: string }>>([]);
  const detailNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of detailOptions) map[String(d.id)] = d.name;
    return map;
  }, [detailOptions]);

  /** toAsciiDigits
   * Normalizes Farsi/Arabic-Indic numerals to ASCII digits for sort/search. */
  function toAsciiDigits(str: string): string {
    return Array.from(str)
      .map((ch) => {
        const code = ch.charCodeAt(0);
        if (code >= 0x0660 && code <= 0x0669) return String.fromCharCode(48 + (code - 0x0660));
        if (code >= 0x06f0 && code <= 0x06f9) return String.fromCharCode(48 + (code - 0x06f0));
        return ch;
      })
      .join('');
  }

  /** toDateObjectSafe
   * Safely converts an ISO date string to DateObject. */
  function toDateObjectSafe(iso?: string): DateObject | null {
    try {
      if (!iso) return null;
      const s = String(iso);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-').map((p) => parseInt(p, 10));
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) return new DateObject({ year: y, month: m, day: d });
      }
      const dObj = new DateObject(new Date(s));
      return dObj;
    } catch { return null; }
  }

  /** formatDisplayDate
   * Formats ISO date to localized display (Jalali in Farsi; Gregorian in English). */
  function formatDisplayDate(iso?: string): string {
    const obj = toDateObjectSafe(iso);
    if (!obj) return '';
    try {
      if (getCurrentLang() === 'fa') {
        const j = obj.convert(persian);
        const jy = String(j.year).padStart(4, '0');
        const jm = String(j.month.number).padStart(2, '0');
        const jd = String(j.day).padStart(2, '0');
        // Persian digits
        const pDigits = (s: string) => s.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[parseInt(d, 10)]);
        return pDigits(`${jy}/${jm}/${jd}`);
      }
      const y = String(obj.year).padStart(4, '0');
      const m = String(obj.month.number).padStart(2, '0');
      const d = String(obj.day).padStart(2, '0');
      return `${y}-${m}-${d}`;
    } catch { return iso || ''; }
  }

  /** formatAmountNoDecimals
   * Formats amounts with thousand separators and localizes digits in Farsi. */
  function formatAmountNoDecimals(val?: number | string): string {
    const n = Number(val || 0);
    const lang = getCurrentLang();
    try {
      const fmt = new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
      return fmt.format(Math.round(n));
    } catch {
      const ascii = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      if (lang === 'fa') {
        const map: Record<string, string> = { '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴', '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹', ',': '،' };
        return ascii.replace(/[0-9,]/g, (c) => map[c] || c);
      }
      return ascii;
    }
  }

  /** getTotalAmount
   * Computes total amount of a payment by summing item amounts. */
  function getTotalAmount(payment: any): number {
    const items = Array.isArray(payment?.items) ? payment.items : [];
    return items.reduce((sum: number, it: any) => sum + Number(it?.amount || 0), 0);
  }

  /** fetchPayments
   * Loads payments list from backend (Accept-Language via service). */
  async function fetchPayments() {
    setLoading(true); setError('');
    try {
      const list = await listPayments();
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || t('common.error', 'Error'));
    } finally { setLoading(false); }
  }

  /** fetchDetails
   * Loads detail options to map receiver names. */
  async function fetchDetails() {
    try {
      const details = await listDetails();
      setDetailOptions(details.map((d: any) => ({ id: d.id, name: d.name })));
    } catch { /* non-blocking */ }
  }

  useEffect(() => { fetchPayments(); fetchDetails(); }, [lang]);

  /** applyFilters
   * Applies date/receiver/status filters client-side. */
  function applyFilters(list: any[]): any[] {
    return list.filter((it) => {
      const d = it?.date ? new Date(it.date) : null;
      const startOk = !filters.startDate || (d && d >= new Date(filters.startDate));
      const endOk = !filters.endDate || (d && d <= new Date(filters.endDate));
      const receiverOk = !filters.detailId || String(it.detailId || '') === filters.detailId;
      const statusOk = !filters.status || String(it.status || '').toLowerCase() === filters.status.toLowerCase();
      return startOk && endOk && receiverOk && statusOk;
    });
  }

  /** filterBySearch
   * Applies search terms across number, description, and receiver name. */
  function filterBySearch(list: any[]): any[] {
    const q = searchQuery.trim(); if (!q) return list;
    const isNumericOnly = /^[\s\u0660-\u0669\u06F0-\u06F9\d]+$/.test(q);
    const qq = (isNumericOnly ? toAsciiDigits(q) : q).toLowerCase();
    return list.filter((it) => {
      const receiverName = detailNameById[String(it.detailId || '')] || '';
      const numberStr = String(it.number || '').toLowerCase();
      const descStr = String(it.description || '').toLowerCase();
      return numberStr.includes(qq) || descStr.includes(qq) || String(receiverName).toLowerCase().includes(qq);
    });
  }

  /** sortItems
   * Sorts by selected column, handling dates and numbers. */
  function sortItems(list: any[]): any[] {
    if (!sortBy) return list;
    const arr = [...list];
    arr.sort((a, b) => {
      let av: any; let bv: any;
      switch (sortBy) {
        case 'number': av = a.number; bv = b.number; break;
        case 'date': av = a.date ? new Date(a.date).getTime() : 0; bv = b.date ? new Date(b.date).getTime() : 0; break;
        case 'receiverName': {
          const an = detailNameById[String(a.detailId || '')] || ''; const bn = detailNameById[String(b.detailId || '')] || ''; av = an; bv = bn; break;
        }
        case 'totalAmount': av = getTotalAmount(a); bv = getTotalAmount(b); break;
        case 'status': av = String(a.status || ''); bv = String(b.status || ''); break;
        default: av = String(a[sortBy] || ''); bv = String(b[sortBy] || '');
      }
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av || '').localeCompare(String(bv || ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }

  const filtered = useMemo(() => applyFilters(items), [items, filters, detailNameById]);
  const searched = useMemo(() => filterBySearch(filtered), [filtered, searchQuery, detailNameById]);
  const sorted = useMemo(() => sortItems(searched), [searched, sortBy, sortDir, detailNameById]);

  const selectedReceiver = useMemo(() => getSelectedDetailOption(detailOptions, filters.detailId), [detailOptions, filters.detailId]);

  /** paginate
   * Returns page slice according to page & pageSize. */
  const total = sorted.length;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  /** onSort
   * Toggles sort state for provided key and resets page. */
  function onSort(key: string): void {
    setSortBy((prev) => {
      if (prev === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return prev; }
      setSortDir('asc'); return key;
    });
    setPage(1);
  }

  /** handleDelete
   * Opens confirm dialog for deleting a draft payment. */
  function handleDelete(id: string) { setConfirmDeleteId(id); }

  /** handleConfirmDelete
   * Confirms deletion then reloads list and shows feedback. */
  async function handleConfirmDelete(): Promise<void> {
    if (!confirmDeleteId) return;
    setError('');
    try {
      await deletePayment(confirmDeleteId);
      await fetchPayments();
      setConfirmDeleteId(null);
      setAlertType('success');
      setAlertTitle(undefined);
      setAlertMessage(t('pages.payments.deleted', 'Deleted successfully'));
      setAlertOpen(true);
    } catch (e: any) {
      const raw = e?.response?.data?.message || e?.message || t('common.error', 'Error');
      setError(raw);
      setAlertType('error');
      setAlertTitle(undefined);
      setAlertMessage(raw);
      setAlertOpen(true);
    }
  }

  /** closeAlert
   * Closes AlertDialog and clears transient state. */
  function closeAlert(): void { setAlertOpen(false); setAlertTitle(undefined); setAlertMessage(''); }

  /** handlePrint
   * Navigates to printable view for payment. */
  function handlePrint(id: string) { navigate(`/treasury/payments/${encodeURIComponent(id)}?print=1`); }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-2">{t('navigation.treasuryPayments', 'Payments')}</h1>

        {/* Header: Create + Search Terms */}
        <div className="relative mb-4 h-10">
          <TextField
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('pages.payments.searchPlaceholder', 'Search payments')}
            size="small"
            sx={{ position: 'absolute', left: 0, top: 0, width: 760 }}
          />
          <Button
            variant="contained"
            color="success"
            onClick={() => navigate('/treasury/payments/new')}
            sx={{ position: 'absolute', right: 0, top: 0 }}
          >
            {t('pages.payments.createTitle', 'Create Payment')}
          </Button>
        </div>

        {/* Filters (MUI) */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3">
          <div className="md:col-span-2">
            <JalaliDateRangePicker
              fromDate={filters.startDate ? new Date(filters.startDate) : null}
              toDate={filters.endDate ? new Date(filters.endDate) : null}
              onFromDateChange={(date) => setFilters((f) => ({ ...f, startDate: date ? toISODate(date) : '' }))}
              onToDateChange={(date) => setFilters((f) => ({ ...f, endDate: date ? toISODate(date) : '' }))}
              onApply={() => setPage(1)}
              includeTime={false}
            />
          </div>
          <div>
            <SearchableSelect
              options={detailOptions}
              value={selectedReceiver}
              onChange={(opt) => setFilters((f) => ({ ...f, detailId: opt?.id ? String(opt.id) : '' }))}
              label={t('pages.payments.fields.payer', 'Receiver')}
              placeholder={t('pages.payments.fields.payer', 'Receiver')}
              size="small"
              fullWidth
              inputDisplayMode="label"
              noOptionsText={t('pages.payments.payer.noOptions', 'No receiver found')}
              getOptionLabel={(opt) => String((opt as any).name || '')}
              renderOption={(props, option) => (
                /** Render only the receiver name; do not show ID in the dropdown list. */
                <li {...props}>{String((option as any).name || '')}</li>
              )}
            />
          </div>
          <FormControl size="small">
            <InputLabel>{t('pages.payments.fields.status', 'Status')}</InputLabel>
            <Select value={filters.status} label={t('pages.payments.fields.status', 'Status')} onChange={(e) => setFilters((f) => ({ ...f, status: String(e.target.value) }))}>
              <MenuItem value="">{t('common.all', 'All')}</MenuItem>
              <MenuItem value="draft">{t('pages.payments.status.draft', 'Draft')}</MenuItem>
              <MenuItem value="posted">{t('pages.payments.status.posted', 'Posted')}</MenuItem>
            </Select>
          </FormControl>
          <div />
        </div>

        {error && <div className="text-red-600 mb-4">{error}</div>}
        {loading && <div className="text-gray-600">{t('common.loading', 'Loading...')}</div>}
        {!loading && sorted.length === 0 && <div>{t('common.noData', 'No data')}</div>}

        {/* Table */}
        {!loading && sorted.length > 0 && (
          <section className="bg-white rounded shadow p-4">
            <h2 className="text-lg font-medium mb-2">{t('pages.payments.list', 'Payments List')}</h2>
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100">
                <tr className="border-b border-gray-200">
                  <TableSortHeader
                    label={t('pages.payments.fields.number', 'Number')}
                    sortKey={'number'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.payments.fields.date', 'Date')}
                    sortKey={'date'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.payments.fields.payer', 'Receiver')}
                    sortKey={'receiverName'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.payments.fields.description', 'Description')}
                    sortKey={'description'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.payments.total', 'Total')}
                    sortKey={'totalAmount'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.payments.fields.status', 'Status')}
                    sortKey={'status'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <th className="px-4 py-3 text-base font-medium text-gray-700 uppercase tracking-wider text-center">
                    {t('common.actions', 'Actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((it) => {
                  const id = String(it.id);
                  /**
                   * normalizePaymentStatus
                   * Maps backend 'temporary' status to 'draft' for payment pages only.
                   */
                  function normalizePaymentStatus(s?: string | null): 'draft' | 'posted' {
                    const v = String(s || '').toLowerCase();
                    return v === 'temporary' ? 'draft' : v === 'posted' ? 'posted' : 'draft';
                  }
                  const isDraft = normalizePaymentStatus(it.status) === 'draft';
                  const receiverName = detailNameById[String(it.detailId || '')] || '-';
                  return (
                    <tr key={id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.number || '-'}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatDisplayDate(it.date)}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{receiverName}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.description || '-'}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatAmountNoDecimals(getTotalAmount(it))}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{t(`pages.payments.status.${normalizePaymentStatus(it.status)}`, normalizePaymentStatus(it.status))}</td>
                      <td className="px-4 py-2 text-center">
                        {isDraft && (
                          <Tooltip title={t('actions.edit', 'Edit')}>
                            <IconButton aria-label={t('actions.edit', 'Edit')} component={Link} to={`/treasury/payments/${encodeURIComponent(id)}`} size="small">
                              <EditIcon fontSize="small" sx={{ color: '#16a34a' }} />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title={t('actions.print', 'Print')}>
                          <IconButton aria-label={t('actions.print', 'Print')} onClick={() => handlePrint(id)} size="small">
                            <PrintIcon fontSize="small" sx={{ color: '#475569' }} />
                          </IconButton>
                        </Tooltip>
                        {isDraft && (
                          <Tooltip title={t('actions.delete', 'Delete')}>
                            <IconButton aria-label={t('actions.delete', 'Delete')} onClick={() => handleDelete(id)} size="small">
                              <DeleteIcon fontSize="small" sx={{ color: '#dc2626' }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              className="mt-3"
            />
          </section>
        )}
      </main>

      {/* Confirm deletion dialog */}
      <ConfirmDialog
        open={!!confirmDeleteId}
        title={t('actions.delete', 'Delete')}
        message={t('pages.payments.confirmDelete', 'Delete this draft payment?')}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
        type="danger"
        dimBackground={false}
      />

      {/* Alert dialog for success/error feedback */}
      <AlertDialog
        open={alertOpen}
        title={alertTitle}
        message={alertMessage}
        onClose={closeAlert}
        dimBackground={false}
      />
    </div>
  );
};

export default TreasuryPaymentsPage;

/** toISODate
 * Converts a JavaScript Date to 'YYYY-MM-DD'. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** getSelectedDetailOption
 * Returns the selected detail option object for current filters.detailId. */
function getSelectedDetailOption(options: Array<{ id: string | number; name: string }>, id: string): { id: string | number; name: string } | null {
  if (!id) return null;
  return options.find((o) => String(o.id) === id) || null;
}