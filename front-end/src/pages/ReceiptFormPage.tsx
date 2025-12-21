/**
 * ReceiptFormPage
 * Scaffolds the receipt creation/edit view with header, items, totals, and actions.
 * - On /treasury/receipts/new: allows creating a draft receipt
 * - On /treasury/receipts/:id: loads and edits an existing draft receipt
 */
import React, { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { ReceiptHeader, ReceiptItemsTable } from '../components/receipts';
import type { Receipt, ReceiptInput, ReceiptItem } from '../types/receipts';
import { createReceipt, getReceipt, updateReceipt, postReceipt } from '../services/receipts';
import { listDetails } from '../services/details';
import type { DetailOption } from '../services/details';
import { listBankAccounts, listCardReadersForAccount, listCashboxes, listChecks } from '../services/treasury';
import type { BankAccount, CardReader, Cashbox, Check } from '../types/treasury';
import ConfirmDialog from '../components/common/ConfirmDialog';
import IncomingCheckForm, { type IncomingFormState } from '../components/checks/IncomingCheckForm';
import axios from 'axios';
import config from '../config';
import { validateReceipt, type ReceiptRowErrors } from '../validators/receipt';
import { Button } from '../components/Button';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';

// Fiscal year reference type for labeling
interface FiscalYearRef { id: number; name: string; start_date: string; end_date: string; is_closed?: boolean }

/**
 * normalizeToInput
 * Maps a loaded receipt to the editable input model.
 */
function normalizeToInput(r: Receipt): ReceiptInput {
  return {
    date: r.date || '',
    fiscalYearId: r.fiscalYearId || null,
    detailId: r.detailId || null,
    specialCodeId: (r as any).specialCodeId || null,
    description: r.description || '',
    cashboxId: (r as any).cashboxId || null,
    items: Array.isArray(r.items) ? r.items.map((it) => ({
      id: it.id,
      instrumentType: it.instrumentType,
      amount: Number(it.amount || 0),
      // Support snake_case fallbacks from backend payloads
      bankAccountId: (it as any).bankAccountId ?? (it as any).bank_account_id ?? null,
      cardReaderId: (it as any).cardReaderId ?? (it as any).card_reader_id ?? null,
      reference: (it as any).reference ?? (it as any).cardRef ?? (it as any).transferRef ?? null,
      checkId: (it as any).checkId ?? (it as any).check_id ?? null,
      position: it.position || null,
      // Per-item Detail ID for downstream document creation
      detailId: (it as any).detailId ?? (it as any).detail_id ?? null,
    })) as ReceiptItem[] : [],
  };
}

/**
 * todayIso
 * Returns today's date in local timezone as ISO string (YYYY-MM-DD).
 * Ensures JalaliDatePicker receives Gregorian ISO while UI can display Jalali.
 */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const ReceiptFormPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // Local wrapper to adapt i18next t() to validator signature
  const tt = (key: string, fallback?: string, vars?: Record<string, any>) => String(t(key, fallback as any, vars as any));
  const navigate = useNavigate();
  const location = useLocation();
  const isRTL = (document?.documentElement?.dir || 'ltr') === 'rtl';
  const params = useParams();
  // Detect print mode via query string: ?print=1
  const printMode = useMemo(() => new URLSearchParams(location.search).get('print') === '1', [location.search]);
  // Use normalization to avoid treating 'new' or 'undefined' as actual ids
  const editId = normalizeEditId(params.id ?? null);

  const [form, setForm] = useState<ReceiptInput>({ date: '', description: '', specialCodeId: null, cashboxId: null, items: [] });
  const [initialFormJson, setInitialFormJson] = useState<string>(JSON.stringify({ date: '', description: '', specialCodeId: null, cashboxId: null, items: [] }));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read-only header fields for display (status, number)
  const [status, setStatus] = useState<string | null>(editId ? 'draft' : 'draft');
  const [number, setNumber] = useState<string | null>(null);

  // Option lists for pickers
  const [detailOptions, setDetailOptions] = useState<DetailOption[]>([]);
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [cardReadersByBankId, setCardReadersByBankId] = useState<Record<string, CardReader[]>>({});
  // Special code options from Codes API
  // Special code options must include `name` to satisfy SelectableOption
  const [specialCodes, setSpecialCodes] = useState<Array<{ id: string; name: string; code: string; title: string }>>([]);
  // Add fiscal years state for top label
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRef[]>([]);

  // Incoming check dialog state
  const [incomingDialogOpen, setIncomingDialogOpen] = useState(false);
  const [incomingForm, setIncomingForm] = useState<IncomingFormState>({
    issue_date: '',
    due_date: '',
    number: '',
    bank_name: '',
    issuer: '',
    party_detail_id: '',
    amount: '',
    notes: '',
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
  const [incomingErrors, setIncomingErrors] = useState<Record<string, string>>({});
  const [incomingSubmitError, setIncomingSubmitError] = useState<string>('');

  /**
   * loadReceipt
   * Loads an existing receipt when editing.
   */
  /** normalizeReceiptStatus
   * Maps backend 'temporary'/'permanent' to UI 'draft'/'posted' in receipt form only.
   * Prevents showing "Temporary" on the receipt page while leaving other modules untouched.
   */
  function normalizeReceiptStatus(v?: string): 'draft' | 'posted' {
    const s = String(v || '').toLowerCase();
    if (s === 'temporary' || s === 'sent') return 'draft';
    if (s === 'permanent') return 'posted';
    if (s === 'draft') return 'draft';
    if (s === 'posted') return 'posted';
    return 'draft';
  }
  async function loadReceipt(id: string) {
    setLoading(true); setError(null);
    try {
      const r = await getReceipt(id);
      setForm(normalizeToInput(r));
      setInitialFormJson(JSON.stringify(normalizeToInput(r)));
      setStatus(normalizeReceiptStatus(r.status || 'draft'));
      setNumber(r.number || null);
    } catch (e: any) {
      // Surface server-provided error message (supports both `message` and `error` fields)
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error;
      setError(serverMsg || e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (editId) loadReceipt(editId); }, [editId]);

/**
 * defaultNewReceiptDate
 * Sets today's date by default when creating a new receipt.
 * Keeps existing date when editing or if a date is already set.
 */
useEffect(() => {
  if (!editId) {
    setForm((prev) => ({
      ...prev,
      date: (prev.date && String(prev.date).trim() !== '') ? prev.date : todayIso(),
    }));
  }
}, [editId]);

  /**
   * loadOptions
   * Fetch parties and treasury lists, plus card readers for each bank account.
   * Payer selection now uses Parties (code/name) to ensure `partyId` matches
   * back-end foreign key on `receipts.party_id`.
   *
   * IMPORTANT: Use a plain hyphen '-' when composing option.name (label)
   * to match the label format used by SearchableSelect. This avoids filtering
   * mismatches caused by different hyphen characters ("-" vs "—").
   */
  async function loadOptions() {
    try {
      const [details, cashs, banks, chks, codesRes, settingsRes] = await Promise.all([
        listDetails(),
        listCashboxes(),
        listBankAccounts(),
        // Request only available checks, include ones used by the current receipt in edit mode
        listChecks({ available: true, excludeReceiptId: editId }),
        axios.get(`${config.API_ENDPOINTS.base}/v1/codes`, { headers: { 'Accept-Language': lang } }),
        axios.get(`${config.API_ENDPOINTS.base}/v1/settings`, { headers: { 'Accept-Language': lang } }),
      ]);
      // Use Details directly as options (already sorted)
      setDetailOptions(details);
      setCashboxes(cashs);
      setBankAccounts(banks);
      setChecks(chks);
      // Special Codes: flat list from codes API, active only
      // Backend returns shape: { message, data: rows }
      const codesList: Array<{ id: string; code: string; title: string; is_active?: boolean; kind?: string }> = (codesRes?.data?.data || codesRes?.data?.items || []) as any[];
      const activeCodes = (codesList || []).filter((c) => (c as any).is_active !== false);
      setSpecialCodes(activeCodes.map((c) => ({ id: String(c.id), name: `${String(c.code)}-${String(c.title)}`, code: String(c.code), title: String(c.title) })));
      /**
       * settingsDefaultReceiptSpecial
       * Uses settings key `CODE_TREASURY_COUNTERPARTY_RECEIPT` to determine
       * the default special code for new receipts.
       */
      if (!editId) {
        const settingsList: any[] = (settingsRes?.data?.items || settingsRes?.data?.data || []) as any[];
        const receiptSetting = settingsList.find((s: any) => String(s.code) === 'CODE_TREASURY_COUNTERPARTY_RECEIPT');
        const defaultSpecialId = receiptSetting?.special_id ? String(receiptSetting.special_id) : null;
        if (defaultSpecialId) {
          setForm((prev) => ({ ...prev, specialCodeId: prev.specialCodeId ?? defaultSpecialId }));
        }
      }
      // Fetch card readers per bank account (batch)
      const readersEntries = await Promise.all(
        (banks || []).map(async (b) => {
          try {
            const rds = await listCardReadersForAccount(String(b.id));
            return [String(b.id), rds] as [string, CardReader[]];
          } catch {
            return [String(b.id), []] as [string, CardReader[]];
          }
        })
      );
      setCardReadersByBankId(Object.fromEntries(readersEntries));
    } catch (e: any) {
      // Non-blocking: log error and continue; pickers will show empty lists
      console.error('loadOptions error', e);
    }
  }

  useEffect(() => { loadOptions(); }, []);

  /**
   * selectDefaultFiscalYear
   * Picks an open fiscal year if available; otherwise the latest by end_date.
   */
  function selectDefaultFiscalYear(list: FiscalYearRef[]): string | null {
    const openFy = list.find((fy) => !fy.is_closed);
    if (openFy) return String(openFy.id);
    if (list.length === 0) return null;
    const latest = [...list].sort((a, b) => (a.end_date > b.end_date ? 1 : -1)).slice(-1)[0];
    return String(latest.id);
  }

  /**
   * fetchFiscalYears
   * Loads fiscal years with Accept-Language, sets default if absent.
   * Ensures compatibility with `{items}` or `{data}` response shapes.
   */
  async function fetchFiscalYears(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/fiscal-years`, { headers: { 'Accept-Language': lang } });
      const payload = res?.data;
      const list: FiscalYearRef[] =
        (payload?.items as any[]) ||
        (payload?.data as any[]) ||
        (Array.isArray(payload) ? payload : []) ||
        [];
      setFiscalYears(list);
      setForm((prev) => ({ ...prev, fiscalYearId: prev.fiscalYearId ?? selectDefaultFiscalYear(list) }));
    } catch {/* non-blocking */}
  }

  // Initial fetch for fiscal years
  useEffect(() => { fetchFiscalYears(); }, []);

  /**
   * handleChangeHeader
   * Applies partial changes to header fields including cashbox.
   */
  function handleChangeHeader(patch: Partial<{ date: string; description: string; detailId: string | null; specialCodeId: string | null; cashboxId: string | null }>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  /**
   * handleChangeItems
   * Updates the items array and auto-fills payer when selecting a check with no payer set.
   */
  function handleChangeItems(items: ReceiptItem[]) {
    setForm((prev) => {
      const next = { ...prev, items };
      // If payer is not selected and a check is chosen, try to set payer to the check issuer
      if (!prev.detailId) {
        const checkRow = items.find((it) => it.instrumentType === 'check' && it.checkId);
        if (checkRow) {
          const selectedCheck = (checks || []).find((c) => String(c.id) === String(checkRow.checkId));
          const issuerName = selectedCheck ? String((selectedCheck as any).issuer || '').trim() : '';
          if (issuerName) {
            const match = (detailOptions || []).find((d) => String(d.title || '').trim() === issuerName);
            if (match) next.detailId = String(match.id);
          }
        }
      }
      return next;
    });
  }

  const total = useMemo(() => (form.items || []).reduce((sum, it) => sum + Number(it.amount || 0), 0), [form.items]);

  /**
   * formatAmountForLocale
   * Formats a numeric amount based on the active language.
   * - Uses Persian (Farsi) digits when language starts with 'fa'.
   * - Falls back to the browser default locale otherwise.
   */
  function formatAmountForLocale(amount: number, langCode: string): string {
    try {
      if (langCode?.toLowerCase().startsWith('fa')) {
        return new Intl.NumberFormat('fa-IR').format(amount);
      }
      return new Intl.NumberFormat().format(amount);
    } catch {
      return amount.toString();
    }
  }

  /**
   * formatDisplayDate
   * Formats ISO 'YYYY-MM-DD' for display.
   * - Farsi: Jalali (Persian) calendar as YYYY/MM/DD with Persian digits.
   * - English: Gregorian as YYYY-MM-DD.
   */
  function formatDisplayDate(isoDate: string | null | undefined, langCode: string): string {
    const v = String(isoDate || '').trim();
    if (!v) return '-';
    try {
      if (langCode?.toLowerCase().startsWith('fa')) {
        const dobj = new DateObject({ date: v, calendar: persian, locale: persian_fa });
        return dobj.format('YYYY/MM/DD');
      }
      // Default: Gregorian YYYY-MM-DD
      const dobj = new DateObject(v);
      const y = String(dobj.year).padStart(4, '0');
      const m = String(dobj.month.number).padStart(2, '0');
      const d = String(dobj.day).padStart(2, '0');
      return `${y}-${m}-${d}`;
    } catch {
      return v;
    }
  }

  /**
   * renderItemDetails
   * Returns instrument-specific details for the print column.
   * - check: Bank name + check number
   * - transfer: Bank account name + account number
   * - card: PSP provider + terminal id
   * - cash: Cashbox name (+ code)
   */
  function renderItemDetails(it: ReceiptItem): string {
    const typ = String(it.instrumentType || '').toLowerCase();
    if (typ === 'check') {
      const c = it.checkId ? (checks || []).find((x) => String(x.id) === String(it.checkId)) : undefined;
      const num = c?.number || c?.check_number || '';
      const bank = c?.bank_name || '';
      const base = t('pages.receipts.items.check', 'Check');
      if (bank && num) return `${base}: ${bank} - ${num}`;
      if (num) return `${base}: ${num}`;
      if (bank) return `${base}: ${bank}`;
      return base;
    }
    if (typ === 'transfer') {
      const ba = it.bankAccountId ? (bankAccounts || []).find((b) => String(b.id) === String(it.bankAccountId)) : undefined;
      const name = ba?.name || '';
      const acc = ba?.account_number || '';
      const base = t('pages.receipts.items.bankAccount', 'Bank Account');
      if (name && acc) return `${base}: ${name} (${acc})`;
      if (name) return `${base}: ${name}`;
      if (acc) return `${base}: ${acc}`;
      return base;
    }
    if (typ === 'card') {
      // Attempt to resolve card reader by bank account; fall back to global search
      const readersByAccount = it.bankAccountId ? (cardReadersByBankId[String(it.bankAccountId)] || []) : [];
      const allReaders = Object.values(cardReadersByBankId || {}).flat();
      const reader = it.cardReaderId
        ? (readersByAccount.find((r) => String(r.id) === String(it.cardReaderId)) ||
           allReaders.find((r) => String(r.id) === String(it.cardReaderId)))
        : undefined;
      const prov = reader?.psp_provider || '';
      const term = reader?.terminal_id || '';
      const base = t('pages.receipts.items.cardReader', 'Card Reader');
      if (prov && term) return `${base}: ${prov} - ${term}`;
      if (term) return `${base}: ${term}`;
      if (prov) return `${base}: ${prov}`;
      return base;
    }
    if (typ === 'cash') {
      const cb = form.cashboxId ? (cashboxes || []).find((c) => String(c.id) === String(form.cashboxId)) : undefined;
      const name = cb?.name || '';
      const code = cb?.code != null ? String(cb.code) : '';
      const base = t('pages.receipts.items.cashbox', 'Cashbox');
      if (name && code) return `${base}: ${name} (${code})`;
      if (name) return `${base}: ${name}`;
      return base;
    }
    return '';
  }

  // Compute validations (Phase 6)
  const validation = useMemo(() => {
    return validateReceipt(form, {
      cashboxes,
      bankAccounts,
      cardReadersByBankId,
      checks,
      requireCardReader: false, // set true if card reader must be selected per bank
      t: tt,
    });
  }, [form, cashboxes, bankAccounts, cardReadersByBankId, checks, tt]);

  const rowErrorsByIndex: Record<number, ReceiptRowErrors> = validation.rowErrors || {};
  const hasFormErrors = validation.formErrors.length > 0;
  const hasRowErrors = validation.invalidRowCount > 0;

  // Compute current fiscal year label for centered header
  const fyLabel = useMemo(() => {
    const fy = form.fiscalYearId ? fiscalYears.find((f) => String(f.id) === form.fiscalYearId) : undefined;
    return fy ? fy.name : t('fields.fiscalYear', 'Fiscal Year');
  }, [fiscalYears, form.fiscalYearId, t]);

  /**
   * normalizeEditId
   * Normalizes the route param `id` into a usable edit id.
   * - Returns null for create mode when `id` is missing, 'new', or 'undefined'.
   */
  function normalizeEditId(idParam?: string | null): string | null {
    if (!idParam) return null;
    const v = String(idParam).trim();
    if (v === '' || v.toLowerCase() === 'new' || v.toLowerCase() === 'undefined') return null;
    return v;
  }

  /**
   * checksToDisplay
   * When a payer is selected, only show checks whose issuer matches the payer name.
   * If no payer is selected, show all available checks.
   */
  const checksToDisplay = useMemo(() => {
    const all = checks || [];
    const payer = form.detailId ? (detailOptions || []).find((d) => String(d.id) === String(form.detailId)) : null;
    const targetName = payer ? String(payer.title || '').trim() : '';
    if (!targetName) return all;
    return all.filter((c) => String((c as any).issuer || '').trim() === targetName);
  }, [checks, form.detailId, detailOptions]);

  /**
   * autoSetCashDetailId
   * When cashbox selection changes, propagate its detail_id to all 'cash' items.
   * If the cashbox lacks a detail_id, clears the per-item detailId.
   */
  React.useEffect(() => {
    const cb = form.cashboxId ? (cashboxes || []).find((c: any) => String(c.id) === String(form.cashboxId)) : null;
    const targetDetailId = cb && (cb as any)?.handler_detail_id != null ? String((cb as any).handler_detail_id) : null;
    setForm((prev) => {
      const items = prev.items || [];
      let changed = false;
      const updated = items.map((it) => {
        if (it.instrumentType !== 'cash') return it;
        const cur = it.detailId || null;
        const tgt = targetDetailId;
        if (String(cur || '') !== String(tgt || '')) { changed = true; return { ...it, detailId: tgt }; }
        return it;
      });
      return changed ? { ...prev, items: updated } : prev;
    });
  }, [form.cashboxId, cashboxes]);

  /**
   * handleSave
   * Saves the form: creates or updates a draft receipt.
   * - Uses normalized `editId` to prevent PUT with invalid ids.
   * - On success, navigates back to receipts list page.
   */
  async function handleSave() {
    setSaving(true); setError(null);
    try {
      if (editId) {
        await updateReceipt(editId, form);
        setInitialFormJson(JSON.stringify(form));
        navigate('/treasury/receipts');
      } else {
        await createReceipt(form);
        // After creating, go back to the list instead of navigating to the new id
        navigate('/treasury/receipts');
      }
    } catch (e: any) {
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error;
      setError(serverMsg || e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }

  /**
   * handleSend
   * Saves current draft, then posts the receipt.
   * - In create mode: creates the draft and immediately posts it.
   * - In edit mode: updates the draft before posting to ensure latest changes.
   */
  async function handleSend() {
    if (hasFormErrors || hasRowErrors) return;
    setPosting(true); setError(null);
    try {
      let id = editId;
      if (!id) {
        const created = await createReceipt(form);
        id = String(created.id);
      } else {
        await updateReceipt(id, form);
      }
      await postReceipt(String(id));
      navigate('/treasury/receipts');
    } catch (e: any) {
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error;
      setError(serverMsg || e?.message || 'Error');
    } finally {
      setPosting(false);
    }
  }

  // Auto-open print dialog when in print mode and data is loaded
  // Function: autoTriggerPrint
  // Purpose: Automatically trigger browser print when '?print=1' is present
  useEffect(() => {
    if (!printMode) return;
    if (loading) return;
    const timer = setTimeout(() => {
      try { window.print(); } catch {/* ignore */}
    }, 100);
    return () => clearTimeout(timer);
  }, [printMode, loading]);

  /**
   * Unsaved changes guard
   */
  const dirty = useMemo(() => JSON.stringify(form) !== initialFormJson, [form, initialFormJson]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = t('pages.receipts.unsavedChangesConfirm', 'You have unsaved changes. Leave?');
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, t]);

  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  /**
   * handleCancel
   * Navigates back to the receipts list (with confirmation if dirty).
   */
  function handleCancel() {
    if (dirty) setConfirmLeaveOpen(true);
    else navigate('/treasury/receipts');
  }

  function confirmLeave() {
    setConfirmLeaveOpen(false);
    navigate('/treasury/receipts');
  }

  function cancelLeave() { setConfirmLeaveOpen(false); }

  /**
   * openIncomingDialog
   * Opens the embedded dialog to issue a new incoming check.
   */
  function openIncomingDialog(): void {
    setIncomingDialogOpen(true);
  }

  /**
   * closeIncomingDialog
   * Closes the incoming check dialog.
   */
  function closeIncomingDialog(): void {
    setIncomingDialogOpen(false);
  }

  /**
   * handleIncomingChange
   * Generic handler to update incoming form fields and clear per-field errors.
   */
  function handleIncomingChange(field: keyof IncomingFormState, value: string): void {
    setIncomingForm(prev => ({ ...prev, [field]: value }));
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
    setIncomingForm(prev => ({ ...prev, amount: String(val) }));
    setIncomingErrors(prev => {
      const next = { ...prev };
      delete next.amount;
      return next;
    });
  }

  /**
   * toAsciiDigits
   * Normalizes Persian/Arabic-Indic numerals to ASCII digits for backend.
   */
  function toAsciiDigits(input: string): string {
    const persian = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    const arabic = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    return String(input || '').replace(/[۰-۹٠-٩]/g, (d: string) => {
      const pi = persian.indexOf(d);
      if (pi >= 0) return String(pi);
      const ai = arabic.indexOf(d);
      if (ai >= 0) return String(ai);
      return d;
    });
  }

  /**
   * validateIncomingForm
   * Client-side validation for embedded incoming check form.
   */
  function validateIncomingForm(): boolean {
    const errors: Record<string, string> = {};
    const requiredMsg = t('validation.required', 'Required');

    if (!incomingForm.issue_date) errors.issue_date = requiredMsg;

    const serial = toAsciiDigits(incomingForm.number || '').trim();
    if (!serial) errors.number = requiredMsg;
    else if (!/^[0-9]+$/.test(serial)) errors.number = t('validation.digitsOnly', 'Digits only');

    // Require issuer selection from details
    if (!incomingForm.party_detail_id) errors.party_detail_id = requiredMsg;

    const amtStr = toAsciiDigits(incomingForm.amount || '').trim();
    const amt = Number(amtStr);
    if (!amtStr) errors.amount = requiredMsg;
    else if (!Number.isFinite(amt) || amt <= 0)
      errors.amount = t('validation.amountPositive', 'Amount must be greater than 0');

    setIncomingErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /**
   * handleIncomingSubmit
   * Submits the incoming check to backend, refreshes checks list on success.
   */
  // Function: handleIncomingSubmit
  // Purpose: Submit incoming check form by sending payload to backend API.
  // Notes: Maps selected issuer detail to `beneficiary_detail_id` for persistence.
  async function handleIncomingSubmit(): Promise<void> {
    setIncomingSubmitError('');
    if (!validateIncomingForm()) return;
    const payload: any = {
      issue_date: incomingForm.issue_date || null,
      due_date: incomingForm.due_date || null,
      number: toAsciiDigits(incomingForm.number || ''),
      bank_name: incomingForm.bank_name || null,
      issuer: incomingForm.issuer || null,
      beneficiary_detail_id: incomingForm.party_detail_id || null,
      amount: Number(toAsciiDigits(incomingForm.amount || '0')),
      notes: incomingForm.notes || null,
      type: 'incoming',
    };
    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/treasury/checks`, payload, {
        headers: { 'Accept-Language': lang },
      });
      // Refresh available checks list after successful creation (non-blocking if it fails)
      try {
        const refreshed = await listChecks({ available: true, excludeReceiptId: editId });
        setChecks(refreshed);
      } catch (e) {
        // Swallow refresh errors; not critical to user flow
      }
      setIncomingDialogOpen(false);
      // Reset form state and errors
      setIncomingForm({ issue_date: '', due_date: '', number: '', bank_name: '', issuer: '', party_detail_id: '', amount: '', notes: '' });
      setIncomingErrors({});
      setIncomingSubmitError('');
     } catch (e: any) {
      // Map server-side validation errors where available
      const serverErrors = e?.response?.data?.errors as Record<string, string> | undefined;
      if (serverErrors) setIncomingErrors(serverErrors);
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error;
      setIncomingSubmitError(serverMsg || t('errors.unexpected', 'Unexpected error'));
     }
  }

  // Function: printableView
  // Purpose: Render printer-friendly receipt layout with localized labels.
  if (printMode) {
    const payer = form.detailId ? (detailOptions || []).find((d) => String(d.id) === String(form.detailId)) : null;
    const payerName = payer ? String(payer.title || '') : '';
    const cashbox = form.cashboxId ? (cashboxes || []).find((c) => String(c.id) === String(form.cashboxId)) : null;
    const cashboxText = cashbox ? `${String(cashbox.name || '')}${(cashbox as any)?.code != null ? ` (${String((cashbox as any).code)})` : ''}` : '-';
    return (
      <div className="p-6 bg-white text-gray-900">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">{t('pages.receipts.printTitle','Receipt')}</h1>
          <div className="text-sm mt-1">{t('fields.fiscalYear', 'Fiscal Year')}: {fyLabel}</div>
          <div className="text-sm">{t('pages.receipts.fields.cashbox','Cashbox')}: {cashboxText}</div>
        </div>
        {error && <div className="text-red-600 mb-4">{error}</div>}
        {loading && <div className="text-gray-600">{t('common.loading', 'Loading...')}</div>}
        {!loading && (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm mb-4">
              <div><span className="font-medium">{t('pages.receipts.fields.number','Number')}:</span> <span>{number || '-'}</span></div>
              <div><span className="font-medium">{t('fields.date','Date')}:</span> <span>{formatDisplayDate(form.date, lang)}</span></div>
              <div><span className="font-medium">{t('pages.receipts.fields.payer','Payer')}:</span> <span>{payerName || '-'}</span></div>
              <div><span className="font-medium">{t('common.status','Status')}:</span> <span>{t(`pages.receipts.status.${status || 'draft'}`, 'Draft')}</span></div>
              <div className="col-span-2"><span className="font-medium">{t('fields.description','Description')}:</span> <span>{form.description || '-'}</span></div>
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
                {(form.items || []).map((it, idx) => {
                  const typeLabelMap: Record<string, string> = {
                     cash: t('common.cash','Cash'),
                     transfer: t('common.transfer','Transfer'),
                     card: t('common.card','Card'),
                     check: t('common.check','Check'),
                   };
                   const instrLabel = typeLabelMap[String((it as any).instrumentType)] || t('pages.receipts.items.instrumentType','Instrument');
                  const ref = (it as any).reference ?? (it as any).cardRef ?? (it as any).transferRef ?? '';
                  return (
                    <tr key={idx}>
                      <td className="p-2 border">{instrLabel}</td>
                      <td className="p-2 border">{String(ref || '') || '-'}</td>
                      <td className="p-2 border">{renderItemDetails(it as ReceiptItem)}</td>
                      <td className="p-2 border text-right">{formatAmountForLocale(Number(it.amount || 0), lang)}</td>
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
    <div>
      <Navbar />
      <div className="p-4">
        <h1 className="text-2xl font-semibold mb-1">
          {editId ? t('pages.receipts.editTitle', 'Edit Receipt') : t('pages.receipts.createTitle', 'Create Receipt')}
        </h1>
        <div className="text-center mb-3">
          <span className="text-sm font-medium">{t('fields.fiscalYear', 'Fiscal Year')}: {fyLabel}</span>
        </div>
        {error && <div className="text-red-600 mb-4">{error}</div>}
        {loading && <div className="text-gray-600">{t('common.loading', 'Loading...')}</div>}
        {!loading && (
          <>
            <ReceiptHeader
               date={form.date}
               description={form.description || ''}
               detailId={form.detailId || null}
               specialCodeId={form.specialCodeId || null}
               status={status}
               number={number}
               fiscalYearId={form.fiscalYearId || null}
               detailOptions={detailOptions}
               specialCodeOptions={specialCodes}
               cashboxId={form.cashboxId || null}
               cashboxes={cashboxes}
               onChange={handleChangeHeader}
            />
            <ReceiptItemsTable
              items={form.items || []}
              onChange={handleChangeItems}
              cashboxes={cashboxes}
              bankAccounts={bankAccounts}
              checks={checksToDisplay}
              cardReadersByBankId={cardReadersByBankId}
              rowErrorsByIndex={rowErrorsByIndex}
              onIssueIncomingCheck={openIncomingDialog}
            />
            {/* Validation summary banner removed per request; inline errors remain */}
            {/* Redesigned footer bar combining actions and total for pixel-perfect match */}
            <div className="flex items-center justify-between bg-white border rounded p-4">
              <div className="text-gray-800 text-lg font-semibold" dir="auto">
                <span className="ml-2 rtl:ml-0 rtl:mr-2">{t('pages.receipts.total', 'Total')}:</span>
                <span>{formatAmountForLocale(total, lang)}</span>
              </div>              
              <div className="flex items-center gap-2">
                <Button type="button" className="gb-button gb-button-secondary" onClick={handleCancel} variant="secondary">
                  {t('actions.cancel', 'Cancel')}
                </Button>
                <Button onClick={handleSave} variant="primary" disabled={saving || hasFormErrors || hasRowErrors}>
                  {t('common.save', 'Save')}
                </Button>
                {editId && (

                <Button onClick={handleSend} variant="info" disabled={saving || posting || hasFormErrors || hasRowErrors}>
                    {t('actions.post', 'SendPost')}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Issue Incoming Check dialog */}
      <ConfirmDialog
        open={incomingDialogOpen}
        title={t('actions.create','Issue Incoming Check')}
        message=""
        onConfirm={handleIncomingSubmit}
        onCancel={closeIncomingDialog}
        type="info"
        dimBackground={false}
        panelClassName="shadow-[0_40px_100px_rgba(0,0,0,0.6)]"
        hideActions={true}
        widthClassName="max-w-xl"
      >
        <IncomingCheckForm
          value={incomingForm}
          errors={incomingErrors}
          submitError={incomingSubmitError}
          onChange={handleIncomingChange}
          onAmountChange={handleIncomingAmountChange}
          onSubmit={handleIncomingSubmit}
          onCancel={closeIncomingDialog}
          detailOptions={detailOptions}
          bankNameSuggestions={bankNameSuggestions}
        />
      </ConfirmDialog>

      {/* Confirm leave dialog */}
      <ConfirmDialog
        open={confirmLeaveOpen}
        title={t('pages.receipts.unsavedChangesTitle', 'Unsaved changes')}
        message={t('pages.receipts.unsavedChangesConfirm', 'You have unsaved changes. Leave?')}
        confirmText={t('actions.yes', 'Confirm')}
        cancelText={t('actions.no', 'Cancel')}
        onConfirm={confirmLeave}
        onCancel={cancelLeave}
        type="warning"
        dimBackground={false}
        backdropClassName="absolute inset-0 bg-transparent"
        panelClassName="shadow-[0_40px_100px_rgba(0,0,0,0.6)]"
        /* Primary (confirm): green; Secondary (cancel): red */
        confirmButtonClassName="bg-green-600 hover:bg-green-700 text-white"
        cancelButtonClassName="bg-red-600 hover:bg-red-700 text-white"
      />
    </div>
  );
};

export default ReceiptFormPage;