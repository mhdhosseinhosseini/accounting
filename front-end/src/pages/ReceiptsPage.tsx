import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import { Link, useNavigate, useLocation } from 'react-router-dom';
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
import { getReceipt } from '../services/receipts';
import { listCashboxes, listBankAccounts, listCardReadersForAccount, listChecks } from '../services/treasury';
import type { Cashbox, BankAccount, CardReader, Check } from '../types/treasury';
import type { Receipt, ReceiptItem } from '../types/receipts';

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

  // Print mode state
  const [printMode, setPrintMode] = useState<boolean>(false);
  const [printReceipt, setPrintReceipt] = useState<Receipt | null>(null);
  const [printLoading, setPrintLoading] = useState<boolean>(false);
  const [printError, setPrintError] = useState<string | null>(null);

  // Option lists for details rendering in print view
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [cardReadersByBankId, setCardReadersByBankId] = useState<Record<string, CardReader[]>>({});

  // Fiscal years for header label in print
  interface FiscalYearRef { id: number; name: string; start_date: string; end_date: string; is_closed?: boolean }
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRef[]>([]);
  const fyLabel = useMemo(() => {
    const id = printReceipt?.fiscalYearId ? String(printReceipt.fiscalYearId) : '';
    const fy = id ? fiscalYears.find((f) => String(f.id) === id) : undefined;
    return fy ? String(fy.name || '') : '';
  }, [fiscalYears, printReceipt?.fiscalYearId]);

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

  /** toPersianDigits
   * Converts ASCII digits to Persian digits for RTL display. */
  function toPersianDigits(str: string): string {
    return String(str).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[parseInt(d, 10)]);
  }

  /** safeText
   * Escapes HTML special characters for safe inline HTML injection. */
  function safeText(s: string): string {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
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

  /** handlePrint
   * Opens printable receipt in a new tab, similar to Documents page. */
  function handlePrint(id: string) { printReceiptInNewTab(id); }
  /** detectPrintFromQuery
   * Activates printing when URL contains ?print=1&id=<receiptId>. */
  const location = useLocation();
  useEffect(() => {
    try {
      const qs = new URLSearchParams(location.search || '');
      const p = qs.get('print');
      const rid = qs.get('id') || qs.get('receiptId') || qs.get('printId');
      if (p === '1' && rid) { printReceiptInNewTab(String(rid)); }
    } catch { /* ignore */ }
  }, [location.search]);

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

  /** formatAmountForLocale
   * Formats amounts for the current language with no decimals. */
  function formatAmountForLocale(val: number, lng: string): string {
    try {
      return new Intl.NumberFormat(lng === 'fa' ? 'fa-IR' : 'en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(Number(val || 0)));
    } catch { return formatAmountNoDecimals(val); }
  }

  /** renderItemDetails
   * Returns instrument-specific details for the Details column in print view. */
  function renderItemDetails(it: ReceiptItem): string {
    const bankAccountId = (it as any).bankAccountId ?? (it as any).bank_account_id ?? null;
    const cardReaderId = (it as any).cardReaderId ?? (it as any).card_reader_id ?? null;
    const checkId = (it as any).checkId ?? (it as any).check_id ?? null;
    const tLabel = t('pages.receipts.items.details', 'Details');

    const type = String((it as any).instrumentType || '').toLowerCase();
    if (type === 'cash') {
      const cbx = (cashboxes || []).find((c) => String(c.id) === String((it as any).cashboxId || ''));
      return cbx ? `${String(cbx.name || '')}${(cbx as any)?.code != null ? ` (${String((cbx as any).code)})` : ''}` : tLabel;
    }
    if (type === 'transfer') {
      const ba = (bankAccounts || []).find((b) => String(b.id) === String(bankAccountId || ''));
      const bank = ba ? String((ba as any).name || (ba as any).bank_name || '') : '';
      const accRaw = ba ? String((ba as any).card_number || (ba as any).account_number || '') : '';
      const acc = isRTL ? toPersianDigits(accRaw) : accRaw;
      const accText = [bank, acc].filter(Boolean).join(' - ');
      return accText || tLabel;
    }
    if (type === 'card') {
      const scopedReaders = bankAccountId ? (cardReadersByBankId[String(bankAccountId)] || []) : [];
      const globalReaders = Object.values(cardReadersByBankId).flat();
      const readersPool = scopedReaders.length ? scopedReaders : globalReaders;
      const rdr = readersPool.find((r) => String(r.id) === String(cardReaderId || ''));
      if (rdr) {
        const psp = String((rdr as any).psp_provider || '');
        const tidRaw = String((rdr as any).terminal_id || '');
        const tid = isRTL ? toPersianDigits(tidRaw) : tidRaw;
        return [psp, tid].filter(Boolean).join(' - ');
      }
      return tLabel;
    }
    if (type === 'check') {
      const chk = (checks || []).find((c) => String(c.id) === String(checkId || ''));
      if (chk) {
        const bank = String((chk as any).bank_name || '');
        const issuer = String((chk as any).issuer || '');
        const numRaw = String((chk as any).check_number || (chk as any).number || '');
        const num = isRTL ? toPersianDigits(numRaw) : numRaw;
        const due = formatDisplayDate((chk as any).due_date || '') || '';
        let account = '';
        const baId = (chk as any).bank_account_id || null;
        if (baId) {
          const ba = (bankAccounts || []).find((b) => String(b.id) === String(baId));
          const accRaw = ba ? String((ba as any).account_number || (ba as any).card_number || '') : '';
          account = isRTL ? toPersianDigits(accRaw) : accRaw;
          const name = ba ? String((ba as any).name || '') : '';
          account = [name, account].filter(Boolean).join(' ');
        }
        const parts = [bank, issuer, num, account, due].filter(Boolean);
        return parts.length ? parts.join(' - ') : tLabel;
      }
      return tLabel;
    }
    return tLabel;
  }

  /** fetchFiscalYears
   * Loads fiscal years to display label in the print header. */
  async function fetchFiscalYears(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/fiscal-years`, { headers: { 'Accept-Language': lang } });
      const list: FiscalYearRef[] = res.data.items || res.data || [];
      setFiscalYears(list);
    } catch { /* non-blocking */ }
  }

  /** loadPrintOptions
   * Fetches cashboxes, bank accounts, checks, and card readers required for rendering Details. */
  async function loadPrintOptions(): Promise<void> {
    try {
      const [cbx, accounts, chks] = await Promise.all([
        listCashboxes(),
        listBankAccounts(),
        listChecks(),
      ]);
      setCashboxes(Array.isArray(cbx) ? cbx : []);
      setBankAccounts(Array.isArray(accounts) ? accounts : []);
      setChecks(Array.isArray(chks) ? chks : []);
      const map: Record<string, CardReader[]> = {};
      await Promise.all((Array.isArray(accounts) ? accounts : []).map(async (ba: any) => {
        const rid = String(ba.id);
        try {
          const readers = await listCardReadersForAccount(rid);
          map[rid] = Array.isArray(readers) ? readers : [];
        } catch { map[rid] = []; }
      }));
      setCardReadersByBankId(map);
    } catch { /* non-blocking */ }
  }

  /** startPrint
   * Activates print mode, loads the targeted receipt and its supporting option data. */
  async function startPrint(id: string): Promise<void> {
    setPrintMode(true);
    setPrintLoading(true);
    setPrintError(null);
    try {
      const rec = await getReceipt(id);
      setPrintReceipt(rec);
      await Promise.all([loadPrintOptions(), fetchFiscalYears()]);
    } catch (e: any) {
      setPrintError(e?.response?.data?.message || e?.message || t('common.error', 'Error'));
    } finally { setPrintLoading(false); }
  }

  /** buildReceiptPrintHtml
   * Builds a standalone HTML string for printable receipt view (RTL-aware). */
  function buildReceiptPrintHtml(rec: Receipt): string {
    const rtl = isRTL;
    const title = rtl ? 'دریافتی' : 'Receipt';
    const headerLabel = rtl ? 'مشخصات دریافت' : 'Receipt Header';
    const itemsLabel = rtl ? 'آیتم‌های دریافت' : 'Receipt Items';

    const numberDisp = rtl ? toPersianDigits(String(rec.number || '')) : String(rec.number || '');
    const dateDisp = formatDisplayDate(rec.date);
    const payerName = detailNameById[String(rec.detailId || '')] || '-';
    const statusNorm = normalizeReceiptStatus(String(rec.status || ''));
    const statusLabel = statusNorm === 'draft' ? (rtl ? 'پیش‌نویس' : 'Draft') : (rtl ? 'ثبت‌شده' : 'Posted');
    const desc = safeText(String(rec.description || ''));

    const cashbox = rec.cashboxId ? (cashboxes || []).find((c) => String(c.id) === String(rec.cashboxId)) : undefined;
    const cashboxText = cashbox ? `${String(cashbox.name || '')}${(cashbox as any)?.code != null ? ` (${String((cashbox as any).code)})` : ''}` : '-';

    const colInstr = rtl ? 'نوع' : 'Instrument';
    const colRef = rtl ? 'شماره مرجع' : 'Reference No.';
    const colDetails = rtl ? 'جزئیات' : 'Details';
    const colAmount = rtl ? 'مبلغ' : 'Amount';

    const rowsHtml = (rec.items || []).map((it: any) => {
      const type = String((it as any).instrumentType || '').toLowerCase();
      const typeLabelMap: Record<string, string> = {
        cash: rtl ? 'نقد' : 'Cash',
        transfer: rtl ? 'حواله' : 'Transfer',
        card: rtl ? 'کارت' : 'Card',
        check: rtl ? 'چک' : 'Check',
      };
      const instrLabel = typeLabelMap[type] || (rtl ? 'نوع' : 'Instrument');

      // Prefer check_number/number for check items as the reference, otherwise fall back
      let refRaw: string = (it as any).reference ?? (it as any).cardRef ?? (it as any).transferRef ?? '';
      if (type === 'check') {
        const chkId = (it as any).checkId ?? (it as any).check_id;
        const chk = (checks || []).find((c) => String(c.id) === String(chkId || ''));
        refRaw = (chk as any)?.check_number ?? (chk as any)?.number ?? refRaw;
      }
      const refDisp = rtl ? toPersianDigits(String(refRaw || '')) : String(refRaw || '');

      // Details: empty for cash; else use renderItemDetails
      const detValue = renderItemDetails(it as ReceiptItem) || '';
      const det = safeText(detValue);
      const detCell = type === 'cash' ? '' : (det || '-');

      const amt = formatAmountNoDecimals((it as any).amount || 0);
      return `<tr>
        <td>${safeText(instrLabel)}</td>
        <td>${refDisp || '-'}</td>
        <td>${detCell|| '-'}</td>
        <td class="amount text-end">${amt}</td>
      </tr>`;
    }).join('');

    const total = Number(rec.totalAmount || 0) || (rec.items || []).reduce((s, ii: any) => s + Number(ii?.amount || 0), 0);
    const totalStr = formatAmountNoDecimals(total);

    const fy = rec.fiscalYearId ? fiscalYears.find((f) => String(f.id) === String(rec.fiscalYearId)) : undefined;
    const fyName = fy ? String(fy.name || '') : '';

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
  .grid { display: grid; grid-template-columns: ${rtl ? '1fr 1fr' : '1fr 1fr'}; gap: 8px; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #f8fafc; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 13px; }
  th { background: #f1f5f9; text-align: ${rtl ? 'right' : 'left'}; }
  td { text-align: ${rtl ? 'right' : 'left'}; }
  .text-end { text-align: ${rtl ? 'left' : 'right'}; }
  .amount { background: #f8fafc; }
  @page { size: A4 portrait; margin: 16mm; }
</style>
</head>
<body>
  <h1>${safeText(title)}</h1>
  <div class="section card">
    <h2 class="muted">${safeText(headerLabel)}</h2>
    <div class="grid">
      <div><strong>${rtl ? 'شماره' : 'Number'}:</strong> ${numberDisp || '-'}</div>
      <div><strong>${rtl ? 'تاریخ' : 'Date'}:</strong> ${dateDisp || '-'}</div>
      <div><strong>${rtl ? 'دریافت‌کننده' : 'Payer'}:</strong> ${safeText(payerName) || '-'}</div>
      <div><strong>${rtl ? 'وضعیت' : 'Status'}:</strong> ${safeText(statusLabel) || '-'}</div>
      <div><strong>${rtl ? 'سال مالی' : 'Fiscal Year'}:</strong> ${safeText(fyName || '')}</div>
      <div><strong>${rtl ? 'صندوق' : 'Cashbox'}:</strong> ${safeText(cashboxText)}</div>
      <div style="grid-column: span 2"><strong>${rtl ? 'توضیحات' : 'Description'}:</strong> ${desc || '-'}</div>
    </div>
  </div>

  <div class="section">
    <h2 class="muted">${safeText(itemsLabel)}</h2>
    <table>
      <colgroup>
        <col style="width: 18%" />
        <col style="width: 18%" />
        <col style="width: 46%" />
        <col style="width: 18%" />
      </colgroup>
      <thead>
        <tr>
          <th>${safeText(colInstr)}</th>
          <th>${safeText(colRef)}</th>
          <th>${safeText(colDetails)}</th>
          <th>${safeText(colAmount)}</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="amount"><strong>${rtl ? 'جمع' : 'Total'}</strong></td>
          <td class="amount text-end"><strong>${totalStr}</strong></td>
        </tr>
      </tfoot>
    </table>
  </div>

  <script>
    window.focus();
    window.addEventListener('load', function () {
      setTimeout(function () { try { window.print(); } catch (e) {} }, 200);
    });
  </script>
</body>
</html>`;

    return html;
  }

  /** printReceiptInNewTab
   * Loads receipt and options, builds print HTML, and opens it in a new tab. */
  async function printReceiptInNewTab(id: string): Promise<void> {
    try {
      const rec = await getReceipt(id);
      await Promise.all([loadPrintOptions(), fetchFiscalYears()]);
      const html = buildReceiptPrintHtml(rec);
      const printWin = window.open('', '_blank');
      if (!printWin) { return; }
      printWin.document.open('text/html');
      printWin.document.write(html);
      printWin.document.close();
    } catch (e: any) {
      setAlertType('error');
      setAlertTitle(undefined);
      setAlertMessage(e?.response?.data?.message || e?.message || t('common.error', 'Error'));
      setAlertOpen(true);
    }
  }

  if (printMode) {
    const rec = printReceipt;
    const payerName = detailNameById[String(rec?.detailId || '')] || '';
    const cashbox = rec?.cashboxId ? (cashboxes || []).find((c) => String(c.id) === String(rec.cashboxId)) : undefined;
    const cashboxText = cashbox ? `${String(cashbox.name || '')}${(cashbox as any)?.code != null ? ` (${String((cashbox as any).code)})` : ''}` : '-';
    const statusNorm = normalizeReceiptStatus(String(rec?.status || ''));
    const total = Number(rec?.totalAmount || 0) || (rec?.items || []).reduce((s, it: any) => s + Number(it?.amount || 0), 0);
    return (
      <div className="p-6 bg-white text-gray-900">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">{t('pages.receipts.printTitle','Receipt')}</h1>
          <div className="text-sm mt-1">{t('fields.fiscalYear', 'Fiscal Year')}: {fyLabel}</div>
          <div className="text-sm">{t('pages.receipts.fields.cashbox','Cashbox')}: {cashboxText}</div>
        </div>
        {printError && <div className="text-red-600 mb-4">{printError}</div>}
        {printLoading || !rec ? (
          <div className="text-gray-600">{t('common.loading','Loading...')}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm mb-4">
              <div><span className="font-medium">{t('pages.receipts.fields.number','Number')}:</span> <span>{rec.number || '-'}</span></div>
              <div><span className="font-medium">{t('fields.date','Date')}:</span> <span>{formatDisplayDate(rec.date)}</span></div>
              <div><span className="font-medium">{t('pages.receipts.fields.payer','Payer')}:</span> <span>{payerName || '-'}</span></div>
              <div><span className="font-medium">{t('common.status','Status')}:</span> <span>{t(`pages.receipts.status.${statusNorm}`, statusNorm === 'draft' ? (isRTL ? 'پیش‌نویس' : 'Draft') : (isRTL ? 'ثبت‌شده' : 'Posted'))}</span></div>
              <div className="col-span-2"><span className="font-medium">{t('fields.description','Description')}:</span> <span>{rec.description || '-'}</span></div>
            </div>
            <table className="w-full text-sm border">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left p-2 border">{t('pages.receipts.items.instrumentType','Instrument')}</th>
                  <th className="text-left p-2 border">{t('fields.refNo','Reference No.')}</th>
                  <th className="text-left p-2 border">{t('pages.receipts.items.details','Details')}</th>
                  <th className="text-right p-2 border">{t('pages.receipts.fields.amount','Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {(rec.items || []).map((it: any, idx: number) => {
                  const typeLabelMap: Record<string, string> = {
                    cash: t('common.cash','Cash'),
                    transfer: t('common.transfer','Transfer'),
                    card: t('common.card','Card'),
                    check: t('common.check','Check'),
                  };
                  const type = String((it as any).instrumentType || '').toLowerCase();
                  const instrLabel = typeLabelMap[String((it as any).instrumentType)] || t('pages.receipts.items.instrumentType','Instrument');
                  // Prefer check_number for check items; otherwise fallback to provided reference fields
                  let refRaw: string = (it as any).reference ?? (it as any).cardRef ?? (it as any).transferRef ?? '';
                  if (type === 'check') {
                    const chkId = (it as any).checkId ?? (it as any).check_id;
                    const chk = (checks || []).find((c) => String(c.id) === String(chkId || ''));
                    refRaw = (chk as any)?.check_number ?? (chk as any)?.number ?? refRaw;
                  }
                  const refDisp = isRTL ? toPersianDigits(String(refRaw || '')) : String(refRaw || '');
                  const detailsText = renderItemDetails(it as ReceiptItem) || '';
                  const detailsCell = type === 'cash' ? '' : detailsText;
                  return (
                    <tr key={idx}>
                      <td className="p-2 border">{instrLabel}</td>
                      <td className="p-2 border">{refDisp || '-'}</td>
                      <td className="p-2 border">{detailsCell}</td>
                      <td className="p-2 border text-right">{formatAmountForLocale(Number((it as any).amount || 0), lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="p-2 border font-semibold" colSpan={3}>{t('pages.receipts.total','Total')}</td>
                  <td className="p-2 border text-right font-semibold">{formatAmountForLocale(total, lang)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>
    );
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