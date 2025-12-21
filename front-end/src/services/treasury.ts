/**
 * Treasury options API client
 * Provides typed functions to list cashboxes, bank accounts, checks, and card readers.
 */
import axios from 'axios';
import config from '../config';
import { getCurrentLang } from '../i18n';
import type { Cashbox, BankAccount, CardReader, Check } from '../types/treasury';

const BASE = `${config.API_ENDPOINTS.base}/v1/treasury`;

/**
 * listCashboxes
 * Fetches available cashboxes.
 */
export async function listCashboxes(): Promise<Cashbox[]> {
  const { data } = await axios.get(`${BASE}/cashboxes`, { headers: { 'Accept-Language': getCurrentLang() } });
  const list = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return list as Cashbox[];
}

/**
 * listBankAccounts
 * Fetches available bank accounts.
 */
export async function listBankAccounts(): Promise<BankAccount[]> {
  const { data } = await axios.get(`${BASE}/bank-accounts`, { headers: { 'Accept-Language': getCurrentLang() } });
  const list = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return list as BankAccount[];
}

/**
 * listCardReadersForAccount
 * Fetches card readers linked to a specific bank account.
 */
export async function listCardReadersForAccount(bankAccountId: string): Promise<CardReader[]> {
  const { data } = await axios.get(`${BASE}/bank-accounts/${encodeURIComponent(bankAccountId)}/card-readers`, { headers: { 'Accept-Language': getCurrentLang() } });
  const list = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return list as CardReader[];
}

/**
 * listChecks
 * Fetches checks for selection in receipt/payment items.
 * Optional filters:
 * - available: when true, only returns checks not used in other documents
 * - excludeReceiptId: include checks that are used in the specified receipt (edit mode)
 * - excludePaymentId: include checks that are used in the specified payment (edit mode)
 * - type: filter by direction ('incoming' | 'outgoing'), defaults to 'incoming'
 * - status: filter by check status (e.g., 'incashbox' for incoming)
 * - cashboxId: for incoming checks, filter by assigned cashbox
 *
 * For 'incoming', uses `/treasury/checks`.
 * For 'outgoing', aggregates across all checkbooks:
 *   - List all bank accounts
 *   - For each bank account, list its checkbooks
 *   - For each checkbook, list outgoing checks with optional filters
 *   - Augments each check with `bank_account_id` and `checkbook_id` for UI labeling
 */
export async function listChecks(opts?: { available?: boolean; excludeReceiptId?: string | null; excludePaymentId?: string | null; type?: 'incoming' | 'outgoing'; status?: string; cashboxId?: string | null }): Promise<Check[]> {
  const lang = getCurrentLang();
  const type = (opts?.type || 'incoming');

  // Incoming checks (generic endpoint)
  if (type === 'incoming') {
    const params: Record<string, string> = { type: 'incoming' };
    if (opts?.available) params.available = 'true';
    if (opts?.excludeReceiptId) params.exclude_receipt_id = String(opts.excludeReceiptId);
    if (opts?.status) params.status = String(opts.status);
    if (opts?.cashboxId) params.cashbox_id = String(opts.cashboxId);
    const { data } = await axios.get(`${BASE}/checks`, {
      headers: { 'Accept-Language': lang },
      params,
    });
    const list = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    return list as Check[];
  }

  // Outgoing checks: aggregate from all checkbooks across all bank accounts
  try {
    const { data: baData } = await axios.get(`${BASE}/bank-accounts`, { headers: { 'Accept-Language': lang } });
    const accounts: Array<{ id: string }> = Array.isArray(baData?.items) ? baData.items : Array.isArray(baData) ? baData : [];

    const allChecks: Check[] = [];
    for (const acc of accounts) {
      const accId = String((acc as any)?.id || '');
      if (!accId) continue;
      const { data: cbData } = await axios.get(`${BASE}/bank-accounts/${encodeURIComponent(accId)}/checkbooks`, { headers: { 'Accept-Language': lang } });
      const checkbooks: Array<{ id: string }> = Array.isArray(cbData?.items) ? cbData.items : Array.isArray(cbData) ? cbData : [];

      for (const cb of checkbooks) {
        const cbId = String((cb as any)?.id || '');
        if (!cbId) continue;
        const params: Record<string, string> = { type: 'outgoing' };
        if (opts?.available) params.available = 'true';
        if (opts?.excludePaymentId) params.exclude_payment_id = String(opts.excludePaymentId);
        const { data: chData } = await axios.get(`${BASE}/checkbooks/${encodeURIComponent(cbId)}/checks`, {
          headers: { 'Accept-Language': lang },
          params,
        });
        const items: any[] = Array.isArray(chData?.items) ? chData.items : Array.isArray(chData) ? chData : [];
        // Augment outgoing checks with account and checkbook identifiers for UI label composition
        items.forEach((c) => {
          (c as any).bank_account_id = accId;
          (c as any).checkbook_id = cbId;
          allChecks.push(c as Check);
        });
      }
    }
    return allChecks;
  } catch (e) {
    // On any failure, return an empty list to avoid crashing the form
    return [];
  }
}

/**
 * listBankAccountKinds
 * Fetches distinct kind_of_account values for bank accounts for the searchable select.
 */
export async function listBankAccountKinds(): Promise<Array<{ id: string; name: string }>> {
  const { data } = await axios.get(`${BASE}/bank-accounts/kinds`, { headers: { 'Accept-Language': getCurrentLang() } });
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  // Normalize to { id, name } pairs
  return items.map((k: any) => ({ id: String(k.id ?? k), name: String(k.name ?? k) }));
}