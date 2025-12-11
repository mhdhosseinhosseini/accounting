/**
 * BankAccountsPage
 * Displays a list of bank accounts with search, sortable headers, pagination,
 * and per-row edit/delete actions. Mirrors BanksPage UX patterns.
 * Columns: Code, Name, Bank Name, IBAN, Active.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import { IconButton, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import TableSortHeader from '../components/common/TableSortHeader';
import Pagination from '../components/common/Pagination';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { getCurrentLang } from '../i18n';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
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
  is_active?: boolean;
  starting_amount?: number;
  starting_date?: string;
}

// Added: BankItem interface for consolidated Manage Banks tabs
interface BankItem {
  id: string;
  name: string;
  branch_number?: number | string | null;
  branch_name?: string | null;
  city?: string | null;
}

// Converts ASCII digits to Persian digits for localized display
function toPersianDigits(s: string): string {
  return String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[parseInt(d, 10)]);
}

// Safe DateObject from ISO string
function toDateObjectSafe(iso?: string): DateObject | null {
  try {
    if (!iso) return null;
    const s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map((p) => parseInt(p, 10));
      if (!isNaN(y) && !isNaN(m) && !isNaN(d)) return new DateObject({ year: y, month: m, day: d });
    }
    const dObj = new DateObject(new Date(s));
    return dObj;
  } catch { return null; }
}

// Formats ISO to localized display (Jalali YYYY/MM/DD in Farsi; Gregorian YYYY-MM-DD in English)
function formatDisplayDate(iso?: string): string {
  const obj = toDateObjectSafe(iso);
  if (!obj) return '';
  try {
    if (getCurrentLang() === 'fa') {
      const j = obj.convert(persian);
      const jy = String(j.year).padStart(4, '0');
      const jm = String(j.month.number).padStart(2, '0');
      const jd = String(j.day).padStart(2, '0');
      return toPersianDigits(`${jy}/${jm}/${jd}`);
    }
    const y = String(obj.year).padStart(4, '0');
    const m = String(obj.month.number).padStart(2, '0');
    const d = String(obj.day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  } catch { return iso || ''; }
}

/**
 * toAsciiDigits
 * Normalizes Farsi/Arabic-Indic numerals to ASCII digits for sort/search.
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

const BankAccountsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isRTL = (document?.documentElement?.dir || 'ltr') === 'rtl';
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);

  // Determine initial active tab from pathname and keep in sync
  const initialTab = useMemo(() => (location.pathname.includes('/treasury/banks') ? 'banks' : 'accounts'), [location.pathname]);
  const [activeTab, setActiveTab] = useState<'banks' | 'accounts'>(initialTab);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  // ===================== Bank Accounts state & logic =====================
  const [items, setItems] = useState<BankAccountItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<keyof BankAccountItem | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  // Confirm/Alert state for accounts and banks
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<string | null>(null);
  const [confirmDeleteBankId, setConfirmDeleteBankId] = useState<string | null>(null);
  const [alertOpen, setAlertOpen] = useState<boolean>(false);
  const [alertTitle, setAlertTitle] = useState<string | undefined>(undefined);
  const [alertMessage, setAlertMessage] = useState<string>('');
  const [alertType, setAlertType] = useState<'success' | 'error' | 'info' | 'warning' | undefined>('info');

  /** handleSort: toggle sort for bank accounts */
  function handleSort(key: keyof BankAccountItem): void {
    setSortBy((prev) => {
      if (prev === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return prev; }
      setSortDir('asc');
      return key;
    });
    setPage(1);
  }

  /** handlePageSizeChange: bank accounts paging */
  function handlePageSizeChange(newSize: number): void { setPageSize(newSize); setPage(1); }

  /** fetchBankAccounts: load from backend */
  async function fetchBankAccounts(): Promise<void> {
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts`, { headers: { 'Accept-Language': lang } });
      const list = res.data.items || res.data.data || res.data || [];
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    } finally { setLoading(false); }
  }

  /** deleteBankAccount: open ConfirmDialog for deletion */
  async function deleteBankAccount(id: string): Promise<void> {
    setConfirmDeleteAccountId(id);
  }

  /**
   * handleConfirmDeleteAccount
   * Executes deletion of a bank account after user confirms:
   * - Sends DELETE with `Accept-Language`
   * - On success: reloads list, closes confirm, and shows success AlertDialog
   * - On error: shows localized error in AlertDialog and keeps context clear
   */
  /**
   * localizeDeleteErrorMessage
   * Maps known database RESTRICT foreign key errors to localized user-friendly messages.
   * - bankAccount + checkbooks constraint -> pages.bankAccounts.errors.referencedByCheckbooks
   * - bank + bank_accounts constraint -> pages.banks.errors.referencedByAccounts
   */
  function localizeDeleteErrorMessage(raw: string, entity: 'bankAccount' | 'bank'): string | null {
    const s = (raw || '').toLowerCase();
    if (entity === 'bankAccount') {
      if (s.includes('violates restrict') && (s.includes('checkbooks_bank_account_id_fkey') || s.includes('on table "checkbooks"'))) {
        return t('pages.bankAccounts.errors.referencedByCheckbooks', 'Cannot delete: referenced by checkbooks');
      }
    }
    if (entity === 'bank') {
      if (s.includes('violates restrict') && (s.includes('bank_accounts') && (s.includes('_bank_id_fkey') || s.includes('on table "bank_accounts"')))) {
        return t('pages.banks.errors.referencedByAccounts', 'Cannot delete: referenced by bank accounts');
      }
    }
    return null;
  }

  async function handleConfirmDeleteAccount(): Promise<void> {
    if (!confirmDeleteAccountId) return;
    setError('');
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/bank-accounts/${encodeURIComponent(confirmDeleteAccountId)}`, { headers: { 'Accept-Language': lang } });
      await fetchBankAccounts();
      setConfirmDeleteAccountId(null);
      setAlertType('success');
      setAlertTitle(undefined);
      setAlertMessage(t('pages.bankAccounts.deleted', 'Deleted successfully'));
      setAlertOpen(true);
    } catch (e: any) {
      const raw = e?.response?.data?.error || '';
      const msg = localizeDeleteErrorMessage(raw, 'bankAccount') || raw || t('common.error', 'Error');
      setError(msg);
      setAlertType('error');
      setAlertTitle(undefined);
      setAlertMessage(msg);
      setAlertOpen(true);
    }
  }

  /** Navigation helpers for accounts */
  function openCreate(): void { navigate('/treasury/bank-accounts/new'); }
  function openEdit(id: string): void { navigate(`/treasury/bank-accounts/edit?id=${encodeURIComponent(id)}`); }

  useEffect(() => { fetchBankAccounts(); }, [lang]);

  /** filteredItems: bank accounts search */
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return items;
    const isNumericOnly = /^[\s\u0660-\u0669\u06F0-\u06F9\d]+$/.test(q);
    const normalized = isNumericOnly ? toAsciiDigits(q) : q;
    const qq = normalized.toLowerCase();
    return items.filter((it) =>
      String(it.account_number || '').toLowerCase().includes(qq) ||
      String(it.name || '').toLowerCase().includes(qq) ||
      String(it.bank_name || '').toLowerCase().includes(qq) ||
      String(it.iban || '').toLowerCase().includes(qq) ||
      String(it.card_number || '').toLowerCase().includes(qq)
    );
  }, [items, searchQuery]);

  /** sortedItems: bank accounts sort */
  const sortedItems = useMemo(() => {
    if (!sortBy) return filteredItems;
    const arr = [...filteredItems];
    arr.sort((a, b) => {
      const av = a[sortBy] as any; const bv = b[sortBy] as any;
      let cmp = 0;
      if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
      else cmp = String(av || '').localeCompare(String(bv || ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredItems, sortBy, sortDir]);

  /** paginate accounts */
  const total = sortedItems.length;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, page, pageSize]);

  // ===================== Banks state & logic (new tab) =====================
  const [banks, setBanks] = useState<BankItem[]>([]);
  const [banksLoading, setBanksLoading] = useState<boolean>(false);
  const [banksError, setBanksError] = useState<string>('');
  const [banksSearch, setBanksSearch] = useState<string>('');
  const [banksSortBy, setBanksSortBy] = useState<keyof BankItem | null>(null);
  const [banksSortDir, setBanksSortDir] = useState<'asc' | 'desc'>('asc');
  const [banksPage, setBanksPage] = useState<number>(1);
  const [banksPageSize, setBanksPageSize] = useState<number>(10);

  /** fetchBanks: load banks list */
  async function fetchBanks(): Promise<void> {
    setBanksLoading(true); setBanksError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/banks`, { headers: { 'Accept-Language': lang } });
      const list = res.data.items || res.data.data || res.data || [];
      setBanks(Array.isArray(list) ? list : []);
    } catch (e: any) { setBanksError(e?.response?.data?.error || t('common.error', 'Error')); }
    finally { setBanksLoading(false); }
  }

  /** deleteBank: open ConfirmDialog for bank deletion */
  async function deleteBank(id: string): Promise<void> {
    setConfirmDeleteBankId(id);
  }

  /**
   * handleConfirmDeleteBank
   * Executes deletion of a bank after user confirms:
   * - Sends DELETE with `Accept-Language`
   * - On success: reloads banks list, closes confirm, and shows success AlertDialog
   * - On error: shows localized error in AlertDialog
   */
  async function handleConfirmDeleteBank(): Promise<void> {
    if (!confirmDeleteBankId) return;
    setBanksError('');
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/banks/${encodeURIComponent(confirmDeleteBankId)}`, { headers: { 'Accept-Language': lang } });
      await fetchBanks();
      setConfirmDeleteBankId(null);
      setAlertType('success');
      setAlertTitle(undefined);
      setAlertMessage(t('pages.banks.deleted', 'Deleted successfully'));
      setAlertOpen(true);
    } catch (e: any) {
      const raw = e?.response?.data?.error || '';
      const msg = localizeDeleteErrorMessage(raw, 'bank') || raw || t('common.error', 'Error');
      setBanksError(msg);
      setAlertType('error');
      setAlertTitle(undefined);
      setAlertMessage(msg);
      setAlertOpen(true);
    }
  }

  /** closeAlert: closes AlertDialog and clears transient state */
  function closeAlert(): void {
    setAlertOpen(false);
    setAlertTitle(undefined);
    setAlertMessage('');
  }

  /** Navigation helpers for banks */
  function openCreateBank(): void { navigate('/treasury/banks/new'); }
  function openEditBank(id: string): void { navigate(`/treasury/banks/edit?id=${encodeURIComponent(id)}`); }

  useEffect(() => { fetchBanks(); }, [lang]);

  /** filteredBanks: search across bank fields */
  const filteredBanks = useMemo(() => {
    const q = banksSearch.trim(); if (!q) return banks;
    const isNumericOnly = /^[\s\u0660-\u0669\u06F0-\u06F9\d]+$/.test(q);
    const qq = (isNumericOnly ? toAsciiDigits(q) : q).toLowerCase();
    return banks.filter((it) =>
      String(it.name || '').toLowerCase().includes(qq) ||
      String(it.branch_name || '').toLowerCase().includes(qq) ||
      String(it.city || '').toLowerCase().includes(qq) ||
      String(it.branch_number ?? '').toLowerCase().includes(qq)
    );
  }, [banks, banksSearch]);

  /** sortedBanks: sort by column */
  const sortedBanks = useMemo(() => {
    if (!banksSortBy) return filteredBanks;
    const arr = [...filteredBanks];
    arr.sort((a, b) => {
      const av = a[banksSortBy] as any; const bv = b[banksSortBy] as any; let cmp = 0;
      if (banksSortBy === 'branch_number') {
        const numA = typeof av === 'number' ? Math.trunc(av) : (parseInt(toAsciiDigits(String(av)).replace(/[^\d]/g, ''), 10) || 0);
        const numB = typeof bv === 'number' ? Math.trunc(bv) : (parseInt(toAsciiDigits(String(bv)).replace(/[^\d]/g, ''), 10) || 0);
        cmp = numA - numB;
      } else if (typeof av === 'string' && typeof bv === 'string') cmp = av.localeCompare(bv);
      else cmp = String(av || '').localeCompare(String(bv || ''));
      return banksSortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredBanks, banksSortBy, banksSortDir]);

  /** paginate banks */
  const banksTotal = sortedBanks.length;
  const pagedBanks = useMemo(() => {
    const start = (banksPage - 1) * banksPageSize;
    return sortedBanks.slice(start, start + banksPageSize);
  }, [sortedBanks, banksPage, banksPageSize]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-2">{t('pages.manageBanks.title', 'Manage Banks')}</h1>

        {/* Tabs: Banks | Bank Accounts (in-page toggle, no route change) */}
        <div className="mb-4 border-b border-gray-200">
          <div className="flex gap-2">
            <button
              type="button"
              className={`px-3 py-2 -mb-px border-b-2 ${activeTab === 'banks' ? 'border-green-700 text-green-700 font-medium' : 'border-transparent hover:border-gray-300 text-gray-600'}`}
              onClick={() => setActiveTab('banks')}
              aria-label={t('pages.treasury.tabs.banks', 'Banks')}
            >
              {t('pages.treasury.tabs.banks', 'Banks')}
            </button>
            <button
              type="button"
              className={`px-3 py-2 -mb-px border-b-2 ${activeTab === 'accounts' ? 'border-green-700 text-green-700 font-medium' : 'border-transparent hover:border-gray-300 text-gray-600'}`}
              onClick={() => setActiveTab('accounts')}
              aria-label={t('pages.treasury.tabs.bankAccounts', 'Bank Accounts')}
            >
              {t('pages.treasury.tabs.bankAccounts', 'Bank Accounts')}
            </button>
          </div>
        </div>

        {/* Header controls per tab */}
        {activeTab === 'accounts' ? (
          <div className="relative mb-4 h-10">
            <button
              type="button"
              onClick={openCreate}
              className="absolute left-0 top-0 bg-green-700 text-white px-3 py-2 rounded-md hover:bg-green-800"
              aria-label={t('pages.bankAccounts.create', 'Create Bank Account')}
              title={t('pages.bankAccounts.create', 'Create Bank Account')}
            >
              {t('pages.bankAccounts.create', 'Create Bank Account')}
            </button>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('common.search', 'Search')}
              className="absolute right-0 top-0 border rounded px-3 py-2 w-64"
            />
          </div>
        ) : (
          <div className="relative mb-4 h-10">
            <button
              type="button"
              onClick={openCreateBank}
              className="absolute left-0 top-0 bg-green-700 text-white px-3 py-2 rounded-md hover:bg-green-800"
              aria-label={t('pages.banks.create', 'Create Bank')}
              title={t('pages.banks.create', 'Create Bank')}
            >
              {t('pages.banks.create', 'Create Bank')}
            </button>
            <input
              value={banksSearch}
              onChange={(e) => setBanksSearch(e.target.value)}
              placeholder={t('common.search', 'Search')}
              className="absolute right-0 top-0 border rounded px-3 py-2 w-64"
            />
          </div>
        )}

        {/* Tab content */}
        {activeTab === 'accounts' ? (
          <section className="bg-white rounded shadow p-4">
            <h2 className="text-lg font-medium mb-2">{t('pages.bankAccounts.list', 'Bank Accounts List')}</h2>
            {loading && <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>}
            {!loading && filteredItems.length === 0 && (
              <p className="text-gray-500">{t('common.noData', 'No data')}</p>
            )}
            {!loading && filteredItems.length > 0 && (
              <>
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-100">
                    <tr className="border-b border-gray-200">
                      <TableSortHeader
                        label={t('fields.accountNumber', 'Account Number')}
                        sortKey={'account_number' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.name', 'Name')}
                        sortKey={'name' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.kindOfAccount', 'Kind of Account')}
                        sortKey={'kind_of_account' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.cardNumber', 'Card Number')}
                        sortKey={'card_number' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.bankName', 'Bank Name')}
                        sortKey={'bank_name' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.iban', 'IBAN')}
                        sortKey={'iban' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.startingAmount', 'Starting Amount')}
                        sortKey={'starting_amount' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.startingDate', 'Starting Date')}
                        sortKey={'starting_date' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={isRTL ? 'text-right' : 'text-left'}
                      />
                      <TableSortHeader
                        label={t('pages.bankAccounts.checkbooks', 'Checkbooks')}
                        sortKey={'checkbook_count' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={isRTL ? 'text-right' : 'text-left'}
                      />
                      <TableSortHeader
                        label={t('pages.bankAccounts.cardReaders', 'Card Readers')}
                        sortKey={'card_reader_count' as any}
                        currentSortBy={sortBy as any}
                        currentSortDir={sortDir}
                        onSort={(k) => handleSort(k as keyof BankAccountItem)}
                        headerAlign={isRTL ? 'text-right' : 'text-left'}
                      />
                      <th className="px-4 py-3 text-base font-medium text-gray-700 uppercase tracking-wider text-center">
                        {t('common.actions', 'Actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((it) => (
                      <tr key={it.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.account_number}</td>
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.name}</td>
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.kind_of_account || ''}</td>
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.card_number || ''}</td>
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.bank_name || ''}</td>
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.iban || ''}</td>
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{typeof it.starting_amount === 'number' ? it.starting_amount.toFixed(2) : ''}</td>
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatDisplayDate(it.starting_date)}</td>
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{(it as any).checkbook_count ?? 0}</td>
                        <td className={`px-4 py-2 ${isRTL ? 'text-right' : 'text-left'}`}>{(it as any).card_reader_count ?? 0}</td>
                        <td className="px-4 py-2 text-center">
                          <IconButton aria-label={t('actions.edit', 'Edit')} onClick={() => openEdit(it.id)} size="small">
                            <EditIcon fontSize="small" sx={{ color: '#16a34a' }} />
                          </IconButton>
                          <IconButton aria-label={t('actions.delete', 'Delete')} onClick={() => deleteBankAccount(it.id)} size="small">
                            <DeleteIcon fontSize="small" sx={{ color: '#dc2626' }} />
                          </IconButton>
                          <Tooltip title={t('pages.bankAccounts.manageCheckbooks', 'Manage Checkbooks')}>
                            <IconButton
                              aria-label={t('pages.bankAccounts.manageCheckbooks', 'Manage Checkbooks')}
                              component={Link}
                              to={`/treasury/bank-accounts/${encodeURIComponent(it.id)}/checkbooks`}
                              size="small"
                            >
                              <LibraryBooksIcon fontSize="small" sx={{ color: '#16a34a' }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('pages.bankAccounts.manageCardReaders', 'Manage Card Readers')}>
                            <IconButton
                              aria-label={t('pages.bankAccounts.manageCardReaders', 'Manage Card Readers')}
                              component={Link}
                              to={`/treasury/bank-accounts/${encodeURIComponent(it.id)}/card-readers`}
                              size="small"
                            >
                              <CreditCardIcon fontSize="small" sx={{ color: '#1d4ed8' }} />
                            </IconButton>
                          </Tooltip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  onPageChange={setPage}
                  onPageSizeChange={handlePageSizeChange}
                  className="mt-3"
                />
              </>
            )}
          </section>
        ) : (
          <section className="bg-white rounded shadow p-4">
            <h2 className="text-lg font-medium mb-2">{t('pages.banks.list', 'Banks List')}</h2>
            {banksLoading && <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>}
            {!banksLoading && filteredBanks.length === 0 && (
              <p className="text-gray-500">{t('common.noData', 'No data')}</p>
            )}
            {!banksLoading && filteredBanks.length > 0 && (
              <>
                <table className="w-full text-left border-collapse">
                  <thead className="bg-gray-100">
                    <tr className="border-b border-gray-200">
                      <TableSortHeader
                        label={t('fields.bankName', 'Bank Name')}
                        sortKey={'name' as any}
                        currentSortBy={banksSortBy as any}
                        currentSortDir={banksSortDir}
                        onSort={(k) => { setBanksSortBy(k as keyof BankItem); setBanksSortDir((d) => (banksSortBy === k ? (d === 'asc' ? 'desc' : 'asc') : 'asc')); setBanksPage(1); }}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.branchNumber', 'Branch Number')}
                        sortKey={'branch_number' as any}
                        currentSortBy={banksSortBy as any}
                        currentSortDir={banksSortDir}
                        onSort={(k) => { setBanksSortBy(k as keyof BankItem); setBanksSortDir((d) => (banksSortBy === k ? (d === 'asc' ? 'desc' : 'asc') : 'asc')); setBanksPage(1); }}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.branchName', 'Branch Name')}
                        sortKey={'branch_name' as any}
                        currentSortBy={banksSortBy as any}
                        currentSortDir={banksSortDir}
                        onSort={(k) => { setBanksSortBy(k as keyof BankItem); setBanksSortDir((d) => (banksSortBy === k ? (d === 'asc' ? 'desc' : 'asc') : 'asc')); setBanksPage(1); }}
                        headerAlign={'text-left'}
                      />
                      <TableSortHeader
                        label={t('fields.city', 'City')}
                        sortKey={'city' as any}
                        currentSortBy={banksSortBy as any}
                        currentSortDir={banksSortDir}
                        onSort={(k) => { setBanksSortBy(k as keyof BankItem); setBanksSortDir((d) => (banksSortBy === k ? (d === 'asc' ? 'desc' : 'asc') : 'asc')); setBanksPage(1); }}
                        headerAlign={'text-left'}
                      />
                      <th className="px-4 py-3 text-base font-medium text-gray-700 uppercase tracking-wider text-center">
                        {t('common.actions', 'Actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedBanks.map((it) => (
                      <tr key={it.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className={`${isRTL ? 'text-right' : 'text-left'} py-2 px-2`}>{it.name}</td>
                        <td className={`${isRTL ? 'text-right' : 'text-left'} py-2 px-2 font-mono`}>{String(it.branch_number ?? '')}</td>
                        <td className={`${isRTL ? 'text-right' : 'text-left'} py-2 px-2`}>{it.branch_name || '-'}</td>
                        <td className={`${isRTL ? 'text-right' : 'text-left'} py-2 px-2`}>{it.city || '-'}</td>
                        <td className="py-2 px-2 text-center">
                          <div className="inline-flex items-center gap-2 justify-center">
                            <IconButton onClick={() => openEditBank(String(it.id))} color="primary" size="small" aria-label={t('actions.edit','Edit')}>
                              <EditIcon className="text-[20px]" />
                            </IconButton>
                            <IconButton onClick={() => deleteBank(String(it.id))} color="error" size="small" aria-label={t('common.delete','Delete')}>
                              <DeleteIcon />
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Pagination
                  page={banksPage}
                  pageSize={banksPageSize}
                  total={banksTotal}
                  onPageChange={setBanksPage}
                  onPageSizeChange={(n) => { setBanksPageSize(n); setBanksPage(1); }}
                  className="mt-3"
                />
              </>
            )}
          </section>
        )}
      </main>

      {/* Confirm deletion dialog for bank accounts */}
      <ConfirmDialog
        open={!!confirmDeleteAccountId}
        title={t('actions.delete', 'Delete')}
        message={t('pages.bankAccounts.deleteConfirm', 'Delete this bank account?')}
        onConfirm={handleConfirmDeleteAccount}
        onCancel={() => setConfirmDeleteAccountId(null)}
        type="danger"
        dimBackground={false}
      />

      {/* Confirm deletion dialog for banks */}
      <ConfirmDialog
        open={!!confirmDeleteBankId}
        title={t('actions.delete', 'Delete')}
        message={t('pages.banks.deleteConfirm', 'Delete this bank?')}
        onConfirm={handleConfirmDeleteBank}
        onCancel={() => setConfirmDeleteBankId(null)}
        type="danger"
        dimBackground={false}
      />

      {/* Alert dialog for success/error feedback */}
      <AlertDialog
        open={alertOpen}
        title={alertTitle}
        message={alertMessage}
        onClose={closeAlert}
        dimBackground={false}
      />

    </div>
  );
};

export default BankAccountsPage;