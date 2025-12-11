/**
 * BankAccountCheckbooksPage
 * Manage checkbooks belonging to a specific bank account.
 * - Lists existing checkbooks
 * - Allows creating a new checkbook with validation
 * - Form is hidden by default; a "Create" toggle reveals it; a "Close" hides it
 * - Create toggle alignment: left in Farsi, right in English
 * - Close button uses project secondary theme styles
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import config from '../config';
import JalaliDatePicker from '../components/common/JalaliDatePicker';
import NumericInput from '../components/common/NumericInput';
import './BankAccountCheckbooksPage.css';
// Added: MUI IconButton and Delete icon for actions
import { IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ConfirmDialog from '../components/common/ConfirmDialog';
import AlertDialog from '../components/common/AlertDialog';

interface CheckbookItem {
  id: string;
  bank_account_id: string;
  series?: string | null;
  sayadi_code?: string | null;
  start_number: number;
  page_count: number;
  issue_date?: string | null;
  received_date?: string | null;
  status: string;
  description?: string | null;
  created_at: string;
}

interface CheckbookInput {
  series?: string;
  sayadi_code?: string;
  start_number: number;
  page_count: number;
  issue_date?: string;
  received_date?: string;
  status?: string;
  description?: string;
}

interface BankAccountItem {
  id: string;
  account_number: string;
  name: string;
  kind_of_account?: string | null;
  card_number?: string | null;
  bank_name?: string | null;
  iban?: string | null;
  is_active?: boolean;
  starting_amount?: number;
  starting_date?: string;
}

export default function BankAccountCheckbooksPage() {
  const { t, i18n } = useTranslation();
  const params = useParams();
  const bankAccountId = params.id || '';
  const lang = useMemo(() => i18n.language || 'en', [i18n.language]);
  const isFa = useMemo(() => (lang || 'en').startsWith('fa'), [lang]);

  const [items, setItems] = useState<CheckbookItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [account, setAccount] = useState<BankAccountItem | null>(null);

  const [form, setForm] = useState<CheckbookInput>({ start_number: 1, page_count: 1, status: 'active', series: '', sayadi_code: '' });
  const [successMsg, setSuccessMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
const [alertOpen, setAlertOpen] = useState(false);
const [alertTitle, setAlertTitle] = useState<string | undefined>(undefined);
const [alertMessage, setAlertMessage] = useState('');
const [alertType, setAlertType] = useState<'error' | 'warning' | 'info' | 'success'>('info');

  async function loadAccount(): Promise<void> {
    if (!bankAccountId) return;
    try {
      const url = `${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(bankAccountId)}`;
      const res = await axios.get(url, { headers: { 'Accept-Language': lang } });
      const data = res.data.item || res.data || {};
      setAccount({
        id: String(data.id || bankAccountId),
        account_number: String(data.account_number || ''),
        name: String(data.name || ''),
        kind_of_account: data.kind_of_account ? String(data.kind_of_account) : '',
        card_number: data.card_number ? String(data.card_number) : '',
        bank_name: data.bank_name ? String(data.bank_name) : '',
        iban: data.iban ? String(data.iban) : '',
        is_active: !!data.is_active,
        starting_amount: typeof data.starting_amount === 'number' ? data.starting_amount : undefined,
        starting_date: data.starting_date ? String(data.starting_date) : undefined,
      });
    } catch { /* show nothing if fetch fails */ }
  }
  async function load(): Promise<void> {
    setLoading(true); setError('');
    try {
      const url = `${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(bankAccountId)}/checkbooks`;
      const res = await axios.get(url, { headers: { 'Accept-Language': lang } });
      setItems(Array.isArray(res.data.items) ? res.data.items : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    } finally { setLoading(false); }
  }

  useEffect(() => { if (bankAccountId) { loadAccount(); load(); } }, [lang, bankAccountId]);

  /**
   * handleChange
   * Updates Checkbook form state, including 'sayadi_code' field.
   */
  function handleChange<K extends keyof CheckbookInput>(key: K, val: CheckbookInput[K]) {
    setForm((p) => ({ ...p, [key]: val }));
  }

  /**
   * closeAlert
   * Closes the AlertDialog and clears its title/message state.
   */
  function closeAlert() {
    setAlertOpen(false);
    setAlertTitle(undefined);
    setAlertMessage('');
  }

  /**
   * submit
   * Handles creating a checkbook:
   * - Prevents default form submit
   * - Normalizes numeric and date fields
   * - Sends POST with `Accept-Language`
   * - Reloads list and hides form on success
   * - Shows AlertDialog for localized success or error feedback
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSuccessMsg('');
    try {
      const url = `${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(bankAccountId)}/checkbooks`;
      await axios.post(url, {
        ...form,
        sayadi_code: (form.sayadi_code || '').trim() || undefined,
        start_number: Number(form.start_number || 1),
        page_count: Number(form.page_count || 1),
        issue_date: form.issue_date ? new Date(form.issue_date).toISOString() : undefined,
        received_date: form.received_date ? new Date(form.received_date).toISOString() : undefined,
      }, { headers: { 'Accept-Language': lang } });
      // Success: show alert dialog
      setAlertType('success');
      setAlertTitle(undefined);
      setAlertMessage(t('pages.bankAccounts.created', 'Created successfully'));
      setAlertOpen(true);
      setForm({ start_number: 1, page_count: 1, status: 'active', series: '', sayadi_code: '' });
      await load();
      setShowForm(false);
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('common.error', 'Error');
      setError(msg);
      // Error: show alert dialog
      setAlertType('error');
      setAlertTitle(undefined);
      setAlertMessage(msg);
      setAlertOpen(true);
    }
  }

  /**
   * remove
   * Prepares deletion by opening a confirm dialog (no dark backdrop):
   * - Stores target id in state
   * - Shows ConfirmDialog with dimBackground=false
   */
  function remove(id: string) {
    setConfirmDeleteId(id);
  }

  /**
   * handleConfirmDelete
   * Executes deletion after user confirms:
   * - Sends DELETE with `Accept-Language`
   * - On success: reloads list, closes dialog, and shows success AlertDialog
   * - On error: localizes message, keeps confirm open, and shows error AlertDialog
   */
  async function handleConfirmDelete() {
    if (!confirmDeleteId) return;
    setError('');
    setSuccessMsg('');
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/checkbooks/${encodeURIComponent(confirmDeleteId)}`, { headers: { 'Accept-Language': lang } });
      await load();
      setConfirmDeleteId(null);
      // Success: show alert dialog
      setAlertType('success');
      setAlertTitle(undefined);
      setAlertMessage(t('pages.bankAccounts.deleted', 'Deleted successfully'));
      setAlertOpen(true);
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('common.error', 'Error');
      const localized = msg === 'Checkbook has issued checks'
        ? t('pages.bankAccounts.errors.checkbookHasIssuedChecks', 'Checkbook has issued checks')
        : msg;
      setError(localized);
      // Error: show alert dialog
      setAlertType('error');
      setAlertTitle(undefined);
      setAlertMessage(localized);
      setAlertOpen(true);
      // keep dialog open so the error is visible alongside alert
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 checkbooks-page">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-2">{t('pages.bankAccounts.checkbooks', 'Checkbooks')}</h1>
        <div className="mb-4 border-b border-gray-200">
          <div className="flex gap-2">
            <Link to="/treasury/bank-accounts" className="px-3 py-2 -mb-px border-b-2 border-transparent hover:border-gray-300 text-gray-600">
              {t('pages.treasury.tabs.bankAccounts', 'Bank Accounts')}
            </Link>
            <span className="px-3 py-2 -mb-px border-b-2 border-green-700 text-green-700 font-medium">{t('pages.bankAccounts.checkbooks', 'Checkbooks')}</span>
          </div>
        </div>

        {account && (
          <section className="bg-white rounded shadow p-4 mb-4">
            <h2 className="text-base font-medium mb-3">{t('pages.bankAccounts.bankAccount', 'Bank Account')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-gray-500">{t('fields.accountNumber', 'Account Number')}</div>
                <div className="text-sm font-medium">{account.account_number}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('fields.name', 'Name')}</div>
                <div className="text-sm font-medium">{account.name}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('fields.bankName', 'Bank Name')}</div>
                <div className="text-sm font-medium">{account.bank_name || ''}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('fields.kindOfAccount', 'Kind of Account')}</div>
                <div className="text-sm">{account.kind_of_account || ''}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('fields.cardNumber', 'Card Number')}</div>
                <div className="text-sm">{account.card_number || ''}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">{t('fields.iban', 'IBAN')}</div>
                <div className="text-sm">{account.iban || ''}</div>
              </div>
            </div>
          </section>
        )}

        {!showForm && (
          <section className="bg-white rounded shadow p-4 mb-4">
            <div className={`flex ${'justify-end'} items-center gap-2 flex-nowrap`}>
              <button type="button" onClick={() => setShowForm(true)} className="gb-button gb-button-primary">
                {t('actions.create', 'Create')}
              </button>
            </div>
          </section>
        )}
        {showForm && (
          <section className="bg-white rounded shadow p-4">
            <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.series', 'Series')}</label>
                <input value={form.series || ''} onChange={(e) => handleChange('series', e.target.value)} className="border rounded px-3 py-2 w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.sayadi', 'Sayadi')}</label>
                <input value={form.sayadi_code || ''} onChange={(e) => handleChange('sayadi_code', e.target.value)} className="border rounded px-3 py-2 w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.startNumber', 'Start Number')}</label>
                <NumericInput
                  value={form.start_number}
                  onChange={(val) => handleChange('start_number', Number(val || 0))}
                  allowDecimal={false}
                  fullWidth={true}
                  size="medium"
                  placeholder={t('fields.startNumber', 'Start Number')}
                />
              </div>
              <div>
                <label className="block text sm font-medium mb-1">{t('fields.pageCount', 'Page Count')}</label>
                <NumericInput
                  value={form.page_count}
                  onChange={(val) => handleChange('page_count', Number(val || 0))}
                  allowDecimal={false}
                  fullWidth={true}
                  size="medium"
                  placeholder={t('fields.pageCount', 'Page Count')}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.issueDate', 'Issue Date')}</label>
                <JalaliDatePicker value={form.issue_date || ''} onChange={(iso) => handleChange('issue_date', iso)} inputClassName="border rounded px-3 py-2 w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.receivedDate', 'Received Date')}</label>
                <JalaliDatePicker value={form.received_date || ''} onChange={(iso) => handleChange('received_date', iso)} inputClassName="border rounded px-3 py-2 w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('fields.status', 'Status')}</label>
                <select value={form.status || 'active'} onChange={(e) => handleChange('status', e.target.value)} className="border rounded px-3 py-2 w-full">
                  <option value="active">{t('pages.bankAccounts.active', 'Active')}</option>
                  <option value="archived">{t('pages.bankAccounts.archived', 'Archived')}</option>
                  <option value="exhausted">{t('pages.bankAccounts.exhausted', 'Exhausted')}</option>
                  <option value="lost">{t('pages.bankAccounts.lost', 'Lost')}</option>
                  <option value="damaged">{t('pages.bankAccounts.damaged', 'Damaged')}</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">{t('fields.description', 'Description')}</label>
                <input value={form.description || ''} onChange={(e) => handleChange('description', e.target.value)} className="border rounded px-3 py-2 w-full" />
              </div>
              <div className="md:col-span-2 flex items-center gap-2 flex-nowrap">
                <button type="submit" className="gb-button gb-button-primary">{t('actions.create', 'Create')}</button>
                <button type="button" onClick={() => setShowForm(false)} className="gb-button gb-button-secondary">{t('actions.close', 'Close')}</button>
              </div>
            </form>
          </section>
        )}

        <section className="bg-white rounded shadow p-4 mt-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.bankAccounts.checklist', 'Checkbooks List')}</h2>

          {loading && <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>}
          {!loading && items.length === 0 && <p className="text-gray-500">{t('common.noData', 'No data')}</p>}
          {!loading && items.length > 0 && (
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3">{t('fields.series', 'Series')}</th>
                  <th className="px-4 py-3">{t('fields.sayadi', 'Sayadi')}</th>
                  <th className="px-4 py-3">{t('fields.startNumber', 'Start Number')}</th>
                  <th className="px-4 py-3">{t('fields.pageCount', 'Page Count')}</th>
                  <th className="px-4 py-3">{t('fields.issueDate', 'Issue Date')}</th>
                  <th className="px-4 py-3">{t('fields.receivedDate', 'Received Date')}</th>
                  <th className="px-4 py-3">{t('fields.status', 'Status')}</th>
                  <th className="px-4 py-3">{t('common.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2">{it.series || ''}</td>
                    <td className="px-4 py-2">{it.sayadi_code || ''}</td>
                    <td className="px-4 py-2">{it.start_number}</td>
                    <td className="px-4 py-2">{it.page_count}</td>
                    <td className="px-4 py-2">{it.issue_date ? String(it.issue_date).split('T')[0] : ''}</td>
                    <td className="px-4 py-2">{it.received_date ? String(it.received_date).split('T')[0] : ''}</td>
                    <td className="px-4 py-2">{it.status}</td>
                    <td className="px-4 py-2 text-center">
                      <IconButton aria-label={t('actions.delete', 'Delete')} onClick={() => remove(it.id)} size="small">
                        <DeleteIcon fontSize="small" sx={{ color: '#d32f2f' }} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {/* Confirm deletion dialog for checkbooks */}
        <ConfirmDialog
          open={!!confirmDeleteId}
          title={t('actions.delete', 'Delete')}
          message={t('pages.bankAccounts.deleteCheckbookConfirm', 'Delete this checkbook?')}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
          type="danger"
          dimBackground={false}
        />
        <AlertDialog
          open={alertOpen}
          title={alertTitle}
          message={alertMessage}
          onClose={closeAlert}
          dimBackground={false}
        />
      </main>
    </div>
  );
}