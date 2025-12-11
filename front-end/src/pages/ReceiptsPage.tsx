import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import { Link, useNavigate } from 'react-router-dom';
import { IconButton, Tooltip, Button, TextField, Select, MenuItem, FormControl, InputLabel, Chip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ArticleIcon from '@mui/icons-material/Article';
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

/**
 * ReceiptsPage
 * Uses MUI header, table actions, sortable headers, pagination, and dialogs.
 * Mirrors patterns used in BankAccountsPage (header, pagination, search terms).
 */
const ReceiptsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRTL = (document?.documentElement?.dir || 'ltr') === 'ltr' ? false : true;
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);

  // ===================== Data & UI state =====================
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Filters (kept, but rendered with MUI controls)
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
  const [confirmDeleteJournalId, setConfirmDeleteJournalId] = useState<string | null>(null);
  const [alertOpen, setAlertOpen] = useState<boolean>(false);
  const [alertTitle, setAlertTitle] = useState<string | undefined>(undefined);
  const [alertMessage, setAlertMessage] = useState<string>('');
  const [alertType, setAlertType] = useState<'success' | 'error' | 'info' | 'warning' | undefined>('info');

  // Details for payer display
  const [detailOptions, setDetailOptions] = useState<Array<{ id: string | number; name: string }>>([]);
  const detailNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of detailOptions) map[String(d.id)] = d.name;
    return map;
  }, [detailOptions]);

  /** toAsciiDigits
   * Normalizes Farsi/Arabic-Indic numerals to ASCII digits for sort/search.
   */
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

  /**
   * formatAmountNoDecimals
   * Formats amounts with thousand separators and localizes digits in Farsi.
   */
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

  /** fetchReceipts
   * Loads receipts list from backend with Accept-Language header. */
  async function fetchReceipts() {
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/receipts`, { headers: { 'Accept-Language': lang } });
      const data = res.data?.data ?? res.data?.items ?? res.data ?? [];
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || t('common.error', 'Error'));
    } finally { setLoading(false); }
  }

  /** fetchDetails
   * Loads detail options to map payer names. */
  async function fetchDetails() {
    try {
      const details = await listDetails();
      setDetailOptions(details.map((d: any) => ({ id: d.id, name: d.name })));
    } catch { /* non-blocking */ }
  }

  useEffect(() => { fetchReceipts(); fetchDetails(); }, [lang]);

  /** applyFilters
   * Applies date/payer/status filters client-side. */
  /** normalizeReceiptStatus
   * Maps backend 'temporary'/'permanent' to UI 'draft'/'posted' for receipts only.
   * Ensures receipt pages never show the word "Temporary"; other sections remain unchanged.
   */
  function normalizeReceiptStatus(v?: string): 'draft' | 'posted' {
    const s = String(v || '').toLowerCase();
    if (s === 'temporary' || s === 'sent') return 'draft';
    if (s === 'permanent') return 'posted';
    if (s === 'draft') return 'draft';
    if (s === 'posted') return 'posted';
    return 'draft';
  }

  /** renderStatusChip
   * Renders a status badge for receipts.
   * Shows a distinct "Sent" chip when raw status is 'sent';
   * Maps 'temporary' and 'draft' to a "Draft" chip;
   * Maps 'permanent'/'posted' to a "Posted" chip.
   */
  function renderStatusChip(rawStatus: string) {
    const s = String(rawStatus || '').toLowerCase();
    const norm = normalizeReceiptStatus(s);
    if (s === 'sent') {
      const label = t('pages.receipts.status.sent', isRTL ? 'ارسال‌شده' : 'Sent');
      return <Chip label={label} size="small" color="info" variant="outlined" />;
    }
    if (norm === 'draft') {
      const label = t('pages.receipts.status.draft', isRTL ? 'پیش‌نویس' : 'Draft');
      return <Chip label={label} size="small" color="default" variant="outlined" />;
    }
    const label = t('pages.receipts.status.posted', isRTL ? 'ثبت‌شده' : 'Posted');
    return <Chip label={label} size="small" color="success" variant="filled" />;
  }

  function applyFilters(list: any[]): any[] {
    return list.filter((it) => {
      const d = it?.date ? new Date(it.date) : null;
      const startOk = !filters.startDate || (d && d >= new Date(filters.startDate));
      const endOk = !filters.endDate || (d && d <= new Date(filters.endDate));
      const payerOk = !filters.detailId || String(it.detailId || '') === filters.detailId;
      const statusOk = !filters.status || normalizeReceiptStatus(String(it.status || '')) === filters.status.toLowerCase();
      return startOk && endOk && payerOk && statusOk;
    });
  }

  /** filterBySearch
   * Applies search terms across number, description, and payer name. */
  function filterBySearch(list: any[]): any[] {
    const q = searchQuery.trim(); if (!q) return list;
    const isNumericOnly = /^[\s\u0660-\u0669\u06F0-\u06F9\d]+$/.test(q);
    const qq = (isNumericOnly ? toAsciiDigits(q) : q).toLowerCase();
    return list.filter((it) => {
      const payerName = detailNameById[String(it.detailId || '')] || '';
      const numberStr = String(it.number || '').toLowerCase();
      const descStr = String(it.description || '').toLowerCase();
      return numberStr.includes(qq) || descStr.includes(qq) || String(payerName).toLowerCase().includes(qq);
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
        case 'payerName': {
          const an = detailNameById[String(a.detailId || '')] || ''; const bn = detailNameById[String(b.detailId || '')] || ''; av = an; bv = bn; break;
        }
        case 'totalAmount': av = Number(a.totalAmount || 0); bv = Number(b.totalAmount || 0); break;
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

  const selectedPayer = useMemo(() => getSelectedDetailOption(detailOptions, filters.detailId), [detailOptions, filters.detailId]);
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
   * Opens confirm dialog for deleting a draft receipt. */
  function handleDelete(id: string) { setConfirmDeleteId(id); }

  /** handleDeleteJournal
   * Opens confirm dialog for deleting linked document (journal). */
  function handleDeleteJournal(journalId: string) { if (journalId) setConfirmDeleteJournalId(journalId); }

  /** handleConfirmDelete
   * Confirms deletion then reloads list and shows feedback. */
  async function handleConfirmDelete(): Promise<void> {
    if (!confirmDeleteId) return;
    setError('');
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/receipts/${encodeURIComponent(confirmDeleteId)}`, { headers: { 'Accept-Language': lang } });
      await fetchReceipts();
      setConfirmDeleteId(null);
      setAlertType('success');
      setAlertTitle(undefined);
      setAlertMessage(t('pages.receipts.deleted', 'Deleted successfully'));
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

  /** handleConfirmDeleteJournal
   * Confirms document deletion then reloads list and shows feedback. */
  async function handleConfirmDeleteJournal(): Promise<void> {
    if (!confirmDeleteJournalId) return;
    setError('');
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/journals/${encodeURIComponent(confirmDeleteJournalId)}`, { headers: { 'Accept-Language': lang } });
      await fetchReceipts();
      setConfirmDeleteJournalId(null);
      setAlertType('success');
      setAlertTitle(undefined);
      setAlertMessage(t('pages.receipts.documentDeleted', 'Document deleted successfully'));
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
   * Opens printable receipt in a new browser tab and triggers print.
   * Falls back to navigating in current tab if popup blocked. */
  function handlePrint(id: string) {
    const url = `/treasury/receipts/${encodeURIComponent(id)}?print=1`;
    const win = window.open(url, '_blank');
    if (!win) { navigate(url); }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-2">{t('navigation.treasuryReceipts', 'Receipts')}</h1>

        {/* Header: Create + Search Terms */}
        <div className="relative mb-4 h-10">
          <TextField
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('pages.receipts.searchPlaceholder', 'Search یثسزقهحفهخد')}
            size="small"
            sx={{ position: 'absolute', left: 0, top: 0, width: 760 }}
          />
          <Button
            variant="contained"
            color="success"
            onClick={() => navigate('/treasury/receipts/new')}
            sx={{ position: 'absolute', right: 0, top: 0 }}
          >
            {t('pages.receipts.createTitle', 'Create Receipt')}
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
              value={selectedPayer}
              onChange={(opt) => setFilters((f) => ({ ...f, detailId: opt?.id ? String(opt.id) : '' }))}
              label={t('pages.receipts.fields.payer', 'Payer')}
              placeholder={t('pages.receipts.fields.payer', 'Payer')}
              size="small"
              fullWidth
              inputDisplayMode="label"
              noOptionsText={t('pages.receipts.payer.noOptions', 'No payer found')}
              getOptionLabel={(opt) => String((opt as any).name || '')}
              renderOption={(props, option) => (
                /** Render only the payer name; do not show ID in the dropdown list. */
                <li {...props}>{String((option as any).name || '')}</li>
              )}
            />
          </div>
          <FormControl size="small">
            <InputLabel>{t('pages.receipts.fields.status', 'Status')}</InputLabel>
            <Select value={filters.status} label={t('pages.receipts.fields.status', 'Status')} onChange={(e) => setFilters((f) => ({ ...f, status: String(e.target.value) }))}>
              <MenuItem value="">{t('common.all', 'All')}</MenuItem>
              <MenuItem value="draft">{t('pages.receipts.status.draft', 'Draft')}</MenuItem>
              <MenuItem value="posted">{t('pages.receipts.status.posted', 'Posted')}</MenuItem>
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
            <h2 className="text-lg font-medium mb-2">{t('pages.receipts.list', 'Receipts List')}</h2>
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100">
                <tr className="border-b border-gray-200">
                  <TableSortHeader
                    label={t('pages.receipts.fields.number', 'Number')}
                    sortKey={'number'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.receipts.fields.date', 'Date')}
                    sortKey={'date'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.receipts.fields.payer', 'Payer')}
                    sortKey={'payerName'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.receipts.fields.description', 'Description')}
                    sortKey={'description'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.receipts.total', 'Total')}
                    sortKey={'totalAmount'}
                    currentSortBy={sortBy as any}
                    currentSortDir={sortDir}
                    onSort={(k) => onSort(String(k))}
                    headerAlign={'text-left'}
                  />
                  <TableSortHeader
                    label={t('pages.receipts.fields.status', 'Status')}
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
                  const isDraft = normalizeReceiptStatus(String(it.status || '')) === 'draft';
                  const hasJournal = Boolean(it.journalId);
                  const payerName = detailNameById[String(it.detailId || '')] || '-';
                  const normStatus = normalizeReceiptStatus(String(it.status || ''));
                  const statusChip = renderStatusChip(String(it.status || ''));
                  const statusLabel = normStatus === 'draft'
                    ? t('pages.receipts.status.draft', isRTL ? 'پیش‌نویس' : 'Draft')
                    : t('pages.receipts.status.posted', isRTL ? 'ثبت‌شده' : 'Posted');
                  return (
                    <tr key={id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.number || '-'}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatDisplayDate(it.date)}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{payerName}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.description || '-'}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatAmountNoDecimals(it.totalAmount)}</td>
                      <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{statusChip}</td>
                      <td className="px-4 py-2 text-center">

                        {isDraft && (
                          <Tooltip title={t('actions.edit', 'Edit')}>
                            <span>
                              <IconButton aria-label={t('actions.edit', 'Edit')} component={Link} to={`/treasury/receipts/${encodeURIComponent(id)}`} size="small" disabled={hasJournal}>
                                <EditIcon fontSize="small" sx={{ color: hasJournal ? '#9ca3af' : '#16a34a' }} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                        <Tooltip title={t('actions.print', 'Print')}>
                          <IconButton aria-label={t('actions.print', 'Print')} onClick={() => handlePrint(id)} size="small">
                            <PrintIcon fontSize="small" sx={{ color: '#475569' }} />
                          </IconButton>
                        </Tooltip>
                        {hasJournal ? (
                          <Tooltip title={t('actions.deleteDocument', isRTL ? 'حذف سند' : 'Delete Document')}>
                            <IconButton aria-label={t('actions.deleteDocument', isRTL ? 'حذف سند' : 'Delete Document')} onClick={() => handleDeleteJournal(String(it.journalId))} size="small">
                              <ArticleIcon fontSize="small" sx={{ color: '#dc2626' }} />
                            </IconButton>
                          </Tooltip>
                        ) : (
                          isDraft && (
                            <Tooltip title={t('actions.delete', 'Delete')}>
                              <IconButton aria-label={t('actions.delete', 'Delete')} onClick={() => handleDelete(id)} size="small">
                                <DeleteIcon fontSize="small" sx={{ color: '#dc2626' }} />
                              </IconButton>
                            </Tooltip>
                          )
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
        message={t('pages.receipts.confirmDelete', 'Delete this draft receipt?')}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
        type="danger"
        dimBackground={false}
      />

      {/* Confirm document deletion dialog */}
      <ConfirmDialog
        open={!!confirmDeleteJournalId}
        title={t('actions.deleteDocument', isRTL ? 'حذف سند' : 'Delete Document')}
        message={t('pages.receipts.confirmDeleteDocument', isRTL ? 'سند ایجادشده از این دریافت حذف شود؟' : 'Delete the document created from this receipt?')}
        onConfirm={handleConfirmDeleteJournal}
        onCancel={() => setConfirmDeleteJournalId(null)}
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

export default ReceiptsPage;

/** toISODate
 * Converts a JavaScript Date to 'YYYY-MM-DD'. */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** getSelectedDetailOption
 * Returns the selected detail option object for current filters.detailId.
 */
function getSelectedDetailOption(options: Array<{ id: string | number; name: string }>, id: string): { id: string | number; name: string } | null {
  if (!id) return null;
  return options.find((o) => String(o.id) === id) || null;
}

/** getEditIconColor
* Returns gray for disabled edit (journal exists), otherwise green.
*/
function getEditIconColor(hasJournal: boolean): string {
  return hasJournal ? '#9ca3af' : '#16a34a';
}