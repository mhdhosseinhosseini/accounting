/**
 * BankAccountCardReadersPage
 * Manage card readers belonging to a specific bank account.
 * Uses MUI components for form and header.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import config from '../config';
import JalaliDatePicker from '../components/common/JalaliDatePicker';
import { Typography, Box, TextField, Checkbox, FormControlLabel, Button, IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ConfirmDialog from '../components/common/ConfirmDialog';
import AlertDialog from '../components/common/AlertDialog';

interface BankAccountItem {
  id: string;
  account_number: string;
  name: string;
  kind_of_account?: string | null;
  card_number?: string | null;
  bank_name?: string | null;
  iban?: string | null;
}

interface CardReaderItem {
  id: string;
  bank_account_id: string;
  psp_provider: string;
  terminal_id: string;
  merchant_id?: string | null;
  device_serial?: string | null;
  brand?: string | null;
  model?: string | null;
  install_date?: string | null;
  last_settlement_date?: string | null;
  is_active: boolean;
  description?: string | null;
  created_at: string;
}

interface CardReaderInput {
  psp_provider: string;
  terminal_id: string;
  merchant_id?: string;
  device_serial?: string;
  brand?: string;
  model?: string;
  install_date?: string;
  last_settlement_date?: string;
  is_active?: boolean;
  description?: string;
}

export default function BankAccountCardReadersPage() {
  const { t, i18n } = useTranslation();
  const params = useParams();
  const bankAccountId = params.id || '';
  const lang = useMemo(() => i18n.language || 'en', [i18n.language]);
  const isFa = lang.startsWith('fa');

  const [account, setAccount] = useState<BankAccountItem | null>(null);
  const [items, setItems] = useState<CardReaderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<{ psp_provider?: string; terminal_id?: string }>({});
  const [form, setForm] = useState<CardReaderInput>({ psp_provider: '', terminal_id: '', is_active: true });
  const [alertOpen, setAlertOpen] = useState<boolean>(false);
  const [alertTitle, setAlertTitle] = useState<string | undefined>(undefined);
  const [alertMessage, setAlertMessage] = useState<string>('');
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
      });
    } catch { /* ignore */ }
  }

  async function load(): Promise<void> {
    setLoading(true); setError('');
    try {
      const url = `${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(bankAccountId)}/card-readers`;
      const res = await axios.get(url, { headers: { 'Accept-Language': lang } });
      setItems(Array.isArray(res.data.items) ? res.data.items : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    } finally { setLoading(false); }
  }

  useEffect(() => { if (bankAccountId) { loadAccount(); load(); } }, [lang, bankAccountId]);

  function handleChange<K extends keyof CardReaderInput>(key: K, val: CardReaderInput[K]) {
    setForm((p) => ({ ...p, [key]: val }));
  }

  /**
   * validateForm
   * Validates required fields and returns error map.
   * Marks fields red via MUI TextField `error` and `helperText`.
   */
  function validateForm(): { psp_provider?: string; terminal_id?: string } {
  const errors: { psp_provider?: string; terminal_id?: string } = {};
  if (!form.psp_provider?.trim()) errors.psp_provider = t('common.errors.required', 'This field is required');
  if (!form.terminal_id?.trim()) errors.terminal_id = t('common.errors.required', 'This field is required');
  return errors;
  }

  /**
   * submit
   * Handles creation of card reader.
   * - Prevents form from closing until request succeeds
   * - Validates required fields and highlights errors in red
   */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    const errors = validateForm();
    if (errors.psp_provider || errors.terminal_id) {
      setFormErrors(errors);
      setError(t('validation.missingFields', 'Please fill all fields'));
      return;
    }
    setFormErrors({});
    try {
      const url = `${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(bankAccountId)}/card-readers`;
      await axios.post(url, {
        ...form,
        install_date: form.install_date ? new Date(form.install_date).toISOString() : undefined,
        last_settlement_date: form.last_settlement_date ? new Date(form.last_settlement_date).toISOString() : undefined,
      }, { headers: { 'Accept-Language': lang } });
      setForm({ psp_provider: '', terminal_id: '', is_active: true });
      await load();
      setShowForm(false);
      setAlertTitle(undefined);
      setAlertMessage(t('pages.bankAccounts.created', 'Created successfully'));
      setAlertType('success');
      setAlertOpen(true);
    } catch (e: any) { setError(e?.response?.data?.error || t('common.error', 'Error')); }
  }

  /**
   * Remove a card reader by id after confirmation via ConfirmDialog.
   * Opens a dialog without dark backdrop, then performs deletion on confirm.
   */
  function remove(id: string) {
    // Open confirm dialog without dark backdrop and store target id
    setConfirmDeleteId(id);
  }

  /**
   * handleConfirmDelete
   * Executes deletion of selected card reader:
   * - Sends DELETE with `Accept-Language`
   * - On success: shows success AlertDialog, reloads list, then closes confirm dialog
   * - On failure: maps known backend errors and keeps confirm dialog open to show error
   */
  async function handleConfirmDelete() {
    if (!confirmDeleteId) return;
    setError('');
    setSuccessMsg('');
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/card-readers/${encodeURIComponent(confirmDeleteId)}`, { headers: { 'Accept-Language': lang } });
      await load();
      setConfirmDeleteId(null);
      setAlertTitle(undefined);
      setAlertMessage(t('pages.bankAccounts.deleted', 'Deleted successfully'));
      setAlertType('success');
      setAlertOpen(true);
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('common.error', 'Error');
      const localized = msg === 'Card reader referenced by payments'
        ? t('pages.bankAccounts.errors.cardReaderReferencedByPayments', 'Card reader referenced by payments')
        : msg;
      setError(localized);
      // keep dialog open so user can read the error
    }
  }

  /**
   * closeAlert
   * Closes the alert dialog and resets its content.
   */
  function closeAlert() {
    setAlertOpen(false);
    setAlertTitle(undefined);
    setAlertMessage('');
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-2">{t('pages.bankAccounts.cardReaders', 'Card Readers')}</h1>
        <div className="mb-4 border-b border-gray-200">
          <div className="flex gap-2">
            <Link to="/treasury/bank-accounts" className="px-3 py-2 -mb-px border-b-2 border-transparent hover:border-gray-300 text-gray-600">
              {t('pages.treasury.tabs.bankAccounts', 'Bank Accounts')}
            </Link>
            <span className="px-3 py-2 -mb-px border-b-2 border-green-700 text-green-700 font-medium">{t('pages.bankAccounts.cardReaders', 'Card Readers')}</span>
          </div>
        </div>

        {account && (
          <section className="bg-white rounded shadow p-4 mb-4">
            <Typography variant="h6" sx={{ mb: 2 }}>{t('pages.bankAccounts.bankAccount', 'Bank Account')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('fields.accountNumber', 'Account Number')}</Typography>
                <Typography variant="body2" fontWeight={600}>{account.account_number}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('fields.name', 'Name')}</Typography>
                <Typography variant="body2" fontWeight={600}>{account.name}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('fields.bankName', 'Bank Name')}</Typography>
                <Typography variant="body2" fontWeight={600}>{account.bank_name || ''}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('fields.kindOfAccount', 'Kind of Account')}</Typography>
                <Typography variant="body2">{account.kind_of_account || ''}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('fields.cardNumber', 'Card Number')}</Typography>
                <Typography variant="body2">{account.card_number || ''}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('fields.iban', 'IBAN')}</Typography>
                <Typography variant="body2">{account.iban || ''}</Typography>
              </Box>
            </Box>
          </section>
        )}

        {!showForm && (
          <section className="mb-4">
            <div className={`flex ${'justify-end'}`}>
              <button type="button" className="gb-button gb-button-primary" onClick={() => setShowForm(true)}>
                 {t('actions.create', 'Create')}
               </button>
            </div>
          </section>
        )}
        {showForm && (
          <section className="bg-white rounded shadow p-4 transition-all duration-200 ease-in-out">
          <form onSubmit={submit}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <TextField label={t('fields.pspProvider', 'PSP Provider')} value={form.psp_provider} onChange={(e) => handleChange('psp_provider', e.target.value)} size="small" fullWidth required error={!!formErrors.psp_provider} helperText={formErrors.psp_provider || ''} />
              <TextField label={t('fields.terminalId', 'Terminal ID')} value={form.terminal_id} onChange={(e) => handleChange('terminal_id', e.target.value)} size="small" fullWidth required error={!!formErrors.terminal_id} helperText={formErrors.terminal_id || ''} />
              <TextField label={t('fields.merchantId', 'Merchant ID')} value={form.merchant_id || ''} onChange={(e) => handleChange('merchant_id', e.target.value)} size="small" fullWidth />
              <TextField label={t('fields.deviceSerial', 'Device Serial')} value={form.device_serial || ''} onChange={(e) => handleChange('device_serial', e.target.value)} size="small" fullWidth />
              <TextField label={t('fields.brand', 'Brand')} value={form.brand || ''} onChange={(e) => handleChange('brand', e.target.value)} size="small" fullWidth />
              <TextField label={t('fields.model', 'Model')} value={form.model || ''} onChange={(e) => handleChange('model', e.target.value)} size="small" fullWidth />
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>{t('fields.installDate', 'Install Date')}</Typography>
                <JalaliDatePicker value={form.install_date || ''} onChange={(iso) => handleChange('install_date', iso)} inputClassName="border rounded px-3 py-2 w-full" />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>{t('fields.lastSettlementDate', 'Last Settlement')}</Typography>
                <JalaliDatePicker value={form.last_settlement_date || ''} onChange={(iso) => handleChange('last_settlement_date', iso)} inputClassName="border rounded px-3 py-2 w-full" />
              </Box>
              <Box sx={{ gridColumn: '1 / -1' }}>
                <FormControlLabel control={<Checkbox checked={!!form.is_active} onChange={(e) => handleChange('is_active', e.target.checked)} />} label={t('fields.isActive', 'Active')} />
              </Box>
              <Box sx={{ gridColumn: '1 / -1' }}>
                <TextField label={t('fields.description', 'Description')} value={form.description || ''} onChange={(e) => handleChange('description', e.target.value)} size="small" fullWidth />
              </Box>
              <Box sx={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap' }}>
                <Button type="submit" variant="contained" color="success">
                  {t('actions.create', 'Create')}
                </Button>
                <button type="button" className="gb-button gb-button-secondary" onClick={() => setShowForm(false)}>
                  {t('actions.close', 'Close')}
                </button>
                {error && <Typography variant="body2" color="error" sx={{ ml: 2 }}>{error}</Typography>}
                {successMsg && <Typography variant="body2" color="success.main" sx={{ ml: 2 }}>{successMsg}</Typography>}
              </Box>
            </Box>
          </form>
        </section>)}

        <section className="bg-white rounded shadow p-4 mt-4">
          <Typography variant="h6" sx={{ mb: 2 }}>{t('pages.bankAccounts.cardreaderlist', 'Card ReaderList')}</Typography>
          {error && !showForm && <p className="text-red-600 mb-2">{error}</p>}
          {successMsg && !showForm && <p className="text-green-700 mb-2">{successMsg}</p>}
          {loading && <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>}
          {!loading && items.length === 0 && <p className="text-gray-500">{t('common.noData', 'No data')}</p>}
          {!loading && items.length > 0 && (
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-100">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3">{t('fields.pspProvider', 'PSP')}</th>
                  <th className="px-4 py-3">{t('fields.terminalId', 'Terminal ID')}</th>
                  <th className="px-4 py-3">{t('fields.merchantId', 'Merchant ID')}</th>
                  <th className="px-4 py-3">{t('fields.deviceSerial', 'Device Serial')}</th>
                  <th className="px-4 py-3">{t('fields.installDate', 'Install Date')}</th>
                  <th className="px-4 py-3">{t('fields.lastSettlementDate', 'Last Settlement')}</th>
                  <th className="px-4 py-3">{t('fields.status', 'Status')}</th>
                  <th className="px-4 py-3">{t('common.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-2">{it.psp_provider}</td>
                    <td className="px-4 py-2">{it.terminal_id}</td>
                    <td className="px-4 py-2">{it.merchant_id || ''}</td>
                    <td className="px-4 py-2">{it.device_serial || ''}</td>
                    <td className="px-4 py-2">{it.install_date ? String(it.install_date).split('T')[0] : ''}</td>
                    <td className="px-4 py-2">{it.last_settlement_date ? String(it.last_settlement_date).split('T')[0] : ''}</td>
                    <td className="px-4 py-2">{it.is_active ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}</td>
                    <td className="px-4 py-2 text-center">
                      <IconButton aria-label={t('actions.delete','Delete')} onClick={() => remove(it.id)} size="small">
                        <DeleteIcon fontSize="small" sx={{ color: '#dc2626' }} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {/* Confirm deletion dialog for card readers */}
        <ConfirmDialog
          open={!!confirmDeleteId}
          title={t('actions.delete', 'Delete')}
          message={t('pages.bankAccounts.deleteCardReaderConfirm', 'Delete this card reader?')}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
          type="danger"
          dimBackground={false}
        >
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </ConfirmDialog>
        {/* Global alert dialog */}
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