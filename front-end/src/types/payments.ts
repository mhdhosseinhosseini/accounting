/**
 * Payment domain types used by the Treasury payments UI and services.
 * Mirrors the receipts domain with instrument items and draft/posted status.
 */

export type PaymentStatus = 'draft' | 'posted';

// Reuse instrument types consistent with backend: 'cash' | 'card' | 'transfer' | 'check'
export type InstrumentType = 'cash' | 'checkin' | 'transfer' | 'check';

/**
 * PaymentItem
 * Represents a single instrument line within a payment.
 */
export interface PaymentItem {
  id?: string | number | null;
  instrumentType: InstrumentType;
  amount: number;
  // Optional instrument-specific fields
  cashboxId?: string | number | null;
  bankAccountId?: string | number | null;
  cardReaderId?: string | number | null;
  reference?: string | null;
  checkId?: string | number | null;
  destinationType?: string | null; // e.g. 'party' | 'bank'
  destinationId?: string | number | null;
  position?: number | null;
}

/**
 * Payment
 * Full payment model as returned by the backend APIs.
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
  items: PaymentItem[];
}