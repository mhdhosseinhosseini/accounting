/**
 * BankFormPage
 * Provides a dedicated form page for creating or editing a bank definition.
 * Fields: bank name, branch number, branch name, city.
 * Integrates with backend endpoints:
 *   - GET /v1/treasury/banks/:id
 *   - POST /v1/treasury/banks
 *   - PATCH /v1/treasury/banks/:id
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import config from '../config';
import { getCurrentLang } from '../i18n';
import { TextField } from '@mui/material';
import { Button } from '../components/Button';
import NumericInput from '../components/common/NumericInput';

interface FormState {
  name: string;
  branch_number: string; // normalized ascii digits in UI; converted to integer on submit
  branch_name: string;
  city: string;
}

/**
 * toAsciiDigits
 * Normalizes Persian/Arabic numerals to ASCII digits.
 */
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

const BankFormPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('id');
  const isEdit = !!editId;
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);

  const [form, setForm] = useState<FormState>({ name: '', branch_number: '', branch_name: '', city: '' });
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  /**
   * fetchForEdit
   * Loads a single bank when editing and pre-fills the form.
   */
  async function fetchForEdit(): Promise<void> {
    if (!isEdit || !editId) return;
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/banks/${editId}`, { headers: { 'Accept-Language': lang } });
      const item = res.data?.item || res.data;
      if (!item) return;
      setForm({
        name: String(item.name || ''),
        branch_number: item.branch_number != null ? String(item.branch_number) : '',
        branch_name: String(item.branch_name || ''),
        city: String(item.city || ''),
      });
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  /**
   * submitCreate
   * Creates a new bank record in the database.
   */
  async function submitCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = {
        name: form.name.trim(),
        branch_number: form.branch_number !== '' ? parseInt(toAsciiDigits(form.branch_number), 10) : null,
        branch_name: form.branch_name.trim() || null,
        city: form.city.trim() || null,
      };
      await axios.post(`${config.API_ENDPOINTS.base}/v1/treasury/banks`, payload, { headers: { 'Accept-Language': lang } });
      navigate('/treasury/banks');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }

  /**
   * submitUpdate
   * Updates an existing bank record by id.
   */
  async function submitUpdate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!isEdit || !editId) return;
    setSaving(true); setError('');
    try {
      const payload: any = {
        name: form.name.trim(),
        branch_number: form.branch_number !== '' ? parseInt(toAsciiDigits(form.branch_number), 10) : null,
        branch_name: form.branch_name.trim() || null,
        city: form.city.trim() || null,
      };
      await axios.patch(`${config.API_ENDPOINTS.base}/v1/treasury/banks/${editId}`, payload, { headers: { 'Accept-Language': lang } });
      navigate('/treasury/banks');
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  }

  /**
   * handleCancel
   * Prevents form submission and navigates back to banks list.
   */
  function handleCancel(e: React.MouseEvent<HTMLButtonElement>): void {
    e.preventDefault();
    navigate('/treasury/banks');
  }

  useEffect(() => { fetchForEdit(); }, [lang, editId]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-2">{t('pages.banks.title', 'Banks')}</h1>

        {/* Tabs: Banks | Bank Accounts */}
        <div className="mb-4 border-b border-gray-200">
          <div className="flex gap-2">
            <Link to="/treasury/banks" className="px-3 py-2 -mb-px border-b-2 border-green-700 text-green-700 font-medium">
              {t('pages.treasury.tabs.banks', 'Banks')}
            </Link>
            <Link to="/treasury/bank-accounts" className="px-3 py-2 -mb-px border-b-2 border-transparent hover:border-gray-300 text-gray-600">
              {t('pages.treasury.tabs.bankAccounts', 'Bank Accounts')}
            </Link>
          </div>
        </div>

        <section className={`${isEdit ? 'bg-yellow-50 border border-yellow-200' : 'bg-white'} rounded shadow p-4 mb-4`}>
          <h2 className="text-lg font-medium mb-2">
            {isEdit ? t('pages.banks.edit', 'Edit Bank') : t('pages.banks.create', 'Create Bank')}
          </h2>
          {loading && <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>}
          {!loading && (
            <form onSubmit={isEdit ? submitUpdate : submitCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">{t('fields.bankName', 'Bank Name')}</label>
                <TextField size="small" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} fullWidth />
              </div>
              <div>
                <label className="block text-sm mb-1">{t('fields.branchNumber', 'Branch Number')}</label>
                <NumericInput
                  value={form.branch_number}
                  onChange={(val) => setForm((prev) => ({ ...prev, branch_number: String(val) }))}
                  placeholder={t('fields.branchNumber', 'Branch Number')}
                  fullWidth
                  size="small"
                  allowDecimal={false}
                  allowNegative={false}
                  min={0}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">{t('fields.branchName', 'Branch Name')}</label>
                <TextField size="small" value={form.branch_name} onChange={(e) => setForm((prev) => ({ ...prev, branch_name: e.target.value }))} fullWidth />
              </div>
              <div>
                <label className="block text-sm mb-1">{t('fields.city', 'City')}</label>
                <TextField size="small" value={form.city} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} fullWidth />
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

export default BankFormPage;