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
import JalaliDateRangePicker from '../components/common/JalaliDateRangePicker';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import { getCurrentLang } from '../i18n';
import { openJournalDailyPrintByIds, openJournalDailyPrintByFilter } from '../print/journalDaily';
import TableSortHeader from '../components/common/TableSortHeader';
import Pagination from '../components/common/Pagination';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useNavigate } from 'react-router-dom';
import { FormControl, IconButton, InputLabel, MenuItem, Select, TextField, Tooltip } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PrintIcon from '@mui/icons-material/Print';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import MultiSelect, { MultiSelectOption } from '../components/common/MultiSelect';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ImageIcon from '@mui/icons-material/Image';
import AutorenewIcon from '@mui/icons-material/Autorenew';

interface FiscalYearRef { id: number; name: string; start_date: string; end_date: string; is_closed?: boolean; }

interface DocumentListItem {
  id: string;
  ref_no: string;
  code?: string;
  date: string; // ISO YYYY-MM-DD (Gregorian storage)
  type?: string;
  provider?: string;
  status?: string; // temporary, permanent
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
  const [providers, setProviders] = useState<string[]>([]);
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
  // Selection removed: printing uses currently visible filtered rows

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
   * Localizes journal status using i18n keys for both EN/FA.
   * Falls back to raw status when unknown.
   */
  function formatStatus(status?: string): string {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'draft':
        return t('status.draft', getCurrentLang() === 'fa' ? 'پیش‌نویس' : 'Draft');
      case 'temporary':
        return t('status.temporary', getCurrentLang() === 'fa' ? 'موقت' : 'Temporary');
      case 'permanent':
        return t('status.permanent', getCurrentLang() === 'fa' ? 'دائمی' : 'Permanent');
      default:
        return s || '-';
    }
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
    if (providers && providers.length > 0) q.provider = providers.join(',');
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
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals`, { params });
      const payload = res.data;
      const itemsArr: DocumentListItem[] = payload.items || payload || [];
      setItems(itemsArr);
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
   * Posts a temporary journal to 'permanent' status.
   */
  async function confirmDocument(id: string): Promise<void> {
    try { await axios.post(`${config.API_ENDPOINTS.base}/v1/journals/${id}/post`); await fetchDocuments(); } catch {/* noop */}
  }

  /**
   * deleteDocument
   * Deletes a temporary journal.
   */
  async function deleteDocument(id: string): Promise<void> {
    try { await axios.delete(`${config.API_ENDPOINTS.base}/v1/journals/${id}`); await fetchDocuments(); } catch {/* noop */}
  }

  /**
   * printDocument
   * Loads a journal by id and opens a print-friendly window with a detailed
   * layout (header + items). The browser’s print dialog can be used to
   * save as PDF. Supports EN/FA with RTL-aware styling and digit localization.
   */
  async function printDocument(id: string): Promise<void> {
    try {
      const lang = getCurrentLang();
      const rtl = lang === 'fa';
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals/${id}`);
      const data = res.data?.item || res.data;
      if (!data) return;

      const docCode = String(data.code || '');
      const docDate = formatDisplayDate(String(data.date || ''));
      const rawStatus = String(data.status || '').trim();
      const docStatus = rtl
        ? ({ temporary: 'موقت', draft: 'پیش‌نویس', permanent: 'قطعی', posted: 'ثبت‌شده' }[rawStatus] || rawStatus)
        : rawStatus;
      const docRefNo = String(data.ref_no || '');
      const providerRaw = String(data.provider || '').trim();
      const docProvider = formatProvider(providerRaw);
      const docDescription = String(data.description || '');

      const items: any[] = Array.isArray(data.items) ? data.items : [];

      // Build printable HTML with simple styling, RTL-aware.
      const title = rtl ? 'سند حسابداری' : 'Accounting Journal';
      const headerLabel = rtl ? 'مشخصات سند' : 'Journal Header';
      const itemsLabel = rtl ? 'آیتم‌های سند' : 'Journal Items';

      // Column labels with localization fallbacks
      const colRow = rtl ? 'ردیف' : 'Row';
      const colAccount = rtl ? 'حساب' : 'Account';
      const colDetail = rtl ? 'تفصیل' : 'Detail';
      const colDescription = rtl ? 'توضیحات' : 'Description';
      const colDebit = rtl ? 'بدهکار' : 'Debit';
      const colCredit = rtl ? 'بستانکار' : 'Credit';

      const safeText = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

      // Order journal items to place Debitor (debit) rows first, then Creditor (credit) rows.
      // Keeps original relative order within each group to avoid surprising re-sequencing.
      const sortedItems = (Array.isArray(items) ? [...items] : []).sort((a, b) => {
        const aDebit = Number(a?.debit || 0) > 0;
        const bDebit = Number(b?.debit || 0) > 0;
        const aCredit = Number(a?.credit || 0) > 0;
        const bCredit = Number(b?.credit || 0) > 0;
        if (aDebit && !bDebit) return -1; // debit first
        if (!aDebit && bDebit) return 1;
        // When both are debit or neither, keep order; if both are credit, keep order
        if (aCredit && !bCredit) return 1; // credit after debit
        if (!aCredit && bCredit) return -1;
        return 0;
      });

      const rowsHtml = sortedItems.map((it, idx) => {
        const accountCodeRaw = String(it.account_code || '');
        const detailCodeRaw = String(it.detail_code || '');
        const accountTitleRaw = String(it.account_title || '');
        const detailTitleRaw = String(it.detail_title || '');
        const accountCode = rtl ? toPersianDigits(accountCodeRaw) : accountCodeRaw;
        const detailCode = rtl ? toPersianDigits(detailCodeRaw) : detailCodeRaw;
        const accountTitle = safeText(accountTitleRaw);
        const detailTitle = safeText(detailTitleRaw);
        // Show code first, then title (e.g., "111007 — موجودی کارت خوان های ریالی")
        const accountDisplay = (accountTitle || accountCode) ? `${accountCode}${accountTitle && accountCode ? ' — ' : ''}${accountTitle}` : '-';
        const detailDisplay = (detailTitle || detailCode) ? `${detailCode}${detailTitle && detailCode ? ' — ' : ''}${detailTitle}` : '-';
        const desc = safeText(String(it.description || ''));
        const debitStr = formatAmountNoDecimals(it.debit ?? 0);
        const creditStr = formatAmountNoDecimals(it.credit ?? 0);
        const rowNum = rtl ? toPersianDigits(String(idx + 1)) : String(idx + 1);
        return `<tr>
          <td>${rowNum}</td>
          <td>${accountDisplay}</td>
          <td>${detailDisplay}</td>
          <td>${desc}</td>
          <td class="amount text-end">${debitStr}</td>
          <td class="amount text-end">${creditStr}</td>
        </tr>`;
      }).join('');

      const codeDisp = rtl ? toPersianDigits(docCode) : docCode;
      const refDisp = rtl ? toPersianDigits(docRefNo) : docRefNo;

      const html = `<!doctype html>
<html lang="${rtl ? 'fa' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeText(title)}</title>
${rtl ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700&display=swap" />' : ''}
<style>
  body { font-family: ${rtl ? "'Vazirmatn', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" : "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"}; color: #0f172a; background: #ffffff; margin: 16px; }
  h1, h2 { margin: 0 0 8px; }
  .muted { color: #475569; }
  .section { margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: ${rtl ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr 1fr'}; gap: 8px; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #f8fafc; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 13px; }
  th { background: #f1f5f9; text-align: ${rtl ? 'right' : 'left'}; }
  td { text-align: ${rtl ? 'right' : 'left'}; }
  .text-end { text-align: ${rtl ? 'left' : 'right'}; }
  .amount { background: #f8fafc; }
  @page { size: A4 landscape; margin: 16mm; }
</style>
</head>
<body>
  <h1>${safeText(title)}</h1>
  <div class="section card">
    <h2 class="muted">${safeText(headerLabel)}</h2>
    <div class="grid">
      <div><strong>${rtl ? 'شماره سند' : 'Document Code'}:</strong> ${codeDisp || '-'}</div>
      <div><strong>${rtl ? 'شماره مرجع' : 'Ref No'}:</strong> ${refDisp || '-'}</div>
      <div><strong>${rtl ? 'تاریخ' : 'Date'}:</strong> ${docDate || '-'}</div>
      <div><strong>${rtl ? 'وضعیت' : 'Status'}:</strong> ${safeText(docStatus) || '-'}</div>
      <div><strong>${rtl ? 'ارائه‌دهنده' : 'Provider'}:</strong> ${safeText(docProvider) || '-'}</div>
      <div style="grid-column: span 3"><strong>${rtl ? 'توضیحات' : 'Description'}:</strong> ${safeText(docDescription) || '-'}</div>
    </div>
  </div>

  <div class="section">
    <h2 class="muted">${safeText(itemsLabel)}</h2>
    <table>
      <colgroup>
              <col style="width: 6%" />
              <col style="width: 25%" />
              <col style="width: 25%" />
              <col style="width: 22%" />
              <col style="width: 11%" />
              <col style="width: 11%" />
            </colgroup>
      <thead>
        <tr>
          <th>${safeText(colRow)}</th>
          <th>${safeText(colAccount)}</th>
          <th>${safeText(colDetail)}</th>
          <th>${safeText(colDescription)}</th>
          <th>${safeText(colDebit)}</th>
          <th>${safeText(colCredit)}</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </div>

  <script>
    // Auto-focus the window and trigger print, enabling Save as PDF in browser
    window.focus();
    window.addEventListener('load', function () {
      setTimeout(function () {
        try { window.print(); } catch (e) {}
      }, 200);
    });
  </script>
</body>
</html>`;

      const printWin = window.open('', '_blank');
      if (!printWin) { return; }
      printWin.document.open('text/html');
      printWin.document.write(html);
      printWin.document.close();
    } catch (e) {
      setError(t('pages.documents.printFailed', getCurrentLang() === 'fa' ? 'نمایش چاپ سند ناموفق بود' : 'Failed to open print view'));
    }
  }

  /**
   * getActiveFiltersTokens
   * Builds a list of active filter tokens to show on the print header.
   */
  function getActiveFiltersTokens(): string[] {
    const tokens: string[] = [];
    const rtl = getCurrentLang() === 'fa';
    if (fyId) {
      const fy = fiscalYears.find((f) => String(f.id) === fyId);
      if (fy) tokens.push(`${rtl ? 'سال مالی' : 'Fiscal Year'}: ${fy.name}`);
    }
    if (types.length > 0) {
      const v = types.map((x) => formatType(x)).join(rtl ? '، ' : ', ');
      tokens.push(`${rtl ? 'نوع' : 'Type'}: ${v}`);
    }
    if (statuses.length > 0) {
      const v = statuses.map((x) => formatStatus(x)).join(rtl ? '، ' : ', ');
      tokens.push(`${rtl ? 'وضعیت' : 'Status'}: ${v}`);
    }
    if (providers.length > 0) {
      const v = providers.map((x) => formatProvider(x)).join(rtl ? '، ' : ', ');
      tokens.push(`${rtl ? 'ارائه‌دهنده' : 'Provider'}: ${v}`);
    }
    if (search.trim()) {
      tokens.push(`${rtl ? 'جستجو' : 'Search'}: ${search.trim()}`);
    }
    return tokens;
  }

  /**
   * handlePrintWithFilters
   * Prints all documents matching current filters.
   */
  async function handlePrintWithFilters(): Promise<void> {
    try {
      const params = buildQueryParams();
      // Remove pagination params to fetch all
      const { page, page_size, ...filterParams } = params;
      await openJournalDailyPrintByFilter(filterParams, { dateFrom, dateTo, filters: getActiveFiltersTokens() });
    } catch (e) {
      setError(t('pages.documents.printFailed', getCurrentLang() === 'fa' ? 'نمایش چاپ سند ناموفق بود' : 'Failed to open print view'));
    }
  }

  // Initial loads and reactive fetching
  useEffect(() => { fetchFiscalYears(); }, []);
  useEffect(() => { fetchDocuments(); }, [fyId, dateFrom, dateTo, types, statuses, providers, search, sortBy, sortDir, page, pageSize]);
  useEffect(() => { if (fyId != null) { fetchDistinctFieldOptions('provider'); fetchDistinctFieldOptions('type'); } }, [fyId]);

  // Compute current fy label
  const fyLabel = useMemo(() => {
    const fy = fyId ? fiscalYears.find((f) => String(f.id) === fyId) : undefined;
    return fy ? fy.name : t('fields.fiscalYear', 'Fiscal Year');
  }, [fiscalYears, fyId]);

  
  // Build options for multi-select filters with translation-aware labels
  const statusOptions: MultiSelectOption[] = useMemo(() => ([
    { value: 'draft', label: t('status.draft', isRTL ? 'پیش‌نویس' : 'Draft') },
    { value: 'temporary', label: t('status.temporary', isRTL ? 'موقت' : 'Temporary') },
    { value: 'permanent', label: t('status.permanent', isRTL ? 'دائمی' : 'Permanent') },
  ]), [isRTL, t]);

  const [typeOptions, setTypeOptions] = useState<MultiSelectOption[]>([]);
  const [providerOptions, setProviderOptions] = useState<MultiSelectOption[]>([]);

  /**
   * fetchDistinctFieldOptions
   * Loads distinct values for a journal field ('provider' | 'type') via paginated queries
   * and updates the options for corresponding multi-selects.
   */
  async function fetchDistinctFieldOptions(field: 'provider' | 'type'): Promise<void> {
    try {
      const pageSize = 100;
      const seen = new Set<string>();
      let pageIdx = 1;
      for (let guard = 0; guard < 200; guard++) {
        const params: any = { sort_by: 'date', sort_dir: 'desc', page: pageIdx, page_size: pageSize };
        if (fyId != null) params.fy_id = fyId;
        const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals`, { params, headers: { 'Accept-Language': getCurrentLang() } });
        const payload = res.data;
        const list: any[] = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
        for (const row of list) {
          const val = String(row?.[field] || '').trim();
          if (val) seen.add(val);
        }
        if (list.length < pageSize) break;
        pageIdx += 1;
      }
      const opts: MultiSelectOption[] = Array.from(seen).sort().map((v) => ({
        value: v,
        label: field === 'provider' ? formatProvider(v) : formatType(v),
      }));
      if (field === 'provider') setProviderOptions(opts);
      else setTypeOptions(opts);
    } catch {
      // Non-blocking
    }
  }

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
   * Posts all currently filtered temporary documents. Validates on server side; shows localized errors.
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
      if (providers && providers.length > 0) body.provider = providers.join(',');
      await axios.post(`${config.API_ENDPOINTS.base}/v1/journals/bulk-post`, body, { headers: { 'Accept-Language': getCurrentLang() } });
      await fetchDocuments();
    } catch (e) {
      setError(t('pages.documents.bulkPostFailed', isRTL ? 'ارسال گروهی ناموفق بود' : 'Bulk post failed'));
    }
  }

  /**
   * canModifyDocument
   * Enables edit/delete only when provider is null/empty or 'content'.
   */
  function canModifyDocument(provider?: string | null): boolean {
    const p = (provider || '').trim().toLowerCase();
    return p === '' || p === 'content';
  }

  /**
   * isTreasuryReceipt
   * Returns true when provider is 'treasury' and type is 'receipt'.
   */
  function isTreasuryReceipt(doc: DocumentListItem): boolean {
    const p = String(doc.provider || '').trim().toLowerCase();
    const t = String(doc.type || '').trim().toLowerCase();
    return p === 'treasury' && t === 'receipt';
  }

  /**
   * isTreasuryPayment
   * Returns true when provider is 'treasury' and type is 'payment'.
   */
  function isTreasuryPayment(doc: DocumentListItem): boolean {
    const p = String(doc.provider || '').trim().toLowerCase();
    const t = String(doc.type || '').trim().toLowerCase();
    return p === 'treasury' && t === 'payment';
  }

  /**
   * isProductionDocument
   * Returns true when provider is 'production'.
   */
  function isProductionDocument(doc: DocumentListItem): boolean {
    const p = String(doc.provider || '').trim().toLowerCase();
    return p === 'production';
  }

  /**
   * canEditDocument
   * Disables Edit for 'permanent' documents and for treasury receipts.
   * Allows Edit for plain/content documents.
   */
  function canEditDocument(doc: DocumentListItem): boolean {
    const p = String(doc.provider || '').trim().toLowerCase();
    const t = String(doc.type || '').trim().toLowerCase();
    const s = String(doc.status || '').trim().toLowerCase();
    if (s === 'permanent') return false;
    if (p === 'treasury' && t === 'receipt') return false;
    if (p === '' || p === 'content') return true;
    return false;
  }

  /**
   * canDeleteDocument
   * Enables Delete unless status is 'permanent'. Allows treasury receipts.
   * Also enables Delete for provider 'production' as requested.
   */
  function canDeleteDocument(doc: DocumentListItem): boolean {
    const s = String(doc.status || '').trim().toLowerCase();
    if (s === 'permanent') return false;
    const p = String(doc.provider || '').trim().toLowerCase();
    const t = String(doc.type || '').trim().toLowerCase();
    if (p === '' || p === 'content') return true;
    if (p === 'treasury' && t === 'receipt') return true;
    if (p === 'treasury' && t === 'payment') return true;
    if (p === 'production') return true; // FA: فعال‌سازی حذف برای ارائه‌دهنده «تولید»
    return false;
  }

  /**
   * navigateEditForDocument
   * Routes to the appropriate edit page based on provider/type.
   * - Treasury receipt: resolves receipt by journal_id, navigates to /treasury/receipts/:id
   * - Default: opens /documents/new?id=:journalId
   */
  async function navigateEditForDocument(doc: DocumentListItem): Promise<void> {
    const provider = String(doc.provider || '').trim().toLowerCase();
    const type = String(doc.type || '').trim().toLowerCase();
    if (provider === 'treasury' && type === 'receipt') {
      try {
        const lang = getCurrentLang();
        const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/receipts/by-journal/${encodeURIComponent(doc.id)}`, { headers: { 'Accept-Language': lang } });
        const rid = res.data?.item?.id || res.data?.id || null;
        if (!rid) throw new Error('missing id');
        navigate(`/treasury/receipts/${encodeURIComponent(rid)}`);
        return;
      } catch (e) {
        setError(t('pages.documents.receiptResolveError', isRTL ? 'یافتن دریافتیِ مرتبط با این سند ممکن نیست' : 'Could not locate receipt for this document'));
        return;
      }
    }
    navigate(`/documents/new?id=${doc.id}`);
  }

  /**
   * getDeleteConfirmMessage
   * Returns localized delete confirm message.
   * For treasury receipts, clarifies the receipt will become temporary and link removed.
   */
  function getDeleteConfirmMessage(doc?: DocumentListItem | null): string {
    if (doc && isTreasuryReceipt(doc)) {
      return t('pages.documents.deleteConfirmReceiptOrigin', isRTL ? 'این سند از دریافتی خزانه‌داری ایجاد شده است. با حذف آن، وضعیت دریافتی «موقت» می‌شود و ارتباطش حذف خواهد شد.' : 'This document comes from a Treasury receipt. Deleting it will make the receipt temporary and remove its link.');
    }
    if (doc && isTreasuryPayment(doc)) {
      return t('pages.documents.deleteConfirmPaymentOrigin', isRTL ? 'این سند از پرداخت خزانه‌داری ایجاد شده است. با حذف آن، وضعیت پرداخت «پیش‌نویس» می‌شود و ارتباطش حذف خواهد شد.' : 'This document comes from a Treasury payment. Deleting it will make the payment draft and remove its link.');
    }
    return t('pages.documents.deleteConfirm', isRTL ? 'این سند موقت حذف شود؟' : 'Delete this temporary document?');
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
              <IconButton onClick={openRenumberConfirm} color="primary" size="medium" aria-label={t('actions.reorderCodes', isRTL ? 'مرتب‌سازی کدها' : 'Reorder codes')} className="hover:bg-gray-100">
                <FormatListNumberedIcon />
              </IconButton>
            </Tooltip>
            {/* Print button relocated here */}
              <Tooltip title={isRTL ? 'دفتر روزنامه' : 'Journal Notebook'} arrow>
                <IconButton
                  onClick={handlePrintWithFilters}
                  color="info"
                  size="medium"
                  aria-label={t('pages.documents.printSelected', isRTL ? 'چاپ روزنامه' : 'Print Journal')}
                  className="hover:bg-gray-100"
                >
                  <MenuBookIcon />
                </IconButton>
              </Tooltip>
              {/* Reset filters */}
              <Tooltip title={isRTL ? 'بازنشانی فیلترها' : 'Reset Filters'} arrow>
                <IconButton
                  onClick={() => {
                    setTypes([]);
                    setStatuses([]);
                    setProviders([]);
                    setSearch('');
                    setFromDate(null);
                    setToDate(null);
                    setDateFrom('');
                    setDateTo('');
                    setSortBy('date');
                    setSortDir('desc');
                    setPage(1);
                    fetchDocuments();
                  }}
                  color="secondary"
                  size="medium"
                  aria-label={isRTL ? 'بازنشانی فیلترها' : 'Reset Filters'}
                  className="hover:bg-gray-100"
                >
                  <AutorenewIcon />
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
                <MultiSelect
                  label={t('fields.provider', 'Provider')}
                  value={providers}
                  onChange={setProviders}
                  options={providerOptions}
                  minWidth={200}
                  size="small"
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
            <div className="text-xs text-gray-600 mt-1">
              {t('pages.documents.activeDateRange', isRTL ? 'بازه فعال:' : 'Active range:')}{' '}
              {dateFrom ? formatDisplayDate(dateFrom) : (isRTL ? 'نامشخص' : 'Unknown')} {isRTL ? 'تا' : '→'} {dateTo ? formatDisplayDate(dateTo) : (isRTL ? 'نامشخص' : 'Unknown')}
            </div>
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
                   {/* Checkbox column removed */}

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
                          <IconButton onClick={openBulkPostConfirm} color="success" size="small" aria-label={t('actions.postFiltered', isRTL ? 'ارسال گروهی' : 'Post filtered')} className="hover:bg-gray-100">
                             <CheckCircleIcon />
                            </IconButton>
                         </Tooltip>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((doc) => (
                    <tr key={doc.id} className={`border-b border-gray-200 hover:bg-gray-50 ${doc.status === 'draft' ? 'bg-red-50' : ''}`}>
                      <td className={`py-2 px-1 ${isRTL ? 'text-right' : 'text-left'}`}>{getCurrentLang() === 'fa' ? toPersianDigits(String(doc.code ?? '')) : doc.code}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatDisplayDate(doc.date)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'} truncate`}>{formatType(doc.type)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'} truncate`}>{formatProvider(doc.provider)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'} truncate`}>{doc.description || '-'}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'} truncate`}>{formatStatus(doc.status)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatAmountNoDecimals(doc.total ?? 0)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>
                        <div className="flex gap-1 items-center whitespace-nowrap">
                          <IconButton onClick={() => navigate(`/documents/new?id=${doc.id}`)} color="primary" size="medium" aria-label={t('actions.edit','Edit')} disabled={!canEditDocument(doc)} className="hover:bg-gray-100">
                            <EditIcon className="text-[22px]" />
                          </IconButton>
                          <IconButton onClick={() => { setDeleteTargetId(doc.id); setDeleteOpen(true); }} color="error" size="medium" aria-label={t('actions.delete','Delete')} disabled={!canDeleteDocument(doc)} className="hover:bg-gray-100">
                            {isTreasuryReceipt(doc) || isTreasuryPayment(doc) ? <ReceiptLongIcon className="text-[22px]" /> : isProductionDocument(doc) ? <ImageIcon className="text-[22px]" /> : <DeleteIcon className="text-[22px]" />}
                          </IconButton>
                          <Tooltip title={t('actions.print','Print')} arrow>
                            <IconButton onClick={() => printDocument(doc.id)} color="default" size="medium" aria-label={t('actions.print','Print')} className="hover:bg-gray-100">
                              <PrintIcon />
                            </IconButton>
                          </Tooltip>
                          <IconButton onClick={() => confirmDocument(doc.id)} color="success" size="medium" disabled={doc.status !== 'temporary'} aria-label={t('actions.confirm','Confirm')} className="hover:bg-gray-100">
                            <CheckCircleIcon className="text-[22px]" />
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
                message={getDeleteConfirmMessage(items.find((i) => i.id === deleteTargetId))}
                onConfirm={async () => { if (deleteTargetId != null) { await deleteDocument(deleteTargetId); } setDeleteOpen(false); setDeleteTargetId(null); }}
                onCancel={() => { setDeleteOpen(false); setDeleteTargetId(null); }}
                type="danger"
                dimBackground={false}
              />

              {/* Confirm bulk post dialog */}
              <ConfirmDialog
                open={confirmBulkOpen}
                title={t('pages.documents.bulkPostConfirmTitle', isRTL ? 'ارسال گروهی اسناد' : 'Bulk post documents')}
                message={t('pages.documents.bulkPostConfirmMessage', isRTL ? 'این عملیات همه اسناد موقتِ فیلترشده را به وضعیت دائمی تغییر می‌دهد. ادامه می‌دهید؟' : 'This will change all filtered temporary documents to permanent. Continue?')}
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
  return [8, 8, 10, 10, 34, 8, 10, 12];
}


/**
 * formatType
 * Localizes journal type ('general', 'receipt', 'payment', 'opening', 'closing', 'adjustment', 'treasury')
 * based on the current language.
 */
function formatType(type?: string): string {
  const raw = String(type || '').trim().toLowerCase();
  const lang = getCurrentLang();
  if (lang === 'fa') {
    const mapFa: Record<string, string> = {
      general: 'عمومی',
      receipt: 'دریافت',
      payment: 'پرداخت',
      opening: 'افتتاحیه',
      closing: 'اختتامیه',
      adjustment: 'اصلاحی',
      treasury: 'خزانه',
      receiving: 'خرید',
      sales: 'فروش'
    };
    return mapFa[raw] || (raw ? raw : 'عمومی');
  } else {
    const mapEn: Record<string, string> = {
      general: 'General',
      receipt: 'Receipt',
      payment: 'Payment',
      opening: 'Opening',
      closing: 'Closing',
      adjustment: 'Adjustment',
      treasury: 'Treasury'
    };
    return mapEn[raw] || (raw ? raw : 'General');
  }
}

/**
 * formatProvider
 * Localizes journal provider ('treasury','accountant','accounting','content','sales','purchase','warehouse','system')
 * based on the current language. Falls back to 'Accounting'/'حسابداری' when empty or unknown.
 */
function formatProvider(provider?: string): string {
  const raw = String(provider || '').trim().toLowerCase();
  const lang = getCurrentLang();
  if (lang === 'fa') {
    const mapFa: Record<string, string> = {
      accountant: 'حسابدار',
      accounting: 'حسابداری',
      treasury: 'خزانه‌داری',
      sales: 'فروش',
      purchase: 'خرید',
      warehouse: 'انبار',
      content: 'محتوا',
      system: 'سیستم',
      production: 'تولید'
    };
    return mapFa[raw] || (raw ? raw : 'حسابداری');
  } else {
    const mapEn: Record<string, string> = {
      accountant: 'Accountant',
      accounting: 'Accounting',
      treasury: 'Treasury',
      sales: 'Sales',
      purchase: 'Purchase',
      warehouse: 'Warehouse',
      content: 'Content',
      system: 'System',
      production: 'Production'
    };
    return mapEn[raw] || (raw ? raw : 'Accounting');
  }
}
