/**
 * Details API client
 * Provides a typed function to list Details (ledger details) for payer selection.
 * Mirrors the mapping used in Checks management to ensure consistent UX.
 */
import axios from 'axios';
import config from '../config';
import { getCurrentLang } from '../i18n';
import type { SelectableOption } from '../components/common/SearchableSelect';

/**
 * DetailOption
 * UI-ready option shape for details selection. Includes `code` and `title`
 * so the SearchableSelect can filter and display combined labels.
 */
export interface DetailOption extends SelectableOption { code: string; title: string }

const BASE = `${config.API_ENDPOINTS.base}/v1/details`;

/**
 * listDetails
 * Fetches all details and maps them to UI options.
 * Returns options sorted by numeric `code` to match accounting order.
 */
export async function listDetails(): Promise<DetailOption[]> {
  const { data } = await axios.get(BASE, { headers: { 'Accept-Language': getCurrentLang() } });
  const items: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const mapped: DetailOption[] = items.map((it: any) => ({
    id: String(it.id),
    name: `${it.code} — ${it.title}`,
    code: String(it.code),
    title: String(it.title || ''),
  }));
  return mapped.sort((a, b) => Number(a.code) - Number(b.code));
}