/**
 * Treasury domain types used for option pickers in receipts form.
 */

/** Cashbox entity */
export interface Cashbox {
  id: string;
  code?: string | number | null;
  name: string;
  handler_detail_id?: string | null;
  is_active?: boolean | null;
}

/** BankAccount entity */
export interface BankAccount {
  id: string;
  account_number: string;
  name: string;
  kind_of_account?: string | null;
  card_number?: string | null;
  bank_id?: string | null;
  iban?: string | null;
  is_active?: boolean | null;
}

/** CardReader entity */
export interface CardReader {
  id: string;
  bank_account_id: string;
  psp_provider?: string | null;
  terminal_id?: string | null;
  merchant_id?: string | null;
  device_serial?: string | null;
  brand?: string | null;
  model?: string | null;
  is_active?: boolean | null;
}

/** Check entity */
export interface Check {
  id: string;
  check_number?: string | null;
  /** Some endpoints return serial as `number`; keep both for compatibility */
  number?: string | null;
  /** Bank name for incoming checks */
  bank_name?: string | null;
  /** Issuer name for incoming checks (free text) */
  issuer?: string | null;
  /** Party detail for checks (issuer/recipient depending on direction) */
  party_detail_id?: string | null;
  /** Legacy: beneficiary detail for outgoing checks (deprecated) */
  beneficiary_detail_id?: string | null;
  amount: number;
  status: string;
  bank_account_id?: string | null;
  checkbook_id?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  notes?: string | null;
}