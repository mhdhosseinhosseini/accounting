/**
 * CashboxFormPage
 * Provides a dedicated form page for creating or editing a cashbox.
 * - When editing (id present in query), highlights the form in yellow like Details page.
 * - Fields: code, name, active, handled by (detail selector).
 * - Integrates with backend endpoints:
 *   - GET /v1/treasury/cashboxes/:id
 *   - POST /v1/treasury/cashboxes
 *   - PATCH /v1/treasury/cashboxes/:id
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import config from '../config';
import { getCurrentLang } from '../i18n';
import SearchableSelect, { SelectableOption } from '../components/common/SearchableSelect';
import { TextField } from '@mui/material';
import { Button } from '../components/Button';
import JalaliDatePicker from '../components/common/JalaliDatePicker';
import NumericInput from '../components/common/NumericInput';

interface DetailOption extends SelectableOption { code: string; title: string; }

interface FormState {
  code: string;
  name: string;
  is_active: boolean;
  handler_detail_id: string; // empty string for none
  starting_amount: string; // money as string, normalized to ASCII digits
  starting_date: string; // YYYY-MM-DD for date input
}

function toAsciiDigits(str: string): string {
  return Array.from(str)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0x0660 && code <= 0x0669) return String.fromCharCode(48 + (code - 0x0660));
      if (code >= 0x06f0 && code <= 0x06f9) return String.fromCharCode(48 + (code - 0x06f0));
      return ch;
    })
    .join('');
}

/**
 * toDateInputValue
 * Converts a date-like value to 'YYYY-MM-DD' for HTML date inputs.
 */
function toDateInputValue(d: string | Date): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * sanitizeAmountToIntegerString
 * Converts an incoming amount (number/string, may contain Persian digits or decimals)
 * to an ASCII-only integer string by stripping any fractional part and non-digits.
 */
function sanitizeAmountToIntegerString(value: any): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const ascii = toAsciiDigits(s);
  const cleaned = ascii.replace(/[^\d.]/g, '');
  const intPart = cleaned.split('.')[0];
  return intPart;
}

/**
 * generateAutoCashboxCode
 * Generates a unique 4-digit code using configured start.
 * - Reads `VITE_CASHBOX_START_CODE` (4-digit) from env, defaulting to 6000.
 * - Fetches existing cashboxes and returns the first available code from start..9999.
 */
async function generateAutoCashboxCode(lang: string): Promise<string> {
  // Determine start code from env; default to 6000 if unset/invalid
  const raw = (import.meta as any)?.env?.VITE_CASHBOX_START_CODE;
  const envStart = parseInt(String(raw ?? ''), 10);
  const START_CODE = Number.isFinite(envStart) && envStart >= 1000 && envStart <= 9999 ? envStart : 6000;
  try {
    const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/cashboxes`, { headers: { 'Accept-Language': lang } });
    const list: any[] = res.data.items || res.data.data || res.data || [];
    const used = new Set<string>();
    for (const it of list) {
      const ascii = toAsciiDigits(String(it?.code ?? ''));
      if (/^\d{4}$/.test(ascii)) used.add(ascii);
    }
    for (let n = START_CODE; n <= 9999; n++) {
      const s = String(n);
      if (!used.has(s)) return s;
    }
    const fallback = START_CODE;
    return String(fallback);
  } catch {
    return String(START_CODE);
  }
}

const CashboxFormPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('id');
  const isEdit = !!editId;
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);

  const [form, setForm] = useState<FormState>({ code: '', name: '', is_active: true, handler_detail_id: '', starting_amount: '', starting_date: '' });
  const [detailOptions, setDetailOptions] = useState<DetailOption[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  /**
   * fetchDetailOptions
   * Loads Details for the handler selector and sorts by numeric code ascending.
   */
  async function fetchDetailOptions(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/details`, { headers: { 'Accept-Language': lang } });
      const list: any[] = res.data?.data || res.data?.items || res.data || [];
      const normalize = (s: string) => toAsciiDigits(String(s));
      const isNum = (s: string) => /^\d+$/.test(s);
      const mapped: DetailOption[] = list.map((it: any) => ({ id: String(it.id), name: `${it.code} — ${it.title}`, code: String(it.code), title: String(it.title || '') }));
      const sorted = mapped.sort((a, b) => {
        const as = normalize(a.code);
        const bs = normalize(b.code);
        if (isNum(as) && isNum(bs)) return Number(as) - Number(bs);
        return as.localeCompare(bs, undefined, { numeric: true });
      });
      setDetailOptions(sorted);
    } catch (e) {
      setDetailOptions([]);
    }
  }

  /**
   * fetchForEdit
   * Loads a single cashbox when editing and pre-fills the form.
   */
  async function fetchForEdit(): Promise<void> {
    if (!isEdit || !editId) return;
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/cashboxes/${editId}`, { headers: { 'Accept-Language': lang } });
      const item = res.data?.item || res.data;
      if (!item) return;
      setForm({
        code: String(item.code || ''),
        name: String(item.name || ''),
        is_active: !!item.is_active,
        handler_detail_id: item.handler_detail_id ? String(item.handler_detail_id) : '',
        starting_amount: item.starting_amount != null ? sanitizeAmountToIntegerString(item.starting_amount) : '',
        starting_date: item.starting_date ? toDateInputValue(item.starting_date) : ''
      });
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  /**
   * submitCreate
   * Creates a new cashbox in the database.
   */
  async function submitCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      let code = form.code.trim();
      if (!code) {
        // Auto-generate a unique 4-digit code starting with 6
        code = await generateAutoCashboxCode(lang);
      }
      const payload = {
        code,
        name: form.name.trim(),
        is_active: form.is_active,
        handler_detail_id: form.handler_detail_id || null,
        starting_amount: form.starting_amount !== '' ? parseInt(toAsciiDigits(form.starting_amount), 10) : 0,
        starting_date: form.starting_date || null,
      };
      await axios.post(`${config.API_ENDPOINTS.base}/v1/treasury/cashboxes`, payload, { headers: { 'Accept-Language': lang } });
      navigate('/treasury/cashboxes');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }

  /**
   * submitUpdate
   * Updates an existing cashbox by id.
   */
  async function submitUpdate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!isEdit || !editId) return;
    setSaving(true); setError('');
    try {
      const payload: any = {
        // Code is immutable in edit mode; do not send changes
        name: form.name.trim(),
        is_active: form.is_active,
        handler_detail_id: form.handler_detail_id || null,
        starting_amount: form.starting_amount !== '' ? parseInt(toAsciiDigits(form.starting_amount), 10) : undefined,
        starting_date: form.starting_date || undefined,
      };
      await axios.patch(`${config.API_ENDPOINTS.base}/v1/treasury/cashboxes/${editId}`, payload, { headers: { 'Accept-Language': lang } });
      navigate('/treasury/cashboxes');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }

  /**
   * handleCancel
   * Ensures clicking Cancel does not submit the form and navigates back.
   */
  function handleCancel(e: React.MouseEvent<HTMLButtonElement>): void {
    e.preventDefault();
    navigate('/treasury/cashboxes');
  }

  async function fetchNextCode(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/cashboxes/next-code`, { headers: { 'Accept-Language': lang } });
      const code = String(res.data?.code || '');
      if (code) setForm((prev) => ({ ...prev, code }));
    } catch {
      const fallback = await generateAutoCashboxCode(lang);
      setForm((prev) => ({ ...prev, code: fallback }));
    }
  }

  useEffect(() => { fetchDetailOptions(); fetchForEdit(); if (!isEdit) { fetchNextCode(); } }, [lang, editId]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-4">{t('pages.cashboxes.title', 'Cashboxes')}</h1>

        <section className={`${isEdit ? 'bg-yellow-50 border border-yellow-200' : 'bg-white'} rounded shadow p-4 mb-4`}>
          <h2 className="text-lg font-medium mb-2">
            {isEdit ? t('pages.cashboxes.edit', 'Edit Cashbox') : t('pages.cashboxes.create', 'Create Cashbox')}
          </h2>
          {loading && <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>}
          {!loading && (
            <form onSubmit={isEdit ? submitUpdate : submitCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm mb-1">{t('fields.detailCode', 'Detail Code')}</label>
                <TextField
                  size="small"
                  value={form.code}
                  disabled={true}
                  helperText={t('pages.cashboxes.codeAutoGeneratedHint', 'Auto-generated based on last cashbox; unique in details')}
                  onChange={(e) => {
                    const ascii = toAsciiDigits(e.target.value);
                    const clean = ascii.replace(/[^0-9]/g, '').slice(0, 4);
                    setForm((prev) => ({ ...prev, code: clean }));
                  }}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">{t('fields.title', 'Title')}</label>
                <TextField size="small" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} fullWidth />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="is_active"
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                />
                <label htmlFor="is_active" className="text-sm">{t('fields.isActive', 'Active')}</label>
              </div>
              <div>
                <label className="block text-sm mb-1">{t('fields.startingAmount', 'Starting Amount')}</label>
                <NumericInput
                  value={form.starting_amount}
                  onChange={(val) => setForm((prev) => ({ ...prev, starting_amount: String(val) }))}
                  placeholder={t('fields.startingAmount', 'Starting Amount')}
                  fullWidth
                  size="small"
                  allowDecimal={false}
                  allowNegative={false}
                  min={0}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">{t('fields.startingDate', 'Starting Date')}</label>
                {/* Use JalaliDatePicker to allow Jalali UI entry while emitting ISO Gregorian */}
                <JalaliDatePicker
                  value={form.starting_date}
                  onChange={(iso) => setForm((prev) => ({ ...prev, starting_date: iso }))}
                  placeholder={t('fields.startingDate', 'Starting Date')}
                  inputClassName="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div className="md:col-span-3">
                <SearchableSelect<DetailOption>
                  options={detailOptions}
                  value={detailOptions.find((o) => String(o.id) === String(form.handler_detail_id)) || null}
                  onChange={(opt) => setForm((prev) => ({ ...prev, handler_detail_id: opt ? String(opt.id) : '' }))}
                  label={t('fields.handledBy', 'Handled By')}
                  placeholder={t('codes.codeOrTitle', 'Search code or title')}
                />
              </div>
              <div className="md:col-span-3 flex items-center gap-2 mt-2 justify-end rtl:justify-end">
                <Button type="submit" disabled={saving || !form.name}>
                  {isEdit ? t('actions.save', 'Save') : t('actions.create', 'Create')}
                </Button>
                <Button type="button" variant="secondary" onClick={handleCancel}>
                  {t('actions.cancel', 'Cancel')}
                </Button>
                {error && <span className="text-red-600 text-sm">{error}</span>}
              </div>
            </form>
          )}
        </section>
      </main>
    </div>
  );
};

export default CashboxFormPage;