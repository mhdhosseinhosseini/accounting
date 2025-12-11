/**
 * ChecksPage
 * Treasury checks management with two tabs: Outgoing and Incoming.
 * Implements the Outgoing tab first with issuance form and recent list.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import { getCurrentLang, t } from '../i18n';
import { Box, TextField, Typography, IconButton } from '@mui/material';
import JalaliDatePicker from '../components/common/JalaliDatePicker';
import SearchableSelect, { SelectableOption } from '../components/common/SearchableSelect';
import NumericInput from '../components/common/NumericInput';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useAuth } from '../context/AuthContext';
import TableSortHeader from '../components/common/TableSortHeader';
import Pagination from '../components/common/Pagination';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import ConfirmDialog from '../components/common/ConfirmDialog';
import AlertDialog from '../components/common/AlertDialog';
import IncomingCheckForm from '../components/checks/IncomingCheckForm';
import OutgoingCheckForm from '../components/checks/OutgoingCheckForm';
import { useLocation } from 'react-router-dom';

/** Option interface for select components */
interface Option extends SelectableOption { extra?: string }

/** Bank account item used for selection */
interface BankAccountItem { id: string; name: string; account_number: string }

/** Checkbook item for dependent selection */
interface CheckbookItem { id: string; series?: string | null; start_number: number; page_count: number }

/** Detail option mapped for recipient selection */
interface DetailOption extends SelectableOption { code: string; title: string }

/** Form state for issuing an outgoing check */
interface OutgoingFormState {
  bank_account_id: string;
  checkbook_id: string;
  issue_date: string; // ISO string
  due_date: string; // optional ISO string
  number: string; // serial digits
  party_detail_id: string; // detail id
  amount: string; // numeric string
  notes: string; // description
}

/** Outgoing list item for table sorting/paging */
interface OutgoingItem {
  id: string;
  issue_date?: string | null;
  due_date?: string | null;
  number?: string | null;
  beneficiary?: string | null;
  amount?: number | null;
  status?: string | null;
  beneficiary_detail_id?: string | null;
}

/** Incoming form state for creating or editing incoming checks */
interface IncomingFormState {
  issue_date: string;
  due_date: string;
  number: string;
  bank_name: string;
  issuer: string;
  party_detail_id: string;
  amount: string;
  notes: string;
}

/** Incoming list item for table sorting/paging */
interface IncomingItem {
  id: string;
  issue_date?: string | null;
  due_date?: string | null;
  number?: string | null;
  bank_name?: string | null;
  issuer?: string | null;
  amount?: number | null;
  status?: string | null;
  notes?: string | null;
}

/**
 * normalizeIncomingItem
 * Produces consistent fields for table sorting and display for incoming checks.
 */
function normalizeIncomingItem(it: any): IncomingItem {
  return {
    ...it,
    amount: normalizeAmount(it.amount)
  };
}

/**
 * toAsciiDigits
 * Normalize Persian/Arabic-Indic digits to ASCII for numeric fields.
 */
function toAsciiDigits(str: string): string {
  return Array.from(String(str)).map(ch => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String.fromCharCode(48 + (code - 0x0660));
    if (code >= 0x06f0 && code <= 0x06f9) return String.fromCharCode(48 + (code - 0x06f0));
    return ch;
  }).join('');
}

/**
 * normalizeAmount
 * Converts amount to a number when possible; returns null when invalid.
 */
function normalizeAmount(val: unknown): number | null {
  const s = val == null ? '' : toAsciiDigits(String(val));
  const n = s ? Number(s) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * deriveBeneficiaryTitle
 * Extracts a human-friendly recipient title from various API shapes.
 */
function deriveBeneficiaryTitle(it: any): string {
  if (it == null) return '';
  if (it.beneficiary) return String(it.beneficiary);
  if (it.beneficiary_title) return String(it.beneficiary_title);
  if (it.beneficiary_detail_title) return String(it.beneficiary_detail_title);
  if (it.beneficiary_detail && (it.beneficiary_detail.title || it.beneficiary_detail.name)) {
    return String(it.beneficiary_detail.title || it.beneficiary_detail.name);
  }
  if (it.beneficiary_detail && it.beneficiary_detail.code && it.beneficiary_detail.title) {
    return `${String(it.beneficiary_detail.code)}-${String(it.beneficiary_detail.title)}`;
  }
  return '';
}

/**
 * normalizeOutgoingItem
 * Produces consistent fields for table sorting and display.
 */
function normalizeOutgoingItem(it: any): OutgoingItem {
  return {
    ...it,
    amount: normalizeAmount(it.amount),
    beneficiary: deriveBeneficiaryTitle(it)
  };
}

/**
 * toDateObjectSafe
 * Safely converts an ISO date (YYYY-MM-DD or ISO string) to DateObject.
 */
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

/**
 * toPersianDigits
 * Converts ASCII digits to Persian digits for localized Jalali display in Farsi.
 */
function toPersianDigits(s: string): string {
  return String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[parseInt(d, 10)]);
}

/**
 * formatJalaliDisplayDate
 * Formats a Gregorian ISO date into Jalali (YYYY/MM/DD). Uses Persian digits in Farsi locale.
 */
function formatJalaliDisplayDate(iso?: string | null): string {
  const obj = toDateObjectSafe(iso || undefined);
  if (!obj) return '';
  try {
    const j = obj.convert(persian);
    const jy = String(j.year).padStart(4, '0');
    const jm = String(j.month.number).padStart(2, '0');
    const jd = String(j.day).padStart(2, '0');
    const out = `${jy}/${jm}/${jd}`;
    return getCurrentLang() === 'fa' ? toPersianDigits(out) : out;
  } catch { return String(iso || ''); }
}

/**
 * formatCheckStatus
 * Localizes outgoing check status to a display label.
 * - Normalizes input to lowercase.
 * - Looks up i18n key 'checks.statuses.<status>'.
 * - Falls back to the normalized status when translation is missing.
 */
function formatCheckStatus(status?: string | null): string {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return '';
  return t(`pages.checks.statuses.${s}`, s);
}

/**
 * formatAmountNoDecimals
 * Formats amounts with thousands separators and no decimals. Localizes digits in Farsi.
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

export default function ChecksPage(): React.ReactElement {
  const { i18n } = useTranslation();
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);
  const isRTL = (document?.documentElement?.dir || 'ltr') === 'rtl';
  const { token, logout } = useAuth();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState<'outgoing'|'incoming'>('outgoing');
  // Controls visibility of the issuance form; initially hidden per request
  const [showForm, setShowForm] = useState<boolean>(false);
  // Track edit mode for a selected check
  const [editingId, setEditingId] = useState<string | null>(null);

  /**
   * syncInitialTabFromQueryParam
   * Sets initial tab based on the `tab` query parameter.
   * Supports `?tab=incoming` or `?tab=outgoing`. Defaults to `outgoing`.
   */
  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const qp = String(params.get('tab') || '').toLowerCase();
    if (qp === 'incoming') setActiveTab('incoming');
    else if (qp === 'outgoing') setActiveTab('outgoing');
  }, [location.search]);

  // Select options
  const [bankAccounts, setBankAccounts] = useState<Option[]>([]);
  const [checkbooks, setCheckbooks] = useState<Option[]>([]);
  const [details, setDetails] = useState<DetailOption[]>([]);

  // Suggestion helper
  const [lastIssued, setLastIssued] = useState<string>('');
  const [nextSuggestion, setNextSuggestion] = useState<string>('');
  const [rangeText, setRangeText] = useState<string>('');

  // Recent list for outgoing checks
  const [recentOutgoing, setRecentOutgoing] = useState<any[]>([]);
  // Recent list for incoming checks
  const [recentIncoming, setRecentIncoming] = useState<any[]>([]);

  // Sorting & pagination state for the outgoing table
  const [sortBy, setSortBy] = useState<keyof OutgoingItem | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Sorting & pagination state for the incoming table
  const [incomingSortBy, setIncomingSortBy] = useState<keyof IncomingItem | null>(null);
  const [incomingSortDir, setIncomingSortDir] = useState<'asc' | 'desc'>('asc');
  const [incomingPage, setIncomingPage] = useState<number>(1);
  const [incomingPageSize, setIncomingPageSize] = useState<number>(10);

  /**
   * handleSort
   * Toggles sort direction and sets the current sort column for outgoing table.
   */
  function handleSort(key: keyof OutgoingItem): void {
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
   * Applies new page size for outgoing table and resets to the first page.
   */
  function handlePageSizeChange(newSize: number): void {
    setPageSize(newSize);
    setPage(1);
  }

  /**
   * handleIncomingSort
   * Toggles incoming table sort by column.
   */
  function handleIncomingSort(column: keyof IncomingItem): void {
    if (incomingSortBy === column) {
      setIncomingSortDir(incomingSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setIncomingSortBy(column);
      setIncomingSortDir('asc');
    }
  }

  /**
   * handleIncomingPageSizeChange
   * Resets to page 1 when the user changes incoming page size.
   */
  function handleIncomingPageSizeChange(newSize: number): void {
    setIncomingPageSize(newSize);
    setIncomingPage(1);
  }

  /**
   * sortedOutgoing
   * Sorts recent outgoing checks based on current sort settings.
   */
  const sortedOutgoing = useMemo(() => {
    if (!sortBy) return recentOutgoing;
    const arr = [...recentOutgoing];
    arr.sort((a, b) => {
      const av = a[sortBy as any];
      const bv = b[sortBy as any];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [recentOutgoing, sortBy, sortDir]);

  /** Paginate outgoing checks */
  const total = sortedOutgoing.length;
  const pagedOutgoing = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedOutgoing.slice(start, start + pageSize);
  }, [sortedOutgoing, page, pageSize]);

  /**
   * sortedIncoming
   * Sorts recent incoming checks based on current sort settings.
   */
  const sortedIncoming = useMemo(() => {
    if (!incomingSortBy) return recentIncoming;
    const arr = [...recentIncoming];
    arr.sort((a, b) => {
      const av = a[incomingSortBy as any];
      const bv = b[incomingSortBy as any];
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      }
      return incomingSortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [recentIncoming, incomingSortBy, incomingSortDir]);

  /** Paginate incoming checks */
  const incomingTotal = sortedIncoming.length;
  const pagedIncoming = useMemo(() => {
    const start = (incomingPage - 1) * incomingPageSize;
    return sortedIncoming.slice(start, start + incomingPageSize);
  }, [sortedIncoming, incomingPage, incomingPageSize]);

  // Form state
  const [form, setForm] = useState<OutgoingFormState>({
    bank_account_id: '',
    checkbook_id: '',
    issue_date: '',
    due_date: '',
    number: '',
    party_detail_id: '',
    amount: '',
    notes: ''
  });

  // Validation state for issuance form
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Incoming form state
  const [incomingForm, setIncomingForm] = useState<IncomingFormState>({
    issue_date: '',
    due_date: '',
    number: '',
    bank_name: '',
    issuer: '',
    party_detail_id: '',
    amount: '',
    notes: ''
  });

  /**
   * fetchBankNamesForIssuer
   * When issuer detail changes, fetch distinct bank names for that detail.
   * Auto-fill bank name if one suggestion exists and field empty.
   */
  const [bankNameSuggestions, setBankNameSuggestions] = useState<string[]>([]);
  useEffect(() => {
    const id = incomingForm.party_detail_id;
    if (!id) { setBankNameSuggestions([]); return; }
    axios
      .get(`${config.API_ENDPOINTS.base}/v1/treasury/checks/bank-names`, { params: { detail_id: id }, headers: { 'Accept-Language': lang } })
      .then(({ data }) => {
        if (data?.ok) {
          const items: string[] = Array.isArray(data.items) ? data.items : [];
          setBankNameSuggestions(items);
          if (items.length === 1 && !incomingForm.bank_name) {
            setIncomingForm(prev => ({ ...prev, bank_name: items[0] }));
          }
        } else {
          setBankNameSuggestions([]);
        }
      })
      .catch(() => setBankNameSuggestions([]));
  }, [incomingForm.party_detail_id]);

  // Validation state for incoming form
  const [incomingErrors, setIncomingErrors] = useState<Record<string, string>>({});
  // General submit error for incoming form
  const [incomingSubmitError, setIncomingSubmitError] = useState<string>('');

  // Dialog state: confirmation
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmTitle, setConfirmTitle] = useState<string>('');
  const [confirmMessage, setConfirmMessage] = useState<string>('');
  const [confirmType, setConfirmType] = useState<'info' | 'warning' | 'danger'>('warning');
  const [confirmContext, setConfirmContext] = useState<{
    action: 'save_outgoing' | 'save_incoming' | 'delete_outgoing' | 'delete_incoming';
    payload?: any;
  } | null>(null);

  // Dialog state: alerts
  const [alertOpen, setAlertOpen] = useState<boolean>(false);
  const [alertTitle, setAlertTitle] = useState<string>('');
  const [alertMessage, setAlertMessage] = useState<string>('');
  const [alertType, setAlertType] = useState<'success' | 'error' | 'info' | 'warning'>('info');

  /**
   * validateForm
   * Client-side validation for required fields and formats.
   * - Ensures bank account and checkbook are selected
   * - Validates issue_date presence
   * - Validates number is digits-only
   * - Validates amount is a positive number
   * - Requires due_date and validates its format
   * - Requires recipient (beneficiary_detail_id)
   * Returns true when valid; sets per-field error messages otherwise.
   */
  function validateForm(): boolean {
    const errs: Record<string, string> = {};
    const requiredMsg = t('validation.required','Required');
    if (!form.bank_account_id) errs.bank_account_id = t('validation.selectBankAccount', 'Select a bank account');
    if (!form.checkbook_id) errs.checkbook_id = t('validation.selectCheckbook', 'Select a checkbook');
    if (!form.issue_date) errs.issue_date = t('validation.invalidDate', 'Invalid date');
    const serial = toAsciiDigits(form.number).trim();
    if (!serial) {
      errs.number = requiredMsg;
    } else if (!/^[0-9]+$/.test(serial)) {
      errs.number = t('validation.digitsOnly','Digits only');
    }
    const amtStr = toAsciiDigits(form.amount).trim();
    const amt = Number(amtStr);
    if (!amtStr) {
      errs.amount = requiredMsg;
    } else if (!Number.isFinite(amt) || amt <= 0) {
      errs.amount = t('validation.amountPositive','Amount must be greater than 0');
    }
    // Due date is now mandatory
    if (!form.due_date) {
      errs.due_date = requiredMsg;
    } else {
      const d = new Date(form.due_date);
      if (isNaN(d.getTime())) {
        errs.due_date = t('validation.invalidDate','Invalid date');
      }
    }
    // Recipient is now mandatory
    if (!form.party_detail_id) {
      errs.party_detail_id = t('validation.selectRecipient','Select a recipient');
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  /**
   * clearError
   * Clears a specific field's validation error when the user edits it.
   */
  function clearError(field: keyof OutgoingFormState): void {
    setFormErrors(prev => {
      const next = { ...prev };
      delete next[field as string];
      return next;
    });
  }

  /**
   * handleAmountChange
   * Updates form.amount with normalized ASCII digits and clears validation error.
   */
  function handleAmountChange(val: number | string): void {
    clearError('amount');
    setForm((prev: OutgoingFormState) => ({ ...prev, amount: String(val) }));
  }

  /**
   * validateIncomingForm
   * Client-side validation for incoming checks form.
   */
  function validateIncomingForm(): boolean {
    const errors: Record<string, string> = {};
    const requiredMsg = t('validation.required', 'Required');

    if (!incomingForm.issue_date) {
      errors.issue_date = requiredMsg;
    }
    const serial = toAsciiDigits(incomingForm.number || '').trim();
    if (!serial) {
      errors.number = requiredMsg;
    } else if (!/^[0-9]+$/.test(serial)) {
      errors.number = t('validation.digitsOnly', 'Digits only');
    }
    // Require issuer selection from details
    if (!incomingForm.party_detail_id) {
      errors.party_detail_id = requiredMsg;
    }
    const amtStr = toAsciiDigits(incomingForm.amount || '').trim();
    const amt = Number(amtStr);
    if (!amtStr) {
      errors.amount = requiredMsg;
    } else if (!Number.isFinite(amt) || amt <= 0) {
      errors.amount = t('validation.amountPositive', 'Amount must be greater than 0');
    }

    setIncomingErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /** Clear a specific incoming form error */
  function clearIncomingError(field: string): void {
    setIncomingErrors(prev => {
      const next = { ...prev };
      delete next[field as string];
      return next;
    });
  }

  /**
   * handleIncomingAmountChange
   * Numeric-only input with Farsi digit support for incoming amount.
   */
  function handleIncomingAmountChange(val: number | string): void {
    clearIncomingError('amount');
    setIncomingForm(prev => ({ ...prev, amount: String(val) }));
  }

  /**
   * closeAlert
   * Closes the AlertDialog.
   */
  function closeAlert(): void { setAlertOpen(false); }

  /**
   * closeConfirm
   * Closes the ConfirmDialog.
   */
  function closeConfirm(): void { setConfirmOpen(false); }

  /**
   * openConfirmSaveOutgoing
   * Opens confirmation dialog for saving outgoing check.
   */
  function openConfirmSaveOutgoing(): void {
    setConfirmTitle(t('actions.confirmSave','Confirm Save'));
    setConfirmMessage(t('pages.checks.confirmSaveOutgoing','Save outgoing check?'));
    setConfirmType('warning');
    setConfirmContext({ action: 'save_outgoing' });
    setConfirmOpen(true);
  }

  /**
   * openConfirmSaveIncoming
   * Opens confirmation dialog for saving incoming check.
   */
  function openConfirmSaveIncoming(): void {
    setConfirmTitle(t('actions.confirmSave','Confirm Save'));
    setConfirmMessage(t('pages.checks.confirmSaveIncoming','Save incoming check?'));
    setConfirmType('warning');
    setConfirmContext({ action: 'save_incoming' });
    setConfirmOpen(true);
  }

  /**
   * openConfirmDeleteOutgoing
   * Opens confirmation dialog for deleting outgoing check.
   */
  function openConfirmDeleteOutgoing(id: string): void {
    setConfirmTitle(t('actions.delete','Confirm Delete'));
    setConfirmMessage(t('pages.checks.confirmDeleteOutgoing','Delete this outgoing check?'));
    setConfirmType('danger');
    setConfirmContext({ action: 'delete_outgoing', payload: id });
    setConfirmOpen(true);
  }

  /**
   * openConfirmDeleteIncoming
   * Opens confirmation dialog for deleting incoming check.
   */
  function openConfirmDeleteIncoming(id: string): void {
    setConfirmTitle(t('actions.confirmDelete','Confirm Delete'));
    setConfirmMessage(t('pages.checks.confirmDeleteIncoming','Delete this incoming check?'));
    setConfirmType('danger');
    setConfirmContext({ action: 'delete_incoming', payload: id });
    setConfirmOpen(true);
  }

  /**
   * handleConfirmAction
   * Executes action after user confirms in ConfirmDialog.
   */
  async function handleConfirmAction(): Promise<void> {
    const ctx = confirmContext;
    setConfirmOpen(false);
    if (!ctx) return;
    try {
      if (ctx.action === 'save_outgoing') {
        await performIssueOutgoing();
      } else if (ctx.action === 'save_incoming') {
        await performIssueIncoming();
      } else if (ctx.action === 'delete_outgoing') {
        await performDeleteOutgoing(String(ctx.payload || ''));
      } else if (ctx.action === 'delete_incoming') {
        await performDeleteIncoming(String(ctx.payload || ''));
      }
    } catch {
      // errors are handled in the perform functions
    } finally {
      setConfirmContext(null);
    }
  }

  /**
   * performIssueOutgoing
   * Issues or edits an outgoing check using current form state.
   */
  async function performIssueOutgoing(): Promise<void> {
    // reuse validation and network logic from issueOutgoingCheck
    if (!validateForm()) { return; }
    const body: any = {
      type: 'outgoing',
      issue_date: form.issue_date || null,
      due_date: form.due_date || null,
      number: toAsciiDigits(form.number),
      party_detail_id: form.party_detail_id || null,
      amount: toAsciiDigits(form.amount),
      notes: form.notes || null,
    };
    try {
      if (editingId) {
        await axios.patch(`${config.API_ENDPOINTS.base}/v1/treasury/checks/${encodeURIComponent(editingId)}`, body, { headers: { 'Accept-Language': lang } });
      } else {
        await axios.post(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/checks`, body, { headers: { 'Accept-Language': lang } });
      }
      const list = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/checks?type=outgoing`, { headers: { 'Accept-Language': lang } });
      setRecentOutgoing(Array.isArray(list.data.items) ? list.data.items.map(normalizeOutgoingItem) : []);
      const sugg = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/last-issued-number`, { headers: { 'Accept-Language': lang } });
      setNextSuggestion(String(sugg.data.nextSuggestion || ''));
      if (editingId) {
        setEditingId(null);
        setShowForm(false);
      } else {
        setForm(prev => ({ ...prev, number: '', amount: '' }));
        setShowForm(false);
      }
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setAlertTitle(t('auth.sessionExpired', 'Session expired'));
        setAlertMessage(t('auth.sessionExpired', 'Session expired, please login'));
        setAlertType('error');
        setAlertOpen(true);
        logout();
        return;
      }
      const data = error?.response?.data;
      let msg = '';
      if (data && typeof data.error === 'string' && data.error) {
        msg = data.error;
      }
      setAlertTitle(t('common.error', 'Error'));
      setAlertMessage(msg || t('common.error', 'An error occurred'));
      setAlertType('error');
      setAlertOpen(true);
    }
  }

  /**
   * performDeleteOutgoing
   * Deletes an outgoing check and refreshes suggestions and list.
   */
  async function performDeleteOutgoing(id: string): Promise<void> {
    if (!form.checkbook_id) return;
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/checks/${encodeURIComponent(id)}`, { headers: { 'Accept-Language': lang } });
      const list = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/checks?type=outgoing`, { headers: { 'Accept-Language': lang } });
      setRecentOutgoing(Array.isArray(list.data.items) ? list.data.items.map(normalizeOutgoingItem) : []);
      const sugg = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/last-issued-number`, { headers: { 'Accept-Language': lang } });
      const li = String(sugg.data.lastIssuedNumber || '');
      const nx = String(sugg.data.nextSuggestion || '');
      const r = sugg.data.range ? `${sugg.data.range.start}…${sugg.data.range.end}` : '';
      setLastIssued(li);
      setNextSuggestion(nx);
      setRangeText(r);
    } catch (e: any) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        setAlertTitle(t('auth.sessionExpired', 'Session expired'));
        setAlertMessage(t('auth.sessionExpired', 'Session expired, please login'));
        setAlertType('error');
        setAlertOpen(true);
        logout();
        return;
      }
      setAlertTitle(t('common.error', 'Error'));
      setAlertMessage(t('common.error', 'An error occurred'));
      setAlertType('error');
      setAlertOpen(true);
    }
  }

  /**
   * performIssueIncoming
   * Issues or edits an incoming check using current form state.
   */
  async function performIssueIncoming(): Promise<void> {
    setIncomingSubmitError('');
    if (!validateIncomingForm()) return;
    const body: any = {
      issue_date: incomingForm.issue_date || null,
      due_date: incomingForm.due_date || null,
      number: toAsciiDigits(incomingForm.number || ''),
      bank_name: incomingForm.bank_name || null,
      issuer: incomingForm.issuer || null,
      beneficiary_detail_id: incomingForm.party_detail_id || null,
      amount: Number(toAsciiDigits(incomingForm.amount || '0')),
      notes: incomingForm.notes || null,
    };
    try {
      if (incomingEditingId) {
        await axios.patch(`${config.API_ENDPOINTS.base}/v1/treasury/checks/${encodeURIComponent(incomingEditingId)}`, body, { headers: { 'Accept-Language': lang } });
      } else {
        await axios.post(`${config.API_ENDPOINTS.base}/v1/treasury/checks`, body, { headers: { 'Accept-Language': lang } });
      }
      setIncomingEditingId(null);
      setShowForm(false);
      setIncomingForm({ issue_date: '', due_date: '', number: '', bank_name: '', issuer: '', party_detail_id: '', amount: '', notes: '' });
      const list = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checks?type=incoming`, { headers: { 'Accept-Language': lang } });
      setRecentIncoming(Array.isArray(list.data.items) ? list.data.items.map(normalizeIncomingItem) : []);
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setAlertTitle(t('auth.sessionExpired', 'Session expired'));
        setAlertMessage(t('auth.sessionExpired', 'Session expired, please login'));
        setAlertType('error');
        setAlertOpen(true);
        setIncomingSubmitError(t('auth.sessionExpired','Session expired, please login'));
        logout();
        return;
      }
      const data = error?.response?.data;
      let generalMessage = '';
      if (data) {
        if (typeof data.error === 'string' && data.error) {
          generalMessage = data.error;
        }
        if (data.errors && typeof data.errors === 'object') {
          const fieldErrors: Record<string, string> = {};
          for (const key of Object.keys(data.errors)) {
            const val = data.errors[key];
            fieldErrors[key] = Array.isArray(val) ? String(val[0]) : String(val);
          }
          setIncomingErrors(prev => ({ ...prev, ...fieldErrors }));
        }
      }
      setIncomingSubmitError(generalMessage || t('common.error','An error occurred'));
      setAlertTitle(t('common.error', 'Error'));
      setAlertMessage(generalMessage || t('common.error', 'An error occurred'));
      setAlertType('error');
      setAlertOpen(true);
    }
  }

  /**
   * performDeleteIncoming
   * Deletes an incoming check and refreshes list with AlertDialog on error.
   */
  async function performDeleteIncoming(id: string): Promise<void> {
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/checks/${encodeURIComponent(id)}`, { headers: { 'Accept-Language': lang } });
      const list = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checks?type=incoming`, { headers: { 'Accept-Language': lang } });
      setRecentIncoming(Array.isArray(list.data.items) ? list.data.items.map(normalizeIncomingItem) : []);
    } catch (e: any) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        setAlertTitle(t('auth.sessionExpired', 'Session expired'));
        setAlertMessage(t('auth.sessionExpired', 'Session expired, please login'));
        setAlertType('error');
        setAlertOpen(true);
        logout();
        return;
      }
      const data = e?.response?.data;
      let msg = '';
      if (data && typeof data.error === 'string' && data.error) {
        msg = data.error;
      }
      setAlertTitle(t('common.error', 'Error'));
      setAlertMessage(msg || t('common.error', 'An error occurred'));
      setAlertType('error');
      setAlertOpen(true);
    }
  }

  /**
   * Loads bank accounts and recipient details when language or auth token changes.
   */
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const baRes = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts`, { headers: { 'Accept-Language': lang } });
        const baItems: BankAccountItem[] = Array.isArray(baRes.data.items) ? baRes.data.items : [];
        const mappedOptions: Option[] = baItems.map(it => ({ id: String(it.id), name: `${it.name}`, code: `${it.name}`, extra: it.name }));
        // Display only the bank account name in selector
        setBankAccounts(mappedOptions);
        // Auto-select the first bank account to populate checkbooks and list on initial load
        if (!form.bank_account_id && mappedOptions.length > 0) {
          setForm(prev => ({ ...prev, bank_account_id: String(mappedOptions[0].id), checkbook_id: '' }));
        }
      } catch { setBankAccounts([]); }
      try {
        const dRes = await axios.get(`${config.API_ENDPOINTS.base}/v1/details`, { headers: { 'Accept-Language': lang } });
        const list = Array.isArray(dRes.data.items) ? dRes.data.items : [];
        const mapped: DetailOption[] = list.map((it: any) => ({ id: String(it.id), name: `${it.code} — ${it.title}`, code: String(it.code), title: String(it.title || '') }));
        const sorted = mapped.sort((a, b) => Number(a.code) - Number(b.code));
        setDetails(sorted);
      } catch (e: any) { if (axios.isAxiosError(e) && e.response?.status === 401) { logout(); return; } setDetails([]); }
    })();
  }, [lang, token]);

  /**
   * Loads recent incoming checks when language or auth token changes.
   */
  useEffect(() => {
    if (!token) { setRecentIncoming([]); return; }
    (async () => {
      try {
        const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checks?type=incoming`, { headers: { 'Accept-Language': lang } });
        setRecentIncoming(Array.isArray(res.data.items) ? res.data.items.map(normalizeIncomingItem) : []);
      } catch (e: any) { if (axios.isAxiosError(e) && e.response?.status === 401) { logout(); return; } setRecentIncoming([]); }
    })();
  }, [lang, token]);

  /**
   * Loads checkbooks when a bank account changes; auto-selects the first active checkbook.
   */
  useEffect(() => {
    if (!token) { setCheckbooks([]); return; }
    if (!form.bank_account_id) { setCheckbooks([]); return; }
    (async () => {
      try {
        const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(form.bank_account_id)}/checkbooks`, { headers: { 'Accept-Language': lang } });
        const raw = Array.isArray(res.data.items) ? res.data.items : [];
        /**
         * Map all checkbooks (active and exhausted) for listing the recent checks.
         * We avoid filtering to only 'active' so that users can see checks
         * from checkbooks that have become exhausted. Issuance still respects
         * backend rules and will fail for non-active checkbooks.
         */
        const mapped: CheckbookItem[] = raw.map((it: any) => ({ id: String(it.id), series: it.series || null, start_number: Number(it.start_number), page_count: Number(it.page_count) }));
        const mappedOptions: Option[] = mapped.map(it => ({ id: it.id, name: `${it.series || ''}`, code: `${it.series || ''}` }));
        setCheckbooks(mappedOptions);
        // Auto-select the most recent checkbook so recent list loads even if it's exhausted
        if (!form.checkbook_id && mappedOptions.length > 0) {
          setForm(prev => ({ ...prev, checkbook_id: String(mappedOptions[0].id) }));
        }
      } catch { setCheckbooks([]); }
    })();
  }, [lang, token, form.bank_account_id]);

  /**
   * Loads last-issued number and the recent outgoing checks list when checkbook changes.
   */
  useEffect(() => {
    if (!token) { setLastIssued(''); setNextSuggestion(''); setRangeText(''); setRecentOutgoing([]); return; }
    if (!form.checkbook_id) { setLastIssued(''); setNextSuggestion(''); setRangeText(''); setRecentOutgoing([]); return; }
    (async () => {
      try {
        const sugg = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/last-issued-number`, { headers: { 'Accept-Language': lang } })
        const li = String(sugg.data.lastIssuedNumber || '')
        const nx = String(sugg.data.nextSuggestion || '')
        const r = sugg.data.range ? `${sugg.data.range.start}…${sugg.data.range.end}` : ''
        setLastIssued(li)
        setNextSuggestion(nx)
        setRangeText(r)
        // Default serial number to suggested next value only when not editing
        if (!editingId && nx) setForm(prev => ({ ...prev, number: nx }))
      } catch { setLastIssued(''); setNextSuggestion(''); setRangeText(''); }
      try {
        const list = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/checks?type=outgoing`, { headers: { 'Accept-Language': lang } })
        setRecentOutgoing(Array.isArray(list.data.items) ? list.data.items.map(normalizeOutgoingItem) : [])
      } catch { setRecentOutgoing([]) }
    })()
  }, [lang, token, form.checkbook_id, editingId])

  /**
   * issueOutgoingCheck
   * Submits outgoing check issuance or edit, refreshes list and suggestions.
   */
  async function issueOutgoingCheck(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    // Client-side validation block; abort submit when invalid
    if (!validateForm()) { return; }
    const body = {
      type: 'outgoing',
      issue_date: form.issue_date || null,
      due_date: form.due_date || null,
      number: toAsciiDigits(form.number),
      party_detail_id: form.party_detail_id || null,
      amount: toAsciiDigits(form.amount),
      notes: form.notes || null,
    } as any;
    try {
      if (editingId) {
        await axios.patch(`${config.API_ENDPOINTS.base}/v1/treasury/checks/${encodeURIComponent(editingId)}`, body, { headers: { 'Accept-Language': lang } });
      } else {
        await axios.post(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/checks`, body, { headers: { 'Accept-Language': lang } });
      }
      // Refresh list and suggestion
      const list = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/checks?type=outgoing`, { headers: { 'Accept-Language': lang } });
      setRecentOutgoing(Array.isArray(list.data.items) ? list.data.items.map(normalizeOutgoingItem) : []);
      const sugg = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/last-issued-number`, { headers: { 'Accept-Language': lang } });
      setNextSuggestion(String(sugg.data.nextSuggestion || ''));
      // Clear fields after create; keep fields on edit but exit edit mode
      if (editingId) {
        setEditingId(null);
        setShowForm(false);
      } else {
        setForm(prev => ({ ...prev, number: '', amount: '' }));
        setShowForm(false);
      }
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setAlertTitle(t('auth.sessionExpired', 'Session expired'));
        setAlertMessage(t('auth.sessionExpired', 'Session expired, please login'));
        setAlertType('error');
        setAlertOpen(true);
        logout();
        return;
      }
      const data = error?.response?.data;
      let msg = '';
      if (data) {
        if (typeof data.error === 'string' && data.error) {
          msg = data.error;
        }
      }
      setAlertTitle(t('common.error', 'Error'));
      setAlertMessage(msg || t('common.error', 'An error occurred'));
      setAlertType('error');
      setAlertOpen(true);
    }
  }

  /**
   * startEditRow
   * Opens form, sets editing id, and preloads values from row.
   */
  function startEditRow(it: any): void {
    setShowForm(true);
    setEditingId(String(it.id));
    setForm(prev => ({
      ...prev,
      // keep selected bank_account_id and checkbook_id
      issue_date: String(it.issue_date || ''),
      due_date: String(it.due_date || ''),
      number: String(it.number || ''),
      party_detail_id: String(it.party_detail_id || it.beneficiary_detail_id || ''),
      amount: String(it.amount != null ? Number(it.amount).toString() : ''),
      notes: String(it.notes || ''),
    }));
  }

  /**
   * deleteRow
   * Deletes a check by id and refreshes the outgoing list and next suggestion.
   */
  async function deleteRow(id: string): Promise<void> {
    const ok = window.confirm(t('actions.confirmDelete','Are you sure you want to delete?'));
    if (!ok) return;
    if (!form.checkbook_id) return;
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/checks/${encodeURIComponent(id)}`, { headers: { 'Accept-Language': lang } });
      const list = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/checks?type=outgoing`, { headers: { 'Accept-Language': lang } });
      setRecentOutgoing(Array.isArray(list.data.items) ? list.data.items.map(normalizeOutgoingItem) : []);
      const sugg = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(form.checkbook_id)}/last-issued-number`, { headers: { 'Accept-Language': lang } });
      const li = String(sugg.data.lastIssuedNumber || '');
      const nx = String(sugg.data.nextSuggestion || '');
      const r = sugg.data.range ? `${sugg.data.range.start}…${sugg.data.range.end}` : '';
      setLastIssued(li);
      setNextSuggestion(nx);
      setRangeText(r);
    } catch {
      // silently ignore errors
    }
  }

  // Track incoming editing id for PATCH
  const [incomingEditingId, setIncomingEditingId] = useState<string | null>(null);

  /**
   * issueIncomingCheck
   * Creates or edits an incoming check via backend POST/PATCH and refreshes list.
   * Adds error handling to surface server validation and general errors to the UI.
   */
  async function issueIncomingCheck(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setIncomingSubmitError('');
    if (!validateIncomingForm()) return;
    const body: any = {
      issue_date: incomingForm.issue_date || null,
      due_date: incomingForm.due_date || null,
      number: toAsciiDigits(incomingForm.number || ''),
      bank_name: incomingForm.bank_name || null,
      issuer: incomingForm.issuer || null,
      beneficiary_detail_id: incomingForm.party_detail_id || null,
      amount: Number(toAsciiDigits(incomingForm.amount || '0')),
      notes: incomingForm.notes || null,
    };
    try {
      if (incomingEditingId) {
        await axios.patch(`${config.API_ENDPOINTS.base}/v1/treasury/checks/${encodeURIComponent(incomingEditingId)}`, body, { headers: { 'Accept-Language': lang } });
      } else {
        await axios.post(`${config.API_ENDPOINTS.base}/v1/treasury/checks`, body, { headers: { 'Accept-Language': lang } });
      }
      setIncomingEditingId(null);
      setShowForm(false);
      setIncomingForm({ issue_date: '', due_date: '', number: '', bank_name: '', issuer: '', party_detail_id: '', amount: '', notes: '' });
      const list = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checks?type=incoming`, { headers: { 'Accept-Language': lang } });
      setRecentIncoming(Array.isArray(list.data.items) ? list.data.items.map(normalizeIncomingItem) : []);
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setIncomingSubmitError(t('auth.sessionExpired','Session expired, please login'));
        logout();
        return;
      }
      const data = error?.response?.data;
      let generalMessage = '';
      if (data) {
        if (typeof data.error === 'string' && data.error) {
          generalMessage = data.error;
        }
        if (data.errors && typeof data.errors === 'object') {
          const fieldErrors: Record<string, string> = {};
          for (const key of Object.keys(data.errors)) {
            const val = data.errors[key];
            fieldErrors[key] = Array.isArray(val) ? String(val[0]) : String(val);
          }
          setIncomingErrors(prev => ({ ...prev, ...fieldErrors }));
        }
      }
      setIncomingSubmitError(generalMessage || t('common.error','An error occurred'));
    }
  }

  /**
   * startIncomingEditRow
   * Opens form in incoming tab and preloads existing row values.
   */
  function startIncomingEditRow(it: any): void {
    setActiveTab('incoming');
    setShowForm(true);
    setIncomingEditingId(String(it.id));
    const selectedDetailId = String(it.beneficiary_detail_id || it.party_detail_id || '');
    setIncomingForm({
      issue_date: String(it.issue_date || ''),
      due_date: String(it.due_date || ''),
      number: String(it.number || ''),
      bank_name: String(it.bank_name || ''),
      issuer: String(it.issuer || ''),
      party_detail_id: selectedDetailId,
      amount: String(it.amount != null ? Number(it.amount).toString() : ''),
      notes: String(it.notes || ''),
    });
    setIncomingErrors({});
  }

  /**
   * deleteIncomingRow
   * Deletes an incoming check (only if status is 'created') and refreshes list.
   */
  async function deleteIncomingRow(id: string): Promise<void> {
    const ok = window.confirm(t('actions.confirmDelete','Are you sure you want to delete?'));
    if (!ok) return;
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/checks/${encodeURIComponent(id)}`, { headers: { 'Accept-Language': lang } });
      const list = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checks?type=incoming`, { headers: { 'Accept-Language': lang } });
      setRecentIncoming(Array.isArray(list.data.items) ? list.data.items.map(normalizeIncomingItem) : []);
    } catch (e: any) {
      if (axios.isAxiosError(e) && e.response?.status === 401) { logout(); return; }
      // ignore
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-2">{t('pages.checks.title', 'Manage Check')}</h1>
        {/* Tabs */}
        <div className="flex space-x-4 rtl:space-x-reverse border-b mb-3">
          <button className={`px-3 py-2 -mb-px border-b-2 ${activeTab==='outgoing'?'border-green-700 text-green-700 font-medium':'border-transparent text-gray-500'}`} onClick={() => setActiveTab('outgoing')}>{t('pages.checks.outgoing', 'Outgoing Checks')}</button>
          <button className={`px-3 py-2 -mb-px border-b-2 ${activeTab==='incoming'?'border-green-700 text-green-700 font-medium':'border-transparent text-gray-500'}`} onClick={() => setActiveTab('incoming')}>{t('pages.checks.incoming', 'Incoming Checks')}</button>
        </div>

        {activeTab === 'outgoing' && (
          <div>
            {/* Top: Issue Check button aligned left for Farsi, right for English (hidden when form is open) */}
            {!showForm && (
              <div className="mb-3" style={{ display: 'flex' }}>
                <button
                  type="button"
                  className="gb-button gb-button-primary"
                  onClick={() => setShowForm(true)}
                  style={{ marginLeft: isRTL ? 0 : 'auto', marginRight: isRTL ? 'auto' : 0 }}
                >
                  {t('actions.issueCheck','Issue Check')}
                </button>
              </div>
            )}

            {/* Outgoing issuance form (hidden until button is pressed) */}
            {showForm && (
              <>
                <OutgoingCheckForm
                  value={form}
                  errors={formErrors}
                  editingId={editingId}
                  bankAccountOptions={bankAccounts as any}
                  checkbookOptions={checkbooks as any}
                  detailOptions={details as any}
                  rangeText={rangeText}
                  onChange={(field, val) => {
                    // Clear field error and update form state; reset checkbook on bank change
                    clearError(field as any);
                    if (field === 'bank_account_id') {
                      setForm((prev: OutgoingFormState) => ({ ...prev, bank_account_id: String(val), checkbook_id: '' }));
                    } else {
                      setForm((prev: OutgoingFormState) => ({ ...prev, [field]: String(val) }));
                    }
                  }}
                  onAmountChange={(val) => handleAmountChange(val)}
                  onSubmit={() => openConfirmSaveOutgoing()}
                  onCancel={() => { setShowForm(false); setEditingId(null); }}
                />
              </>
            )}

            {/* Recent outgoing checks */}
            <section className="bg-white rounded shadow p-4 mt-6">
              <h2 className="text-lg font-medium mb-2">{t('pages.checks.outgoingRecent','Recent Outgoing Checks')}</h2>
              {sortedOutgoing.length === 0 ? (
                <p className="text-gray-500">{t('common.noData','No data')}</p>
              ) : (
                <>
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100">
                      <tr className="border-b border-gray-200">
                        <TableSortHeader label={t('fields.checkDate', 'Check Date')} sortKey={'issue_date' as any} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as keyof OutgoingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.dueDate', 'Due Date')} sortKey={'due_date' as any} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as keyof OutgoingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.checkSerial', 'Serial Number')} sortKey={'number' as any} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as keyof OutgoingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.recipientDetail', 'Recipient (Detail)')} sortKey={'beneficiary' as any} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as keyof OutgoingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.amount', 'Amount')} sortKey={'amount' as any} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as keyof OutgoingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.status', 'Status')} sortKey={'status' as any} currentSortBy={sortBy as any} currentSortDir={sortDir} onSort={(k) => handleSort(k as keyof OutgoingItem)} headerAlign={'text-left'} />
                        <th className="px-4 py-3 text-base font-medium text-gray-700 tracking-wider text-center normal-case">{t('actions.actions', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedOutgoing.map((it: any) => (
                        <tr key={String(it.id)} className="border-b border-gray-200 hover:bg-gray-50">
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatJalaliDisplayDate(it.issue_date)}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatJalaliDisplayDate(it.due_date)}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{String(it.number || '')}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{String(it.beneficiary || '')}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatAmountNoDecimals(it.amount)}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatCheckStatus(it.status)}</td>
                          <td className="px-4 py-2 text-center">
                            <IconButton aria-label={t('actions.edit','Edit')} onClick={() => startEditRow(it)} size="small">
                              <EditIcon fontSize="small" sx={{ color: '#16a34a' }} />
                            </IconButton>
                            <IconButton aria-label={t('actions.delete','Delete')} onClick={() => openConfirmDeleteOutgoing(String(it.id))} size="small">
                              <DeleteIcon fontSize="small" sx={{ color: '#dc2626' }} />
                            </IconButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <Pagination
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    onPageChange={setPage}
                    onPageSizeChange={handlePageSizeChange}
                    className="mt-3"
                  />
                </>
              )}
            </section>
          </div>
        )}

        {activeTab === 'incoming' && (
          <div>
            {/* Top: Issue Incoming button (hidden when form is open) */}
            {!showForm && (
              <div className="mb-3" style={{ display: 'flex' }}>
                <button
                  type="button"
                  className="gb-button gb-button-primary"
                  onClick={() => setShowForm(true)}
                  style={{ marginLeft: isRTL ? 0 : 'auto', marginRight: isRTL ? 'auto' : 0 }}
                >
                  {t('pages.checks.issueIncoming','Issue Incoming Check')}
                </button>
              </div>
            )}

            {/* Incoming issuance form */}
            {showForm && (
              <>
                <IncomingCheckForm
                  value={incomingForm}
                  errors={incomingErrors}
                  submitError={incomingSubmitError}
                  editingId={incomingEditingId}
                  onChange={(field, val) => { clearIncomingError(field); setIncomingForm(prev => ({ ...prev, [field]: val })); }}
                  onAmountChange={(val) => handleIncomingAmountChange(val)}
                  onSubmit={openConfirmSaveIncoming}
                  onCancel={() => { setShowForm(false); setIncomingEditingId(null); }}
                  detailOptions={details}
                  bankNameSuggestions={bankNameSuggestions}
                />
              </>
            )}

            {/* Recent incoming checks */}
            <section className="bg-white rounded shadow p-4 mt-6">
              <h2 className="text-lg font-medium mb-2">{t('pages.checks.incomingRecent','Recent Incoming Checks')}</h2>
              {sortedIncoming.length === 0 ? (
                <p className="text-gray-500">{t('common.noData','No data')}</p>
              ) : (
                <>
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100">
                      <tr className="border-b border-gray-200">
                        <TableSortHeader label={t('fields.checkDate', 'Check Date')} sortKey={'issue_date' as any} currentSortBy={incomingSortBy as any} currentSortDir={incomingSortDir} onSort={(k) => handleIncomingSort(k as keyof IncomingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.dueDate', 'Due Date')} sortKey={'due_date' as any} currentSortBy={incomingSortBy as any} currentSortDir={incomingSortDir} onSort={(k) => handleIncomingSort(k as keyof IncomingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.checkSerial', 'Serial Number')} sortKey={'number' as any} currentSortBy={incomingSortBy as any} currentSortDir={incomingSortDir} onSort={(k) => handleIncomingSort(k as keyof IncomingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.bankName', 'Bank Name')} sortKey={'bank_name' as any} currentSortBy={incomingSortBy as any} currentSortDir={incomingSortDir} onSort={(k) => handleIncomingSort(k as keyof IncomingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.issuer', 'Issuer')} sortKey={'issuer' as any} currentSortBy={incomingSortBy as any} currentSortDir={incomingSortDir} onSort={(k) => handleIncomingSort(k as keyof IncomingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.amount', 'Amount')} sortKey={'amount' as any} currentSortBy={incomingSortBy as any} currentSortDir={incomingSortDir} onSort={(k) => handleIncomingSort(k as keyof IncomingItem)} headerAlign={'text-left'} />
                        <TableSortHeader label={t('fields.status', 'Status')} sortKey={'status' as any} currentSortBy={incomingSortBy as any} currentSortDir={incomingSortDir} onSort={(k) => handleIncomingSort(k as keyof IncomingItem)} headerAlign={'text-left'} />
                        <th className="px-4 py-3 text-base font-medium text-gray-700 tracking-wider text-center normal-case">{t('actions.actions', 'Actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedIncoming.map((it: any) => (
                        <tr key={String(it.id)} className="border-b border-gray-200 hover:bg-gray-50">
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatJalaliDisplayDate(it.issue_date)}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatJalaliDisplayDate(it.due_date)}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{String(it.number || '')}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{String(it.bank_name || '')}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{String(it.issuer || '')}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatAmountNoDecimals(it.amount)}</td>
                          <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatCheckStatus(it.status)}</td>
                          <td className="px-4 py-2 text-center">
                            <IconButton aria-label={t('actions.edit','Edit')} onClick={() => startIncomingEditRow(it)} size="small">
                              <EditIcon fontSize="small" sx={{ color: '#16a34a' }} />
                            </IconButton>
                            <IconButton aria-label={t('actions.delete','Delete')} onClick={() => openConfirmDeleteIncoming(String(it.id))} size="small">
                              <DeleteIcon fontSize="small" sx={{ color: '#dc2626' }} />
                            </IconButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <Pagination
                    page={incomingPage}
                    pageSize={incomingPageSize}
                    total={incomingTotal}
                    onPageChange={setIncomingPage}
                    onPageSizeChange={handleIncomingPageSizeChange}
                    className="mt-3"
                  />
                </>
              )}
            </section>
          </div>
        )}
      {/* Global dialogs */}
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmText={t('actions.confirm','Confirm')}
        cancelText={t('actions.cancel','Cancel')}
        onConfirm={handleConfirmAction}
        onCancel={closeConfirm}
        type={confirmType}
        dimBackground={false}
      />
      <AlertDialog
        open={alertOpen}
        title={alertTitle}
        message={alertMessage}
        onClose={closeAlert}
        dimBackground={false}
      />
      </main>
    </div>
  );
}