/**
 * Receipt domain types mirroring backend OpenAPI schemas.
 * Used by pages and services for type safety.
 */

/**
 * Allowed status values for a receipt.
 */
export type ReceiptStatus = 'draft' | 'posted' | 'canceled';

/**
 * Allowed instrument types for a receipt item line.
 */
export type InstrumentType = 'cash' | 'card' | 'transfer' | 'check';

/**
 * ReceiptItem
 * Represents a single instrument line within a receipt, e.g. cash, card, transfer, or check.
 */
export interface ReceiptItem {
  id?: string;
  instrumentType: InstrumentType;
  amount: number;
  bankAccountId?: string | null;
  cardReaderId?: string | null;
  reference?: string | null;
  checkId?: string | null;
  position?: number | null;
  // New unified per-item Detail ID used for document creation routing
  detailId?: string | null;
}

/**
 * Receipt
 * Receipt header with summary fields and associated items.
 */
export interface Receipt {
  id: string;
  number?: string | null;
  status: ReceiptStatus;
  date: string; // ISO date or date-time string from backend
  fiscalYearId?: string | null;
  detailId?: string | null;
  specialCodeId?: string | null;
  description?: string | null;
  totalAmount: number;
  cashboxId?: string | null;
  // Linked document (journal) created from this receipt, if any
  journalId?: string | null;
  items: ReceiptItem[];
}

/**
 * ReceiptInput
 * Payload used when creating or updating a draft receipt.
 */
export interface ReceiptInput {
  date: string;
  fiscalYearId?: string | null;
  detailId?: string | null;
  specialCodeId?: string | null;
  description?: string | null;
  cashboxId?: string | null;
  items: ReceiptItem[];
}