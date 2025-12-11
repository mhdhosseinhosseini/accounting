/**
 * CashboxesPage
 * Displays the Cashboxes list with search, sortable headers, pagination,
 * and per-row edit/delete actions. Mirrors the Details page UX patterns.
 * - Create navigates to a dedicated form page (/treasury/cashboxes/new)
 * - Edit navigates to the same form page with id and yellow background
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
import { useNavigate } from 'react-router-dom';
import { getCurrentLang } from '../i18n';
import moment from 'moment-jalaali';

interface CashboxItem {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  handler_title?: string | null;
  /** Optional starting amount saved in backend (may be number or string) */
  starting_amount?: number | string | null;
  /** Optional starting date ISO string 'YYYY-MM-DD' */
  starting_date?: string | null;
}

/**
 * toAsciiDigits
 * Converts Farsi/Arabic-Indic numerals to ASCII for numeric sorting/search.
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
 * toFarsiDigits
 * Converts ASCII digits to Farsi digits for localized display.
 */
function toFarsiDigits(str: string): string {
  const map: Record<string, string> = { '0':'۰', '1':'۱', '2':'۲', '3':'۳', '4':'۴', '5':'۵', '6':'۶', '7':'۷', '8':'۸', '9':'۹' };
  return str.replace(/[0-9]/g, (d) => map[d]);
}

/**
 * formatAmountLocalized
 * Formats amount with thousands separators and locale digits.
 * Accepts number/string; returns '-' when empty.
 */
function formatAmountLocalized(val: number | string | null | undefined, langCode?: string): string {
  if (val === null || val === undefined) return '-';
  let n: number;
  if (typeof val === 'number') {
    n = Math.trunc(val);
  } else {
    const ascii = toAsciiDigits(String(val));
    const digitsOnly = ascii.replace(/[^\d]/g, '');
    n = digitsOnly ? parseInt(digitsOnly, 10) : 0;
  }
  const locale = (langCode || (typeof navigator !== 'undefined' ? navigator.language : 'en'))?.startsWith('fa') ? 'fa-IR' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
  } catch {
    const withCommas = n.toLocaleString('en-US');
    return locale === 'fa-IR' ? toFarsiDigits(withCommas) : withCommas;
  }
}

/**
 * formatDateLocalized
 * Displays date in Jalali for Farsi; ISO (YYYY-MM-DD) for English.
 */
function formatDateLocalized(iso: string | null | undefined, langCode?: string): string {
  if (!iso) return '-';
  const l = (langCode || (typeof navigator !== 'undefined' ? navigator.language : 'en'));
  if (l.startsWith('fa')) {
    const m = moment(iso, 'YYYY-MM-DD', true);
    if (!m.isValid()) return '-';
    const j = m.format('jYYYY/jMM/jDD');
    return toFarsiDigits(j);
  }
  const m = moment(iso, 'YYYY-MM-DD', true);
  return m.isValid() ? m.format('YYYY-MM-DD') : '-';
}

const CashboxesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRTL = (document?.documentElement?.dir || 'ltr') === 'rtl';
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);

  const [items, setItems] = useState<CashboxItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [sortBy, setSortBy] = useState<keyof CashboxItem | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  /**
   * handleSort
   * Toggles sort direction and sets column.
   */
  function handleSort(key: keyof CashboxItem): void {
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

  function handlePageSizeChange(newSize: number): void {
    setPageSize(newSize);
    setPage(1);
  }

  /**
   * fetchCashboxes
   * Loads list from backend with Accept-Language header.
   */
  async function fetchCashboxes(): Promise<void> {
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/treasury/cashboxes`, { headers: { 'Accept-Language': lang } });
      const list = res.data.items || res.data.data || res.data || [];
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * deleteCashbox
   * Deletes a cashbox by id after confirmation.
   */
  async function deleteCashbox(id: string): Promise<void> {
    const confirmed = window.confirm(t('pages.cashboxes.deleteConfirm', 'Delete this cashbox?'));
    if (!confirmed) return;
    setError('');
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/treasury/cashboxes/${id}`, { headers: { 'Accept-Language': lang } });
      await fetchCashboxes();
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    }
  }

  /** Navigate to create form page */
  function openCreate(): void { navigate('/treasury/cashboxes/new'); }
  /** Navigate to edit form page */
  function openEdit(id: string): void { navigate(`/treasury/cashboxes/edit?id=${encodeURIComponent(id)}`); }

  useEffect(() => { fetchCashboxes(); }, [lang]);

  /**
   * filteredItems
   * Filters items by search query across code, name, and handler title.
   */
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return items;
    const isNumericOnly = /^[\s\u0660-\u0669\u06F0-\u06F9\d]+$/.test(q);
    const normalized = isNumericOnly ? toAsciiDigits(q) : q;
    const qq = normalized.toLowerCase();
    return items.filter((it) =>
      String(it.code).toLowerCase().includes(qq) ||
      String(it.name).toLowerCase().includes(qq) ||
      String(it.handler_title || '').toLowerCase().includes(qq)
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
      if (sortBy === 'code') {
        cmp = Number(toAsciiDigits(String(av))) - Number(toAsciiDigits(String(bv)));
      } else if (sortBy === 'starting_amount') {
        const numA = typeof av === 'number' ? Math.trunc(av) : (parseInt(toAsciiDigits(String(av)).replace(/[^\d]/g, ''), 10) || 0);
        const numB = typeof bv === 'number' ? Math.trunc(bv) : (parseInt(toAsciiDigits(String(bv)).replace(/[^\d]/g, ''), 10) || 0);
        cmp = numA - numB;
      } else if (sortBy === 'starting_date') {
        const aIso = String(av || '');
        const bIso = String(bv || '');
        cmp = aIso.localeCompare(bIso);
      } else if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av.localeCompare(bv);
      } else {
        cmp = (av === bv) ? 0 : (av ? 1 : -1);
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
        <h1 className="text-xl font-semibold mb-4">{t('pages.cashboxes.title', 'Cashboxes')}</h1>

        {/* Header controls: Create button (left) and search (right) */}
        <div className="relative mb-4 h-10">
          <button
            type="button"
            onClick={openCreate}
            className="absolute left-0 top-0 bg-green-700 text-white px-3 py-2 rounded-md hover:bg-green-800"
            aria-label={t('pages.cashboxes.create', 'Create Cashbox')}
            title={t('pages.cashboxes.create', 'Create Cashbox')}
          >
            {t('pages.cashboxes.create', 'Create Cashbox')}
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
          <h2 className="text-lg font-medium mb-2">{t('pages.cashboxes.list', 'Cashboxes List')}</h2>
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
                      label={t('fields.detailCode', 'Detail Code')}
                      sortKey={'code' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof CashboxItem)}
                      headerAlign='text-left'
                    />
                    <TableSortHeader
                      label={t('fields.title', 'Title')}
                      sortKey={'name' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof CashboxItem)}
                      headerAlign='text-left'
                    />
                    <TableSortHeader
                      label={t('fields.isActive', 'Active')}
                      sortKey={'is_active' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof CashboxItem)}
                      headerAlign='text-left'
                    />
                    <TableSortHeader
                      label={t('fields.handledBy', 'Handled By')}
                      sortKey={'handler_title' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof CashboxItem)}
                      headerAlign='text-left'
                    />
                    <TableSortHeader
                      label={t('fields.startingAmount', 'Starting Amount')}
                      sortKey={'starting_amount' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof CashboxItem)}
                      headerAlign='text-left'
                    />
                    <TableSortHeader
                      label={t('fields.startingDate', 'Starting Date')}
                      sortKey={'starting_date' as any}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof CashboxItem)}
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
                      <td className={`py-2 px-2 font-mono ${isRTL ? 'text-right' : 'text-left'}`}>{it.code}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.name}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.is_active ? t('common.yes', 'Yes') : t('common.no', 'No')}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.handler_title || '-'}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatAmountLocalized(it.starting_amount, lang)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatDateLocalized(it.starting_date, lang)}</td>
                      <td className="py-2 px-2 text-center">
                        <div className="inline-flex items-center gap-2 justify-center">
                          <IconButton onClick={() => openEdit(it.id)} color="primary" size="small" aria-label={t('actions.edit','Edit')}>
                            <EditIcon className="text-[20px]" />
                          </IconButton>
                          <IconButton onClick={() => deleteCashbox(it.id)} color="error" size="small" aria-label={t('common.delete','Delete')}>
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

export default CashboxesPage;