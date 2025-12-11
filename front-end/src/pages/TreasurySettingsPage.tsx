/**
 * TreasurySettingsPage
 * Displays and manages application settings in an inline editable table.
 * - Lists settings with columns: Code, Name, Value
 * - Supports search, sorting, pagination
 * - Inline add/edit/delete with JSON-capable value input
 * - Value parsing heuristics: JSON, number, boolean/null, or string
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import TableSortHeader from '../components/common/TableSortHeader';
import Pagination from '../components/common/Pagination';
import { getCurrentLang } from '../i18n';
import AlertDialog from '../components/common/AlertDialog';
import ConfirmDialog from '../components/common/ConfirmDialog';
import NumericInput from '../components/common/NumericInput';
import SearchableSelect, { SelectableOption } from '../components/common/SearchableSelect';
import { IconButton, Tooltip } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';

interface SettingItem {
  id: string;
  code: string;
  name: string;
  value: any;
  created_at?: string;
  updated_at?: string;
  // Store special code id for backend processing only; never shown in UI
  special_id?: string | null;
  // Persisted input type for this setting
  type?: 'special' | 'digits' | 'string';
}

interface CodeItem {
  id: string;
  code: string;
  title: string;
  kind?: string | null;
  parent_id?: string | null;
  is_active?: boolean;
  nature?: string | null;
}

/**
 * CodeOption
 * Mapped option type for SearchableSelect; includes id, code, and name label.
 */
interface CodeOption extends SelectableOption {
  code: string;
  title?: string | null;
}

/**
 * stringifyValue
 * Converts any JSON value to a compact string for display and editing.
 */
function stringifyValue(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

/**
 * parseValueInput
 * Parses a string input into a JSON-compatible value.
 * - Tries JSON.parse for objects/arrays/booleans/null/numbers
 * - If numeric-like, returns number
 * - Else returns the original string
 */
function parseValueInput(input: string): any {
  const s = (input || '').trim();
  if (!s) return '';
  try {
    // JSON.parse handles numbers, booleans, null, arrays/objects
    return JSON.parse(s);
  } catch {
    // If numeric-like, convert to number
    const ascii = s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => {
      const code = d.charCodeAt(0);
      const zero = code >= 0x0660 && code <= 0x0669 ? 0x0660 : 0x06f0;
      return String.fromCharCode(48 + (code - zero));
    });
    if (/^-?\d+(?:\.\d+)?$/.test(ascii)) {
      return Number(ascii);
    }
    return s; // fallback to plain string
  }
}

const TreasurySettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const lang = useMemo(() => i18n.language || getCurrentLang(), [i18n.language]);

  const [items, setItems] = useState<SettingItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [alertOpen, setAlertOpen] = useState<boolean>(false);
  const [alertMessage, setAlertMessage] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmTitle, setConfirmTitle] = useState<string>('');
  const [confirmMessage, setConfirmMessage] = useState<string>('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<keyof SettingItem | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string>('');
  const [editName, setEditName] = useState<string>('');
  const [editValue, setEditValue] = useState<string>('');
  // Track selected special code id for the row being edited
  const [editSpecialId, setEditSpecialId] = useState<string>('');

  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [newCode, setNewCode] = useState<string>('');
  const [newName, setNewName] = useState<string>('');
  const [newValue, setNewValue] = useState<string>('');
  // Track selected special code id for the new row
  const [newSpecialId, setNewSpecialId] = useState<string>('');
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [codesLoading, setCodesLoading] = useState<boolean>(false);

  /**
   * editSaveButtonRef / newSaveButtonRef
   * Button refs used to move focus after special-code selection is committed.
   */
  const editSaveButtonRef = useRef<HTMLButtonElement>(null);
  const newSaveButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * focusEditSave
   * Moves focus to the current row Save button after selection commit.
   */
  function focusEditSave(): void {
    editSaveButtonRef.current?.focus();
  }

  /**
   * focusNewSave
   * Moves focus to the new-row Save button after selection commit.
   */
  function focusNewSave(): void {
    newSaveButtonRef.current?.focus();
  }

  /**
   * codeOptions
   * Maps raw Codes into SearchableSelect options showing "code - title".
   * Ensures compatibility with SelectableOption by providing a `name` label.
   */
  const codeOptions = useMemo((): CodeOption[] => {
    return (codes || []).map((c) => ({
      id: c.id,
      code: String(c.code || ''),
      name: `${c.code} - ${c.title}`,
      title: c.title,
    }));
  }, [codes]);

  const [editType, setEditType] = useState<'special'|'digits'|'string' | null>(null);
  const [newType, setNewType] = useState<'special'|'digits'|'string'>('string');

 
 /**
   * getFieldType
   * Determines input behavior for a setting by its code.
   * Heuristics:
   * - If code contains both 'special' and 'code' → 'special'
   * - If code contains numeric hints (percent/amount/number/digits/count/limit/max/min/threshold) → 'digits'
   * - Otherwise → 'string'
   */
  function getFieldType(code: string): 'special' | 'digits' | 'string' {
    const c = (code || '').toLowerCase();
    if (c.includes('special') && c.includes('code')) return 'special';
    if (/\b(percent|amount|number|digits|count|limit|max|min|threshold)\b/.test(c)) return 'digits';
    return 'string';
  }

  /**
   * normalizeValueByType
   * Converts a string UI value into the correct format for saving
   * based on the selected field type.
   * - special → returns the trimmed display label (UI only; not sent to backend)
   * - digits  → returns the digits-only string
   * - string  → returns the raw trimmed string
   */
  function normalizeValueByType(input: string, type: 'special' | 'digits' | 'string'): any {
    if (type === 'special') return (input || '').trim();
    if (type === 'digits') return (input || '').replace(/[^0-9]/g, '');
    return (input || '').trim();
  }

  /**
   * fetchCodes
   * Loads flat list of codes for special-code dropdowns.
   */
  async function fetchCodes(): Promise<void> {
    setCodesLoading(true);
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/codes`, { headers: { 'Accept-Language': lang } });
      const list = res.data.items || res.data.data || res.data || [];
      setCodes(Array.isArray(list) ? list : []);
    } catch (e) {
      // silent fail; UI will fallback to plain input
    } finally {
      setCodesLoading(false);
    }
  }

  /**
   * getCodeLabelById
   * Finds a human-friendly label for a code id: "code - title".
   */
  function getCodeLabelById(id: string | number | null | undefined): string {
    if (!id) return '';
    const s = String(id);
    const x = codes.find((c) => String(c.id) === s);
    return x ? `${x.code} - ${x.title}` : '';
  }

  /**
   * handleSort
   * Toggles sort direction and sets column.
   */
  function handleSort(key: keyof SettingItem): void {
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
   * fetchSettings
   * Loads list from backend with Accept-Language header.
   */
  async function fetchSettings(): Promise<void> {
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/settings`, { headers: { 'Accept-Language': lang } });
      const list = res.data.items || res.data.data || res.data || [];
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || t('common.error', 'Error');
      setError(msg);
      setAlertMessage(msg);
      setAlertOpen(true);
    } finally {
      setLoading(false);
    }
  }

  /**
   * beginEdit
   * Initializes edit state for a settings row.
   * For 'special' type, uses 'special_id' to derive the display label,
   * falling back to any stored string value when mapping is unavailable.
   */
  function beginEdit(it: SettingItem): void {
    setEditingId(it.id);
    setEditCode(it.code);
    setEditName(it.name);
    const ft = it.type ?? getFieldType(it.code);
    setEditType(ft);
    if (ft === 'special') {
      const sid = String((it.special_id ?? '')) || (typeof it.value !== 'object' ? String(it.value ?? '') : '');
      setEditSpecialId(sid || '');
      // Prefer mapping by special_id; fallback to stored display label
      const display = getCodeLabelById(sid) || (typeof it.value === 'string' ? it.value : '');
      setEditValue(display || '');
    } else {
      setEditSpecialId('');
      setEditValue(stringifyValue(it.value));
    }
  }

  /**
   * cancelEdit
   * Cancels inline editing and clears form state.
   */
  function cancelEdit(): void {
    setEditingId(null);
    setEditCode('');
    setEditName('');
    setEditValue('');
    setEditType(null);
    setEditSpecialId('');
  }

  /**
   * saveEdit
   * Persists the current edit state to the backend.
   * If type is 'special', only 'special_id' is sent (no 'value').
   */
  async function saveEdit(id: string): Promise<void> {
     if (!editCode.trim() || !editName.trim()) {
       setAlertMessage(t('common.errors.required', 'This field is required'));
       setAlertOpen(true);
       return;
     }
     const exists = items.some((it) => it.code.trim().toLowerCase() === editCode.trim().toLowerCase() && it.id !== id);
     if (exists) {
       setAlertMessage(t('pages.settings.errors.codeExists', 'Setting code already exists'));
       setAlertOpen(true);
       return;
     }
     setError('');
     try {
       const selectedType = (editType || getFieldType(editCode));
       const payload: Partial<SettingItem> = {
         code: editCode.trim(),
         name: editName.trim(),
         type: selectedType
       };
       if (selectedType === 'special') {
         payload.special_id = editSpecialId || undefined;
       } else {
         payload.value = normalizeValueByType(editValue, selectedType);
       }
       await axios.patch(`${config.API_ENDPOINTS.base}/v1/settings/${id}`, payload, { headers: { 'Accept-Language': lang } });
       await fetchSettings();
       cancelEdit();
     } catch (e: any) {
       const backendMsg = e?.response?.data?.error || e?.response?.data?.message;
       const msg = backendMsg || t('common.error', 'Error');
       setError(msg);
       setAlertMessage(msg);
       setAlertOpen(true);
     }
  }

  /**
   * deleteSetting
   * Deletes a setting after confirmation.
   */
  async function deleteSetting(id: string): Promise<void> {
     setError('');
     try {
       await axios.delete(`${config.API_ENDPOINTS.base}/v1/settings/${id}`, { headers: { 'Accept-Language': lang } });
       await fetchSettings();
     } catch (e: any) {
       setError(e?.response?.data?.error || t('common.error', 'Error'));
     }
   }
  /**
   * requestDelete
   * Opens confirmation dialog before deleting.
   */
  function requestDelete(id: string): void {
    setPendingDeleteId(id);
    setConfirmTitle(t('common.delete', 'Delete'));
    setConfirmMessage(t('actions.confirmDelete', 'Are you sure you want to delete?'));
    setConfirmOpen(true);
  }

  /**
   * handleConfirmDelete
   * Confirms deletion and performs the delete action.
   */
  function handleConfirmDelete(): void {
    const id = pendingDeleteId;
    setConfirmOpen(false);
    setPendingDeleteId(null);
    if (id) {
      deleteSetting(id);
    }
  }

  /** Cancel confirmation dialog */
  function cancelConfirm(): void {
    setConfirmOpen(false);
    setPendingDeleteId(null);
  }

  /**
   * saveNew
   * Creates a new settings row in the backend.
   * If type is 'special', only 'special_id' is sent (no 'value').
   */
  async function saveNew(): Promise<void> {
    if (!newCode.trim() || !newName.trim()) {
      setAlertMessage(t('common.errors.required', 'This field is required'));
      setAlertOpen(true);
      return;
    }
    const exists = items.some((it) => it.code.trim().toLowerCase() === newCode.trim().toLowerCase());
    if (exists) {
      setAlertMessage(t('pages.settings.errors.codeExists', 'Setting code already exists'));
      setAlertOpen(true);
      return;
    }

    setError('');
    try {
      const payload: Partial<SettingItem> = {
        code: newCode.trim(),
        name: newName.trim(),
        type: newType
      };
      if (newType === 'special') {
        payload.special_id = newSpecialId || undefined;
      } else {
        payload.value = normalizeValueByType(newValue, newType);
      }
      await axios.post(`${config.API_ENDPOINTS.base}/v1/settings`, payload, { headers: { 'Accept-Language': lang } });
      await fetchSettings();
      setNewCode(''); setNewName(''); setNewValue('');
      setNewSpecialId('');
      setNewType('string');
    } catch (e: any) {
      const msg = e?.response?.data?.error || t('common.error', 'Error');
      setError(msg);
      setAlertMessage(msg);
      setAlertOpen(true);
    }
  }

  /**
   * cancelNew
   * Cancels adding a new setting and clears form state.
   */
  function cancelNew(): void {
    setIsAdding(false);
    setNewCode(''); setNewName(''); setNewValue('');
    setNewSpecialId('');
  }

  useEffect(() => { fetchSettings(); fetchCodes(); }, [lang]);

  /**
   * filteredItems
   * Filters items by search query across code and name.
   */
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      String(it.code).toLowerCase().includes(q) ||
      String(it.name).toLowerCase().includes(q)
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
        const na = parseInt(String(av).replace(/[^\d]/g, ''), 10) || 0;
        const nb = parseInt(String(bv).replace(/[^\d]/g, ''), 10) || 0;
        cmp = na - nb;
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
        <h1 className="text-xl font-semibold mb-4">{t('navigation.treasurySettings', 'Settings')}</h1>


        {/* Header controls: just search on the right */}
        <div className="relative mb-4 h-10">
          <input
             value={searchQuery}
             onChange={(e) => setSearchQuery(e.target.value)}
             className="absolute right-0 top-0 w-64 px-3 py-2 border rounded-md"
             placeholder={t('common.search', 'Search')}
             aria-label={t('common.search', 'Search')}
           />
         </div>


        {/* Alert dialog for validation errors */}
        <AlertDialog
          open={alertOpen}
          title={t('common.warning', 'Warning')}
          message={alertMessage || error || ''}
          onClose={() => setAlertOpen(false)}
          dimBackground={false}
        />


        {/* Confirmation dialog for delete */}
        <ConfirmDialog
          open={confirmOpen}
          title={confirmTitle}
          message={confirmMessage}
          onConfirm={handleConfirmDelete}
          onCancel={cancelConfirm}
          type="danger"
          dimBackground={false}
        />


        <div className="overflow-x-auto bg-white rounded-md">
           <table className="min-w-full">
             <thead>
               <tr className="bg-gray-100">
                 <th className="px-3 py-2 text-right">
                   <TableSortHeader
                     label={t('fields.code', 'Code')}
                     sortKey={'code'}
                     currentSortBy={(sortBy as any) || null}
                     currentSortDir={sortDir}
                     onSort={(key: any) => handleSort(key as keyof SettingItem)}
                   />
                 </th>
                 <th className="px-3 py-2 text-right">
                   <TableSortHeader
                     label={t('fields.name', 'Name')}
                     sortKey={'name'}
                     currentSortBy={(sortBy as any) || null}
                     currentSortDir={sortDir}
                     onSort={(key: any) => handleSort(key as keyof SettingItem)}
                   />
                 </th>
                <th className="px-3 py-2 text-right">{t('fields.type', 'Type')}</th>
                 <th className="px-3 py-2 text-right">{t('fields.value', 'Value')}</th>
                 <th className="px-3 py-2 text-right">{t('common.actions', 'Actions')}</th>
               </tr>
               </thead>
             <tbody>
               {loading ? (
                 <tr><td className="px-3 py-2" colSpan={5}>{t('common.loading', 'Loading...')}</td></tr>
               ) : pagedItems.length === 0 ? (
                 <tr><td className="px-3 py-2" colSpan={5}>{t('common.noData', 'No data')}</td></tr>
               ) : (
                 pagedItems.map((it) => (

                   <tr key={it.id}>
                     <td className="px-3 py-2 align-top">
                       {editingId === it.id ? (
                         <input value={editCode} onChange={(e) => setEditCode(e.target.value)} className="w-full px-2 py-1 border rounded" />
                       ) : (
                         <span>{it.code}</span>
                       )}
                     </td>
                     <td className="px-3 py-2 align-top">
                       {editingId === it.id ? (
                         <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-2 py-1 border rounded" />
                       ) : (
                         <span>{it.name}</span>
                       )}
                     </td>
                    <td className="px-3 py-2 align-top">
                      {editingId === it.id ? (
                        <select
                          value={(editType ?? it.type ?? getFieldType(it.code))}
                          onChange={(e) => setEditType(e.target.value as 'special'|'digits'|'string')}
                          className="w-full px-2 py-1 border rounded"
                          aria-label={t('fields.type', 'Type') as string}
                        >
                          <option value="special">{t('pages.settings.type.special', 'Special Code')}</option>
                          <option value="digits">{t('pages.settings.type.digits', 'Digits Only')}</option>
                          <option value="string">{t('pages.settings.type.string', 'Text')}</option>
                        </select>
                      ) : (
                        <span>
                          {(() => {
                            const ft = it.type ?? getFieldType(it.code);
                            if (ft === 'special') return t('pages.settings.type.special', 'Special Code');
                            if (ft === 'digits') return t('pages.settings.type.digits', 'Digits Only');
                            return t('pages.settings.type.string', 'Text');
                          })()}
                        </span>
                      )}
                    </td>
                     <td className="px-3 py-2 align-top">
                      {editingId === it.id ? (
                        (editType ?? it.type ?? getFieldType(it.code)) === 'special' ? (
                          <SearchableSelect<CodeOption>
                            options={codeOptions}
                            value={codeOptions.find((o) => String(o.id) === String(editSpecialId || it.special_id || '')) || null}
                            onChange={(opt) => { setEditSpecialId(opt ? String(opt.id) : ''); setEditValue(opt ? opt.name : ''); }}
                            label={t('pages.settings.selectSpecialCode', 'Select special code')}
                            placeholder={t('pages.codes.codeOrTitle', 'Search code or title')}
                            size="small"
                            fullWidth
                            loading={codesLoading}
                            getOptionLabel={(opt) => opt.name}
                            isOptionEqualToValue={(o, v) => String(o.id) === String(v.id)}
                            inputDisplayMode="label"
                            autoSelectSingleOnEnter
                            onCommitted={focusEditSave}
                            renderOption={(props, option) => (
                              // Render only the combined label; do not show separate code span
                              <li {...props}>{option.name}</li>
                            )}
                          />
                        ) : ((editType ?? it.type ?? getFieldType(it.code)) === 'digits') ? (
                          <NumericInput
                            value={editValue}
                            onChange={(v) => setEditValue(String(v))}
                            allowDecimal={false}
                            allowNegative={false}
                            fullWidth
                            size="small"
                          />
                        ) : (
                          <input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full px-2 py-1 border rounded" />
                        )
                      ) : (
                        (() => {
                          const ft = it.type ?? getFieldType(it.code);
                          if (ft === 'special') {
                            const label = getCodeLabelById(it.special_id as any) || (typeof it.value === 'string' ? it.value : '');
                            return <span>{label || ''}</span>;
                          }
                          return <span className="break-words whitespace-pre-wrap">{stringifyValue(it.value)}</span>;
                        })()
                      )}
                     </td>
                     <td className="px-3 py-2 align-top">
                       {editingId === it.id ? (
                         <div className="flex gap-2">
                           <Tooltip title={t('common.save', 'Save') as string}>
                             <IconButton
                               aria-label={t('common.save', 'Save') as string}
                               size="small"
                               onClick={() => saveEdit(it.id)}
                               ref={editSaveButtonRef}
                             >
                               <SaveIcon fontSize="small" sx={{ color: '#16a34a' }} />
                             </IconButton>
                           </Tooltip>
                           <Tooltip title={t('common.cancel', 'Cancel') as string}>
                             <IconButton
                               aria-label={t('common.cancel', 'Cancel') as string}
                               size="small"
                               onClick={cancelEdit}
                             >
                               <CancelIcon fontSize="small" sx={{ color: '#6b7280' }} />
                             </IconButton>
                           </Tooltip>
                         </div>
                       ) : (
                         <div className="flex gap-2">
                           <Tooltip title={t('common.edit', 'Edit') as string}>
                             <IconButton
                               aria-label={t('common.edit', 'Edit') as string}
                               size="small"
                               onClick={() => beginEdit(it)}
                             >
                               <EditIcon fontSize="small" sx={{ color: '#16a34a' }} />
                             </IconButton>
                           </Tooltip>
                           <Tooltip title={t('common.delete', 'Delete') as string}>
                             <IconButton
                               aria-label={t('common.delete', 'Delete') as string}
                               size="small"
                               onClick={() => requestDelete(it.id)}
                             >
                               <DeleteIcon fontSize="small" sx={{ color: '#dc2626' }} />
                             </IconButton>
                           </Tooltip>
                         </div>
                       )}
                     </td>
                   </tr>
                 ))
               )}
              {/* Always-present empty row for creating a new setting */}
              <tr>
                <td className="px-3 py-2">
                  <input
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    className="w-full px-2 py-1 border rounded"
                    placeholder={t('fields.code', 'Code')}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-2 py-1 border rounded"
                    placeholder={t('fields.name', 'Name')}
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as 'special'|'digits'|'string')}
                    className="w-full px-2 py-1 border rounded"
                    aria-label={t('fields.type', 'Type') as string}
                  >
                    <option value="special">{t('pages.settings.type.special', 'Special Code')}</option>
                    <option value="digits">{t('pages.settings.type.digits', 'Digits Only')}</option>
                    <option value="string">{t('pages.settings.type.string', 'Text')}</option>
                  </select>
                </td>
                <td className="px-3 py-2">

                  {(newType) === 'special' ? (
                    <SearchableSelect<CodeOption>
                      options={codeOptions}
                      value={codeOptions.find((o) => String(o.id) === String(newSpecialId || '')) || null}
                      onChange={(opt) => { setNewSpecialId(opt ? String(opt.id) : ''); setNewValue(opt ? opt.name : ''); }}
                      label={t('pages.settings.selectSpecialCode', 'Select special code')}
                      placeholder={t('pages.codes.codeOrTitle', 'Search code or title')}
                      size="small"
                      fullWidth
                      loading={codesLoading}
                      getOptionLabel={(opt) => opt.name}
                      isOptionEqualToValue={(o, v) => String(o.id) === String(v.id)}
                      inputDisplayMode="label"
                      autoSelectSingleOnEnter
                      onCommitted={focusNewSave}
                      renderOption={(props, option) => (
                        // Render only the combined label; do not show separate code span
                        <li {...props}>{option.name}</li>
                      )}
                    />
                  ) : (newType) === 'digits' ? (
                    <NumericInput
                      value={newValue}
                      onChange={(v) => setNewValue(String(v))}
                      allowDecimal={false}
                      allowNegative={false}
                      fullWidth
                      size="small"
                    />
                  ) : (
                    <input
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      className="w-full px-2 py-1 border rounded"
                      placeholder={t('fields.value', 'Value')}
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  <Tooltip title={t('common.save', 'Save') as string}>
                    <IconButton
                      aria-label={t('common.save', 'Save') as string}
                      size="small"
                      onClick={saveNew}
                      ref={newSaveButtonRef}
                    >
                      <SaveIcon fontSize="small" sx={{ color: '#16a34a' }} />
                    </IconButton>
                  </Tooltip>
                </td>
              </tr>
             </tbody>
           </table>
         </div>

         {/* Pagination footer */}
         <div className="mt-4">
           <Pagination
             page={page}
             pageSize={pageSize}
             total={total}
             onPageChange={setPage}
             onPageSizeChange={handlePageSizeChange}
           />
         </div>
       </main>
     </div>
   );
 };

 export default TreasurySettingsPage;