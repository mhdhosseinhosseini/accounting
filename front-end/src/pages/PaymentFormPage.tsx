/**
 * PaymentFormPage
 * Creates/edits a draft payment with header and items, then allows posting.
 * - /treasury/payments/new: create draft
 * - /treasury/payments/:id: edit draft
 */
import React, { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { PaymentHeader, PaymentItemsTable } from '../components/payments';
import type { Payment, PaymentInput, PaymentItem } from '../types/payments';
import { createPayment, getPayment, postPayment, updatePayment } from '../services/payments';
import { listCashboxes, listBankAccounts, listChecks } from '../services/treasury';
import type { Cashbox, BankAccount, Check } from '../types/treasury';
import { listDetails } from '../services/details';
import type { DetailOption } from '../services/details';
import axios from 'axios';
import config from '../config';
// Outgoing check issuance dialog + form
import ConfirmDialog from '../components/common/ConfirmDialog';
import OutgoingCheckForm, { type OutgoingFormState } from '../components/checks/OutgoingCheckForm';
import { validatePayment, type PaymentRowErrors } from '../validators/payment';

/**
 * normalizeEditId
 * Converts route param to a usable edit id, excluding 'new'.
 */
function normalizeEditId(id: string | null): string | null {
  if (!id) return null;
  if (id === 'new') return null;
  return id;
}

/**
 * normalizeToInput
 * Maps loaded payment into editable input shape.
 */
function normalizeToInput(p: Payment): PaymentInput {
  return {
    date: p.date || '',
    description: p.description || '',
    fiscalYearId: p.fiscalYearId || null,
    detailId: p.detailId || null,
    specialCodeId: p.specialCodeId || null,
    items: Array.isArray(p.items) ? p.items.map((it) => ({
      id: it.id,
      instrumentType: it.instrumentType,
      amount: Number(it.amount || 0),
      cashboxId: it.cashboxId || null,
      bankAccountId: it.bankAccountId || null,
      cardReaderId: it.cardReaderId || null,
      reference: (it as any).reference ?? (it as any).cardRef ?? (it as any).transferRef ?? null,
      checkId: it.checkId || null,
      destinationType: it.destinationType || null,
      destinationId: it.destinationId || null,
      position: it.position || null,
    })) as PaymentItem[] : [],
  };
}

const PaymentFormPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // Local wrapper to adapt i18next t() to validator signature
  const tt = (key: string, fallback?: string, vars?: Record<string, any>) => String(t(key, fallback as any, vars as any));
  const navigate = useNavigate();
  const params = useParams();
  const editId = normalizeEditId(params.id ?? null);

  const [form, setForm] = useState<PaymentInput>({ date: '', description: '', items: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<string | null>(editId ? 'draft' : 'draft');
  const [number, setNumber] = useState<string | null>(null);

  // Treasury options
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  // added incoming checks for 'checkin' instrument
  const [incomingChecks, setIncomingChecks] = useState<Check[]>([]);
  // removed duplicate declarations
  const [detailOptions, setDetailOptions] = useState<DetailOption[]>([]);
  const [specialCodes, setSpecialCodes] = useState<Array<{ id: string; name: string; code: string; title: string }>>([]);

  // Outgoing check issuance dialog state
  const [outgoingDialogOpen, setOutgoingDialogOpen] = useState<boolean>(false);
  const [outgoingForm, setOutgoingForm] = useState<OutgoingFormState>({
    bank_account_id: '',
    checkbook_id: '',
    issue_date: '',
    due_date: '',
    number: '',
    party_detail_id: '',
    amount: '',
    notes: '',
  });
  const [outgoingErrors, setOutgoingErrors] = useState<Record<string, string>>({});
  const [outgoingSubmitError, setOutgoingSubmitError] = useState<string>('');
  const [checkbookOptions, setCheckbookOptions] = useState<Array<{ id: string; name: string }>>([]);
  const bankAccountOptions = useMemo(() => (bankAccounts || []).map((acc) => ({ id: String(acc.id), name: String(acc.name || ''), account_number: String(acc.account_number || '') })), [bankAccounts]);
  const [rangeText, setRangeText] = useState<string>('');

  /**
   * FiscalYearRef
   * Lightweight view model for fiscal years.
   */
  interface FiscalYearRef { id: number; name: string; start_date: string; end_date: string; is_closed?: boolean }

  // Fiscal years list for defaulting fiscalYearId when absent
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRef[]>([]);

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
   * Loads fiscal years and sets default on form if absent.
   */
  async function fetchFiscalYears(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/fiscal-years`);
      const list: FiscalYearRef[] = res.data.items || res.data || [];
      setFiscalYears(list);
      setForm((prev) => ({ ...prev, fiscalYearId: prev.fiscalYearId ?? selectDefaultFiscalYear(list) }));
    } catch {/* non-blocking */}
  }

  // Initial fetch for fiscal years
  useEffect(() => { fetchFiscalYears(); }, []);

  /**
   * openOutgoingDialog
   * Opens the outgoing check issuance dialog.
   */
  function openOutgoingDialog(): void { setOutgoingDialogOpen(true); }

  /**
   * closeOutgoingDialog
   * Closes the outgoing check issuance dialog and clears any submit error.
   */
  function closeOutgoingDialog(): void { setOutgoingDialogOpen(false); setOutgoingSubmitError(''); }

  /**
   * toAsciiDigits
   * Normalizes potentially Farsi digits to ASCII for server submission.
   */
  function toAsciiDigits(str: string): string {
    const map: Record<string, string> = { '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9' };
    return String(str || '').replace(/[۰-۹]/g, (d) => map[d] || d);
  }

  /**
   * validateOutgoingForm
   * Client-side validation mirroring ChecksPage rules for outgoing checks.
   * - Requires bank_account_id, checkbook_id, issue_date, due_date
   * - Serial number must be digits-only
   * - Amount must be a positive number
   * - Recipient detail is required
   */
  function validateOutgoingForm(): boolean {
    const errs: Record<string, string> = {};
    const requiredMsg = t('validation.required','Required');
    if (!outgoingForm.bank_account_id) errs.bank_account_id = t('validation.selectBankAccount', 'Select a bank account');
    if (!outgoingForm.checkbook_id) errs.checkbook_id = t('validation.selectCheckbook', 'Select a checkbook');
    if (!outgoingForm.issue_date) errs.issue_date = t('validation.invalidDate', 'Invalid date');
    const serial = toAsciiDigits(outgoingForm.number).trim();
    if (!serial) {
      errs.number = requiredMsg;
    } else if (!/^[0-9]+$/.test(serial)) {
      errs.number = t('validation.digitsOnly','Digits only');
    }
    const amtStr = toAsciiDigits(outgoingForm.amount).trim();
    const amt = Number(amtStr);
    if (!amtStr) {
      errs.amount = requiredMsg;
    } else if (!Number.isFinite(amt) || amt <= 0) {
      errs.amount = t('validation.amountPositive','Amount must be greater than 0');
    }
    if (!outgoingForm.due_date) {
      errs.due_date = requiredMsg;
    } else {
      const d = new Date(outgoingForm.due_date);
      if (isNaN(d.getTime())) {
        errs.due_date = t('validation.invalidDate','Invalid date');
      }
    }
    if (!outgoingForm.party_detail_id) {
      errs.party_detail_id = t('validation.selectRecipient','Select a recipient');
    }
    setOutgoingErrors(errs);
    return Object.keys(errs).length === 0;
  }

  /**
   * clearOutgoingError
   * Clears a specific outgoing form field error on change.
   */
  function clearOutgoingError(field: keyof OutgoingFormState): void {
    setOutgoingErrors((prev) => { const next = { ...prev }; delete next[field as string]; return next; });
  }

  /**
   * handleOutgoingAmountChange
   * Updates outgoingForm.amount and clears validation error.
   */
  function handleOutgoingAmountChange(val: number | string): void {
    clearOutgoingError('amount');
    setOutgoingForm((prev) => ({ ...prev, amount: String(val) }));
  }

  /**
   * handleOutgoingChange
   * Generic change handler for OutgoingCheckForm controlled fields.
   * - Resets checkbook when bank account changes
   */
  function handleOutgoingChange(field: keyof OutgoingFormState, value: string): void {
    clearOutgoingError(field);
    if (field === 'bank_account_id') {
      setOutgoingForm((prev) => ({ ...prev, bank_account_id: String(value), checkbook_id: '' }));
    } else {
      setOutgoingForm((prev) => ({ ...prev, [field]: String(value) }));
    }
  }

  /**
   * loadTreasuryOptions
   * Loads cashboxes, bank accounts, and checks (available list).
   * When editing, includes checks used in the current payment.
   */
  async function loadTreasuryOptions() {
    try {
      const [details, cb, ba, outgoingChecks, incomingChecksRes, codesRes] = await Promise.all([
        listDetails(),
        listCashboxes(),
        listBankAccounts(),
        listChecks({ available: true, excludePaymentId: editId || null, type: 'outgoing' }),
        listChecks({ available: true, excludePaymentId: editId || null, type: 'incoming' }),
        axios.get(`${config.API_ENDPOINTS.base}/v1/codes`, { headers: { 'Accept-Language': lang } }),
      ]);
      setDetailOptions(details);
      setCashboxes(cb);
      setBankAccounts(ba);
      setChecks(outgoingChecks);
      setIncomingChecks(incomingChecksRes);
      // Only include active 'specific' codes for the Special Code dropdown
      const codesList: Array<{ id: string; code: string; title: string; is_active?: boolean; kind?: string }> = (codesRes?.data?.data || codesRes?.data?.items || []) as any[];
      const specificActiveCodes = (codesList || []).filter((c: any) => String(c.kind) === 'specific' && c.is_active !== false);
      setSpecialCodes(specificActiveCodes.map((c: any) => ({ id: String(c.id), name: `${String(c.code)}-${String(c.title)}`, code: String(c.code), title: String(c.title) })));
      /**
       * envDefaultPaymentCode
       * Returns the default payment special code from environment config or null.
       */
      function envDefaultPaymentCode(): string | null {
        const v = (config as any)?.DEFAULT_CODES?.paymentSpecial;
        return v && String(v).trim().length > 0 ? String(v) : null;
      }
      // Apply env-driven default special code for new payments (do not override existing)
      const envCode = envDefaultPaymentCode();
      if (envCode) {
        const def = (specificActiveCodes || []).find((c: any) => String(c.code) === envCode);
        setForm((prev) => ({ ...prev, specialCodeId: prev.specialCodeId ?? (def ? String(def.id) : prev.specialCodeId ?? null) }));
      }

    } catch (e) {
      // Swallow options errors; they will show as empty lists
    }
  }

  /**
   * loadPayment
   * Fetches existing payment when editing.
   */
  /**
   * normalizePaymentStatus
   * Converts backend payment statuses to UI-supported ones for payments only.
   * Maps 'temporary' → 'draft'; preserves 'posted'; defaults to 'draft'.
   */
  function normalizePaymentStatus(s?: string | null): 'draft' | 'posted' {
    const v = String(s || '').toLowerCase();
    return v === 'temporary' ? 'draft' : v === 'posted' ? 'posted' : 'draft';
  }
  async function loadPayment(id: string) {
    setLoading(true); setError(null);
    try {
      const p = await getPayment(id);
      setForm(normalizeToInput(p));
      setStatus(normalizePaymentStatus(p.status));
      setNumber(p.number || null);
    } catch (e: any) {
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error;
      setError(serverMsg || e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (editId) loadPayment(editId); }, [editId]);
  useEffect(() => { loadTreasuryOptions(); }, [editId]);

  /**
   * handleSave
   * Creates or updates a draft payment.
   * - In both create and edit modes, navigates back to payments list upon success.
   */
  async function handleSave() {
    setSaving(true); setError(null);
    try {
      const payload: PaymentInput = {
        date: form.date || '',
        description: form.description || '',
        fiscalYearId: form.fiscalYearId || null,
        detailId: form.detailId || null,
        specialCodeId: form.specialCodeId || null,
        items: (form.items || []).map((it, idx) => ({ ...it, position: it.position ?? idx + 1 })),
      };
      let saved: Payment;
      if (!editId) {
        saved = await createPayment(payload);
        navigate('/treasury/payments');
      } else {
        saved = await updatePayment(editId, payload);
        // After successful update, return to payments list page
        navigate('/treasury/payments');
      }
      setStatus(normalizePaymentStatus(saved.status));
      setNumber(saved.number || null);
    } catch (e: any) {
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error;
      setError(serverMsg || e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }

  /**
   * handlePost
   * Posts (finalizes) the current draft payment.
  * - After successful post, navigates back to payments list.
   */
   async function handlePost() {
     if (!editId) return;
     setSaving(true); setError(null);
     try {
       const posted = await postPayment(editId);
       setStatus(normalizePaymentStatus(posted.status));
       setNumber(posted.number || number);
      // Redirect to payments list after posting
      navigate('/treasury/payments');
     } catch (e: any) {
       const serverMsg = e?.response?.data?.message || e?.response?.data?.error;
       setError(serverMsg || e?.message || 'Error');
     } finally {
       setSaving(false);
     }
   }

  /**
   * loadCheckbooksForAccount
   * Loads checkbooks for selected bank account, maps to options.
   */
  async function loadCheckbooksForAccount(bankAccountId: string): Promise<void> {
    if (!bankAccountId) { setCheckbookOptions([]); return; }
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(bankAccountId)}/checkbooks`, { headers: { 'Accept-Language': lang } });
      const raw = Array.isArray(res.data.items) ? res.data.items : [];
      const mapped = raw.map((it: any) => ({ id: String(it.id), name: String(it.series || it.name || '') }));
      setCheckbookOptions(mapped);
      // Auto-select first available if not set
      if (!outgoingForm.checkbook_id && mapped.length > 0) {
        setOutgoingForm((prev) => ({ ...prev, checkbook_id: String(mapped[0].id) }));
      }
    } catch {
      setCheckbookOptions([]);
    }
  }

  /**
   * loadSuggestionForCheckbook
   * Loads last-issued number and next suggestion for selected checkbook.
   */
  async function loadSuggestionForCheckbook(checkbookId: string): Promise<void> {
    if (!checkbookId) { setRangeText(''); return; }
    try {
      const sugg = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(checkbookId)}/last-issued-number`, { headers: { 'Accept-Language': lang } });
      const next = String(sugg.data.nextSuggestion || '');
      const r = sugg.data.range ? `${sugg.data.range.start}…${sugg.data.range.end}` : '';
      setRangeText(r);
      // Set suggested next serial when not editing
      if (!next) return;
      setOutgoingForm((prev) => ({ ...prev, number: next }));
    } catch {
      setRangeText('');
    }
  }

  // When bank account changes, load its checkbooks
  useEffect(() => {
    if (!outgoingDialogOpen) return;
    loadCheckbooksForAccount(outgoingForm.bank_account_id);
  }, [outgoingDialogOpen, outgoingForm.bank_account_id]);

  // When checkbook changes, load next suggestion and range
  useEffect(() => {
    if (!outgoingDialogOpen) return;
    loadSuggestionForCheckbook(outgoingForm.checkbook_id);
  }, [outgoingDialogOpen, outgoingForm.checkbook_id]);

  /**
   * handleOutgoingSubmit
   * Validates and submits the outgoing check issuance, then refreshes checks list.
   */
  async function handleOutgoingSubmit(): Promise<void> {
    setOutgoingSubmitError('');
    if (!validateOutgoingForm()) return;
    const body: any = {
      type: 'outgoing',
      issue_date: outgoingForm.issue_date || null,
      due_date: outgoingForm.due_date || null,
      number: toAsciiDigits(outgoingForm.number),
      party_detail_id: outgoingForm.party_detail_id || null,
      amount: toAsciiDigits(outgoingForm.amount),
      notes: outgoingForm.notes || null,
    };
    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(outgoingForm.checkbook_id)}/checks`, body, { headers: { 'Accept-Language': lang } });
      // Refresh outgoing checks list for selection in items table
      const refreshed = await listChecks({ available: true, excludePaymentId: editId || null, type: 'outgoing' });
      setChecks(refreshed);
      // Close dialog and reset minimal fields
      setOutgoingDialogOpen(false);
      setOutgoingForm((prev) => ({ ...prev, number: '', amount: '' }));
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setOutgoingSubmitError(t('auth.sessionExpired','Session expired, please login'));
        return;
      }
      const data = error?.response?.data;
      let generalMessage = '';
      if (data && typeof data.error === 'string' && data.error) {
        generalMessage = data.error;
      }
      if (data && data.errors && typeof data.errors === 'object') {
        const fieldErrors: Record<string, string> = {};
        for (const key of Object.keys(data.errors)) {
          const val = (data.errors as any)[key];
          fieldErrors[key] = Array.isArray(val) ? String(val[0]) : String(val);
        }
        setOutgoingErrors((prev) => ({ ...prev, ...fieldErrors }));
      }
      setOutgoingSubmitError(generalMessage || t('common.error','An error occurred'));
    }
  }

  /** Compute total amount from items. */
  const total = useMemo(() => (form.items || []).reduce((sum, it) => sum + Number(it.amount || 0), 0), [form.items]);

  /**
   * formatAmountForDisplay
   * Formats a numeric amount using locale rules (Farsi vs English),
   * applying Persian digits and thousands separators for 'fa' languages.
   */
  function formatAmountForDisplay(amount: number, langCode: string): string {
    const locale = langCode && langCode.toLowerCase().startsWith('fa') ? 'fa-IR' : 'en-US';
    try {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(amount || 0));
    } catch {
      const s = String(Number(amount || 0));
      if (locale === 'fa-IR') {
        const fa = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
        return s.replace(/\d/g, (d) => fa[parseInt(d, 10)]);
      }
      return s;
    }
  }

  // Localized total text for UI (Farsi digits + grouping when applicable)
  const totalDisplay = useMemo(() => formatAmountForDisplay(total, lang), [total, lang]);

  /**
   * Compute validations for Payments
   * - Row-level and form-level checks mirrored from receipts
   * - Uses outgoing and incoming checks lists for state validation
   */
  const paymentValidation = useMemo(() => {
    return validatePayment(form, {
      cashboxes,
      bankAccounts,
      checksOutgoing: checks,
      checksIncoming: incomingChecks,
      t: tt,
    });
  }, [form, cashboxes, bankAccounts, checks, incomingChecks, t]);
  const rowErrorsByIndex: Record<number, PaymentRowErrors> = paymentValidation.rowErrors || {};
  const hasFormErrors = paymentValidation.formErrors.length > 0;
  const hasRowErrors = paymentValidation.invalidRowCount > 0;


  /**
   * filteredChecks
   * Filters outgoing checks by selected payer (detailId).
   * - If payer is empty, returns all outgoing checks
   * - Uses `party_detail_id` primarily; falls back to `beneficiary_detail_id` (legacy)
   */
  const filteredChecks = useMemo(() => {
    const payerId = form.detailId != null ? String(form.detailId) : '';
    if (!payerId) return checks || [];
    return (checks || []).filter((c) => {
      const owner = (c as any).party_detail_id != null ? String((c as any).party_detail_id)
        : ((c as any).beneficiary_detail_id != null ? String((c as any).beneficiary_detail_id) : '');
      return owner && owner === payerId;
    });
  }, [checks, form.detailId]);

  return (
    <div>
      <Navbar />
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-semibold mb-1">
          {editId ? t('pages.payments.editTitle', 'Edit Payments') : t('pages.payments.createTitle', 'Create Payment')}
        </h1>

        <PaymentHeader
          number={number}
          status={status}
          date={form.date || ''}
          description={form.description || ''}
          detailId={form.detailId != null ? String(form.detailId) : null}
          specialCodeId={form.specialCodeId != null ? String(form.specialCodeId) : null}
          fiscalYearId={form.fiscalYearId != null ? String(form.fiscalYearId) : null}
          detailOptions={detailOptions}
          specialCodeOptions={specialCodes}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        />

        {error && <div className="text-red-600 mb-2">{error}</div>}
        {loading && <div className="text-gray-600">{t('common.loading', 'Loading...')}</div>}

        <PaymentItemsTable
          items={form.items || []}
          onChange={(items) => setForm((prev) => ({ ...prev, items }))}
          cashboxes={cashboxes}
          bankAccounts={bankAccounts}
          checks={filteredChecks}
          incomingChecks={incomingChecks}
          onIssueOutgoingCheck={openOutgoingDialog}
          payerDetailId={form.detailId != null ? String(form.detailId) : null}
          onSetPayerDetailId={(id) => setForm((prev) => ({ ...prev, detailId: id }))}
          // Row-level validation errors for inline display
          rowErrorsByIndex={rowErrorsByIndex}
        />

        <div className="flex items-center justify-between bg-white border rounded p-4">
          <div className="text-lg">
            {t('pages.payments.total', 'Total')}: <strong>{totalDisplay}</strong>
          </div>
          <div className="flex items-center gap-2">
            {/* Cancel button uses secondary style */}
            <button type="button" className="gb-button gb-button-secondary" onClick={() => navigate('/treasury/payments')}>
              {t('common.cancel', 'Cancel')}
            </button>
            {/* Save button uses primary style */}
            <button type="button" className="gb-button gb-button-primary" disabled={saving || hasFormErrors || hasRowErrors} onClick={handleSave}>
              {t('common.save', 'Save')}
            </button>
            {editId && (
              <button type="button" className="px-4 py-2 rounded bg-blue-800 text-white" disabled={saving || status === 'posted' || hasFormErrors || hasRowErrors} onClick={handlePost}>
                {t('actions.post', 'Post')}
              </button>
            )}
          </div>
        </div>

        {/* Issue Outgoing Check dialog */}
        <ConfirmDialog
          open={outgoingDialogOpen}
          title={t('pages.checks.issue','Issue')}
          message=""
          onConfirm={handleOutgoingSubmit}
          onCancel={closeOutgoingDialog}
          type="info"
          dimBackground={false}
          panelClassName="shadow-[0_40px_100px_rgba(0,0,0,0.6)]"
          hideActions={true}
          widthClassName="max-w-3xl"
        >
          <OutgoingCheckForm
            value={outgoingForm}
            errors={outgoingErrors}
            submitError={outgoingSubmitError}
            editingId={null}
            bankAccountOptions={bankAccountOptions as any}
            checkbookOptions={checkbookOptions as any}
            detailOptions={detailOptions as any}
            rangeText={rangeText}
            onChange={handleOutgoingChange}
            onAmountChange={handleOutgoingAmountChange}
            onSubmit={handleOutgoingSubmit}
            onCancel={closeOutgoingDialog}
          />
        </ConfirmDialog>
      </div>
    </div>
  );
};

export default PaymentFormPage;