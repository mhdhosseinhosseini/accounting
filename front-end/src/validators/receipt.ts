import type { ReceiptInput, ReceiptItem } from '../types/receipts';
import type { Cashbox, BankAccount, CardReader, Check } from '../types/treasury';

export interface ReceiptRowErrors {
  amount?: string;
  bankAccountId?: string;
  cardReaderId?: string; // UI-only, used when enforcing reader selection
  reference?: string;
  checkId?: string;
}

export interface ReceiptValidationResult {
  rowErrors: Record<number, ReceiptRowErrors>;
  formErrors: string[];
  invalidRowCount: number;
}

/**
 * validateReceipt
 * Validates receipt header and items.
 * - Does not require `bankAccountId` for `card` items; the selected card reader implies bank account.
 * - Still requires `bankAccountId` for `transfer` items and `checkId` for checks.
 * - Enforces reference presence and uniqueness where applicable.
 */
/**
 * validateReceipt
 * Validates receipt header and items.
 * - Does not require `bankAccountId` for `card` items; the selected card reader implies bank account.
 * - Still requires `bankAccountId` for `transfer` items and `checkId` for checks.
 * - Enforces reference presence and uniqueness where applicable.
 */
export function validateReceipt(
  form: ReceiptInput,
  opts: {
    cashboxes?: Cashbox[];
    bankAccounts?: BankAccount[];
    cardReadersByBankId?: Record<string, CardReader[]>;
    checks?: Check[];
    requireCardReader?: boolean;
    t: (key: string, fallback?: string, vars?: Record<string, any>) => string;
  }
): ReceiptValidationResult {
  const { t } = opts;
  const items = (form.items || []) as ReceiptItem[];
  const rowErrors: Record<number, ReceiptRowErrors> = {};
  const formErrors: string[] = [];

  if (!items.length) {
    formErrors.push(t('pages.receipts.validation.form.atLeastOneItem', 'At least one item is required'));
  }

  const hasDate = !!(form.date && String(form.date).trim().length > 0);
  if (!hasDate) {
    formErrors.push(t('pages.receipts.validation.form.dateRequired', 'Date is required'));
  }
  const hasFiscalYear = !!(form.fiscalYearId && String(form.fiscalYearId).trim().length > 0);
  if (!hasFiscalYear) {
    formErrors.push(t('pages.receipts.validation.form.fiscalYearRequired', 'Fiscal year is required'));
  }

  // Unified reference duplicate detection for card and transfer
  const referenceMap = new Map<string, number[]>(); // ref -> [rowIdx]

  items.forEach((it, idx) => {
    const errs: ReceiptRowErrors = {};

    const amountNum = Number(it.amount || 0);
    const isPositiveAmountRequired = it.instrumentType !== 'check';
    if (isPositiveAmountRequired && (!Number.isFinite(amountNum) || amountNum <= 0)) {
      errs.amount = t('validation.positiveAmount', 'Amount must be greater than zero');
    }

    if (it.instrumentType === 'card') {
      // No bank account required for card; card reader implies bank account
      if (opts.requireCardReader) {
        const hasReader = !!((it as any).cardReaderId);
        if (!hasReader) {
          errs.cardReaderId = t('pages.receipts.validation.card.readerRequired', 'Card reader is required');
        }
      }
      const ref = String(((it as any).reference ?? (it as any).cardRef) || '').trim();
      if (!ref) {
        errs.reference = t('pages.receipts.validation.reference.required', 'Reference is required');
      } else {
        const arr = referenceMap.get(ref) || [];
        arr.push(idx); referenceMap.set(ref, arr);
      }
    }

    if (it.instrumentType === 'transfer') {
      if (!it.bankAccountId) {
        errs.bankAccountId = t('pages.receipts.validation.transfer.bankRequired', 'Bank account is required');
      }
      const ref = String(((it as any).reference ?? (it as any).transferRef) || '').trim();
      if (!ref) {
        errs.reference = t('pages.receipts.validation.reference.required', 'Reference is required');
      } else {
        const arr = referenceMap.get(ref) || [];
        arr.push(idx); referenceMap.set(ref, arr);
      }
    }

    if (it.instrumentType === 'check') {
      if (!it.checkId) {
        errs.checkId = t('pages.receipts.validation.check.required', 'Check selection is required');
      }
      const check = (opts.checks || []).find((c) => String(c.id) === String(it.checkId || ''));
      if (check) {
        const invalidStates = new Set(['canceled','paid','returned','void']);
        if (check.status && invalidStates.has(String(check.status).toLowerCase())) {
          errs.checkId = t('pages.receipts.validation.check.invalidState', 'Selected check is not in a valid state');
        }
        if (!Number.isFinite(Number(check.amount)) || Number(check.amount) <= 0) {
          errs.amount = t('pages.receipts.validation.check.invalidAmount', 'Check amount must be greater than zero');
        }
      }
    }

    if (Object.keys(errs).length > 0) {
      rowErrors[idx] = errs;
    }
  });

  // Duplicate reference errors
  for (const [ref, idxs] of referenceMap.entries()) {
    if (idxs.length > 1) {
      idxs.forEach((i) => {
        const current = rowErrors[i] || (rowErrors[i] = {});
        current.reference = t('pages.receipts.validation.reference.unique', 'Reference must be unique for this date');
      });
    }
  }

  const needsCashbox = items.some((it) => it.instrumentType === 'cash' || it.instrumentType === 'check');
  if (needsCashbox && !form.cashboxId) {
    formErrors.push(t('pages.receipts.validation.cash.cashboxRequired', 'Cashbox is required for cash or check items'));
  }

  const invalidRowCount = Object.keys(rowErrors).length;

  return { rowErrors, formErrors, invalidRowCount };
}