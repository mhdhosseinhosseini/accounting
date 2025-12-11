/**
 * DetailsPage
 * - Displays list of global 4-digit Detail codes with search.
 * - Provides Add/Edit form at top and per-row edit/delete actions.
 * - Integrates with backend under `/api/v1/details`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import { IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import NumericInput from '../components/common/NumericInput';
import TableSortHeader from '../components/common/TableSortHeader';
import Pagination from '../components/common/Pagination';
import MultiSelect from '../components/common/MultiSelect';

interface DetailItem {
  id: string;
  code: string;
  title: string;
  is_active: boolean;
  kind: boolean;
}

interface FormState {
  code: string;
  title: string;
  is_active: boolean;
}

/**
 * Minimal detail-level item used for linking in DetailsPage.
 */
interface DetailLevelLeafItem {
  id: string;
  code: string;
  title: string;
  children?: DetailLevelLeafItem[];
}

/**
 * Convert Farsi/Arabic-Indic digits to ASCII equivalents.
 * Preserves non-digit characters unchanged.
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

const DetailsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  // Determine RTL/LTR at render time based on document direction
  const isRTL = (document?.documentElement?.dir || 'ltr') === 'rtl';
  const lang = useMemo(() => i18n.language || 'fa', [i18n.language]);

  const [items, setItems] = useState<DetailItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState<string>('');

  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ code: '', title: '', is_active: true });
  const [saving, setSaving] = useState<boolean>(false);

  // Linked detail-levels state
  const [leafLevels, setLeafLevels] = useState<DetailLevelLeafItem[]>([]);
  const [levelsLoading, setLevelsLoading] = useState<boolean>(false);
  const [selectedLevelIds, setSelectedLevelIds] = useState<string[]>([]);
  /**
   * Builds multi-select options sorted by numeric code ascending (supports Farsi digits).
   */
  const levelOptions = useMemo(() => {
    const normalize = (s: string) => toAsciiDigits(String(s));
    const isNum = (s: string) => /^\d+$/.test(s);
    const sorted = [...leafLevels].sort((a, b) => {
      const as = normalize(a.code);
      const bs = normalize(b.code);
      if (isNum(as) && isNum(bs)) return Number(as) - Number(bs);
      return as.localeCompare(bs, undefined, { numeric: true });
    });
    return sorted.map((lv) => ({ value: lv.id, label: `${lv.code} — ${lv.title}` }));
  }, [leafLevels]);

  // Sorting & pagination state
  const [sortBy, setSortBy] = useState<keyof DetailItem | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  /**
   * Handle sort toggle for a given column key.
   * - If clicking a new column, set ascending by default.
   * - If clicking the same column, toggle direction.
   */
  function handleSort(key: keyof DetailItem): void {
    setSortBy((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
    // Reset to first page when sorting changes
    setPage(1);
  }

  /**
   * Update page size and reset to first page.
   */
  function handlePageSizeChange(newSize: number): void {
    setPageSize(newSize);
    setPage(1);
  }

  /**
   * Fetch Details list from backend.
   */
  async function fetchDetails(): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/details`, { headers: { 'Accept-Language': lang } });
      const list = res.data.items || res.data.data || res.data || [];
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Fetch suggested next 4-digit code and prefill the form when creating.
   */
  async function fetchSuggestedCode(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/details/suggest-next`, { headers: { 'Accept-Language': lang } });
      const next = res.data.code || '';
      if (next) setForm((prev) => ({ ...prev, code: next }));
    } catch {
      // noop
    }
  }

  /**
   * Flatten a detail-level tree into an array.
   * Adds each node once; used to identify leaf nodes.
   */
  function flattenTree(nodes: DetailLevelLeafItem[]): DetailLevelLeafItem[] {
    const out: DetailLevelLeafItem[] = [];
    const stack = [...nodes];
    while (stack.length > 0) {
      const n = stack.pop()!;
      out.push(n);
      if (n.children && n.children.length) {
        for (let i = n.children.length - 1; i >= 0; i--) {
          stack.push(n.children[i]);
        }
      }
    }
    return out;
  }

  /**
   * Fetch leaf detail-levels from backend tree endpoint.
   * Only leaf nodes are allowed to be linked.
   */
  async function fetchLeafLevels(): Promise<void> {
    setLevelsLoading(true);
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/detail-levels/tree`, { headers: { 'Accept-Language': lang } });
      const raw = res.data?.items ?? res.data ?? [];
      const roots: DetailLevelLeafItem[] = Array.isArray(raw) ? raw : [];
      const flat = flattenTree(roots);
      const leaves = flat.filter((n) => !n.children || n.children.length === 0);
      setLeafLevels(leaves);
    } catch (e) {
      // silently ignore; UI will show empty list
      setLeafLevels([]);
    } finally {
      setLevelsLoading(false);
    }
  }

  /**
   * Fetch linked detail-levels for a given detail to preselect in form.
   * @param id - detail ID
   */
  async function fetchLinkedLevelsForDetail(id: string): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/details/${id}/detail-levels`, { headers: { 'Accept-Language': lang } });
      const arr = Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
      const ids: string[] = arr.map((x: any) => String(x.id));
      setSelectedLevelIds(ids);
    } catch {
      setSelectedLevelIds([]);
    }
  }

  useEffect(() => {
    fetchDetails();
    fetchLeafLevels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  /**
   * Open the form for creating a new detail.
   * Prefills code using suggested next value.
   */
  function openCreate(): void {
    setEditingId(null);
    setForm({ code: '', title: '', is_active: true });
    setSelectedLevelIds([]);
    setFormOpen(true);
    fetchSuggestedCode();
  }

  /**
   * Open the form for editing an existing detail.
   * @param item - The detail item to edit
   */
  function openEdit(item: DetailItem): void {
    setEditingId(item.id);
    setForm({ code: item.code, title: item.title, is_active: !!item.is_active });
    setFormOpen(true);
    fetchLinkedLevelsForDetail(item.id);
  }

  /**
   * Close the form and clear edit state.
   */
  function closeForm(): void {
    setFormOpen(false);
    setEditingId(null);
    setForm({ code: '', title: '', is_active: true });
    setSelectedLevelIds([]);
  }

  /**
   * Handle changes from the chip-based MultiSelect for leaf detail levels.
   * Accepts new array of ids and updates local selection state.
   */
  function handleLevelsMultiChange(ids: string[]): void {
    setSelectedLevelIds(ids);
  }

  /**
   * Create a new detail via backend POST.
   */
  async function createDetail(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, detail_level_ids: selectedLevelIds } as any;
      await axios.post(`${config.API_ENDPOINTS.base}/v1/details`, payload, { headers: { 'Accept-Language': lang } });
      await fetchDetails();
      closeForm();
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Update an existing detail via backend PATCH.
   */
  async function updateDetail(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, detail_level_ids: selectedLevelIds } as any;
      await axios.patch(`${config.API_ENDPOINTS.base}/v1/details/${editingId}`, payload, { headers: { 'Accept-Language': lang } });
      await fetchDetails();
      closeForm();
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Delete a detail by id.
   * Shows a simple confirm dialog.
   */
  async function deleteDetail(id: string): Promise<void> {
    const confirmed = window.confirm(t('pages.details.deleteConfirm', 'Delete this detail?'));
    if (!confirmed) return;
    setError('');
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/details/${id}`, { headers: { 'Accept-Language': lang } });
      await fetchDetails();
    } catch (e: any) {
      setError(e?.response?.data?.error || t('common.error', 'Error'));
    }
  }

  /**
   * Filter items by search query across code and title.
   * Normalizes numeric-only queries by converting Farsi digits to ASCII.
   */
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return items;
    const isNumericOnly = /^[\s\u0660-\u0669\u06F0-\u06F9\d]+$/.test(q);
    const normalized = isNumericOnly ? toAsciiDigits(q) : q;
    const qq = normalized.toLowerCase();
    return items.filter((it) => String(it.code).toLowerCase().includes(qq) || String(it.title).toLowerCase().includes(qq));
  }, [items, searchQuery]);

  /**
   * Sort filtered items based on current sort settings.
   */
  const sortedItems = useMemo(() => {
    if (!sortBy) return filteredItems;
    const arr = [...filteredItems];
    arr.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      let cmp = 0;
      if (sortBy === 'code') {
        const as = toAsciiDigits(String(av));
        const bs = toAsciiDigits(String(bv));
        const isNum = (s: string) => /^\d+$/.test(s);
        if (isNum(as) && isNum(bs)) cmp = Number(as) - Number(bs);
        else cmp = as.localeCompare(bs, undefined, { numeric: true });
      } else if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av.localeCompare(bv);
      } else {
        cmp = (av === bv) ? 0 : (av ? 1 : -1);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredItems, sortBy, sortDir]);

  /**
   * Paginate the sorted items.
   */
  const total = sortedItems.length;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, page, pageSize]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="gb-page w-full py-6">
        <h1 className="text-xl font-semibold mb-4">{t('pages.details.title', 'Details')}</h1>

        {/* Header controls: add/edit button (top-left) and search (top-right) */}
        <div className="relative mb-4 h-10">
          <button
            type="button"
            onClick={openCreate}
            className="absolute left-0 top-0 bg-green-700 text-white px-3 py-2 rounded-md hover:bg-green-800"
            aria-label={t('pages.details.addEdit', 'Add/Edit')}
            title={t('pages.details.addEdit', 'Add/Edit')}
          >
            {t('pages.details.addEdit', 'Add/Edit')}
          </button>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('common.search', 'Search')}
            className="absolute right-0 top-0 border rounded px-3 py-2 w-64"
          />
        </div>

        {/* Add/Edit form */}
        {formOpen && (
          <section className={`${editingId ? 'bg-yellow-50 border border-yellow-200' : 'bg-white'} rounded shadow p-4 mb-4`}>
            <h2 className="text-lg font-medium mb-2">
              {editingId ? t('pages.details.edit', 'Edit Detail') : t('pages.details.create', 'Create Detail')}
            </h2>
            <form onSubmit={editingId ? updateDetail : createDetail} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm mb-1">{t('fields.code', 'Code')}</label>
                <NumericInput
                  value={form.code}
                  onChange={(v) => {
                    const ascii = toAsciiDigits(String(v || ''));
                    const clean = ascii.replace(/[^0-9]/g, '').slice(0, 4);
                    setForm((prev) => ({ ...prev, code: clean }));
                  }}
                  maxLength={4}
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm mb-1">{t('fields.title', 'Title')}</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="border rounded px-3 py-2 w-full"
                />
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

              {/* Linked leaf detail-levels multi-select */}
              <div className="md:col-span-3">
                {levelsLoading ? (
                  <p className="text-gray-500 text-sm">{t('common.loading', 'Loading...')}</p>
                ) : (
                  <MultiSelect
                    label={t('pages.details.linkedLevels', 'Linked Detail Levels')}
                    value={selectedLevelIds}
                    onChange={handleLevelsMultiChange}
                    options={levelOptions}
                    minWidth={300}
                  />
                )}
                <p className="text-xs text-gray-500 mt-1">{t('pages.details.leafOnlyHint', 'Only leaf levels can be linked.')}</p>
              </div>

              <div className="md:col-span-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving || !form.code || form.code.length !== 4 || !form.title}
                  className="bg-green-700 text-white px-3 py-2 rounded-md hover:bg-green-800 disabled:opacity-50"
                >
                  {editingId ? t('actions.save', 'Save') : t('actions.create', 'Create')}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="bg-gray-300 text-gray-800 px-3 py-2 rounded-md hover:bg-gray-400"
                >
                  {t('actions.cancel', 'Cancel')}
                </button>
                {error && <span className="text-red-600 text-sm">{error}</span>}
              </div>
            </form>
          </section>
        )}

        {/* List table */}
        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.details.list', 'Details List')}</h2>
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
                       label={t('fields.code', 'Code')}
                       sortKey={'code'}
                       currentSortBy={sortBy as any}
                       currentSortDir={sortDir}
                       onSort={(k) => handleSort(k as keyof DetailItem)}
                       headerAlign='text-left'
                     />
                     <TableSortHeader
                       label={t('fields.title', 'Title')}
                       sortKey={'title'}
                       currentSortBy={sortBy as any}
                       currentSortDir={sortDir}
                       onSort={(k) => handleSort(k as keyof DetailItem)}
                       headerAlign='text-left'
                     />
                     <TableSortHeader
                       label={t('fields.isActive', 'Active')}
                       sortKey={'is_active'}
                       currentSortBy={sortBy as any}
                       currentSortDir={sortDir}
                       onSort={(k) => handleSort(k as keyof DetailItem)}
                       headerAlign='text-left'
                     />
                    <TableSortHeader
                      label={t('pages.details.kind', 'Kind')}
                      sortKey={'kind'}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof DetailItem)}
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
                       <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.title}</td>
                       <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{it.is_active ? t('common.yes', 'Yes') : t('common.no', 'No')}</td>
                      <td className={`${isRTL ? 'text-right' : 'text-left'} py-2 px-2`}>
                        {it.kind ? t('pages.details.kind.user', 'User-defined') : t('pages.details.kind.system', 'System-managed')}
                      </td>
                       <td className="py-2 px-2 text-center">
                         <div className="inline-flex items-center gap-2 justify-center">
                          <IconButton
                            onClick={() => openEdit(it)}
                            color="primary"
                            size="small"
                            aria-label={t('actions.edit','Edit')}
                            disabled={!it.kind}
                            title={!it.kind ? t('pages.details.systemManagedTooltip.edit', 'System-managed details cannot be edited') : t('actions.edit','Edit')}
                          >
                             <EditIcon className="text-[20px]" />
                           </IconButton>
                          <IconButton
                            onClick={() => deleteDetail(it.id)}
                            color="error"
                            size="small"
                            aria-label={t('common.delete','Delete')}
                            disabled={!it.kind}
                            title={!it.kind ? t('pages.details.systemManagedTooltip.delete', 'System-managed details cannot be deleted') : t('common.delete','Delete')}
                          >
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

export default DetailsPage;