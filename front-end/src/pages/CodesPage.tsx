/**
 * CodesPage
 * - Manages General → Specific codes with a simple tree UI.
 * - Provides create, edit, and delete operations.
 * - Uses backend endpoints under `/api/v1/codes` for CRUD and `/tree` for hierarchy.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import NumericInput from '../components/common/NumericInput';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import { IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';

import AlertDialog from '../components/common/AlertDialog';
import { FormControl, InputLabel, Select, MenuItem, TextField, FormHelperText } from '@mui/material';

// Shape of a code record returned by the backend
interface CodeItem {
  id: string;
  code: string;
  title: string;
  kind: 'group' | 'general' | 'specific';
  parent_id?: string | null;
  is_active?: boolean | number;
  nature?: 0 | 1 | null; // 0 = Debitor, 1 = Creditor
  children?: CodeItem[];
}

// Create/Edit form state type
interface FormState {
  code: string;
  title: string;
  kind: 'group' | 'general' | 'specific';
  parent_id: string | null;
  nature: 0 | 1 | null; // 0 = Debitor, 1 = Creditor
}

/**
 * Parent option type for MUI selects (id + combined label).
 */
type ParentOption = { id: string; label: string };

export const CodesPage: React.FC = () => {
  const { t } = useTranslation();

  // Tree and flat lists
  const [tree, setTree] = useState<CodeItem[]>([]);
  const [flat, setFlat] = useState<CodeItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  // Alert dialog state for show/hide and message
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertType, setAlertType] = useState<'error' | 'warning' | 'success' | 'info'>('info');
  const [alertTitle, setAlertTitle] = useState<string | undefined>(undefined);
  const [alertMessage, setAlertMessage] = useState('');

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({ code: '', title: '', kind: 'group', parent_id: null, nature: null });
  const [creating, setCreating] = useState<boolean>(false);

  // Edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>({ code: '', title: '', kind: 'general', parent_id: null, nature: null });
  const [saving, setSaving] = useState<boolean>(false);

  /**
   * Maps numeric nature values to localized labels.
   * 1 = Creditor, 0 = Debitor, null/undefined → ''.
   */
  function getNatureLabel(n: 0 | 1 | null | undefined): string {
    if (n === 1) return t('pages.codes.nature.creditor', 'Creditor') as string;
    if (n === 0) return t('pages.codes.nature.debitor', 'Debitor') as string;
    return '';
  }

  /**
   * Map numeric nature to a CSS class for colorization in the tree.
   * Returns 'text-[#d04bc9]' for 0, 'text-[#52d941]' for 1, or '' for none/unknown.
   */
  function getNatureClass(n: 0 | 1 | null | undefined): string {
    // Use Tailwind arbitrary color classes to replace CodesPage.css rules
    if (n === 0) return 'text-[#d04bc9]'; // Debitor
    if (n === 1) return 'text-[#52d941]'; // Creditor
    return '';
  }

  // Removed duplicate resetCreateForm/startEdit definitions (consolidated below)

  // UI state for expand/collapse
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /**
   * Snapshot of expanded state before search begins.
   * - When a search query is active, we auto-expand matching branches.
   * - When the query is cleared, we restore the previous expand state.
   */
  const [expandedBeforeSearch, setExpandedBeforeSearch] = useState<Set<string> | null>(null);

  /**
   * Search state for tree.
   * - treeSearchQuery filters the left tree view by code or title.
   */
  const [treeSearchQuery, setTreeSearchQuery] = useState<string>('');

  /**
   * Fetch codes list and tree from backend.
   */
  async function fetchAll() {
    setLoading(true);
    setError('');
    try {
      const [treeRes, listRes] = await Promise.all([
        axios.get(`${config.API_ENDPOINTS.base}/v1/codes/tree`),
        axios.get(`${config.API_ENDPOINTS.base}/v1/codes`),
      ]);
      const treeData: CodeItem[] = (treeRes.data?.data || treeRes.data || []) as any;
      const flatData: CodeItem[] = (listRes.data?.data || listRes.data || []) as any;
      setTree(Array.isArray(treeData) ? treeData : []);
      setFlat(Array.isArray(flatData) ? flatData : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || t('common.error', 'Error'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  /**
   * Reset create form fields to Group with next available code.
   * - Sets kind to 'group'.
   * - Clears title and parent.
   * - Prefills code using getSuggestedCode for group.
   */
  function resetCreateForm() {
    const nextGroupCode = getSuggestedCode('group', null);
    setForm({ code: nextGroupCode, title: '', kind: 'group', parent_id: null, nature: null });
  }

  /**
   * Start editing selected code record.
   */
  function startEdit(item: CodeItem) {
    setEditingId(item.id);
    setEditForm({
      code: item.code,
      title: item.title,
      kind: item.kind,
      parent_id: item.parent_id ?? null,
      nature: item.nature ?? null,
    });
  }

  /**
   * Cancel edit mode.
   */
  function cancelEdit() {
    setEditingId(null);
    setEditForm({ code: '', title: '', kind: 'general', parent_id: null, nature: null });
  }

  /**
   * Client-side validation for parent-kind relationship.
   */
  function validateParentKind(selectedKind: FormState['kind'], selectedParentId: string | null): { ok: boolean; message?: string } {
    if (selectedKind === 'group') return { ok: true };
    const parent = flat.find((c) => c.id === selectedParentId);
    if (selectedKind === 'general') {
      if (!parent || parent.kind !== 'group') {
        return { ok: false, message: t('pages.codes.mustPickGroupParent', 'Pick a Group as parent') };
      }
      return { ok: true };
    }
    if (!parent || parent.kind !== 'general') {
      return { ok: false, message: t('pages.codes.mustPickGeneralParent', 'Pick a General as parent') };
    }
    return { ok: true };
  }

  /**
   * Create a new code using backend API.
   */
  async function createCode(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError('');

    const check = validateParentKind(form.kind, form.parent_id);
    if (!check.ok) {
      setCreating(false);
      setError(check.message || t('common.error', 'Error'));
      return;
    }

    try {
      const payload = { ...form, is_active: true };
      await axios.post(`${config.API_ENDPOINTS.base}/v1/codes`, payload);
      resetCreateForm();
      await fetchAll();
    } catch (e: any) {
      if (e.response?.status === 409) {
        setError(t('pages.codes.conflict', 'This code already exists.'));
      } else {
        setError(e?.response?.data?.message || t('common.error', 'Error'));
      }
    } finally {
      setCreating(false);
    }
  }

  /**
   * Update an existing code by id.
   */
  async function updateCode() {
    if (!editingId) return;
    setSaving(true);
    setError('');

    const check = validateParentKind(editForm.kind, editForm.parent_id);
    if (!check.ok) {
      setSaving(false);
      setError(check.message || t('common.error', 'Error'));
      return;
    }

    try {
      await axios.patch(`${config.API_ENDPOINTS.base}/v1/codes/${editingId}`, editForm);
      cancelEdit();
      await fetchAll();
    } catch (e: any) {
      if (e.response?.status === 409) {
        setError(t('pages.codes.conflict', 'This code already exists.'));
      } else {
        setError(e?.response?.data?.message || t('common.error', 'Error'));
      }
    } finally {
      setSaving(false);
    }
  }

  /**
   * Delete a code and all its descendants.
   * Future: when journal database is ready, prevent deletion if the code is referenced.
   */
  async function deleteCode(id: string) {
    const confirmed = window.confirm(t('pages.codes.deleteConfirmCascade', 'Delete this code and all children?'));
    if (!confirmed) return;

    setError('');
    try {
      // Collect descendants from the flat list (children, grandchildren, etc.).
      const descendants: string[] = [];
      const queue: string[] = [id];
      const visited = new Set<string>([id]);
      while (queue.length) {
        const current = queue.shift() as string;
        for (const c of flat) {
          if (c.parent_id === current && !visited.has(c.id)) {
            descendants.push(c.id);
            queue.push(c.id);
            visited.add(c.id);
          }
        }
      }

      // Delete children first (deepest to shallowest), then the selected node.
      const order = [...descendants.reverse(), id];
      for (const delId of order) {
        await axios.delete(`${config.API_ENDPOINTS.base}/v1/codes/${delId}`);
      }

      await fetchAll();
      setAlertType('success');
      setAlertTitle(t('common.success', 'Success'));
      setAlertMessage(t('pages.codes.deletedCascade', 'Deleted code and all children.'));
      setAlertOpen(true);
    } catch (e: any) {
      const msg = e?.response?.data?.message || t('common.error', 'Error');
      setError(msg);
      setAlertType('error');
      setAlertTitle(t('common.error', 'Error'));
      setAlertMessage(msg);
      setAlertOpen(true);
    }
  }

  /**
   * Toggle expand/collapse for a node.
   */
  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Parent options computed per-form based on selected kind
  const parentOptionsForCreate = useMemo<ParentOption[]>(() => {
    if (form.kind === 'group') return [];
    if (form.kind === 'general') {
      return flat
        .filter((c) => c.kind === 'group')
        .map((g) => ({ id: g.id, label: `${g.code} — ${g.title}` }));
    }
    return flat
      .filter((c) => c.kind === 'general')
      .map((g) => ({ id: g.id, label: `${g.code} — ${g.title}` }));
  }, [flat, form.kind]);

  const parentOptionsForEdit = useMemo<ParentOption[]>(() => {
    if (editForm.kind === 'group') return [];
    if (editForm.kind === 'general') {
      return flat
        .filter((c) => c.kind === 'group')
        .map((g) => ({ id: g.id, label: `${g.code} — ${g.title}` }));
    }
    return flat
      .filter((c) => c.kind === 'general')
      .map((g) => ({ id: g.id, label: `${g.code} — ${g.title}` }));
  }, [flat, editForm.kind]);

  /**
   * Parent search removed; use full `parentOptionsForCreate` list.
   */

  /**
   * Parent search removed; use full `parentOptionsForEdit` list.
   */

  /**
   * Compute suggested code for create form based on kind and selected parent.
   * - Group: next two-digit after highest group code.
   * - General: prefix parent group code + next two-digit child.
   * - Specific: prefix parent general code + next two-digit child.
   */
  function getSuggestedCode(kind: FormState['kind'], parentId: string | null): string {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    if (kind === 'group') {
      const nums = flat
        .filter((c) => c.kind === 'group')
        .map((c) => parseInt(String(c.code), 10))
        .filter((n) => Number.isFinite(n));
      const next = (nums.length ? Math.max(...nums) : 0) + 1;
      return pad2(next);
    }
    if (!parentId) return '';
    const parent = flat.find((c) => c.id === parentId);
    if (!parent || !parent.code) return '';
    const prefix = String(parent.code);
    const expectedLen = kind === 'general' ? 4 : 6;
    const siblings = flat.filter((c) => c.kind === kind && c.parent_id === parentId);
    let maxSuffix = 0;
    for (const s of siblings) {
      const codeStr = String(s.code || '');
      if (codeStr.startsWith(prefix) && codeStr.length >= expectedLen) {
        const suffixStr = codeStr.slice(prefix.length, prefix.length + 2);
        const num = parseInt(suffixStr, 10);
        if (Number.isFinite(num) && num > maxSuffix) maxSuffix = num;
      }
    }
    const nextSuffix = maxSuffix + 1;
    return prefix + pad2(nextSuffix);
  }

  const suggestedCreateCode = useMemo(() => getSuggestedCode(form.kind, form.parent_id), [flat, form.kind, form.parent_id]);

  /**
   * Auto-fill the create form code with the suggested value when it changes.
   * - Runs when kind/parent or data updates recompute the suggestion.
   * - Only updates if suggestion is non-empty and different from current code.
   */
  useEffect(() => {
    if (!suggestedCreateCode) return;
    setForm((prev) => (prev.code === suggestedCreateCode ? prev : { ...prev, code: suggestedCreateCode }));
  }, [suggestedCreateCode]);

  /**
   * Ensure create form parent_id is valid for current kind.
   * - group: parent_id = null
   * - general: must be a group parent
   * - specific: must be a general parent
   */
  function ensureValidParentForCreate() {
    if (form.kind === 'group') {
      if (form.parent_id !== null) {
        setForm((prev) => ({ ...prev, parent_id: null }));
      }
      return;
    }
    const validIds = new Set(parentOptionsForCreate.map((o) => o.id));
    if (!form.parent_id || !validIds.has(form.parent_id)) {
      const nextId = parentOptionsForCreate[0]?.id || null;
      setForm((prev) => ({ ...prev, parent_id: nextId }));
    }
  }

  useEffect(() => {
    ensureValidParentForCreate();
  }, [form.kind, parentOptionsForCreate]);

  function handleCreateParentChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value || '';
    const next = value ? value : null;
    setForm((prev) => ({ ...prev, parent_id: next }));
  }

  /**
   * Handle parent change for MUI Select in create form.
   * Normalizes empty string to null to match API payload expectations.
   */
  function handleCreateParentChangeMui(e: any) {
    const value = e.target.value || '';
    const next = value ? value : null;
    setForm((prev) => ({ ...prev, parent_id: next }));
  }

  /**
   * Start create-under flow for a given node.
   * - Sets create form to the next valid kind (group→general, general→specific).
   * - Prefills parent_id with the clicked node's id.
   * - Clears editing mode to show the create form.
   */
  function startCreateUnder(node: CodeItem) {
    // Determine next kind based on current node kind
    const nextKind: FormState['kind'] = node.kind === 'group' ? 'general' : node.kind === 'general' ? 'specific' : 'specific';
    // If node is specific, creating a child is invalid → show alert and abort
    if (node.kind === 'specific') {
      setAlertType('warning');
      setAlertTitle(t('common.warning', 'Warning'));
      setAlertMessage(t('pages.codes.cannotCreateUnderSpecific', 'Cannot create under Specific'));
      setAlertOpen(true);
      return;
    }
    // Exit edit mode and open create form with prefilled parent/kind
    setEditingId(null);
    setForm({ code: '', title: '', kind: nextKind, parent_id: node.id, nature: node.nature ?? null });
  }

  /**
   * Render action buttons (edit/delete) as icon-only controls for each node.
   * - Accessible: sets aria-label and title via i18n for English/Farsi.
   * - Visual: compact icon buttons shown on row hover.
   */
  function ActionButtons({ node }: { node: CodeItem }) {
    return (
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">

        {node.kind !== 'specific' && (
          <IconButton
            onClick={() => startCreateUnder(node)}
          color="info"
          size="small"
          >
            <AddCircleOutlineIcon className="text-[20px]" />
          </IconButton>
        )}
        <IconButton
          onClick={() => startEdit(node)}
          color="primary"
          size="small"
        >
          <EditIcon className="text-[20px]" />
        </IconButton>
        <IconButton 
          onClick={() => deleteCode(node.id)}
          color="error"
          size="small"
        >
          <DeleteIcon />
        </IconButton>
      </div>
    );
  }

  /**
   * Render hierarchical tree of codes.
   * Displays code + dashed leader + title; hides kind label.
   * Typography: uses 'text-sm' on the list to make tree smaller.
   * Indentation: applies row-level margin start via CSS var for clear nesting.
   * Uses `ml-[var(--indent)]` in LTR and `mr-[var(--indent)]` in RTL.
   * Step: 20px per depth for clearer child alignment.
   */
  function renderTree(nodes: CodeItem[], depth = 0) {
    const isRTL = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    return (
      <ul className="space-y-1 text-[16px]">
        {nodes.map((node) => (
          <li key={node.id}>
            <div
              className={`group flex items-center justify-between hover:bg-green-50 rounded px-2 py-1 ${isRTL ? 'mr-[var(--indent)]' : 'ml-[var(--indent)]'}`}
              style={{ ['--indent' as any]: `${depth * 20}px` } as React.CSSProperties }
            >
              <div className="flex items-center">
                {node.children && node.children.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => toggleExpand(node.id)}
                    className={`bg-transparent p-0 border-0 rounded-none mr-2 text-lg font-bold transition-colors duration-200 ${
                      expanded.has(node.id)
                        ? 'text-blue-600'
                        : 'text-gray-500'
                    }`}
                    aria-label={expanded.has(node.id) ? t('common.collapse', 'Collapse') : t('common.expand', 'Expand')}
                  >
                    {expanded.has(node.id) ? (
                      <KeyboardArrowDownIcon sx={{ fontSize: 18 }} className="text-blue-600" />
                     ) : (
                       <ChevronLeftIcon sx={{ fontSize: 18 }} className="text-gray-500" />
                    )}                  
                  </button>
                ) : (
                  
                  <CropSquareIcon sx={{ fontSize: 14 }} className="text-green-600" />
                )}
                <span className="font-mono mr-2 text-gray-900">&nbsp;{node.code}</span>
                <span className="text-blue-600">&nbsp;{node.title}</span>
                {node.nature !== null && node.nature !== undefined && (
                  <span className={`ml-2 text-xs ${getNatureClass(node.nature)}`}>&nbsp;{getNatureLabel(node.nature)}</span>
                )}
              </div>
              <ActionButtons node={node} />
            </div>
            {node.children && node.children.length > 0 && expanded.has(node.id) && renderTree(node.children, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }

  /**
   * Filter a hierarchical codes tree by a query across `code` and `title`.
   * - Includes a node if it matches itself or any descendant matches.
   * - Matching is case-insensitive and checks substring on both fields.
   * - Children are pruned to only keep matching branches.
   * - When the query is numeric-only, convert Farsi/Arabic-Indic digits to ASCII before matching.
   */
  function filterTreeByQuery(nodes: CodeItem[], query: string): CodeItem[] {
    /**
     * Convert Farsi/Arabic-Indic digits to ASCII equivalents.
     * Preserves non-digit characters unchanged. Used for numeric-only search normalization.
     */
    function toAsciiDigits(str: string): string {
      return Array.from(str)
        .map((ch) => {
          const code = ch.charCodeAt(0);
          // Arabic-Indic digits U+0660–U+0669
          if (code >= 0x0660 && code <= 0x0669) {
            return String.fromCharCode(48 + (code - 0x0660));
          }
          // Eastern Arabic digits U+06F0–U+06F9
          if (code >= 0x06f0 && code <= 0x06f9) {
            return String.fromCharCode(48 + (code - 0x06f0));
          }
          return ch;
        })
        .join('');
    }

    // Only normalize when the query contains digits and whitespace, without letters.
    const isNumericOnly = /^[\s\u0660-\u0669\u06F0-\u06F9\d]+$/.test(query);
    const normalized = isNumericOnly ? toAsciiDigits(query) : query;

    const q = normalized.trim().toLowerCase();
    if (!q) return nodes;
    const walk = (list: CodeItem[]): CodeItem[] => {
      const out: CodeItem[] = [];
      for (const node of list) {
        const selfMatch = String(node.code).toLowerCase().includes(q) || String(node.title).toLowerCase().includes(q);
        const childMatches = node.children ? walk(node.children) : [];
        if (selfMatch || childMatches.length > 0) {
          out.push({ ...node, children: childMatches });
        }
      }
      return out;
    };
    return walk(nodes);
  }

  /**
   * Memoized filtered tree based on `treeSearchQuery`.
   */
  const filteredTree = useMemo(() => {
    return treeSearchQuery.trim() ? filterTreeByQuery(tree, treeSearchQuery) : tree;
  }, [tree, treeSearchQuery]);

  /**
   * Collect IDs of nodes that should be expanded to reveal matching branches.
   * - Returns IDs of all nodes that have children in the filtered tree.
   * - Ensures ancestors with children are expanded so matches are visible.
   */
  function collectExpandableNodeIds(nodes: CodeItem[]): Set<string> {
    const ids = new Set<string>();
    const walk = (list: CodeItem[]) => {
      for (const n of list) {
        if (n.children && n.children.length > 0) {
          ids.add(n.id);
          walk(n.children);
        }
      }
    };
    walk(nodes);
    return ids;
  }

  /**
   * Auto-expand matching branches when a search query is active.
   * - On enter search: snapshot current expand state and expand all ancestors.
   * - On clear search: restore the snapshot.
   */
  useEffect(() => {
    const q = treeSearchQuery.trim();
    if (q) {
      // Snapshot previous expanded state once when entering search
      setExpandedBeforeSearch((prev) => prev ?? new Set(expanded));
      // Expand all nodes that have children in the filtered tree (ancestors of matches)
      const ids = collectExpandableNodeIds(filteredTree);
      setExpanded(ids);
    } else {
      // Restore previous expanded state when search is cleared
      if (expandedBeforeSearch) {
        setExpanded(expandedBeforeSearch);
        setExpandedBeforeSearch(null);
      }
    }
  }, [treeSearchQuery, filteredTree]);
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      {/* Global alert dialog for this page */}
      <AlertDialog open={alertOpen} title={alertTitle} message={alertMessage} onClose={() => setAlertOpen(false)} type={alertType} />
      <main className="gb-page w-full py-6">
          <h1 className="text-2xl font-semibold mb-6">{t('pages.codes.title', 'Codes Manager')}</h1>

          {error && <div className="mb-4 text-gray-600 px-2">{error}</div>}

          <div className="flex gap-6">
            {/* Left Section - Tree View */}
            <section className="w-2/5 bg-gray-100 rounded-lg shadow-lg p-5 gb-section">
              <h3 className="font-medium mb-4 text-gray-700">{t('pages.codes.tree', 'Codes')}</h3>
              <TextField
                fullWidth
                size="small"
                variant="outlined"
                className="mb-3"
                label={t('pages.codes.codeOrTitle', 'Search code or title')}
                value={treeSearchQuery}
                onChange={(e) => setTreeSearchQuery(e.target.value)}
              />
              <div className="max-h-[calc(100vh-220px)] overflow-y-auto pr-2 custom-scrollbar">
                {loading && <div className="text-xs text-gray-500">{t('common.loading', 'Loading...')}</div>}
                {!loading && tree.length > 0 ? (
                  renderTree(filteredTree)
                ) : (
                  <div className="text-xs text-gray-500">{t('common.noData', 'No data')}</div>
                )}
              </div>
            </section>

            {/* Right Section - Form */}
            <section className="w-3/5 bg-gray-100 rounded-lg shadow-lg p-5 gb-section">
              <h3 className="font-medium mb-4 text-gray-700">
                {editingId === null
                  ? t('pages.codes.create', 'Create Code')
                  : t('pages.codes.edit', 'Edit Code')}
              </h3>

              {editingId === null ? (
                <div className="bg-gray-100 rounded-lg p-4">
                  <form onSubmit={createCode} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">{t('fields.code', 'Code')}</label>
                      <NumericInput
                        value={form.code}
                        onChange={(val) => setForm({ ...form, code: String(val) })}
                        className="gb-input w-full"
                        placeholder={t('fields.code', 'Code') as string}
                        required
                        allowDecimal={false}
                        allowNegative={false}
                        maxLength={form.kind === 'group' ? 2 : form.kind === 'general' ? 4 : form.kind === 'specific' ? 6 : undefined}
                      />
                      {form.kind === 'group' &&
                        form.code.length > 0 &&
                        form.code.length !== 2 && (
                          <p className="mt-1 text-[11px] text-red-500">
                            {t('pages.codes.groupCodeLength')}
                          </p>
                        )}
                      {form.kind === 'general' &&
                        form.code.length > 0 &&
                        form.code.length !== 4 && (
                          <p className="mt-1 text-[11px] text-red-500">
                            {t('pages.codes.generalCodeLength')}
                          </p>
                        )}
                      {form.kind === 'specific' &&
                        form.code.length > 0 &&
                        form.code.length !== 6 && (
                          <p className="mt-1 text-[11px] text-red-500">
                            {t('pages.codes.specificCodeLength')}
                          </p>
                        )}

                    </div>
                    <div>
                      <TextField
                        fullWidth
                        label={t('fields.title', 'Title')}
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <FormControl fullWidth>
                        <InputLabel>{t('fields.kind', 'Kind')}</InputLabel>
                        <Select
                          label={t('fields.kind', 'Kind')}
                          value={form.kind}
                          onChange={(e) => setForm({ ...form, kind: e.target.value as 'group' | 'general' | 'specific', parent_id: e.target.value === 'group' ? null : form.parent_id })}
                        >
                          <MenuItem value="group">{t('pages.codes.kind.group', 'Group')}</MenuItem>
                          <MenuItem value="general">{t('pages.codes.kind.general', 'General')}</MenuItem>
                          <MenuItem value="specific">{t('pages.codes.kind.specific', 'Specific')}</MenuItem>
                        </Select>
                      </FormControl>
                    </div>
                    <div>
                      <FormControl fullWidth required={form.kind !== 'group'} disabled={form.kind === 'group'}>
                        <InputLabel>{t('fields.parent', 'Parent')}</InputLabel>
                        <Select
                          label={t('fields.parent', 'Parent')}
                          value={form.kind === 'group' ? '' : (form.parent_id ?? '')}
                          onChange={handleCreateParentChangeMui}
                        >
                          {form.kind === 'group' && (
                            <MenuItem value="">{t('pages.codes.noParent', 'No parent')}</MenuItem>
                          )}
                          {parentOptionsForCreate.map((opt) => (
                            <MenuItem key={opt.id} value={opt.id}>{opt.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </div>
                    <div>
                      <FormControl fullWidth>
                        <InputLabel>{t('fields.nature', 'Nature')}</InputLabel>
                        <Select
                          label={t('fields.nature', 'Nature')}
                          value={form.nature === null ? '' : String(form.nature)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setForm({ ...form, nature: v === '' ? null : Number(v) as 0 | 1 });
                          }}
                        >
                          <MenuItem value="">{t('common.none', 'None')}</MenuItem>
                          <MenuItem value="0">{t('pages.codes.nature.debitor', 'Debitor')}</MenuItem>
                          <MenuItem value="1">{t('pages.codes.nature.creditor', 'Creditor')}</MenuItem>
                        </Select>
                      </FormControl>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="submit"
                      className="gb-button gb-button-primary"
                      disabled={creating}
                    >
                      {creating ? t('actions.saving', 'Saving...') : t('actions.create', 'Create')}
                    </button>
                    <button
                      type="button"
                      onClick={resetCreateForm}
                      className="gb-button gb-button-secondary"
                    >
                      {t('actions.clear', 'Clear')}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                <form onSubmit={createCode} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">{t('fields.code', 'Code')}</label>
                      <NumericInput
                        value={editForm.code}
                        onChange={(val) => setEditForm({ ...editForm, code: String(val) })}
                        className="gb-input w-full"
                        placeholder={t('fields.code', 'Code') as string}
                        required
                        allowDecimal={false}
                        allowNegative={false}
                        maxLength={editForm.kind === 'group' ? 2 : editForm.kind === 'general' ? 4 : editForm.kind === 'specific' ? 6 : undefined}
                      />
                      {editForm?.kind === 'group' &&
                        editForm.code.length > 0 &&
                        editForm.code.length !== 2 && (
                          <p className="text-red-500 text-xs">
                            {t('pages.codes.groupCodeLength')}
                          </p>
                        )}
                      {editForm?.kind === 'general' &&
                        editForm.code.length > 0 &&
                        editForm.code.length !== 4 && (
                          <p className="text-red-500 text-xs">
                            {t('pages.codes.generalCodeLength')}
                          </p>
                        )}
                      {editForm?.kind === 'specific' &&
                        editForm.code.length > 0 &&
                        editForm.code.length !== 6 && (
                          <p className="text-red-500 text-xs">
                            {t('pages.codes.specificCodeLength')}
                          </p>
                        )}
                    </div>
                    <div>
                      <TextField
                        fullWidth
                        label={t('fields.title', 'Title')}
                        value={editForm.title}
                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <FormControl fullWidth>
                        <InputLabel>{t('fields.kind', 'Kind')}</InputLabel>
                        <Select
                          label={t('fields.kind', 'Kind')}
                          value={editForm.kind}
                          onChange={(e) => setEditForm({ ...editForm, kind: e.target.value as 'group' | 'general' | 'specific', parent_id: e.target.value === 'group' ? null : editForm.parent_id })}
                        >
                          <MenuItem value="group">{t('pages.codes.kind.group', 'Group')}</MenuItem>
                          <MenuItem value="general">{t('pages.codes.kind.general', 'General')}</MenuItem>
                          <MenuItem value="specific">{t('pages.codes.kind.specific', 'Specific')}</MenuItem>
                        </Select>
                      </FormControl>
                    </div>
                    <div>
                      <FormControl fullWidth disabled={editForm.kind === 'group'} required={editForm.kind !== 'group'}>
                        <InputLabel>{t('fields.parent', 'Parent')}</InputLabel>
                        <Select
                          label={t('fields.parent', 'Parent')}
                          value={editForm.parent_id ?? ''}
                          onChange={(e) => setEditForm({ ...editForm, parent_id: (e.target.value as string) || null })}
                        >
                          {editForm.kind === 'group' && (
                            <MenuItem value="">{t('pages.codes.noParent', 'No parent')}</MenuItem>
                          )}
                          {parentOptionsForEdit.map((opt) => (
                            <MenuItem key={opt.id} value={opt.id}>{opt.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </div>
                    <div>
                      <FormControl fullWidth>
                        <InputLabel>{t('fields.nature', 'Nature')}</InputLabel>
                        <Select
                          label={t('fields.nature', 'Nature')}
                          value={editForm.nature === null ? '' : String(editForm.nature)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setEditForm({ ...editForm, nature: v === '' ? null : Number(v) as 0 | 1 });
                          }}
                        >
                          <MenuItem value="">{t('common.none', 'None')}</MenuItem>
                          <MenuItem value="0">{t('pages.codes.nature.debitor', 'Debitor')}</MenuItem>
                          <MenuItem value="1">{t('pages.codes.nature.creditor', 'Creditor')}</MenuItem>
                        </Select>
                      </FormControl>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={updateCode}
                      className="gb-button gb-button-primary"
                      disabled={saving}
                    >
                      {saving ? t('actions.saving', 'Saving...') : t('actions.save', 'Save')}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="gb-button gb-button-secondary"
                    >
                      {t('actions.cancel', 'Cancel')}
                    </button>
                  </div>
                  </form>
                </div>
              )}
            </section>
        </div>
        </main>
    </div>
  );
};

export default CodesPage;