/**
 * BanksPage
 * Displays a list of banks with search, sortable headers, pagination,
 * and per-row edit/delete actions. Mirrors CashboxesPage UX patterns.
 * Columns: Bank Name, Branch Number, Branch Name, City.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import { IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import TableSortHeader from '../components/common/TableSortHeader';
import Pagination from '../components/common/Pagination';
import { useNavigate, Link } from 'react-router-dom';
import { getCurrentLang } from '../i18n';

interface BankItem {
  id: string;
  name: string;
  branch_number?: number | string | null;
  branch_name?: string | null;
  city?: string | null;
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

const BanksPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRTL = (document?.documentElement?.dir || 'ltr') === 'rtl';
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);

  const [items, setItems] = useState<BankItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [sortBy, setSortBy] = useState<keyof BankItem | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  /**
   * handleSort
   * Toggles sort direction and sets current column.
   */
  function handleSort(key: keyof BankItem): void {
    setSortBy((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
    setPage(1);
  }

  /**
   * handlePageSizeChange
   * Applies new page size and resets to first page.
   */
  function handlePageSizeChange(newSize: number): void {
    setPageSize(newSize);
    setPage(1);
  }

  /**
   * fetchBanks
   * Loads list from backend with Accept-Language header.
   */
  async function fetchBanks(): Promise<void> {
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/banks`, { headers: { 'Accept-Language': lang } });
      const list = res.data.items || res.data.data || res.data || [];
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * deleteBank
   * Deletes a bank by id after confirmation and refreshes list.
   */
  async function deleteBank(id: string): Promise<void> {
    const confirmed = window.confirm(t('pages.banks.deleteConfirm', 'Delete this bank?'));
    if (!confirmed) return;
    setError('');
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/banks/${id}`, { headers: { 'Accept-Language': lang } });
      await fetchBanks();
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    }
  }

  /** Navigate to create form page */
  function openCreate(): void { navigate('/treasury/banks/new'); }
  /** Navigate to edit form page */
  function openEdit(id: string): void { navigate(`/treasury/banks/edit?id=${encodeURIComponent(id)}`); }

  useEffect(() => { fetchBanks(); }, [lang]);

  /**
   * filteredItems
   * Filters items by search query across name, branch number/name, city.
   */
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return items;
    const isNumericOnly = /^[\s\u0660-\u0669\u06F0-\u06F9\d]+$/.test(q);
    const normalized = isNumericOnly ? toAsciiDigits(q) : q;
    const qq = normalized.toLowerCase();
    return items.filter((it) =>
      String(it.name || '').toLowerCase().includes(qq) ||
      String(it.branch_name || '').toLowerCase().includes(qq) ||
      String(it.city || '').toLowerCase().includes(qq) ||
      String(it.branch_number ?? '').toLowerCase().includes(qq)
    );
  }, [items, searchQuery]);

  /**
   * sortedItems
   * Sorts filtered items based on current sort settings.
   */
  const sortedItems = useMemo(() => {
    if (!sortBy) return filteredItems;
    const arr = [...filteredItems];
    arr.sort((a, b) => {
      const av = a[sortBy] as any;
      const bv = b[sortBy] as any;
      let cmp = 0;
      if (sortBy === 'branch_number') {
        const numA = typeof av === 'number' ? Math.trunc(av) : (parseInt(toAsciiDigits(String(av)).replace(/[^\d]/g, ''), 10) || 0);
        const numB = typeof bv === 'number' ? Math.trunc(bv) : (parseInt(toAsciiDigits(String(bv)).replace(/[^\d]/g, ''), 10) || 0);
        cmp = numA - numB;
      } else if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av.localeCompare(bv);
      } else {
        cmp = String(av || '').localeCompare(String(bv || ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredItems, sortBy, sortDir]);

  /** Paginate */
  const total = sortedItems.length;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, page, pageSize]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-2">{t('pages.banks.title', 'Banks')}</h1>

        {/* Tabs: Banks | Bank Accounts */}
        <div className="mb-4 border-b border-gray-200">
          {/* Using simple links to route between Banks and Bank Accounts */}
          <div className="flex gap-2">
            <Link to="/treasury/banks" className="px-3 py-2 -mb-px border-b-2 border-green-700 text-green-700 font-medium">
              {t('pages.treasury.tabs.banks', 'Banks')}
            </Link>
            <Link to="/treasury/bank-accounts" className="px-3 py-2 -mb-px border-b-2 border-transparent hover:border-gray-300 text-gray-600">
              {t('pages.treasury.tabs.bankAccounts', 'Bank Accounts')}
            </Link>
          </div>
        </div>

        {/* Header controls: Create button (left) and search (right) */}
        <div className="relative mb-4 h-10">
          <button
            type="button"
            onClick={openCreate}
            className="absolute left-0 top-0 bg-green-700 text-white px-3 py-2 rounded-md hover:bg-green-800"
            aria-label={t('pages.banks.create', 'Create Bank')}
            title={t('pages.banks.create', 'Create Bank')}
          >
            {t('pages.banks.create', 'Create Bank')}
          </button>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('common.search', 'Search')}
            className="absolute right-0 top-0 border rounded px-3 py-2 w-64"
          />
        </div>

        {/* List table */}
        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.banks.list', 'Banks List')}</h2>
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
                      label={t('fields.bankName', 'Bank Name')}
                      sortKey={'name' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof BankItem)}
                      headerAlign='text-left'
                    />
                    <TableSortHeader
                      label={t('fields.branchNumber', 'Branch Number')}
                      sortKey={'branch_number' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof BankItem)}
                      headerAlign='text-left'
                    />
                    <TableSortHeader
                      label={t('fields.branchName', 'Branch Name')}
                      sortKey={'branch_name' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof BankItem)}
                      headerAlign='text-left'
                    />
                    <TableSortHeader
                      label={t('fields.city', 'City')}
                      sortKey={'city' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof BankItem)}
                      headerAlign='text-left'
                    />
                    <th className="px-4 py-3 text-base font-medium text-gray-700 uppercase tracking-wider text-center">
                      {t('common.actions', 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedItems.map((it) => (
                    <tr key={it.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className={`${isRTL ? 'text-right' : 'text-left'} py-2 px-2`}>{it.name}</td>
                      <td className={`${isRTL ? 'text-right' : 'text-left'} py-2 px-2 font-mono`}>{String(it.branch_number ?? '')}</td>
                      <td className={`${isRTL ? 'text-right' : 'text-left'} py-2 px-2`}>{it.branch_name || '-'}</td>
                      <td className={`${isRTL ? 'text-right' : 'text-left'} py-2 px-2`}>{it.city || '-'}</td>
                      <td className="py-2 px-2 text-center">
                        <div className="inline-flex items-center gap-2 justify-center">
                          <IconButton onClick={() => openEdit(String(it.id))} color="primary" size="small" aria-label={t('actions.edit','Edit')}>
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
      </main>
    </div>
  );
};

export default BanksPage;