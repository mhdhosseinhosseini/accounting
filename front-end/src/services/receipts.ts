/**
 * Receipts API client
 * Provides typed functions to interact with Treasury receipts endpoints.
 */
import axios from 'axios';
import config from '../config';
import { getCurrentLang } from '../i18n';
import type { Receipt, ReceiptInput } from '../types/receipts';

const BASE = `${config.API_ENDPOINTS.base}/v1/treasury/receipts`;

/**
 * listReceipts
 * Fetches the list of receipts.
 */
export async function listReceipts(): Promise<Receipt[]> {
  const { data } = await axios.get(BASE, { headers: { 'Accept-Language': getCurrentLang() } });
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list as Receipt[];
}


/**
 * createReceipt
 * Creates a new draft receipt.
 * - Ensures header fields expected by backend are present: `status`, `totalAmount`.
 * - `totalAmount` is computed client-side from the items to align with backend schema.
 * - Supports both `{ ok, data }` and `{ item }` response shapes.
 */
export async function createReceipt(payload: ReceiptInput): Promise<Receipt> {
  const totalAmount = (payload.items || []).reduce((sum, it) => sum + Number(it.amount || 0), 0);
  const body = { ...payload, status: 'draft', totalAmount } as any;
  const { data } = await axios.post(BASE, body, { headers: { 'Accept-Language': getCurrentLang() } });
  const item = data?.item ?? data?.data ?? data;
  return item as Receipt;
}

/**
 * updateReceipt
 * Updates a draft receipt by id.
 * - Mirrors `createReceipt`: includes `status` and recomputed `totalAmount`.
 * - Supports both `{ ok, data }` and `{ item }` response shapes.
 * - Guards against invalid `id` (empty, 'undefined').
 */
export async function updateReceipt(id: string, payload: ReceiptInput): Promise<Receipt> {
  if (!id || String(id).trim() === '' || String(id).toLowerCase() === 'undefined') {
    throw new Error('Invalid receipt ID: cannot update');
  }
  const totalAmount = (payload.items || []).reduce((sum, it) => sum + Number(it.amount || 0), 0);
  const body = { ...payload, status: 'draft', totalAmount } as any;
  const { data } = await axios.put(`${BASE}/${encodeURIComponent(id)}`, body, { headers: { 'Accept-Language': getCurrentLang() } });
  const item = data?.item ?? data?.data ?? data;
  return item as Receipt;
}

/**
 * getReceipt
 * Fetches a single receipt by id.
 * - Supports both `{ ok, data }` and `{ item }` response shapes.
 * - Guards against invalid `id` (empty, 'undefined').
 */
export async function getReceipt(id: string): Promise<Receipt> {
  if (!id || String(id).trim() === '' || String(id).toLowerCase() === 'undefined') {
    throw new Error('Invalid receipt ID: cannot fetch');
  }
  const { data } = await axios.get(`${BASE}/${encodeURIComponent(id)}`, { headers: { 'Accept-Language': getCurrentLang() } });
  const item = data?.item ?? data?.data ?? data;
  return item as Receipt;
}

/**
 * deleteReceipt
 * Deletes a draft receipt by id.
 * - Guards against invalid `id` (empty, 'undefined').
 */
export async function deleteReceipt(id: string): Promise<void> {
  if (!id || String(id).trim() === '' || String(id).toLowerCase() === 'undefined') {
    throw new Error('Invalid receipt ID: cannot delete');
  }
  await axios.delete(`${BASE}/${encodeURIComponent(id)}`, { headers: { 'Accept-Language': getCurrentLang() } });
}

/**
 * postReceipt
 * Finalizes (posts) a draft receipt by id.
 * - Guards against invalid `id` (empty, 'undefined').
 */
export async function postReceipt(id: string): Promise<Receipt> {
  if (!id || String(id).trim() === '' || String(id).toLowerCase() === 'undefined') {
    throw new Error('Invalid receipt ID: cannot post');
  }
  const { data } = await axios.post(`${BASE}/${encodeURIComponent(id)}/post`, {}, { headers: { 'Accept-Language': getCurrentLang() } });
  const item = data?.item ?? data?.data ?? data;
  return item as Receipt;
}