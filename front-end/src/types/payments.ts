/**
 * Payment domain types used by the Treasury payments UI and services.
 * Mirrors the receipts domain with instrument items and draft/posted status.
 */

export type PaymentStatus = 'draft' | 'posted';

// Reuse instrument types consistent with backend: 'cash' | 'transfer' | 'check' | 'checkin'
export type InstrumentType = 'cash' | 'checkin' | 'transfer' | 'check';

/**
 * PaymentItem
 * Represents a single instrument line within a payment.
 *
 * Notes:
 * - Front-end uses `relatedInstrumentId` for UI selection across types.
 * - On save, we map to backend-specific fields: `bankAccountId` for 'transfer', `checkId` for 'check'/'checkin'.
 * - Card payments are not used; `card_reader_id` removed in schema. فارسی: پرداخت کارتی حذف شده است.
 */
export interface PaymentItem {
  id?: string | number | null;
  instrumentType: InstrumentType;
  amount: number;
  // Unified instrument-specific ID across all types (UI-side only)
  relatedInstrumentId?: string | number | null;
  // Backend instrument-specific fields (payload-side)
  bankAccountId?: string | number | null; // for 'transfer'
  checkId?: string | number | null; // for 'check' and 'checkin'
  // Free-form reference for transfers; optional for other instruments
  reference?: string | null;
  destinationType?: string | null; // e.g. 'party' | 'bank'
  destinationId?: string | number | null;
  position?: number | null;
}

/**
 * Payment
 * Full payment model as returned by the backend APIs.
 * Note (FA): برای پرداخت‌های ارسال‌شده، شناسه سند روزنامه (journalId) برای کنترل عملیات حذف سند لازم است.
 */
export interface Payment {
  id: string;
  number?: string | null;
  date: string;
  description?: string | null;
  status: PaymentStatus;
  fiscalYearId?: string | number | null;
  detailId?: string | number | null;
  specialCodeId?: string | number | null;
  // Added header-level cashbox to mirror receipts
  cashboxId?: string | number | null;
  // Link to posted journal document (when status is 'sent'/'posted')
  journalId?: string | null;
  items: PaymentItem[];
}

/**
 * PaymentInput
 * Editable shape used by the form for creating/updating draft payments.
 */
export interface PaymentInput {
  date: string;
  description?: string | null;
  fiscalYearId?: string | number | null;
  detailId?: string | number | null;
  specialCodeId?: string | number | null;
  // Added header-level cashbox to mirror receipts
  cashboxId?: string | number | null;
  items: PaymentItem[];
}