/**
 * DocumentsPage
 * - Lists documents (journals) with server-side filters, sorting, and pagination.
 * - Aligns with documentPages.md requirements: fiscal year filter, Jalali date, row actions.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import JalaliDateRangePicker from '../../../../admin/src/components/Common/JalaliDateRangePicker';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import { getCurrentLang } from '../i18n';
import TableSortHeader from '../components/common/TableSortHeader';
import Pagination from '../components/common/Pagination';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useNavigate } from 'react-router-dom';
import { FormControl, IconButton, InputLabel, MenuItem, Select, TextField, Tooltip } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PrintIcon from '@mui/icons-material/Print';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import MultiSelect, { MultiSelectOption } from '../components/common/MultiSelect';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';

interface FiscalYearRef { id: number; name: string; start_date: string; end_date: string; is_closed?: boolean; }

interface DocumentListItem {
  id: string;
  ref_no: string;
  code?: string;
  date: string; // ISO YYYY-MM-DD (Gregorian storage)
  type?: string;
  provider?: string;
  status?: string; // draft, posted
  description?: string; // journal description
  total?: number;
}

const DocumentsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Filters
  const [fyId, setFyId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [provider, setProvider] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);

  // Data
  const [items, setItems] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRef[]>([]);

  // Table state (server-side)
  const [sortBy, setSortBy] = useState<string>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [total, setTotal] = useState<number>(0);

  const isRTL = getCurrentLang() === 'fa';

  // Deletion confirm dialog state
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // Bulk post confirm dialog state
  const [confirmBulkOpen, setConfirmBulkOpen] = useState<boolean>(false);
  const [confirmRenumberOpen, setConfirmRenumberOpen] = useState<boolean>(false);

  /**
   * openBulkPostConfirm
   * Opens confirmation dialog for bulk posting filtered drafts.
   */
  function openBulkPostConfirm(): void { setConfirmBulkOpen(true); }

  /**
   * closeBulkPostConfirm
   * Closes the bulk post confirmation dialog.
   */
  function closeBulkPostConfirm(): void { setConfirmBulkOpen(false); }

  /**
   * openRenumberConfirm
   * Opens confirmation dialog for renumbering document codes.
   */
  function openRenumberConfirm(): void { setConfirmRenumberOpen(true); }

  /**
   * closeRenumberConfirm
   * Closes the renumber confirmation dialog.
   */
  function closeRenumberConfirm(): void { setConfirmRenumberOpen(false); }

  /**
   * toPersianDigits
   * Converts ASCII digits to Persian digits for localized display.
   */
  function toPersianDigits(s: string): string {
    const map: Record<string, string> = {
      '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴',
      '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹',
    };
    return String(s).replace(/[0-9]/g, (d) => map[d] || d);
  }

  /**
   * toDateObjectSafe
   * Safely converts various date string formats into a DateObject.
   */
  function toDateObjectSafe(iso?: string): DateObject | null {
    if (!iso) return null;
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new DateObject(iso);
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return new DateObject(d);
      const parts = iso.replace(/\//g, '-').split('-');
      if (parts.length === 3) {
        const [y, m, dd] = parts.map((p) => parseInt(p, 10));
        if (!isNaN(y) && !isNaN(m) && !isNaN(dd)) {
          return new DateObject({ year: y, month: m, day: dd });
        }
      }
      return null;
    } catch { return null; }
  }

  /**
   * formatDisplayDate
   * Force-converts Gregorian ISO to Jalali (YYYY/MM/DD) and always uses Persian digits.
   * Debug: logs input ISO, DateObject parsing, Jalali conversion parts, and final output.
   */
  function formatDisplayDate(iso?: string): string {
    console.log('[DocumentsPage] formatDisplayDate: called', { iso });
    const obj = toDateObjectSafe(iso);
    if (!obj) {
      console.warn('[DocumentsPage] formatDisplayDate: invalid input, cannot build DateObject', { iso });
      return '-';
    }
    try {
      const j = obj.convert(persian);
      const jy = String(j.year).padStart(4, '0');
      const jm = String(j.month.number).padStart(2, '0');
      const jd = String(j.day).padStart(2, '0');
      const out = `${jy}/${jm}/${jd}`;
      const outFa = toPersianDigits(out);
      console.log('[DocumentsPage] formatDisplayDate: success', {
        iso,
        gregorian: `${obj.year}-${obj.month.number}-${obj.day}`,
        jalaliAscii: out,
        jalaliPersian: outFa,
      });
      return outFa;
    } catch (err) {
      console.error('[DocumentsPage] formatDisplayDate: conversion error', { iso, err });
      return iso || '-';
    }
  }

  /**
   * formatAmountNoDecimals
   * Formats amounts with thousand separators and no decimals. Localizes digits in Farsi.
   */
  function formatAmountNoDecimals(val?: number | string): string {
    const n = Number(val || 0);
    const lang = getCurrentLang();
    try {
      const fmt = new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
      return fmt.format(Math.round(n));
    } catch {
      const ascii = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return lang === 'fa' ? toPersianDigits(ascii) : ascii;
    }
  }

  /**
   * formatStatus
   * Localizes journal status to Farsi when applicable.
   */
  function formatStatus(status?: string): string {
    const s = (status || '').toLowerCase();
    const lang = getCurrentLang();
    if (lang !== 'fa') return s || '-';
    const map: Record<string, string> = {
      draft: 'موقت',
      posted: 'ثبت‌شده',
      reversed: 'برگشتی',
    };
    return map[s] || (s ? s : '-');
  }

  /**
   * parseCodeRangeFromSearch
   * Parses search text for a numeric range like "10-20" and also supports Farsi/Arabic-Indic digits
   * and common separators ("-", "–", "—", "−", and the Farsi word "تا").
   * Also accepts a single number (e.g., "۲۰" or "20") with optional trailing punctuation.
   * Returns inclusive code range when matched.
   */
  function parseCodeRangeFromSearch(s?: string): { code_from?: number; code_to?: number } {
    const raw = (s || '').trim();
    // Normalize Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII 0-9
    const text = raw
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString())
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString());

    // First, try range separators: -, –, —, −, or words تا / to
    const mRange = text.match(/^(\d+)\s*(?:-|–|—|−|تا|to)\s*(\d+)$/i);
    if (mRange) {
      const a = Number(mRange[1]);
      const b = Number(mRange[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        return { code_from: Math.min(a, b), code_to: Math.max(a, b) };
      }
    }

    // Then, accept single numbers with optional trailing punctuation/spaces
    const mSingle = text.match(/^(\d+)(?:[\s,.;:،٫٬…؛!؟]*)$/);
    if (mSingle) {
      const n = Number(mSingle[1]);
      if (Number.isFinite(n)) {
        return { code_from: n, code_to: n };
      }
    }

    return {};
  }

  /**
   * buildQueryParams
   * Constructs query object for server-side filtering, sorting, and pagination.
   */
  function buildQueryParams(): Record<string, any> {
    const q: Record<string, any> = {
      page, page_size: pageSize,
      sort_by: sortBy, sort_dir: sortDir,
    };
    if (fyId != null) q.fy_id = fyId;
    if (dateFrom) q.date_from = dateFrom;
    if (dateTo) q.date_to = dateTo;
    // Support multi-select values for type and status (comma-separated)
    if (types && types.length > 0) q.type = types.join(',');
    if (statuses && statuses.length > 0) q.status = statuses.join(',');
    if (provider) q.provider = provider;
    const range = parseCodeRangeFromSearch(search);
    if (range.code_from != null) q.code_from = range.code_from;
    if (range.code_to != null) q.code_to = range.code_to;
    if (search && range.code_from == null && range.code_to == null) q.search = search;
    return q;
  }

  /**
   * fetchFiscalYears
   * Loads fiscal years to populate the filter; defaults fyId to open year if available.
   */
  async function fetchFiscalYears(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/fiscal-years`);
      const list: FiscalYearRef[] = res.data.items || res.data || [];
      setFiscalYears(list);
      // Set default fiscal year, avoiding "All"
      if (fyId === null) {
        const def = selectDefaultFiscalYear(list);
        if (def != null) setFyId(def);
      }
    } catch { /* non-blocking */ }
  }

  /**
   * fetchDocuments
   * Queries backend for journals list (/v1/journals) with current filters and table state.
   */
  async function fetchDocuments(): Promise<void> {
    if (fyId == null) { return; }
    setLoading(true);
    setError('');
    try {
      const params = buildQueryParams();
      console.log('[DocumentsPage] fetchDocuments: params', params);
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals`, { params });
      const payload = res.data;
      const itemsArr: DocumentListItem[] = payload.items || payload || [];
      setItems(itemsArr);
      console.log('[DocumentsPage] fetchDocuments: received items', itemsArr.map(i => ({ id: i.id, date: i.date })));
      setTotal(payload.total ?? itemsArr.length);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * handleSort
   * Toggles sortDir for same column or sets new sort column.
   */
  function handleSort(key: string): void {
    setSortBy((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
    setPage(1);
  }

  /**
   * handlePageSizeChange
   * Updates pageSize and resets to first page.
   */
  function handlePageSizeChange(newSize: number): void {
    setPageSize(newSize);
    setPage(1);
  }

  /**
   * confirmDocument
   * Posts a draft journal to 'posted' status.
   */
  async function confirmDocument(id: string): Promise<void> {
    try { await axios.post(`${config.API_ENDPOINTS.base}/v1/journals/${id}/post`); await fetchDocuments(); } catch {/* noop */}
  }

  /**
   * deleteDocument
   * Deletes a draft journal.
   */
  async function deleteDocument(id: string): Promise<void> {
    try { await axios.delete(`${config.API_ENDPOINTS.base}/v1/journals/${id}`); await fetchDocuments(); } catch {/* noop */}
  }

  /**
   * printDocument
   * Fetches a journal for print preview (placeholder).
   */
  async function printDocument(id: string): Promise<void> {
    try { await axios.get(`${config.API_ENDPOINTS.base}/v1/journals/${id}`); } catch {/* noop */}
  }

  // Initial loads and reactive fetching
  useEffect(() => { fetchFiscalYears(); }, []);
  useEffect(() => { fetchDocuments(); }, [fyId, dateFrom, dateTo, types, statuses, provider, search, sortBy, sortDir, page, pageSize]);

  // Compute current fy label
  const fyLabel = useMemo(() => {
    const fy = fyId ? fiscalYears.find((f) => String(f.id) === fyId) : undefined;
    return fy ? fy.name : t('fields.fiscalYear', 'Fiscal Year');
  }, [fiscalYears, fyId]);

  
  // Build options for multi-select filters with translation-aware labels
  const statusOptions: MultiSelectOption[] = useMemo(() => ([
    { value: 'draft', label: t('status.draft', isRTL ? 'موقت' : 'Draft') },
    { value: 'posted', label: t('status.posted', isRTL ? 'ثبت‌شده' : 'Posted') },
  ]), [isRTL, t]);

  const typeOptions: MultiSelectOption[] = useMemo(() => ([
    { value: 'general', label: t('types.general', isRTL ? 'عمومی' : 'General') },
  ]), [isRTL, t]);

  /**
   * handleReorderCodes
   * Calls backend to reorder journal codes by ascending date within the active fiscal year.
   */
  async function handleReorderCodes(): Promise<void> {
    if (!fyId) {
      setError(t('pages.documents.noFiscalYear', isRTL ? 'ابتدا سال مالی را انتخاب کنید' : 'Select a fiscal year first'));
      return;
    }
    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/journals/reorder-codes`, { fiscal_year_id: fyId }, { headers: { 'Accept-Language': getCurrentLang() } });
      await fetchDocuments();
    } catch (e) {
      setError(t('pages.documents.reorderFailed', isRTL ? 'مرتب‌سازی کدها ناموفق بود' : 'Failed to reorder codes'));
    }
  }

  /**
   * handleBulkPostFiltered
   * Posts all currently filtered draft documents. Validates on server side; shows localized errors.
   */
  async function handleBulkPostFiltered(): Promise<void> {
    if (!fyId) {
      setError(t('pages.documents.noFiscalYear', isRTL ? 'ابتدا سال مالی را انتخاب کنید' : 'Select a fiscal year first'));
      return;
    }
    try {
      const body: Record<string, any> = {};
      body.fy_id = fyId;
      if (dateFrom) body.date_from = dateFrom;
      if (dateTo) body.date_to = dateTo;
      const range = parseCodeRangeFromSearch(search);
      if (range.code_from != null) body.code_from = range.code_from;
      if (range.code_to != null) body.code_to = range.code_to;
      if (search && range.code_from == null && range.code_to == null) body.search = search;
      if (statuses && statuses.length > 0) body.status = statuses.join(',');
      await axios.post(`${config.API_ENDPOINTS.base}/v1/journals/bulk-post`, body, { headers: { 'Accept-Language': getCurrentLang() } });
      await fetchDocuments();
    } catch (e) {
      setError(t('pages.documents.bulkPostFailed', isRTL ? 'ارسال گروهی ناموفق بود' : 'Bulk post failed'));
    }
  }

  return (
    <div className={"min-h-screen bg-gray-50 text-gray-900"}>
      <Navbar />
      <main className="max-w-none w-full px-6 py-6">
        {/* Header: title and New button in one row, RTL-aware ordering */}
        <div className="flex items-center justify-between mb-1">

            <>
              <h1 className="text-xl font-semibold">{t('pages.documents.title', 'Documents')}</h1>
                       {/* Active fiscal year label under New button */}
         <div className={`${isRTL ? 'text-right' : 'text-left'} mb-3`}>
           <span className="text-sm font-medium">{t('fields.fiscalYear', isRTL ? 'سال مالی' : 'Fiscal Year')}: {fyLabel}</span>
         </div>
              <button className="bg-green-700 text-white rounded px-4 py-2" onClick={() => navigate('/documents/new')}>
                {t('actions.new', 'New')}
              </button>
             </>
         </div>

 
         {/* Filter bar */}
         <section className="bg-white rounded shadow p-4 mb-6">
           <h2 className="text-lg font-medium mb-2">{t('pages.documents.filters', 'Filters')}</h2>
 
          {/* Row: Reorder icon only + filters, RTL-aware placement */}
          <div>
           <div className={getFilterRowClass()}>
                        <Tooltip title={t('actions.renumbering')} arrow>
              <IconButton onClick={openRenumberConfirm} color="primary" size="medium" aria-label={t('actions.reorderCodes', isRTL ? 'مرتب‌سازی کدها' : 'Reorder codes')}>
                <FormatListNumberedIcon />
              </IconButton>
            </Tooltip>
               {/* Compact filters */}
               <div className="w-100">
                 <MultiSelect
                   label={t('fields.status', 'Status')}
                   value={statuses}
                   onChange={setStatuses}
                   options={statusOptions}
                   minWidth={200}
                   size="small"
                 />
               </div>
               <div className="w-50">
                 <MultiSelect
                   label={t('fields.type', 'Type')}
                   value={types}
                   onChange={setTypes}
                   options={typeOptions}
                   minWidth={200}
                   size="small"
                 />
               </div>
               <div className="w-50">
                 <TextField
                   label={t('fields.provider', 'Provider')}
                   variant="outlined"
                   size="small"
                   fullWidth
                   value={provider}
                   onChange={(e) => setProvider(e.target.value)}
                 />
               </div>
               {/* Search: wider by taking remaining space */}
               <div className="flex-1 min-w-[280px]">
                 <TextField
                   label={t('fields.search', 'Search')}
                   variant="outlined"
                   size="small"
                   fullWidth
                   value={search}
                   onChange={(e) => setSearch(e.target.value)}
                   placeholder={t('pages.documents.searchPlaceholder', 'Search header and lines')}
                   helperText={t('pages.documents.searchRangeHint')}
                 />
               </div>
             </div>
           </div>
 
           {/* Date range below with reduced width */}
           <div className={getDateRangeWrapperClass()}>
             <label className="block text-sm mb-1">{t('fields.dateRange', 'Date Range')}</label>
             <JalaliDateRangePicker
               fromDate={fromDate}
               toDate={toDate}
               onFromDateChange={(d) => { setFromDate(d); setDateFrom(d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : ''); }}
               onToDateChange={(d) => { setToDate(d); setDateTo(d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : ''); }}
               onApply={() => { fetchDocuments(); }}
               includeTime={false}
             />
           </div>
         </section>

        {/* List table */}
        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.documents.list', 'Documents List')}</h2>
          {loading && <p className="text-gray-600">{t('common.loading', 'Loading...')}</p>}
          {error && <p className="text-red-600">{error}</p>}
          {!loading && items.length === 0 && <p className="text-gray-600">{t('common.noData', 'No data')}</p>}
          {!loading && items.length > 0 && (
            <>
              
              <table className="w-full text-left border-collapse table-fixed">
                <colgroup>
                  {getColumnWidths().map((w, idx) => (
                    <col key={idx} style={{ width: `${w}%` }} />
                  ))}
                </colgroup>
                 <thead className="bg-gray-100" dir={isRTL ? 'rtl' : 'ltr'}>
                  <tr className="border-b border-gray-200">
                    <TableSortHeader label={t('fields.documentCode', 'Document Code')} sortKey={'code'} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as string)} headerAlign={isRTL ? 'text-left' : 'text-right'} />
                     <TableSortHeader label={t('fields.date', 'Date')} sortKey={'date'} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as string)} headerAlign={isRTL ? 'text-left' : 'text-right'} />
                     <TableSortHeader label={t('fields.type', 'Type')} sortKey={'type'} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as string)} headerAlign={isRTL ? 'text-left' : 'text-right'} />
                     <TableSortHeader label={t('fields.provider', 'Provider')} sortKey={'provider'} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as string)} headerAlign={isRTL ? 'text-left' : 'text-right'} />
                     <TableSortHeader label={t('fields.description', 'Description')} sortKey={'description'} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as string)} headerAlign={isRTL ? 'text-left' : 'text-right'} />
                     <TableSortHeader label={t('fields.status', 'Status')} sortKey={'status'} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as string)} headerAlign={isRTL ? 'text-left' : 'text-right'} />
                     <TableSortHeader label={t('fields.total', 'Total')} sortKey={'total'} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as string)} headerAlign={isRTL ? 'text-left' : 'text-right'} />
                     <th className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>
                       <div className="flex items-center gap-2">
                         {t('actions.actions', isRTL ? 'عملیات' : 'Actions')}
                         <Tooltip title={t('actions.postFiltered')} arrow>
                           <IconButton onClick={openBulkPostConfirm} color="success" size="small" aria-label={t('actions.postFiltered', isRTL ? 'ارسال گروهی' : 'Post filtered')}>
                              <CheckCircleIcon />
                            </IconButton>
                         </Tooltip>
                       </div>
                     </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((doc) => (
                    <tr key={doc.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{getCurrentLang() === 'fa' ? toPersianDigits(String(doc.code ?? '')) : doc.code}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatDisplayDate(doc.date)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'} truncate`}>{doc.type || (isRTL ? 'عمومی' : 'General')}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'} truncate`}>{doc.provider || (isRTL ? 'حسابداری' : 'Accounting')}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'} truncate`}>{doc.description || '-'}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'} truncate`}>{formatStatus(doc.status)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatAmountNoDecimals(doc.total ?? 0)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>
                        <div className="flex flex-wrap gap-1">
                          <IconButton onClick={() => navigate(`/documents/new?id=${doc.id}`)} color="primary" size="small" aria-label={t('actions.edit','Edit')}>
                            <EditIcon className="text-[20px]" />
                          </IconButton>
                          <IconButton onClick={() => { setDeleteTargetId(doc.id); setDeleteOpen(true); }} color="error" size="small" aria-label={t('actions.delete','Delete')}>
                            <DeleteIcon />
                          </IconButton>
                          <IconButton onClick={() => printDocument(doc.id)} color="default" size="small" aria-label={t('actions.print','Print')}>
                            <PrintIcon />
                          </IconButton>
                          <IconButton onClick={() => confirmDocument(doc.id)} color="success" size="small" disabled={doc.status !== 'draft'} aria-label={t('actions.confirm','Confirm')}>
                            <CheckCircleIcon />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={handlePageSizeChange} className="mt-3" />
              {/* Confirm delete dialog */}
              <ConfirmDialog
                open={deleteOpen}
                title={t('actions.delete', 'Delete')}
                message={t('pages.documents.deleteConfirm', 'Delete this draft document?')}
                onConfirm={async () => { if (deleteTargetId != null) { await deleteDocument(deleteTargetId); } setDeleteOpen(false); setDeleteTargetId(null); }}
                onCancel={() => { setDeleteOpen(false); setDeleteTargetId(null); }}
                type="danger"
                dimBackground={false}
              />

              {/* Confirm bulk post dialog */}
              <ConfirmDialog
                open={confirmBulkOpen}
                title={t('pages.documents.bulkPostConfirmTitle', isRTL ? 'ارسال گروهی اسناد' : 'Bulk post documents')}
                message={t('pages.documents.bulkPostConfirmMessage', isRTL ? 'این عملیات همه اسناد موقتِ فیلترشده را به وضعیت ثبت‌شده (دائمی) تغییر می‌دهد. ادامه می‌دهید؟' : 'This will change all filtered draft documents to posted (permanent). Continue?')}
                onConfirm={async () => { await handleBulkPostFiltered(); closeBulkPostConfirm(); }}
                onCancel={() => { closeBulkPostConfirm(); }}
                type="warning"
                dimBackground={false}
              />

              {/* Confirm renumber codes dialog */}
              <ConfirmDialog
                open={confirmRenumberOpen}
                title={t('pages.documents.renumberConfirmTitle', isRTL ? 'شماره‌گذاری مجدد اسناد' : 'Renumber documents')}
                message={t('pages.documents.renumberConfirmMessage', isRTL ? 'این عملیات کد اسناد را بر اساس تاریخ و ترتیب جدید بازشماره می‌کند. ادامه می‌دهید؟' : 'This will renumber document codes based on date/order. Continue?')}
                onConfirm={async () => { await handleReorderCodes(); closeRenumberConfirm(); }}
                onCancel={() => { closeRenumberConfirm(); }}
                type="warning"
                dimBackground={false}
              />
            </>
          )}
        </section>
      </main>
    </div>
  );
};

export default DocumentsPage;

/**
 * selectDefaultFiscalYear
 * Picks default fiscal year: first open year; else first item.
 */
function selectDefaultFiscalYear(list: FiscalYearRef[]): string | null {
  const openFy = list.find((fy) => !fy.is_closed);
  return openFy ? String(openFy.id) : (list.length ? String(list[0].id) : null);
}

/**
 * getFilterRowClass
 * Returns class names for the filter row honoring RTL: search appears at the beginning
 * (right side in Farsi RTL, left side in English LTR), with no wrapping.
 */
function getFilterRowClass(): string {
  const rtl = getCurrentLang() === 'fa';
  return rtl ? 'flex flex-row-reverse flex-nowrap gap-2 items-start' : 'flex flex-row flex-nowrap gap-2 items-start';
}

/**
 * getDateRangeWrapperClass
 * Restricts date range control width to only what it needs (smaller, not full width).
 */
function getDateRangeWrapperClass(): string {
  return 'mt-3 inline-block max-w-sm';
}

/**
 * getColumnWidths
 * Returns width percentages for table columns in order:
 * [Number, Date, Type, Provider, Description, Status, Total, Actions].
 * Keeps provider, status, actions, and date compact; makes description wider.
 * Works for both LTR and RTL (including Farsi) using fixed table layout.
 */
function getColumnWidths(): number[] {
  return [10, 8, 10, 10, 32, 8, 12, 10];
}