import type { PaymentInput, PaymentItem } from '../types/payments';
import type { Cashbox, BankAccount, Check } from '../types/treasury';

export interface PaymentRowErrors {
  amount?: string;
  cashboxId?: string;
  bankAccountId?: string;
  reference?: string;
  checkId?: string;
}

export interface PaymentValidationResult {
  rowErrors: Record<number, PaymentRowErrors>;
  formErrors: string[];
  invalidRowCount: number;
}

/**
 * validatePayment
 * Performs validations for Payments: row-level and form-level.
 * - Row rules:
 *   - Required instrument-specific fields
 *   - Positive amounts (non-zero) for cash/transfer; check amounts come from selection and must be > 0
 *   - Unique transfer reference per date within the current form
 *   - Valid check state (not canceled/paid/etc.) best-effort via provided checks lists
 * - Form rules:
 *   - At least one item line
 *   - Header rules: date required; fiscal year required
 *
 * The validator is pure and UI-agnostic. It returns error strings keyed by row index
 * and a list of form-level errors. Caller provides translation via `t`.
 */
export function validatePayment(
  form: PaymentInput,
  opts: {
    cashboxes?: Cashbox[];
    bankAccounts?: BankAccount[];
    // Checks lists for validating selection/state
    checksOutgoing?: Check[]; // used for instrumentType 'check'
    checksIncoming?: Check[]; // used for instrumentType 'checkin'
    // Translation function
    t: (key: string, fallback?: string, vars?: Record<string, any>) => string;
  }
): PaymentValidationResult {
  const { t } = opts;
  const items = (form.items || []) as PaymentItem[];
  const rowErrors: Record<number, PaymentRowErrors> = {};
  const formErrors: string[] = [];

  // Form-level: must have at least one item
  if (!items.length) {
    formErrors.push(t('pages.payments.validation.form.atLeastOneItem', 'At least one item is required'));
  }

  // Header-level: date required
  const hasDate = !!(form.date && String(form.date).trim().length > 0);
  if (!hasDate) {
    formErrors.push(t('pages.payments.validation.form.dateRequired', 'Date is required'));
  }
  // Header-level: fiscal year required
  const hasFiscalYear = !!(form.fiscalYearId && String(form.fiscalYearId).trim().length > 0);
  if (!hasFiscalYear) {
    formErrors.push(t('pages.payments.validation.form.fiscalYearRequired', 'Fiscal year is required'));
  }

  // Build maps for duplicate reference detection (reference)
  const referenceMap = new Map<string, number[]>(); // ref -> [rowIdx]

  items.forEach((it, idx) => {
    const errs: PaymentRowErrors = {};

    // Amount validation (skip manual rule for checks because amount is bound to the selected check)
    const amountNum = Number(it.amount || 0);
    const isPositiveAmountRequired = it.instrumentType !== 'check' && it.instrumentType !== 'checkin';
    if (isPositiveAmountRequired && (!Number.isFinite(amountNum) || amountNum <= 0)) {
      errs.amount = t('validation.positiveAmount', 'Amount must be greater than zero');
    }

    if (it.instrumentType === 'cash') {
      if (!it.cashboxId) {
        errs.cashboxId = t('validation.cashboxRequired', 'Cashbox is required');
      }
    }

    if (it.instrumentType === 'transfer') {
      if (!it.bankAccountId) {
        errs.bankAccountId = t('pages.payments.validation.transfer.bankRequired', 'Bank account is required');
      }
      const refVal = ((it as any).reference ?? (it as any).transferRef ?? '').trim();
      if (!refVal) {
        errs.reference = t('pages.payments.validation.transfer.refRequired', 'Transfer reference is required');
      } else {
        const key = `${refVal}`;
        const arr = referenceMap.get(key) || [];
        arr.push(idx); referenceMap.set(key, arr);
      }
    }

    if (it.instrumentType === 'check' || it.instrumentType === 'checkin') {
      if (!it.checkId) {
        errs.checkId = t('pages.payments.validation.check.required', 'Check selection is required');
      }
      // Validate check state (best-effort)
      const checksPool = it.instrumentType === 'check' ? (opts.checksOutgoing || []) : (opts.checksIncoming || []);
      const check = checksPool.find((c) => String(c.id) === String(it.checkId || ''));
      if (check) {
        const invalidStates = new Set(['canceled','paid','returned','void']);
        if ((check as any).status && invalidStates.has(String((check as any).status).toLowerCase())) {
          errs.checkId = t('pages.payments.validation.check.invalidState', 'Selected check is not in a valid state');
        }
        if (!Number.isFinite(Number((check as any).amount)) || Number((check as any).amount) <= 0) {
          errs.amount = t('pages.payments.validation.check.invalidAmount', 'Check amount must be greater than zero');
        }
      }
    }

    if (Object.keys(errs).length > 0) {
      rowErrors[idx] = errs;
    }
  });

  // Duplicate reference errors (apply to all rows that share a duplicate value)
  for (const [ref, idxs] of referenceMap.entries()) {
    if (idxs.length > 1) {
      idxs.forEach((i) => {
        const current = rowErrors[i] || (rowErrors[i] = {} as PaymentRowErrors);
        current.reference = t('pages.payments.validation.transfer.refUnique', 'Transfer reference must be unique for this date');
      });
    }
  }

  const invalidRowCount = Object.keys(rowErrors).length;

  return { rowErrors, formErrors, invalidRowCount };
}