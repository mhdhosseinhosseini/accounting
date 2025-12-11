/**
 * Payments API client
 * Provides typed functions to list, create, update, delete, and post payments.
 */
import axios from 'axios';
import config from '../config';
import { getCurrentLang } from '../i18n';
import type { Payment, PaymentInput } from '../types/payments';

const BASE = `${config.API_ENDPOINTS.base}/v1/treasury/payments`;

/**
 * listPayments
 * Fetches the list of payments from the backend.
 */
export async function listPayments(): Promise<Payment[]> {
  const { data } = await axios.get(BASE, { headers: { 'Accept-Language': getCurrentLang() } });
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list as Payment[];
}

/**
 * getPayment
 * Fetches a single payment by id.
 */
export async function getPayment(id: string): Promise<Payment> {
  const { data } = await axios.get(`${BASE}/${encodeURIComponent(id)}`, { headers: { 'Accept-Language': getCurrentLang() } });
  const item = (data?.data ?? data) as Payment;
  return item as Payment;
}

/**
 * createPayment
 * Creates a new draft payment with provided input.
 * Ensures DB status is saved as 'draft' (not 'temporary') by sending it explicitly.
 */
export async function createPayment(input: PaymentInput): Promise<Payment> {
  const body = { ...input, status: 'draft' } as any;
  const { data } = await axios.post(BASE, body, { headers: { 'Accept-Language': getCurrentLang() } });
  // Backend returns { ok, item, message } for creation
  const item = (data?.item ?? data?.data ?? data) as Payment;
  return item as Payment;
}

/**
 * updatePayment
 * Updates an existing draft payment.
 * Ensures DB status remains 'draft' by sending status explicitly.
 */
export async function updatePayment(id: string, input: PaymentInput): Promise<Payment> {
  const body = { ...input, status: 'draft' } as any;
  // Backend responds with { ok, message } for update; re-fetch the payment
  await axios.put(`${BASE}/${encodeURIComponent(id)}`, body, { headers: { 'Accept-Language': getCurrentLang() } });
  return await getPayment(id);
}

/**
 * deletePayment
 * Deletes an existing draft payment.
 */
export async function deletePayment(id: string): Promise<{ ok: boolean }> {
  const { data } = await axios.delete(`${BASE}/${encodeURIComponent(id)}`, { headers: { 'Accept-Language': getCurrentLang() } });
  return { ok: Boolean(data?.ok ?? true) };
}

/**
 * postPayment
 * Posts (finalizes) a draft payment.
 */
export async function postPayment(id: string): Promise<Payment> {
  const { data } = await axios.post(`${BASE}/${encodeURIComponent(id)}/post`, {}, { headers: { 'Accept-Language': getCurrentLang() } });
  // Backend returns { ok, item, message } for posting
  const item = (data?.item ?? data?.data ?? data) as Payment;
  return item as Payment;
}