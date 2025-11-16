import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import Navbar from '../components/Navbar';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import SearchIcon from '@mui/icons-material/Search';
import config from '../config';

/**
 * Detail level item interface aligned with backend response.
 */
interface DetailLevelItem {
  id: string;
  code: string;
  title: string;
  parent_id: string | null;
  specific_code_id?: string | null;
  children?: DetailLevelItem[];
}

/**
 * Coding (specific) code option interface for linking root detail levels.
 */
interface SpecificCodeOption {
  id: string;
  code: string;
  title: string;
}

/**
 * Create/Update payload shape for detail levels.
 */
interface DetailLevelPayload {
  code: string;
  title: string;
  parent_id: string | null;
  specific_code_id?: string | null;
}

/**
 * Returns a flat array given a tree of detail levels.
 * Includes each node exactly once, preserves parent relationships.
 */
function flattenTree(nodes: DetailLevelItem[]): DetailLevelItem[] {
  const flat: DetailLevelItem[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    flat.push(node);
    if (node.children && node.children.length) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }
  return flat;
}

/**
 * Normalizes numeric input by converting Persian/Arabic digits to Latin digits.
 * Keeps non-digit characters intact.
 */
function normalizeDigits(input: string): string {
  const map: Record<string, string> = {
    '۰': '0', '٠': '0',
    '۱': '1', '١': '1',
    '۲': '2', '٢': '2',
    '۳': '3', '٣': '3',
    '۴': '4', '٤': '4',
    '۵': '5', '٥': '5',
    '۶': '6', '٦': '6',
    '۷': '7', '٧': '7',
    '۸': '8', '٨': '8',
    '۹': '9', '٩': '9',
  };
  return input.replace(/[۰-۹٠-٩]/g, (d) => map[d] || d);
}

/**
 * DetailLevelsPage presents a tree of detail levels with create/edit forms.
 * - Root detail levels must link to a specific coding code.
 * - Child detail levels must not link to a specific code.
 * - Parent selection is optional; selecting one creates a child under it.
 */
const DetailLevelsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [tree, setTree] = useState<DetailLevelItem[]>([]);
  const [flat, setFlat] = useState<DetailLevelItem[]>([]);
  const [specificCodes, setSpecificCodes] = useState<SpecificCodeOption[]>([]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [creatingUnderId, setCreatingUnderId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<DetailLevelPayload>({
    code: '',
    title: '',
    parent_id: null,
    specific_code_id: null,
  });

  const [editForm, setEditForm] = useState<DetailLevelPayload>({
    code: '',
    title: '',
    parent_id: null,
    specific_code_id: null,
  });

  const lang = useMemo(() => i18n.language || 'fa', [i18n.language]);

  /**
   * Fetches detail levels tree from backend and prepares a flat list.
   * Uses GET /v1/detail-levels/tree which returns { items: [...] }.
   * Auto-expands root nodes that have children to reveal indentation.
   */
  async function fetchDetailLevels() {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/detail-levels/tree`, {
        headers: { 'Accept-Language': lang },
      });
      const rawItems = res.data?.items ?? res.data;
      const items: DetailLevelItem[] = Array.isArray(rawItems) ? rawItems : [];
      setTree(items);
      setFlat(flattenTree(items));
      const nextExpanded: Record<string, boolean> = {};
      for (const root of items) {
        if (root.children && root.children.length > 0) {
          nextExpanded[root.id] = true;
        }
      }
      setExpanded(nextExpanded);
    } catch (err: any) {
      console.error(err);
      setTree([]);
      setFlat([]);
      alert(err?.response?.data?.message || err?.message || t('errors.unknown'));
    }
  }

  /**
   * Fetches 'specific' coding codes for root detail levels.
   * Normalizes backend response and filters active, specific codes.
   */
  async function fetchSpecificCodes() {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/codes`, {
        headers: { 'Accept-Language': lang },
      });
      const rows = Array.isArray(res.data?.data)
        ? res.data.data
        : Array.isArray(res.data?.items)
        ? res.data.items
        : Array.isArray(res.data)
        ? res.data
        : [];

      const specs = rows
        .filter((r: any) => String(r.kind) === 'specific' && (r.is_active === true || r.is_active === 1))
        .map((r: any) => ({ id: r.id, code: r.code, title: r.title })) as SpecificCodeOption[];

      setSpecificCodes(specs);
    } catch (err: any) {
      console.error('fetchSpecificCodes failed:', err);
      setSpecificCodes([]);
    }
  }

  useEffect(() => {
    fetchDetailLevels().catch(console.error);
    fetchSpecificCodes().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  /**
   * Resets create form, optionally targeting a specific parent.
   */
  function startCreateUnder(parentId: string | null) {
    setCreatingUnderId(parentId);
    setEditingId(null);
    setCreateForm({
      code: '',
      title: '',
      parent_id: parentId,
      specific_code_id: parentId ? null : null,
    });
  }

  /**
   * Loads selected item into edit form and switches to edit mode.
   */
  function startEdit(item: DetailLevelItem) {
    setEditingId(item.id);
    setCreatingUnderId(null);
    setEditForm({
      code: item.code || '',
      title: item.title || '',
      parent_id: item.parent_id || null,
      specific_code_id: item.specific_code_id || null,
    });
  }

  /**
   * Creates a new detail level with client-side validation.
   * - If parent_id is null, specific_code_id MUST be provided.
   * - If parent_id is non-null, specific_code_id MUST be null.
   * - Submission is triggered by the gb-styled create form (CodesPage colors).
   */
  async function handleCreate() {
    const payload: DetailLevelPayload = {
      code: normalizeDigits(createForm.code.trim()),
      title: createForm.title.trim(),
      parent_id: createForm.parent_id,
      specific_code_id: createForm.parent_id ? null : createForm.specific_code_id || null,
    };

    if (!payload.title || !payload.code) {
      alert(t('validation.requiredFields'));
      return;
    }

    if (!payload.parent_id && !payload.specific_code_id) {
      alert(t('pages.detailLevels.errors.rootRequiresSpecific'));
      return;
    }
    if (!!payload.parent_id && !!payload.specific_code_id) {
      alert(t('pages.detailLevels.errors.nonRootCannotHaveSpecific'));
      return;
    }

    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/detail-levels`, payload, {
        headers: { 'Accept-Language': lang },
      });
      await fetchDetailLevels();
      startCreateUnder(null);
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || err?.message;
      if (status === 409) {
        alert(t('pages.detailLevels.errors.codeExists'));
      } else {
        alert(msg || t('errors.unknown'));
      }
    }
  }

  /**
   * Updates an existing detail level with similar validation rules.
   * - Submission is triggered by the gb-styled edit form (CodesPage colors).
   */
  async function handleUpdate() {
    if (!editingId) return;
    const payload: DetailLevelPayload = {
      code: normalizeDigits(editForm.code.trim()),
      title: editForm.title.trim(),
      parent_id: editForm.parent_id,
      specific_code_id: editForm.parent_id ? null : editForm.specific_code_id || null,
    };

    if (!payload.title || !payload.code) {
      alert(t('validation.requiredFields'));
      return;
    }
    if (!payload.parent_id && !payload.specific_code_id) {
      alert(t('pages.detailLevels.errors.rootRequiresSpecific'));
      return;
    }
    if (!!payload.parent_id && !!payload.specific_code_id) {
      alert(t('pages.detailLevels.errors.nonRootCannotHaveSpecific'));
      return;
    }

    try {
      await axios.patch(`${config.API_ENDPOINTS.base}/v1/detail-levels/${editingId}`, payload, {
        headers: { 'Accept-Language': lang },
      });
      await fetchDetailLevels();
      setEditingId(null);
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message || err?.message;
      if (status === 409) {
        alert(t('pages.detailLevels.errors.codeExists'));
      } else {
        alert(msg || t('errors.unknown'));
      }
    }
  }

  /**
   * Deletes a detail level by ID. Backend prevents deleting nodes with children.
   */
  async function handleDelete(id: string) {
    if (!confirm(t('actions.confirmDelete'))) return;
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/detail-levels/${id}`, {
        headers: { 'Accept-Language': lang },
      });
      await fetchDetailLevels();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message;
      alert(msg || t('errors.unknown'));
    }
  }

  /**
   * Toggles tree node expanded/collapsed state by ID.
   */
  function toggleExpanded(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  /**
   * Renders a hierarchical tree list with actions.
   * Icon colors mirror the coding page scheme:
   * - Create (plus) blue, Edit green, Delete red
   * - Toggle arrow blue when expanded, gray when collapsed
   * - Root row text blue to emphasize top-level items
   * - Row hover reveals add/edit/delete icons; otherwise they remain hidden
   */
  function renderTree(nodes: DetailLevelItem[], depth = 0): React.ReactNode {
    return (
      <List disablePadding>
        {nodes.map((node) => {
          const isExpanded = !!expanded[node.id];
          const hasChildren = !!node.children && node.children.length > 0;
          return (
            <Box key={node.id} sx={{ pl: depth * 2 }}>
              <ListItem
                className="group"
                secondaryAction={
                  <Box className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
                    <Tooltip title={t('actions.createUnder')}>
                      <IconButton size="small" onClick={() => startCreateUnder(node.id)}>
                        <AddCircleOutlineIcon fontSize="small" sx={{ color: '#2563eb' }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('actions.edit')}>
                      <IconButton size="small" onClick={() => startEdit(node)}>
                        <EditIcon fontSize="small" sx={{ color: '#16a34a' }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('actions.delete')}>
                      <IconButton size="small" onClick={() => handleDelete(node.id)}>
                        <DeleteIcon fontSize="small" sx={{ color: '#dc2626' }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                }
              >
                {hasChildren ? (
                  <IconButton size="small" onClick={() => toggleExpanded(node.id)}>
                    {isExpanded ? (
                      <KeyboardArrowDownIcon sx={{ color: '#2563eb' }} />
                    ) : (
                      <ChevronLeftIcon sx={{ color: '#6b7280' }} />
                    )}
                  </IconButton>
                ) : (
                  <Box sx={{ width: 24 }} />
                )}
                <ListItemText
                  primary={`${node.code} — ${node.title}`}
                  primaryTypographyProps={{ sx: { color: !node.parent_id ? '#2563eb' : 'inherit' } }}
                />
              </ListItem>
              {hasChildren && isExpanded && (
                <Box sx={{ pl: 2 }}>{renderTree(node.children!, depth + 1)}</Box>
              )}
            </Box>
          );
        })}
      </List>
    );
  }

  /**
   * Filters tree nodes by code or title containing the query.
   */
  function filterNodes(nodes: DetailLevelItem[], q: string): DetailLevelItem[] {
    if (!q) return nodes;
    const lcq = q.trim().toLowerCase();
    const matches = (n: DetailLevelItem) =>
      (n.code || '').toLowerCase().includes(lcq) || (n.title || '').toLowerCase().includes(lcq);

    const recur = (items: DetailLevelItem[]): DetailLevelItem[] => {
      const out: DetailLevelItem[] = [];
      for (const n of items) {
        const children = n.children ? recur(n.children) : [];
        if (matches(n) || children.length > 0) {
          out.push({ ...n, children });
        }
      }
      return out;
    };
    return recur(nodes);
  }

  const filteredTree = useMemo(() => filterNodes(tree, query), [tree, query]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          {/* Left: Tree and search */}
          <Card>
            <CardContent>
              <Typography variant="h6">{t('pages.detailLevels.treeTitle')}</Typography>
              <TextField
                fullWidth
                size="small"
                sx={{ mt: 1, mb: 2 }}
                placeholder={t('pages.detailLevels.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                }}
              />

              {renderTree(filteredTree)}
            </CardContent>
          </Card>

          {/* Right: Create/Edit form */}
          <Card>
            <CardContent>
              {!editingId ? (
                <>
                  <Typography variant="h6">{t('pages.detailLevels.createTitle')}</Typography>
                  {/* Create form styled like CodesPage: gb-input/select/button with primary/secondary colors */}
                  <div className="bg-gray-50 rounded-lg p-4 gb-card">
                    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">{t('fields.title')}</label>
                          <input
                            type="text"
                            value={createForm.title}
                            onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                            className="gb-input w-full"
                            placeholder={t('fields.title') as string}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">{t('fields.code')}</label>
                          <input
                            type="text"
                            value={createForm.code}
                            onChange={(e) => setCreateForm({ ...createForm, code: normalizeDigits(e.target.value) })}
                            className="gb-input w-full"
                            placeholder={t('fields.code') as string}
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {/* Parent selector shows only when no specific code is chosen */}
                        {!createForm.specific_code_id && (
                          <div>
                            <label className="block text-sm text-gray-600 mb-1">{t('fields.parent')}</label>
                            <select
                              value={createForm.parent_id ?? ''}
                              onChange={(e) => {
                                const v = e.target.value || '';
                                setCreateForm({
                                  ...createForm,
                                  parent_id: v ? v : null,
                                  specific_code_id: v ? null : createForm.specific_code_id,
                                });
                              }}
                              className="gb-select w-full"
                            >
                              <option value="">{t('labels.none')}</option>
                              {flat.map((opt) => (
                                <option key={opt.id} value={opt.id}>{`${opt.code} — ${opt.title}`}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Specific code selector shows only when no parent is chosen; choosing specific hides parent */}
                        {!createForm.parent_id && (
                          <div>
                            <label className="block text-sm text-gray-600 mb-1">{t('fields.specificCode')}</label>
                            <select
                              value={createForm.specific_code_id ?? ''}
                              onChange={(e) => {
                                const v = e.target.value || '';
                                setCreateForm({
                                  ...createForm,
                                  specific_code_id: v ? v : null,
                                  parent_id: v ? null : createForm.parent_id,
                                });
                              }}
                              className="gb-select w-full"
                            >
                              <option value="">{t('labels.none')}</option>
                              {specificCodes.map((c) => (
                                <option key={c.id} value={c.id}>{`${c.code} — ${c.title}`}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="flex pt-2">
                        <button type="submit" className="gb-button gb-button-primary">
                          {t('actions.save')}
                        </button>
                      </div>
                    </form>
                  </div>
                </>
              ) : (
                <>
                  <Typography variant="h6">{t('pages.detailLevels.editTitle')}</Typography>
                  {/* Edit form styled like CodesPage: gb-input/select/button with primary/secondary colors; highlighted amber in edit mode */}
                   <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 gb-card">
                     <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleUpdate(); }}>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">{t('fields.title')}</label>
                          <input
                            type="text"
                            value={editForm.title}
                            onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                            className="gb-input w-full"
                            placeholder={t('fields.title') as string}
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">{t('fields.code')}</label>
                          <input
                            type="text"
                            value={editForm.code}
                            onChange={(e) => setEditForm({ ...editForm, code: normalizeDigits(e.target.value) })}
                            className="gb-input w-full"
                            placeholder={t('fields.code') as string}
                            required
                          />
                        </div>
                      </div>

                      {/* Parent selection (only for non-root items) */}
                      {!!editForm.parent_id && (
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">{t('fields.parent')}</label>
                          <select
                            value={editForm.parent_id ?? ''}
                            onChange={(e) => {
                              const v = e.target.value || '';
                              setEditForm({
                                ...editForm,
                                parent_id: v ? v : null,
                                specific_code_id: v ? null : editForm.specific_code_id,
                              });
                            }}
                            className="gb-select w-full"
                          >
                            <option value="">{t('labels.none')}</option>
                            {flat.map((opt) => (
                              <option key={opt.id} value={opt.id}>{`${opt.code} — ${opt.title}`}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Specific code selection (only for root) */}
                      {!editForm.parent_id && (
                        <div>
                          <label className="block text-sm text-gray-600 mb-1">{t('fields.specificCode')}</label>
                          <select
                            value={editForm.specific_code_id ?? ''}
                            onChange={(e) => {
                              const v = e.target.value || '';
                              setEditForm({ ...editForm, specific_code_id: v ? v : null });
                            }}
                            className="gb-select w-full"
                          >
                            <option value="">{t('labels.none')}</option>
                            {specificCodes.map((c) => (
                              <option key={c.id} value={c.id}>{`${c.code} — ${c.title}`}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex gap-3 pt-2">
                        <button type="submit" className="gb-button gb-button-primary">
                          {t('actions.save')}
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="gb-button gb-button-secondary">
                          {t('actions.cancel')}
                        </button>
                      </div>
                    </form>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </Box>
      </main>
    </div>
  );
};

export default DetailLevelsPage;