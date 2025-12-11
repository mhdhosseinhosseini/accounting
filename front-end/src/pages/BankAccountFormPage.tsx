/**
 * BankAccountFormPage
 * Create/Edit form for a single bank account. Mirrors BankFormPage patterns.
 * Fields: account_number, name, kind_of_account, card_number, bank_id, iban, starting_amount, starting_date, is_active
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { getCurrentLang } from '../i18n';
import NumericInput from '../components/common/NumericInput';
import JalaliDatePicker from '../components/common/JalaliDatePicker';
import { Button } from '../components/Button';
import SearchableSelect from '../components/common/SearchableSelect';
import { listBankAccountKinds } from '../services/treasury';

interface BankItem { id: string; name: string; branch_name?: string; branch_number?: string | number; city?: string; }

interface BankAccountInput {
  account_number: string;
  name: string;
  kind_of_account?: string | null;
  card_number?: string | null;
  bank_id?: string | null;
  iban?: string | null;
  starting_amount?: number;
  starting_date?: string;
  is_active?: boolean;
}

/**
 * toAsciiDigits
 * Normalizes Farsi/Arabic-Indic numerals to ASCII digits for numeric fields.
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

/**
 * getBankDisplayName
 * Returns bank name with branch name (if present), excluding branch numbers.
 */
function getBankDisplayName(b: BankItem | undefined): string {
  if (!b) return '';
  const branch = b.branch_name ? ` - ${b.branch_name}` : '';
  return `${b.name}${branch}`;
}

/**
 * BankAccountFormPage
 * Bank account create/edit form: removed free-text bank name, enabled kind-of-account,
 * and applied gray borders to inputs. Preserves Farsi/English labels via i18n `t` keys.
 */
const BankAccountFormPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);

  const [banks, setBanks] = useState<BankItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Distinct kinds for searchable select and current typed text
  const [kinds, setKinds] = useState<Array<{ id: string; name: string }>>([]);
  const [kindInputText, setKindInputText] = useState<string>('');
  const [form, setForm] = useState<BankAccountInput>({ account_number: '', name: '', kind_of_account: '', card_number: '', bank_id: '', iban: '', starting_amount: 0, starting_date: new Date().toISOString().split('T')[0], is_active: true });

  const isEdit = (searchParams.get('id') || '').length > 0;
  const id = searchParams.get('id') || '';

  /** loadBanks: populate select options from /treasury/banks */
  async function loadBanks(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/banks`, { headers: { 'Accept-Language': lang } });
      const list = res.data.items || res.data.data || res.data || [];
      setBanks(Array.isArray(list) ? list.map((b: any) => ({ id: String(b.id), name: String(b.name || b.title || ''), branch_name: b.branch_name ? String(b.branch_name) : undefined, branch_number: b.branch_number != null ? String(b.branch_number) : undefined, city: b.city ? String(b.city) : undefined })) : []);
    } catch (e) {
      // swallow silently; select can show empty
    }
  }

  /**
   * loadKinds
   * Fetch distinct account kinds for searchable select.
   */
  async function loadKinds(): Promise<void> {
    try {
      const list = await listBankAccountKinds();
      setKinds(list);
    } catch (_) {
      setKinds([]);
    }
  }

  /** loadExisting: fetch existing account for edit */
  async function loadExisting(): Promise<void> {
    if (!isEdit) return;
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(id)}`, { headers: { 'Accept-Language': lang } });
      const data = res.data.item || res.data.data || res.data || {};
      setForm({
        account_number: String(data.account_number || ''),
        name: String(data.name || ''),
        kind_of_account: data.kind_of_account ? String(data.kind_of_account) : '',
        card_number: data.card_number ? String(data.card_number) : '',
        bank_id: data.bank_id ? String(data.bank_id) : '',
        iban: String(data.iban || ''),
        starting_amount: typeof data.starting_amount === 'number' ? data.starting_amount : 0,
        starting_date: data.starting_date ? String(data.starting_date).split('T')[0] : new Date().toISOString().split('T')[0],
        is_active: Boolean(data.is_active ?? true),
      });
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    } finally { setLoading(false); }
  }

  useEffect(() => { loadBanks(); }, [lang]);
  useEffect(() => { loadKinds(); }, [lang]);
  useEffect(() => { loadExisting(); }, [lang, id]);

  /** handleChange: update controlled inputs */
  function handleChange<K extends keyof BankAccountInput>(key: K, value: BankAccountInput[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Selected kind option derived from form value
  const selectedKindOption = useMemo(() => {
    if (!form.kind_of_account) return null;
    return kinds.find((k) => k.name === String(form.kind_of_account)) || null;
  }, [kinds, form.kind_of_account]);

  /**
   * handleCreateKindOption
   * Adds a newly typed kind into local `kinds` state (if missing)
   * and binds it to the form, so it persists on submit.
   */
  function handleCreateKindOption(text: string): void {
    const name = String(text || '').trim();
    if (!name) return;
    setKinds((prev) => (prev.some((k) => k.name === name) ? prev : [...prev, { id: name, name }]));
    handleChange('kind_of_account', name);
  }

  /** submit: POST or PUT to backend */
  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(''); setSuccessMsg('');
    if (!form.bank_id) {
      setError(t('validation.bankRequired', 'Please select a bank.'));
      return;
    }
    const payload = {
      ...form,
      account_number: toAsciiDigits(form.account_number || ''),
      card_number: toAsciiDigits(form.card_number || ''),
      iban: toAsciiDigits(form.iban || ''),
      starting_amount: Number(toAsciiDigits(String(form.starting_amount ?? '0'))),
      starting_date: form.starting_date ? new Date(form.starting_date).toISOString() : new Date().toISOString()
    } as any;
    try {
      if (isEdit) {
        await axios.put(`${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(id)}`, payload, { headers: { 'Accept-Language': lang } });
        setSuccessMsg(t('pages.bankAccounts.updated', 'Updated successfully'));
      } else {
        await axios.post(`${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts`, payload, { headers: { 'Accept-Language': lang } });
        setSuccessMsg(t('pages.bankAccounts.created', 'Created successfully'));
        // Ensure the newly typed kind appears in future options immediately
        const newKind = String(payload.kind_of_account || '').trim();
        if (newKind && !kinds.some((k) => k.name === newKind)) {
          setKinds((prev) => [...prev, { id: newKind, name: newKind }]);
        }
      }
      setTimeout(() => navigate('/treasury/bank-accounts'), 500);
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    }
  }

  /**
   * handleCancel
   * Prevents form submission and navigates back to Bank Accounts list.
   */
  function handleCancel(e: React.MouseEvent<HTMLButtonElement>): void {
    e.preventDefault();
    navigate('/treasury/bank-accounts');
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-2">{isEdit ? t('pages.bankAccounts.edit', 'Edit Bank Account') : t('pages.bankAccounts.create', 'Create Bank Account')}</h1>

        {/* Tabs: Banks | Bank Accounts */}
        <div className="mb-4 border-b border-gray-200">
          <div className="flex gap-2">
            <Link to="/treasury/banks" className="px-3 py-2 -mb-px border-b-2 border-transparent hover:border-gray-300 text-gray-600">
              {t('pages.treasury.tabs.banks', 'Banks')}
            </Link>
            <Link to="/treasury/bank-accounts" className="px-3 py-2 -mb-px border-b-2 border-green-700 text-green-700 font-medium">
              {t('pages.treasury.tabs.bankAccounts', 'Bank Accounts')}
            </Link>
          </div>
        </div>

        <section className="bg-white rounded shadow p-4">
          <form onSubmit={submit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.accountNumber', 'Account Number')}</label>
                <input
                  value={form.account_number}
                  onChange={(e) => handleChange('account_number', e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 w-full focus:border-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.kindOfAccount', 'Kind of Account')}</label>
                <SearchableSelect
                  options={kinds}
                  value={selectedKindOption}
                  onChange={(val) => handleChange('kind_of_account', val ? String(val.name) : '')}
                  label={t('fields.kindOfAccount', 'Kind of Account')}
                  placeholder={t('fields.kindOfAccount', 'Kind of Account')}
                  onInputChange={(txt) => { setKindInputText(txt); handleChange('kind_of_account', txt); }}
                  size="medium"
                  creatable={true}
                  onCreateOption={handleCreateKindOption}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.cardNumber', 'Card Number')}</label>
                <input
                  value={form.card_number || ''}
                  onChange={(e) => handleChange('card_number', e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 w-full focus:border-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.bankName', 'Bank Name')}</label>
                <select
                  value={form.bank_id || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    handleChange('bank_id', val);
                    const sel = banks.find((x) => x.id === val);
                    const display = getBankDisplayName(sel);
                    if (display) handleChange('name', display);
                  }}
                  className="border border-gray-300 rounded px-3 py-2 w-full focus:border-gray-400"
                >
                  <option value="">{t('common.select', 'Select')}</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{b.branch_name ? ' - ' + b.branch_name : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.iban', 'IBAN')}</label>
                <input
                  value={form.iban || ''}
                  onChange={(e) => handleChange('iban', e.target.value)}
                  className="border border-gray-300 rounded px-3 py-2 w-full focus:border-gray-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.startingAmount', 'Starting Amount')}</label>
                <NumericInput
                  value={form.starting_amount ?? 0}
                  onChange={(val) => handleChange('starting_amount', Number(val || 0))}
                  allowDecimal={true}
                  decimalScale={2}
                  fullWidth={true}
                  size="medium"
                  placeholder={t('fields.startingAmount', 'Starting Amount')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.startingDate', 'Starting Date')}</label>
                <JalaliDatePicker
                  value={form.starting_date || ''}
                  onChange={(iso) => handleChange('starting_date', iso)}
                  inputClassName="border border-gray-300 rounded px-3 py-2 w-full focus:border-gray-400"
                />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input
                  id="is_active"
                  type="checkbox"
                  checked={!!form.is_active}
                  onChange={(e) => handleChange('is_active', e.target.checked)}
                />
                <label htmlFor="is_active">{t('fields.isActive', 'Active')}</label>
              </div>
            </div>

            {error && <p className="text-red-600 mt-3">{error}</p>}
            {successMsg && <p className="text-green-700 mt-3">{successMsg}</p>}

            <div className="mt-4 flex gap-2 justify-end rtl:justify-end">
              <button type="submit" className="bg-green-700 text-white px-4 py-2 rounded hover:bg-green-800">
                {isEdit ? t('actions.save', 'Save') : t('actions.create', 'Create')}
              </button>
              <Button type="button" variant="secondary" onClick={handleCancel}>
                {t('actions.cancel', 'Cancel')}
              </Button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
};

export default BankAccountFormPage;