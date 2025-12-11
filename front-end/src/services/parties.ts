/**
 * Parties API client
 * Provides typed functions to list parties for payer selection in receipts.
 */
import axios from 'axios';
import config from '../config';
import { getCurrentLang } from '../i18n';
import type { Party } from '../types/parties';

const BASE = `${config.API_ENDPOINTS.base}/v1/parties`;

/**
 * listParties
 * Fetches all parties to populate the payer selection.
 * Returns an array of Party objects ordered by name.
 */
export async function listParties(): Promise<Party[]> {
  const { data } = await axios.get(BASE, { headers: { 'Accept-Language': getCurrentLang() } });
  const list = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return list as Party[];
}