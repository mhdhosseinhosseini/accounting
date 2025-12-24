/**
 * HierarchicalCodesReportPage
 * Dynamic financial report showing aggregated Debit/Credit totals in a hierarchical tree:
 * - Level 1: Group codes
 * - Level 2: Main (General) codes
 * - Level 3: Special (Specific) codes
 * Data source: journal items via `/v1/reports/journals-pivot-raw` with robust filters.
 * Features: Expand/collapse tree, running totals per level, search, responsive layout, export (PDF, CSV).
 * فارسی: این گزارش به‌صورت درختی مجموع بدهکار/بستانکار را برای کدهای گروه، کل و معین نشان می‌دهد.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import { getCurrentLang } from '../i18n';
import config from '../config';
import * as XLSX from 'xlsx';
import moment from 'moment-jalaali';
import JalaliDateRangePicker from '../components/common/JalaliDateRangePicker';
import MultiSelect, { MultiSelectOption } from '../components/common/MultiSelect';
import NumericInput from '../components/common/NumericInput';
import { Download, FileDown, Search, ChevronRight, ChevronDown, ChevronLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { FormControl, InputLabel, Select as MuiSelect, MenuItem } from '@mui/material';

/**
 * CodeRecord
 * Code entity fetched from `/v1/codes` to build hierarchy relationships and display titles.
 */
interface CodeRecord {
  id: string;
  code: string;
  title: string;
  kind: 'group' | 'general' | 'specific';
  parent_id: string | null;
}

/**
 * JournalPivotRawItem
 * Minimal shape of raw items returned from backend `/v1/reports/journals-pivot-raw`.
 */
interface JournalPivotRawItem {
  debit: number;
  credit: number;
  date: string;
  journal_code: number | null;
  account_code: string | null;
  detail_code: string | null;
}

/**
 * TreeNode
 * Represents a node in the hierarchical tree with running totals and children.
 */
interface TreeNode {
  code: string;
  title: string;
  debit: number;
  credit: number;
  children?: TreeNode[];
}

interface TableRow {
  group?: TreeNode | null;
  main?: TreeNode | null;
  special?: TreeNode | null;
  detail?: TreeNode | null;
  debit: number;
  credit: number;
  beforeDebit?: number;
  beforeCredit?: number;
}

/**
 * toAsciiDigits
 * Normalizes Persian/Arabic-Indic digits to ASCII digits to ensure consistent lookups.
 * فارسی: تبدیل ارقام فارسی/عربی به انگلیسی برای سازگاری در جستجو و نگاشت‌ها.
 */
function toAsciiDigits(str: string): string {
  return Array.from(String(str || ''))
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0x0660 && code <= 0x0669) return String.fromCharCode(48 + (code - 0x0660));
      if (code >= 0x06f0 && code <= 0x06f9) return String.fromCharCode(48 + (code - 0x06f0));
      return ch;
    })
    .join('');
}

/**
 * normalizeCode
 * Slices an account code to the configured digit length for the target hierarchy level.
 */
function normalizeCode(accountCode: string | number | null | undefined, digits: number): string {
  const raw = String(accountCode ?? '').trim();
  if (!raw) return '';
  return toAsciiDigits(raw.slice(0, digits));
}

/**
 * groupCodeOf
 * Returns group-level code using configured digits (`config.CODE_DIGITS.group`).
 */
function groupCodeOf(accountCode: string | number | null | undefined): string {
  const digits = (config.CODE_DIGITS?.group as number) || 2;
  return normalizeCode(accountCode, digits);
}

/**
 * generalCodeOf
 * Returns general-level code using configured digits (`config.CODE_DIGITS.general`).
 */
function generalCodeOf(accountCode: string | number | null | undefined): string {
  const digits = (config.CODE_DIGITS?.general as number) || 4;
  return normalizeCode(accountCode, digits);
}

/**
 * specificCodeOf
 * Returns specific-level code using configured digits (`config.CODE_DIGITS.specific`).
 */
function specificCodeOf(accountCode: string | number | null | undefined): string {
  const digits = (config.CODE_DIGITS?.specific as number) || 6;
  return normalizeCode(accountCode, digits);
}

/**
 * HierarchicalCodesReportPage
 * Builds interactive tree with filters and exports. Auto-refreshes on filter change.
 */
const HierarchicalCodesReportPage: React.FC = () => {
  const { t } = useTranslation();
  const lang = getCurrentLang();
  const rtl = lang === 'fa';

  // Fiscal year selection and date range
  const [fiscalYears, setFiscalYears] = useState<Array<{ id: string | number; name?: string; start_date?: string; end_date?: string; is_closed?: boolean }>>([]);
  const [fyId, setFyId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);

  // Document number filtering (journal_code)
  const [docFrom, setDocFrom] = useState<number | null>(null);
  const [docTo, setDocTo] = useState<number | null>(null);

  // Code filters
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [generalFilter, setGeneralFilter] = useState<string[]>([]);
  const [specificFilter, setSpecificFilter] = useState<string[]>([]);

  // Search within the report (code/title)
  const [searchText, setSearchText] = useState<string>('');

  // Titles and hierarchy relationships
  const [groupTitles, setGroupTitles] = useState<Record<string, string>>({});
  const [generalTitles, setGeneralTitles] = useState<Record<string, string>>({});
  const [specificTitles, setSpecificTitles] = useState<Record<string, string>>({});
  const [groupToGenerals, setGroupToGenerals] = useState<Record<string, string[]>>({});
  const [generalToSpecifics, setGeneralToSpecifics] = useState<Record<string, string[]>>({});
  const [detailTitles, setDetailTitles] = useState<Record<string, string>>({});

  // Raw items and computed tree
  const [rawItems, setRawItems] = useState<JournalPivotRawItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Expand/collapse state
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedGenerals, setExpandedGenerals] = useState<Record<string, boolean>>({});

  // Column-view selection state
  const [selectedGroupCode, setSelectedGroupCode] = useState<string | null>(null);
  const [selectedGeneralCode, setSelectedGeneralCode] = useState<string | null>(null);
  const [selectedSpecificCode, setSelectedSpecificCode] = useState<string | null>(null);

  // View mode and header expansion for table view
  const [viewMode, setViewMode] = useState<'table' | 'column'>('table');
  const [headerExpandGroup, setHeaderExpandGroup] = useState<boolean>(false);
  const [headerExpandMain, setHeaderExpandMain] = useState<boolean>(false);
  const [headerExpandDetail, setHeaderExpandDetail] = useState<boolean>(false);
  const [detailFilter, setDetailFilter] = useState<string[]>([]);
  const [amountColumnsMode, setAmountColumnsMode] = useState<'two' | 'four' | 'six'>('four');
  const [beforeItems, setBeforeItems] = useState<JournalPivotRawItem[]>([]);

  // Simple in-memory cache for recent queries by signature
  const cacheRef = useRef<Map<string, JournalPivotRawItem[]>>(new Map());

  /**
   * selectDefaultFiscalYear
   * Prefers open year; otherwise latest by end_date.
   */
  function selectDefaultFiscalYear(list: Array<{ id: string | number; is_closed?: boolean; end_date?: string }>): string | null {
    const openFy = list.find((fy) => !fy.is_closed);
    if (openFy) return String(openFy.id);
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => String(a.end_date || '').localeCompare(String(b.end_date || '')));
    return String(sorted.slice(-1)[0].id);
  }

  /**
   * formatDateYmd
   * Converts a Date to `YYYY-MM-DD` for API queries.
   */
  function formatDateYmd(d: Date): string {
    const y = String(d.getFullYear()).padStart(4, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * fetchFiscalYears
   * Loads FYs and initializes default selection and date range.
   */
  async function fetchFiscalYears(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/fiscal-years`, { headers: { 'Accept-Language': lang } });
      const list = (res.data?.items || res.data || []) as Array<{ id: string | number; name?: string; start_date?: string; end_date?: string; is_closed?: boolean }>;
      setFiscalYears(list);
      const def = selectDefaultFiscalYear(list);
      setFyId(def);
      const fy = def ? list.find((f) => String(f.id) === String(def)) : undefined;
      if (fy?.start_date) setDateFrom(new Date(fy.start_date));
      if (fy?.end_date) setDateTo(new Date(fy.end_date));
    } catch {
      // Non-blocking
    }
  }
  /**
   * buildHierarchyMaps
   * Fetches all codes and builds:
   * - Titles maps for group/general/specific (normalized by configured digits)
   * - Relationship maps: group→generals, general→specifics
   */
  async function buildHierarchyMaps(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/codes`, { headers: { 'Accept-Language': lang } });
      const records: CodeRecord[] = (res.data?.items || res.data?.data || []) as CodeRecord[];
      const groups = records.filter((r) => String(r.kind) === 'group');
      const generals = records.filter((r) => String(r.kind) === 'general');
      const specifics = records.filter((r) => String(r.kind) === 'specific');
      const gTitles: Record<string, string> = {};
      for (const g of groups) gTitles[groupCodeOf(g.code)] = String(g.title || '');
      const mTitles: Record<string, string> = {};
      for (const m of generals) mTitles[generalCodeOf(m.code)] = String(m.title || '');
      const sTitles: Record<string, string> = {};
      for (const s of specifics) sTitles[specificCodeOf(s.code)] = String(s.title || '');
      setGroupTitles(gTitles);
      setGeneralTitles(mTitles);
      setSpecificTitles(sTitles);
      // Relationships
      const g2m: Record<string, string[]> = {};
      for (const m of generals) {
        const gCode = groupCodeOf(m.code);
        const mCode = generalCodeOf(m.code);
        if (!g2m[gCode]) g2m[gCode] = [];
        if (!g2m[gCode].includes(mCode)) g2m[gCode].push(mCode);
      }
      const m2s: Record<string, string[]> = {};
      for (const s of specifics) {
        // Find parent general from code slice
        const mCode = generalCodeOf(s.code);
        const sCode = specificCodeOf(s.code);
        if (!m2s[mCode]) m2s[mCode] = [];
        if (!m2s[mCode].includes(sCode)) m2s[mCode].push(sCode);
      }
      // Sort codes for stable UI
      Object.keys(g2m).forEach((g) => g2m[g].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
      Object.keys(m2s).forEach((m) => m2s[m].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
      setGroupToGenerals(g2m);
      setGeneralToSpecifics(m2s);
    } catch {
      setGroupTitles({});
      setGeneralTitles({});
      setSpecificTitles({});
      setGroupToGenerals({});
      setGeneralToSpecifics({});
    }
  }

  /**
   * buildDetailTitles
   * Fetches all details to build a title map for filters.
   */
  async function buildDetailTitles(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/details`, { headers: { 'Accept-Language': lang } });
      const list = (res.data?.items || res.data?.data || res.data || []) as Array<{ code?: string; title?: string }>;
      const map: Record<string, string> = {};
      for (const d of list) {
        const code = toAsciiDigits(String(d.code || '').trim());
        if (code) map[code] = String(d.title || '');
      }
      setDetailTitles(map);
    } catch {
      setDetailTitles({});
    }
  }

  /**
   * buildQuerySignature
   * Returns a stable string signature for current filters to use in cache keying.
   */
  function buildQuerySignature(): string {
    const parts = [
      `fy=${fyId ?? ''}`,
      `from=${dateFrom ? formatDateYmd(dateFrom) : ''}`,
      `to=${dateTo ? formatDateYmd(dateTo) : ''}`,
      `jfrom=${docFrom ?? ''}`,
      `jto=${docTo ?? ''}`,
      `gf=${groupFilter.slice().sort().join(',')}`,
      `mf=${generalFilter.slice().sort().join(',')}`,
      `sf=${specificFilter.slice().sort().join(',')}`,
      `df=${detailFilter.slice().sort().join(',')}`,
    ];
    return parts.join('|');
  }

  /**
   * fetchRawItems
   * Calls `/v1/reports/journals-pivot-raw` with active filters and caches the results.
   */
  async function fetchRawItems(): Promise<void> {
    if (!fyId || !dateFrom || !dateTo) return;
    setLoading(true);
    setError('');
    try {
      const sig = buildQuerySignature();
      const cached = cacheRef.current.get(sig);
      if (cached) {
        setRawItems(cached);
        return;
      }
      const params: Record<string, any> = { fiscal_year_id: fyId, start_date: formatDateYmd(dateFrom), end_date: formatDateYmd(dateTo), status: 'all', row_dim: 'date', col_dim: 'status' };
      if (docFrom != null) params.journal_code_from = docFrom;
      if (docTo != null) params.journal_code_to = docTo;
      // Code range filters: when specific filters provided, narrow account_code range around selection
      // To support combination filters, we keep server filters minimal and apply precise OR/AND client-side.
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/reports/journals-pivot-raw`, { params, headers: { 'Accept-Language': lang } });
      const items = (res.data?.items || []) as JournalPivotRawItem[];
      // Client-side precise filtering by any code level (groups OR generals OR specifics), AND across dimensions
      const gSet = new Set(groupFilter.map((c) => toAsciiDigits(c)));
      const mSet = new Set(generalFilter.map((c) => toAsciiDigits(c)));
      const sSet = new Set(specificFilter.map((c) => toAsciiDigits(c)));
      const dSet = new Set(detailFilter.map((c) => toAsciiDigits(c)));
      const anyActive = gSet.size || mSet.size || sSet.size || dSet.size;
      const filtered = anyActive
        ? items.filter((it) => {
            const acc = String(it.account_code || '');
            const g = groupCodeOf(acc);
            const m = generalCodeOf(acc);
            const s = specificCodeOf(acc);
            const d = toAsciiDigits(String(it.detail_code || ''));
            if (gSet.size && !gSet.has(g)) return false;
            if (mSet.size && !mSet.has(m)) return false;
            if (sSet.size && !sSet.has(s)) return false;
            if (dSet.size && !dSet.has(d)) return false;
            return true;
          })
        : items;
      cacheRef.current.set(sig, filtered);
      setRawItems(filtered);
    } catch {
      setError(t('fetch.error', 'Failed to fetch data'));
      setRawItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchBeforeItems(): Promise<void> {
    if (!fyId || !dateFrom) { setBeforeItems([]); return; }
    try {
      const fy = fiscalYears.find((f) => String(f.id) === String(fyId));
      const start = fy?.start_date ? new Date(fy.start_date) : null;
      if (!start) { setBeforeItems([]); return; }
      const prev = new Date(dateFrom.getTime() - 24 * 60 * 60 * 1000);
      const params: Record<string, any> = { fiscal_year_id: fyId, start_date: formatDateYmd(start), end_date: formatDateYmd(prev), status: 'all', row_dim: 'date', col_dim: 'status' };
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/reports/journals-pivot-raw`, { params, headers: { 'Accept-Language': lang } });
      const items = (res.data?.items || []) as JournalPivotRawItem[];
      const gSet = new Set(groupFilter.map((c) => toAsciiDigits(c)));
      const mSet = new Set(generalFilter.map((c) => toAsciiDigits(c)));
      const sSet = new Set(specificFilter.map((c) => toAsciiDigits(c)));
      const dSet = new Set(detailFilter.map((c) => toAsciiDigits(c)));
      const anyActive = gSet.size || mSet.size || sSet.size || dSet.size;
      const filtered = anyActive
        ? items.filter((it) => {
            const acc = String(it.account_code || '');
            const g = groupCodeOf(acc);
            const m = generalCodeOf(acc);
            const s = specificCodeOf(acc);
            const d = toAsciiDigits(String(it.detail_code || ''));
            if (gSet.size && !gSet.has(g)) return false;
            if (mSet.size && !mSet.has(m)) return false;
            if (sSet.size && !sSet.has(s)) return false;
            if (dSet.size && !dSet.has(d)) return false;
            return true;
          })
        : items;
      setBeforeItems(filtered);
    } catch {
      setBeforeItems([]);
    }
  }

  /**
   * aggregateTotals
   * Sums Debit/Credit values for a set of items keyed by a selector function.
   */
  function aggregateTotals(items: JournalPivotRawItem[], keyFn: (it: JournalPivotRawItem) => string): Record<string, { debit: number; credit: number }> {
    const map: Record<string, { debit: number; credit: number }> = {};
    for (const it of items || []) {
      const key = keyFn(it);
      if (!key) continue;
      const d = Number(it.debit || 0);
      const c = Number(it.credit || 0);
      const entry = map[key] || { debit: 0, credit: 0 };
      entry.debit += d;
      entry.credit += c;
      map[key] = entry;
    }
    return map;
  }
  function aggregateTotalsBySpecificDetail(items: JournalPivotRawItem[]): Record<string, { debit: number; credit: number }> {
    const map: Record<string, { debit: number; credit: number }> = {};
    for (const it of items || []) {
      const s = specificCodeOf(it.account_code);
      const dCode = toAsciiDigits(String(it.detail_code || '').trim());
      if (!s || !dCode) continue;
      const key = `${s}|${dCode}`;
      const d = Number(it.debit || 0);
      const c = Number(it.credit || 0);
      const entry = map[key] || { debit: 0, credit: 0 };
      entry.debit += d;
      entry.credit += c;
      map[key] = entry;
    }
    return map;
  }

  /**
   * buildTree
   * Constructs the hierarchical tree with running totals using current raw items and relationships.
   */
  const treeData: TreeNode[] = useMemo(() => {
    const byGroup = aggregateTotals(rawItems, (it) => groupCodeOf(it.account_code));
    const byGeneral = aggregateTotals(rawItems, (it) => generalCodeOf(it.account_code));
    const bySpecific = aggregateTotals(rawItems, (it) => specificCodeOf(it.account_code));
    const bySpecDetail = aggregateTotalsBySpecificDetail(rawItems);
    const specificToDetails: Record<string, string[]> = {};
    for (const it of rawItems || []) {
      const s = specificCodeOf(it.account_code);
      const dCode = toAsciiDigits(String(it.detail_code || '').trim());
      if (!s || !dCode) continue;
      if (!specificToDetails[s]) specificToDetails[s] = [];
      if (!specificToDetails[s].includes(dCode)) specificToDetails[s].push(dCode);
    }
    const groupCodes = Object.keys(byGroup).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const nodes: TreeNode[] = [];
    for (const gCode of groupCodes) {
      const gNode: TreeNode = {
        code: gCode,
        title: groupTitles[gCode] || t('pages.reports.tabs.group', 'Group'),
        debit: byGroup[gCode]?.debit || 0,
        credit: byGroup[gCode]?.credit || 0,
        children: [],
      };
      const generals = (groupToGenerals[gCode] || []).filter((m) => byGeneral[m] != null);
      for (const mCode of generals) {
        const mNode: TreeNode = {
          code: mCode,
          title: generalTitles[mCode] || t('pages.reports.tabs.general', 'Main'),
          debit: byGeneral[mCode]?.debit || 0,
          credit: byGeneral[mCode]?.credit || 0,
          children: [],
        };
        const specifics = (generalToSpecifics[mCode] || []).filter((s) => bySpecific[s] != null);
        for (const sCode of specifics) {
          const sNode: TreeNode = {
            code: sCode,
            title: specificTitles[sCode] || t('pages.reports.tabs.specific', 'Special'),
            debit: bySpecific[sCode]?.debit || 0,
            credit: bySpecific[sCode]?.credit || 0,
            children: [],
          };
          const dList = (specificToDetails[sCode] || []).filter((d) => bySpecDetail[`${sCode}|${d}`] != null);
          for (const dCode of dList) {
            const key = `${sCode}|${dCode}`;
            const dt = bySpecDetail[key] || { debit: 0, credit: 0 };
            const dNode: TreeNode = {
              code: dCode,
              title: detailTitles[dCode] || t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail'),
              debit: dt.debit,
              credit: dt.credit,
            };
            sNode.children!.push(dNode);
          }
          mNode.children!.push(sNode);
        }
        gNode.children!.push(mNode);
      }
      nodes.push(gNode);
    }
    // Search filter by code/title
    const q = searchText.trim().toLowerCase();
    if (!q) return nodes;
    const matchesNode = (n: TreeNode): boolean => n.code.toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q);
    const filtered: TreeNode[] = [];
    for (const n of nodes) {
      const gMatch = matchesNode(n);
      const mChildren = (n.children || []).map((m) => {
        const sChildren = (m.children || []).map((s) => {
          const dChildren = (s.children || []).map((d) => ({ node: d, match: matchesNode(d) }));
          return { node: s, match: matchesNode(s), dChildren };
        });
        return { node: m, match: matchesNode(m), sChildren };
      });
      const anyChildMatch = mChildren.some((mc) => mc.match || mc.sChildren.some((sc) => sc.match || sc.dChildren.some((dc) => dc.match)));
      if (gMatch || anyChildMatch) {
        const gCopy: TreeNode = { ...n, children: [] };
        for (const mc of mChildren) {
          if (mc.match || mc.sChildren.some((sc) => sc.match || sc.dChildren.some((dc) => dc.match))) {
            const mCopy: TreeNode = { ...mc.node, children: [] };
            for (const sc of mc.sChildren) {
              if (sc.match || sc.dChildren.some((dc) => dc.match)) {
                const sCopy: TreeNode = { ...sc.node, children: [] };
                for (const dc of sc.dChildren) {
                  if (dc.match) sCopy.children!.push(dc.node);
                }
                mCopy.children!.push(sCopy);
              }
            }
            gCopy.children!.push(mCopy);
          }
        }
        filtered.push(gCopy);
      }
    }
    return filtered;
  }, [rawItems, groupTitles, generalTitles, specificTitles, detailTitles, groupToGenerals, generalToSpecifics, searchText, t, rtl]);

  /**
   * toggleGroupExpand
   * Expands/collapses a group node.
   */
  function toggleGroupExpand(code: string): void {
    setExpandedGroups((prev) => ({ ...prev, [code]: !prev[code] }));
  }

  /**
   * toggleGeneralExpand
   * Expands/collapses a general (main) node.
   */
  function toggleGeneralExpand(code: string): void {
    setExpandedGenerals((prev) => ({ ...prev, [code]: !prev[code] }));
  }

  /**
   * buildGroupOptions
   * Creates multi-select options for group/general/specific filters based on titles maps.
   */
  const groupOptions: MultiSelectOption[] = useMemo(
    () => Object.keys(groupTitles).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((code) => ({ value: code, label: `${code} — ${groupTitles[code]}` })),
    [groupTitles]
  );
  const generalOptions: MultiSelectOption[] = useMemo(
    () => Object.keys(generalTitles).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((code) => ({ value: code, label: `${code} — ${generalTitles[code]}` })),
    [generalTitles]
  );
  const specificOptions: MultiSelectOption[] = useMemo(
    () => Object.keys(specificTitles).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((code) => ({ value: code, label: `${code} — ${specificTitles[code]}` })),
    [specificTitles]
  );

  /**
   * downloadCsv
   * Mirrors the current TABLE VIEW expansion state and exports visible rows.
   */
  function downloadCsv(): void {
    const includeMain = headerExpandGroup;
    const includeSpecial = headerExpandMain;
    const includeDetail = headerExpandDetail;
    const includeFour = amountColumnsMode === 'four';
    const includeSix = amountColumnsMode === 'six';
    const headerCols: string[] = [
      t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group'),
      ...(includeMain ? [t('pages.reports.tabs.general', rtl ? 'کل' : 'Main')] : []),
      ...(includeSpecial ? [t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special')] : []),
      ...(includeDetail ? [t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail')] : []),
      ...(includeSix ? [t('pages.reports.table.beforeDebit', rtl ? 'گردش قبل از دوره بدهکار' : 'Before Debit')] : []),
      ...(includeSix ? [t('pages.reports.table.beforeCredit', rtl ? 'گردش قبل از دوره بستانکار' : 'Before Credit')] : []),
      t('pages.reports.table.debit', rtl ? 'بدهکار' : 'Debit'),
      t('pages.reports.table.credit', rtl ? 'بستانکار' : 'Credit'),
      ...(includeFour || includeSix ? [t('pages.reports.table.remainDebit', rtl ? 'مانده بدهکار' : 'Remain Debit')] : []),
      ...(includeFour || includeSix ? [t('pages.reports.table.remainCredit', rtl ? 'مانده بستانکار' : 'Remain Credit')] : []),
    ];
    const aoa: (string | number)[][] = [];
    aoa.push(headerCols);
    for (const r of tableRows) {
      const groupCell = r.group ? `${r.group.code} — ${r.group.title}` : '';
      const mainCell = includeMain ? (r.main ? `${r.main.code} — ${r.main.title}` : '') : undefined;
      const specialCell = includeSpecial ? (r.special ? `${r.special.code} — ${r.special.title}` : '') : undefined;
      const detailCell = includeDetail ? (r.detail ? `${r.detail.code} — ${r.detail.title}` : '') : undefined;
      const totalD = (r.beforeDebit || 0) + (r.debit || 0);
      const totalC = (r.beforeCredit || 0) + (r.credit || 0);
      const row = [
        groupCell,
        ...(includeMain ? [String(mainCell ?? '')] : []),
        ...(includeSpecial ? [String(specialCell ?? '')] : []),
        ...(includeDetail ? [String(detailCell ?? '')] : []),
        ...(includeSix ? [formatCurrency(r.beforeDebit || 0)] : []),
        ...(includeSix ? [formatCurrency(r.beforeCredit || 0)] : []),
        formatCurrency(r.debit || 0),
        formatCurrency(r.credit || 0),
        ...(includeFour || includeSix ? [formatCurrency(Math.max(0, totalD - totalC))] : []),
        ...(includeFour || includeSix ? [formatCurrency(Math.max(0, totalC - totalD))] : []),
      ];
      aoa.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const amountStartIndex = 1 + (includeMain ? 1 : 0) + (includeSpecial ? 1 : 0) + (includeDetail ? 1 : 0);
    const amountColsCount = (includeSix ? 2 : 0) + 2 + ((includeFour || includeSix) ? 2 : 0);
    ws['!cols'] = [
      ...Array(amountStartIndex).fill({ wch: 28 }),
      ...Array(amountColsCount).fill({ wch: 14 }),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, rtl ? 'گزارش تراز' : 'Balance Report');
    if (rtl) {
      (wb as any).Workbook = { Views: [{ RTL: true }] };
      (ws as any)['!rtl'] = true;
      (ws as any)['!sheetViews'] = [{ rightToLeft: 1 }];
    }
    XLSX.writeFile(wb, `hierarchical_table_${Date.now()}.xlsx`);
  }

  /**
   * openPrintView
   * Mirrors the current TABLE VIEW expansion state and prints the same columns/rows.
   */
  function openPrintView(): void {
    const title = t('pages.reports.balance.title', rtl ? 'گزارش تراز' : 'Balance Report');
    const rtlDir = rtl ? 'rtl' : 'ltr';
    const langAttr = rtl ? 'fa' : 'en';
    const headerRange = `${t('pages.reports.filters', rtl ? 'فیلترها' : 'Filters')}: ${dateFrom ? formatDateJalali(dateFrom) : ''} ${rtl ? 'تا' : 'to'} ${dateTo ? formatDateJalali(dateTo) : ''}`;
    const includeMain = headerExpandGroup;
    const includeSpecial = headerExpandMain;
    const includeDetail = headerExpandDetail;
    const includeTwo = amountColumnsMode === 'two';
    const includeFour = amountColumnsMode === 'four';
    const includeSix = amountColumnsMode === 'six';
    const filteredRows = tableRows.filter((r) => !r.main && !r.special && !r.detail);
    const beforeDebitTotal = includeSix ? filteredRows.reduce((acc, r) => acc + (r.beforeDebit || 0), 0) : 0;
    const beforeCreditTotal = includeSix ? filteredRows.reduce((acc, r) => acc + (r.beforeCredit || 0), 0) : 0;
    const debitTotal = filteredRows.reduce((acc, r) => acc + (r.debit || 0), 0);
    const creditTotal = filteredRows.reduce((acc, r) => acc + (r.credit || 0), 0);
    const remainDebitTotal = (includeFour || includeSix)
      ? filteredRows.reduce((acc, r) => {
          const totalD = (r.beforeDebit || 0) + (r.debit || 0);
          const totalC = (r.beforeCredit || 0) + (r.credit || 0);
          return acc + Math.max(0, totalD - totalC);
        }, 0)
      : 0;
    const remainCreditTotal = (includeFour || includeSix)
      ? filteredRows.reduce((acc, r) => {
          const totalD = (r.beforeDebit || 0) + (r.debit || 0);
          const totalC = (r.beforeCredit || 0) + (r.credit || 0);
          return acc + Math.max(0, totalC - totalD);
        }, 0)
      : 0;
    const ths = [
      t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group'),
      ...(includeMain ? [t('pages.reports.tabs.general', rtl ? 'کل' : 'Main')] : []),
      ...(includeSpecial ? [t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special')] : []),
      ...(includeDetail ? [t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail')] : []),
      ...(includeSix ? [t('pages.reports.table.beforeDebit', rtl ? 'گردش قبل از دروه بدهکار' : 'Before Debit')] : []),
      ...(includeSix ? [t('pages.reports.table.beforeCredit', rtl ? 'گردش قبل از دوره بستانکار' : 'Before Credit')] : []),
      t('pages.reports.table.debit', rtl ? 'بدهکار' : 'Debit'),
      t('pages.reports.table.credit', rtl ? 'بستانکار' : 'Credit'),
      ...(includeFour || includeSix ? [t('pages.reports.table.remainDebit', rtl ? 'مانده بدهکار' : 'Remain Debit')] : []),
      ...(includeFour || includeSix ? [t('pages.reports.table.remainCredit', rtl ? 'مانده بستانکار' : 'Remain Credit')] : []),
    ];
    const bodyRows = tableRows.map((r) => {
      const groupCell = r.group ? `${r.group.code} — ${r.group.title}` : '';
      const mainCell = includeMain ? (r.main ? `${r.main.code} — ${r.main.title}` : '') : undefined;
      const specialCell = includeSpecial ? (r.special ? `${r.special.code} — ${r.special.title}` : '') : undefined;
      const detailCell = includeDetail ? (r.detail ? `${r.detail.code} — ${r.detail.title}` : '') : undefined;
      const baseCells = [
        `<td class="lvl-group">${groupCell}</td>`,
        ...(includeMain ? [`<td class="lvl-main">${String(mainCell ?? '')}</td>`] : []),
        ...(includeSpecial ? [`<td class="lvl-special">${String(specialCell ?? '')}</td>`] : []),
        ...(includeDetail ? [`<td class="lvl-detail">${String(detailCell ?? '')}</td>`] : []),
        ...(includeSix ? [`<td class="amount">${formatCurrency(r.beforeDebit || 0)}</td>`] : []),
        ...(includeSix ? [`<td class="amount">${formatCurrency(r.beforeCredit || 0)}</td>`] : []),
        `<td class="amount">${formatCurrency(r.debit || 0)}</td>`,
        `<td class="amount">${formatCurrency(r.credit || 0)}</td>`,
      ];
      const totalD = (r.beforeDebit || 0) + (r.debit || 0);
      const totalC = (r.beforeCredit || 0) + (r.credit || 0);
      const remainCells = (includeFour || includeSix)
        ? [
            `<td class="amount remain-debit">${formatCurrency(Math.max(0, totalD - totalC))}</td>`,
            `<td class="amount remain-credit">${formatCurrency(Math.max(0, totalC - totalD))}</td>`,
          ]
        : [];
      return [...baseCells, ...remainCells].join('');
    }).join('\n');
    const tfoot = `
      <tfoot>
        <tr>
          <td>${t('pages.reports.table.total', rtl ? 'جمع' : 'Total')}</td>
          ${includeMain ? '<td></td>' : ''}
          ${includeSpecial ? '<td></td>' : ''}
          ${includeDetail ? '<td></td>' : ''}
          ${includeSix ? `<td class="amount">${formatCurrency(beforeDebitTotal)}</td>` : ''}
          ${includeSix ? `<td class="amount">${formatCurrency(beforeCreditTotal)}</td>` : ''}
          <td class="amount">${formatCurrency(debitTotal)}</td>
          <td class="amount">${formatCurrency(creditTotal)}</td>
          ${(includeFour || includeSix) ? `<td class="amount remain-debit">${formatCurrency(remainDebitTotal)}</td>` : ''}
          ${(includeFour || includeSix) ? `<td class="amount remain-credit">${formatCurrency(remainCreditTotal)}</td>` : ''}
        </tr>
      </tfoot>
    `;
    const html = `<!doctype html>
<html lang="${langAttr}" dir="${rtlDir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
${rtl ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700&display=swap" />' : ''}
<style>
  body { font-family: ${rtl ? "'Vazirmatn', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" : "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"}; color: #0f172a; background: #ffffff; margin: 6mm; }
  h1 { margin: 0 0 8px; text-align: center; }
  .muted { color: #475569; text-align: center; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 13px; }
  th { background: #f1f5f9; text-align: ${rtl ? 'right' : 'left'}; }
  td { text-align: ${rtl ? 'right' : 'left'}; }
  .amount { text-align: ${rtl ? 'left' : 'right'}; font-variant-numeric: tabular-nums; background: #f8fafc; }
  .remain-debit { background: #ecfdf5; }
  .remain-credit { background: #fee2e2; }
  .lvl-main { ${rtl ? 'padding-right' : 'padding-left'}: 16px; }
  .lvl-special { ${rtl ? 'padding-right' : 'padding-left'}: 32px; }
  @page { size: A4 landscape; margin: 10mm 6mm; }
  tfoot tr { background: #f8fafc; font-weight: 600; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <div class="muted">${headerRange}</div>
  <table>
    <thead>
      <tr>${ths.map((h) => `<th>${h}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${bodyRows.split('\n').map((cells) => `<tr>${cells}</tr>`).join('\n')}
    </tbody>
    ${tfoot}
  </table>
  <script>
    window.focus();
    window.addEventListener('load', function () { setTimeout(function () { try { window.print(); } catch (e) {} }, 200); });
  </script>
</body>
</html>`;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.open('text/html');
    win.document.write(html);
    win.document.close();
  }

  /**
   * useEffect initial loads: fiscal years and hierarchy maps.
   */
  useEffect(() => { fetchFiscalYears(); }, []);
  useEffect(() => { buildHierarchyMaps(); buildDetailTitles(); }, []);

  /**
   * Auto-refresh raw items when filters change.
   */
  useEffect(() => {
    if (fyId && dateFrom && dateTo) {
      fetchRawItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyId, dateFrom, dateTo, docFrom, docTo, groupFilter, generalFilter, specificFilter, detailFilter]);

  useEffect(() => {
    if (fyId && dateFrom) {
      fetchBeforeItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyId, dateFrom, groupFilter, generalFilter, specificFilter, detailFilter]);

  /**
   * formatCurrency
   * Locale-aware formatting for numbers; uses Persian digits when language is Farsi.
   */
  function formatCurrency(n: number): string {
    try {
      const fmt = new Intl.NumberFormat(rtl ? 'fa-IR' : 'en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
      return fmt.format(Math.round(n || 0));
    } catch {
      return String(Math.round(n || 0));
    }
  }

  /**
   * formatDateJalali
   * Formats a Date to Jalali YYYY/MM/DD with localized digits for Farsi; otherwise Gregorian.
   */
  function formatDateJalali(d: Date): string {
    const m = moment(d);
    if (rtl) {
      const j = m.format('jYYYY/jMM/jDD');
      const map: Record<string, string> = { '0':'۰','1':'۱','2':'۲','3':'۳','4':'۴','5':'۵','6':'۶','7':'۷','8':'۸','9':'۹' };
      return j.replace(/[0-9]/g, (ch: string) => map[ch] || ch);
    }
    return formatDateYmd(d);
  }

  /**
   * renderNode
   * Renders a single tree node row with expand/collapse controls and debit/credit styling.
   */
  function renderNode(node: TreeNode, level: number): React.ReactNode {
    const isGroup = level === 0;
    const isGeneral = level === 1;
    const expanded = isGroup ? !!expandedGroups[node.code] : isGeneral ? !!expandedGenerals[node.code] : false;
    const hasChildren = (node.children || []).length > 0;
    const toggle = () => (isGroup ? toggleGroupExpand(node.code) : isGeneral ? toggleGeneralExpand(node.code) : undefined);
    return (
      <div key={`${level}-${node.code}`} className={`border-b border-gray-200 py-2 ${level === 0 ? 'bg-gray-50' : ''}`}>
        <button type="button" onClick={hasChildren ? toggle : undefined} className="w-full">
          <div className="flex items-center gap-2">
            {hasChildren ? (
              expanded ? <ChevronDown className="h-4 w-4 text-blue-700" /> : <ChevronRight className="h-4 w-4 text-blue-700" />
            ) : (
              <span className="inline-block w-4 h-4" />
            )}
            <span className={`font-medium ${level === 0 ? 'text-lg' : level === 1 ? 'text-base' : 'text-sm'}`}>
              {node.code} — {node.title}
            </span>
            <span className="ml-auto rtl:mr-auto rtl:ml-0 inline-flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-1 rounded bg-green-50 text-green-700">{t('pages.reports.table.debit', rtl ? 'بدهکار' : 'Debit')}: {formatCurrency(node.debit)}</span>
              <span className="inline-flex items-center px-2 py-1 rounded bg-red-50 text-red-700">{t('pages.reports.table.credit', rtl ? 'بستانکار' : 'Credit')}: {formatCurrency(node.credit)}</span>
            </span>
          </div>
        </button>
        {expanded && hasChildren && (
          <div className="pl-4 rtl:pr-4 mt-2">
            {(node.children || []).map((ch) => renderNode(ch, level + 1))}
          </div>
        )}
      </div>
    );
  }

  /**
   * totalsSummary
   * Computes grand totals across the tree for quick verification.
   */
  const totalsSummary = useMemo(() => {
    let d = 0, c = 0;
    for (const g of treeData) {
      d += g.debit;
      c += g.credit;
    }
    return { debit: d, credit: c };
  }, [treeData]);

  const beforeByGroup = useMemo(() => aggregateTotals(beforeItems, (it) => groupCodeOf(it.account_code)), [beforeItems]);
  const beforeByGeneral = useMemo(() => aggregateTotals(beforeItems, (it) => generalCodeOf(it.account_code)), [beforeItems]);
  const beforeBySpecific = useMemo(() => aggregateTotals(beforeItems, (it) => specificCodeOf(it.account_code)), [beforeItems]);
  const beforeBySpecificDetail = useMemo(() => aggregateTotalsBySpecificDetail(beforeItems), [beforeItems]);

  const tableRows: TableRow[] = useMemo(() => {
    const rows: TableRow[] = [];
    for (const g of treeData) {
      rows.push({
        group: g,
        main: null,
        special: null,
        detail: null,
        debit: g.debit,
        credit: g.credit,
        beforeDebit: beforeByGroup[g.code]?.debit || 0,
        beforeCredit: beforeByGroup[g.code]?.credit || 0,
      });
      if (headerExpandGroup) {
        for (const m of g.children || []) {
          rows.push({
            group: null,
            main: m,
            special: null,
            detail: null,
            debit: m.debit,
            credit: m.credit,
            beforeDebit: beforeByGeneral[m.code]?.debit || 0,
            beforeCredit: beforeByGeneral[m.code]?.credit || 0,
          });
          if (headerExpandMain) {
            for (const s of m.children || []) {
              rows.push({
                group: null,
                main: null,
                special: s,
                detail: null,
                debit: s.debit,
                credit: s.credit,
                beforeDebit: beforeBySpecific[s.code]?.debit || 0,
                beforeCredit: beforeBySpecific[s.code]?.credit || 0,
              });
              if (headerExpandDetail) {
                for (const d of s.children || []) {
                  const key = `${s.code}|${d.code}`;
                  rows.push({
                    group: null,
                    main: null,
                    special: null,
                    detail: d,
                    debit: d.debit,
                    credit: d.credit,
                    beforeDebit: beforeBySpecificDetail[key]?.debit || 0,
                    beforeCredit: beforeBySpecificDetail[key]?.credit || 0,
                  });
                }
              }
            }
          }
        }
      }
    }
    return rows;
  }, [treeData, headerExpandGroup, headerExpandMain, headerExpandDetail, beforeByGroup, beforeByGeneral, beforeBySpecific, beforeBySpecificDetail]);

  function toggleHeaderGroup(): void {
    setHeaderExpandGroup((prev) => {
      const next = !prev;
      if (!next) setHeaderExpandMain(false);
      return next;
    });
  }

  function toggleHeaderMain(): void {
    if (!headerExpandGroup) return;
    setHeaderExpandMain((prev) => {
      const next = !prev;
      if (!next) setHeaderExpandDetail(false);
      return next;
    });
  }

  function toggleHeaderDetail(): void {
    if (!headerExpandMain) return;
    setHeaderExpandDetail((prev) => !prev);
  }

  /**
   * getSelectedNodes
   * Returns nodes for currently selected group and general for column rendering.
   */
  function getSelectedNodes(): {
    groupNode: TreeNode | null;
    generalNodes: TreeNode[];
    specificNodes: TreeNode[];
    detailNodes: TreeNode[];
  } {
    const groupNode = selectedGroupCode ? (treeData.find((g) => g.code === selectedGroupCode) || null) : null;
    const generalNodes = groupNode?.children || [];
    const generalNode = selectedGeneralCode ? (generalNodes.find((m) => m.code === selectedGeneralCode) || null) : null;
    const specificNodes = generalNode?.children || [];
    const specificNode = selectedSpecificCode ? (specificNodes.find((s) => s.code === selectedSpecificCode) || null) : null;
    const detailNodes = specificNode?.children || [];
    return { groupNode, generalNodes, specificNodes: specificNodes || [], detailNodes: detailNodes || [] };
  }

  /**
   * handleSelectGroup
   * Selects a group for the column view and opens the Main column.
   */
  function handleSelectGroup(code: string): void {
    setSelectedGroupCode(code);
    // Reset deeper selection when changing group
    setSelectedGeneralCode(null);
  }

  /**
   * handleSelectGeneral
   * Selects a general (main) for the column view and opens the Special column.
   */
  function handleSelectGeneral(code: string): void {
    setSelectedGeneralCode(code);
    setSelectedSpecificCode(null);
  }

  /**
   * collapseToGroup
   * Collapses Special column back to Main.
   */
  function collapseToGroup(): void {
    setSelectedGeneralCode(null);
    setSelectedSpecificCode(null);
  }

  /**
   * collapseAllColumns
   * Collapses back to only Groups column.
   */
  function collapseAllColumns(): void {
    setSelectedGeneralCode(null);
    setSelectedGroupCode(null);
    setSelectedSpecificCode(null);
  }

  /**
   * expandAllGroups
   * Expands all group nodes currently in the tree.
   */
  function expandAllGroups(): void {
    const next: Record<string, boolean> = {};
    for (const g of treeData) next[g.code] = true;
    setExpandedGroups(next);
  }
  /**
   * collapseAllGroups
   * Collapses all group nodes currently in the tree.
   */
  function collapseAllGroups(): void {
    const next: Record<string, boolean> = {};
    for (const g of treeData) next[g.code] = false;
    setExpandedGroups(next);
    // Also collapse mains
    setExpandedGenerals({});
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="w-full max-w-none px-2 py-4">
  <h1 className="text-xl font-semibold mb-4">
          {t('pages.reports.balance.title', rtl ? 'گزارش تراز' : 'Balance Report')}
        </h1>

        {/* Filters */}
        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-3">{t('pages.reports.filters', rtl ? 'فیلترها' : 'Filters')}</h2>
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-[260px]">
                <div className="relative">
                  <input className="w-full border border-gray-300 rounded px-2 py-2 pr-8 rtl:pl-8" placeholder={t('pages.reports.search', rtl ? 'جستجو' : 'Search')} value={searchText} onChange={(e) => setSearchText(e.target.value)} />
                  <Search className="absolute right-2 top-2.5 h-4 w-4 text-gray-500 rtl:left-2 rtl:right-auto" />
                </div>
              </div>
              <div className="w-40">
                <FormControl fullWidth size="small">
                  <InputLabel>{t('pages.reports.columns', rtl ? 'ستون‌ها' : 'Columns')}</InputLabel>
                  <MuiSelect
                    value={amountColumnsMode}
                    label={t('pages.reports.columns', rtl ? 'ستون‌ها' : 'Columns')}
                    onChange={(e) => setAmountColumnsMode((e.target.value as 'two' | 'four' | 'six') || 'four')}
                  >
                    <MenuItem value="two">{rtl ? 'دو ستون' : 'Two Columns'}</MenuItem>
                    <MenuItem value="four">{rtl ? 'چهار ستون' : 'Four Columns'}</MenuItem>
                    <MenuItem value="six">{rtl ? 'شش ستون' : 'Six Columns'}</MenuItem>
                  </MuiSelect>
                </FormControl>
              </div>
              <div className="inline-block">
                <JalaliDateRangePicker
                  fromDate={dateFrom}
                  toDate={dateTo}
                  onFromDateChange={(d) => setDateFrom(d)}
                  onToDateChange={(d) => setDateTo(d)}
                  onApply={() => { if (fyId && dateFrom && dateTo) fetchRawItems(); }}
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="w-32">
                  <label className="block text-sm text-gray-700 mb-1">{t('pages.reports.docFrom', rtl ? 'از شماره سند' : 'Doc From')}</label>
                  <NumericInput value={docFrom ?? ''} onChange={(v) => setDocFrom(v ? Number(v) : null)} placeholder="e.g. 10" />
                </div>
                <div className="w-32">
                  <label className="block text-sm text-gray-700 mb-1">{t('pages.reports.docTo', rtl ? 'تا شماره سند' : 'Doc To')}</label>
                  <NumericInput value={docTo ?? ''} onChange={(v) => setDocTo(v ? Number(v) : null)} placeholder="e.g. 200" />
                </div>
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-[220px] w-full">
                <MultiSelect hideLabel fullWidth searchable placeholder={t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group')} options={groupOptions} value={groupFilter} onChange={setGroupFilter} />
              </div>
              <div className="flex-1 min-w-[220px] w-full">
                <MultiSelect hideLabel fullWidth searchable placeholder={t('pages.reports.tabs.general', rtl ? 'کل' : 'Main')} options={generalOptions} value={generalFilter} onChange={setGeneralFilter} />
              </div>
              <div className="flex-1 min-w-[220px] w-full">
                <MultiSelect hideLabel fullWidth searchable placeholder={t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special')} options={specificOptions} value={specificFilter} onChange={setSpecificFilter} />
              </div>
              <div className="flex-1 min-w-[220px] w-full">
                <MultiSelect hideLabel fullWidth searchable placeholder={t('fields.detailCode', rtl ? 'کد تفصیل' : 'Detail Code')} options={Object.keys(detailTitles).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((code) => ({ value: code, label: `${code} — ${detailTitles[code]}` }))} value={detailFilter} onChange={setDetailFilter} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center px-2 py-1 rounded bg-green-50 text-green-700">{t('pages.reports.table.debit', 'Debit')}: {formatCurrency(totalsSummary.debit)}</span>
            <span className="inline-flex items-center px-2 py-1 rounded bg-red-50 text-red-700">{t('pages.reports.table.credit', 'Credit')}: {formatCurrency(totalsSummary.credit)}</span>
          </div>
        </section>

        {/* Results: hierarchical column expansion */}
        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-3">{t('pages.reports.results', rtl ? 'نتایج' : 'Results')}</h2>
          <div className="mb-3 flex flex-wrap gap-2"></div>
          {error && (<p className="text-red-600 mb-3">{error}</p>)}
          {loading && (<p className="text-gray-600 mb-3">{t('common.loading', rtl ? 'در حال بارگذاری...' : 'Loading...')}</p>)}
          {!loading && treeData.length === 0 && (
            <p className="text-gray-600">{t('pages.reports.resultsPlaceholder', rtl ? 'نتایج گزارش در اینجا نمایش داده می‌شود.' : 'Report results will appear here.')}</p>
          )}
          {!loading && treeData.length > 0 && viewMode === 'table' && (
            <div className="relative overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left rtl:text-right">
                      <button
                        type="button"
                        onClick={toggleHeaderGroup}
                        aria-expanded={headerExpandGroup}
                        aria-label={headerExpandGroup ? t('pages.reports.collapseGroup', rtl ? 'جمع‌کردن گروه' : 'Collapse Group') : t('pages.reports.expandGroup', rtl ? 'بازکردن گروه' : 'Expand Group')}
                        className="inline-flex items-center gap-2"
                      >
                        {t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group')}
                        {headerExpandGroup ? <ChevronDown className="h-4 w-4 text-gray-600" /> : <ChevronRight className={`h-4 w-4 text-gray-600 ${rtl ? 'rotate-180' : ''}`} />}
                      </button>
                    </th>
                    {headerExpandGroup && (
                      <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left rtl:text-right">
                        <button
                          type="button"
                          onClick={toggleHeaderMain}
                          aria-expanded={headerExpandMain}
                          aria-label={headerExpandMain ? t('pages.reports.collapseMain', rtl ? 'جمع‌کردن کل' : 'Collapse Main') : t('pages.reports.expandMain', rtl ? 'بازکردن کل' : 'Expand Main')}
                          className="inline-flex items-center gap-2"
                        >
                          {t('pages.reports.tabs.general', rtl ? 'کل' : 'Main')}
                          {headerExpandMain ? <ChevronDown className="h-4 w-4 text-gray-600" /> : <ChevronRight className={`h-4 w-4 text-gray-600 ${rtl ? 'rotate-180' : ''}`} />}
                        </button>
                      </th>
                    )}
                    {headerExpandMain && (
                      <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left rtl:text-right">
                        <button
                          type="button"
                          onClick={toggleHeaderDetail}
                          aria-expanded={headerExpandDetail}
                          aria-label={headerExpandDetail ? t('pages.reports.collapseSpecific', rtl ? 'جمع‌کردن معین' : 'Collapse Special') : t('pages.reports.expandSpecific', rtl ? 'بازکردن معین' : 'Expand Special')}
                          className="inline-flex items-center gap-2"
                        >
                          {t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special')}
                          {headerExpandDetail ? <ChevronDown className="h-4 w-4 text-gray-600" /> : <ChevronRight className={`h-4 w-4 text-gray-600 ${rtl ? 'rotate-180' : ''}`} />}
                        </button>
                      </th>
                    )}
                    {headerExpandDetail && (
                      <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left rtl:text-right">
                        {t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail')}
                      </th>
                    )}
                    {amountColumnsMode === 'six' && (
                      <>
                        <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-right rtl:text-left">{t('pages.reports.table.beforeDebit', rtl ? 'بدهکار از قبل' : 'Before Debit')}</th>
                        <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-right rtl:text-left">{t('pages.reports.table.beforeCredit', rtl ? 'بستانکار از قبل' : 'Before Credit')}</th>
                      </>
                    )}
                    <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-right rtl:text-left">{t('pages.reports.table.debit', rtl ? 'بدهکار' : 'Debit')}</th>
                    <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-right rtl:text-left">{t('pages.reports.table.credit', rtl ? 'بستانکار' : 'Credit')}</th>
                    {(amountColumnsMode === 'four' || amountColumnsMode === 'six') && (
                      <>
                        <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-right rtl:text-left">{t('pages.reports.table.remainDebit', rtl ? 'مانده بدهکار' : 'Remain Debit')}</th>
                        <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-right rtl:text-left">{t('pages.reports.table.remainCredit', rtl ? 'مانده بستانکار' : 'Remain Credit')}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-3 py-2 text-sm">
                        {row.group ? `${row.group.code} — ${row.group.title}` : ''}
                      </td>
                      {headerExpandGroup && (
                        <td className="border border-gray-200 px-3 py-2 text-sm">
                          {row.main ? `${row.main.code} — ${row.main.title}` : ''}
                        </td>
                      )}
                      {headerExpandMain && (
                        <td className="border border-gray-200 px-3 py-2 text-sm">
                          {row.special ? `${row.special.code} — ${row.special.title}` : ''}
                        </td>
                      )}
                      {headerExpandDetail && (
                        <td className="border border-gray-200 px-3 py-2 text-sm">
                          {row.detail ? `${row.detail.code} — ${row.detail.title}` : ''}
                        </td>
                      )}
                      {amountColumnsMode === 'six' && (
                        <>
                          <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">
                            {formatCurrency(row.beforeDebit || 0)}
                          </td>
                          <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">
                            {formatCurrency(row.beforeCredit || 0)}
                          </td>
                        </>
                      )}
                      <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">
                        {formatCurrency(row.debit)}
                      </td>
                      <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">
                        {formatCurrency(row.credit)}
                      </td>
                      {(amountColumnsMode === 'four' || amountColumnsMode === 'six') && (
                        <>
                          <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular bg-green-50">
                            {formatCurrency(Math.max(0, ((row.beforeDebit || 0) + (row.debit || 0)) - ((row.beforeCredit || 0) + (row.credit || 0))))}
                          </td>
                          <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular bg-red-50">
                            {formatCurrency(Math.max(0, ((row.beforeCredit || 0) + (row.credit || 0)) - ((row.beforeDebit || 0) + (row.debit || 0))))}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-medium">
                    <td className="border border-gray-200 px-3 py-2 text-sm">
                      {t('pages.reports.table.total', rtl ? 'جمع' : 'Total')}
                    </td>
                    {headerExpandGroup && (<td className="border border-gray-200 px-3 py-2 text-sm" />)}
                    {headerExpandMain && (<td className="border border-gray-200 px-3 py-2 text-sm" />)}
                    {headerExpandDetail && (<td className="border border-gray-200 px-3 py-2 text-sm" />)}
                    {amountColumnsMode === 'six' && (
                      <>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">
                          {formatCurrency(tableRows.filter((r) => !r.main && !r.special && !r.detail).reduce((acc, r) => acc + (r.beforeDebit || 0), 0))}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">
                          {formatCurrency(tableRows.filter((r) => !r.main && !r.special && !r.detail).reduce((acc, r) => acc + (r.beforeCredit || 0), 0))}
                        </td>
                      </>
                    )}
                    <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">
                      {formatCurrency(tableRows.filter((r) => !r.main && !r.special && !r.detail).reduce((acc, r) => acc + (r.debit || 0), 0))}
                    </td>
                    <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">
                      {formatCurrency(tableRows.filter((r) => !r.main && !r.special && !r.detail).reduce((acc, r) => acc + (r.credit || 0), 0))}
                    </td>
                    {(amountColumnsMode === 'four' || amountColumnsMode === 'six') && (
                      <>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular bg-green-50">
                          {formatCurrency(tableRows.filter((r) => !r.main && !r.special && !r.detail).reduce((acc, r) => {
                            const totalD = (r.beforeDebit || 0) + (r.debit || 0);
                            const totalC = (r.beforeCredit || 0) + (r.credit || 0);
                            return acc + Math.max(0, totalD - totalC);
                          }, 0))}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular bg-red-50">
                          {formatCurrency(tableRows.filter((r) => !r.main && !r.special && !r.detail).reduce((acc, r) => {
                            const totalD = (r.beforeDebit || 0) + (r.debit || 0);
                            const totalC = (r.beforeCredit || 0) + (r.credit || 0);
                            return acc + Math.max(0, totalC - totalD);
                          }, 0))}
                        </td>
                      </>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {!loading && treeData.length > 0 && viewMode === 'column' && (
            <div className="relative overflow-x-auto">
              <div className="flex gap-4 min-w-full">
                {/* Column: Group */}
                <motion.div layout className="flex-1 min-w-[260px] border border-gray-200 rounded">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-medium">
                    {t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group')}
                  </div>
                  <div role="listbox" aria-label={t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group')} className="p-2 space-y-1">
                    {treeData.map((g) => {
                      const isSelected = selectedGroupCode === g.code;
                      const hasChildren = (g.children || []).length > 0;
                      return (
                        <button
                          key={g.code}
                          role="option"
                          aria-selected={isSelected}
                          aria-expanded={isSelected && hasChildren}
                          onClick={() => handleSelectGroup(g.code)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectGroup(g.code); }
                            if (e.key === 'ArrowRight') { e.preventDefault(); handleSelectGroup(g.code); }
                          }}
                          className={`w-full text-left px-3 py-2 rounded border ${isSelected ? 'border-blue-400 bg-blue-50' : 'border-transparent hover:bg-gray-50'} flex items-center gap-2`}
                        >
                          {hasChildren ? (
                            <ChevronRight className={`h-4 w-4 text-gray-600 ${rtl ? 'rotate-180' : ''}`} />
                          ) : (
                            <span className="inline-block w-4 h-4" />
                          )}
                          <span className="font-medium">{g.code} — {g.title}</span>
                          <span className="ml-auto rtl:mr-auto rtl:ml-0 inline-flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-1 rounded bg-green-50 text-green-700">{t('pages.reports.table.debit', rtl ? 'بدهکار' : 'Debit')}: {formatCurrency(g.debit)}</span>
                            <span className="inline-flex items-center px-2 py-1 rounded bg-red-50 text-red-700">{t('pages.reports.table.credit', rtl ? 'بستانکار' : 'Credit')}: {formatCurrency(g.credit)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>

                {/* Column: Main (Generals) */}
                <AnimatePresence initial={false}>
                  {selectedGroupCode && (
                    <motion.div
                      key={`main-${selectedGroupCode}`}
                      initial={{ opacity: 0, x: rtl ? -40 : 40 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: rtl ? -40 : 40 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                      className="flex-1 min-w-[260px] border border-gray-200 rounded"
                    >
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-medium">
                        {t('pages.reports.tabs.general', rtl ? 'کل' : 'Main')}
                      </div>
                      <div role="listbox" aria-label={t('pages.reports.tabs.general', rtl ? 'کل' : 'Main')} className="p-2 space-y-1">
                        {getSelectedNodes().generalNodes.map((m) => {
                          const isSelected = selectedGeneralCode === m.code;
                          const hasChildren = (m.children || []).length > 0;
                          return (
                            <button
                              key={m.code}
                              role="option"
                              aria-selected={isSelected}
                              aria-expanded={isSelected && hasChildren}
                              onClick={() => handleSelectGeneral(m.code)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectGeneral(m.code); }
                                if (e.key === 'ArrowRight') { e.preventDefault(); handleSelectGeneral(m.code); }
                                if (e.key === 'ArrowLeft') { e.preventDefault(); setSelectedGeneralCode(null); }
                              }}
                              className={`w-full text-left px-3 py-2 rounded border ${isSelected ? 'border-blue-400 bg-blue-50' : 'border-transparent hover:bg-gray-50'} flex items-center gap-2`}
                            >
                              {hasChildren ? (
                                <ChevronRight className={`h-4 w-4 text-gray-600 ${rtl ? 'rotate-180' : ''}`} />
                              ) : (
                                <span className="inline-block w-4 h-4" />
                              )}
                              <span className="font-medium">{m.code} — {m.title}</span>
                              <span className="ml-auto rtl:mr-auto rtl:ml-0 inline-flex items-center gap-2">
                                <span className="inline-flex items-center px-2 py-1 rounded bg-green-50 text-green-700">{t('pages.reports.table.debit', rtl ? 'بدهکار' : 'Debit')}: {formatCurrency(m.debit)}</span>
                                <span className="inline-flex items-center px-2 py-1 rounded bg-red-50 text-red-700">{t('pages.reports.table.credit', rtl ? 'بستانکار' : 'Credit')}: {formatCurrency(m.credit)}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Column: Special (Specifics) */}
                <AnimatePresence initial={false}>
                  {selectedGeneralCode && (
                    <motion.div
                      key={`special-${selectedGeneralCode}`}
                      initial={{ opacity: 0, x: rtl ? -40 : 40 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: rtl ? -40 : 40 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                      className="flex-1 min-w-[260px] border border-gray-200 rounded"
                    >
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-medium">
                        {t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special')}
                      </div>
                      <div role="listbox" aria-label={t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special')} className="p-2 space-y-1">
                        {getSelectedNodes().specificNodes.map((s) => {
                          const isSelected = selectedSpecificCode === s.code;
                          const hasChildren = (s.children || []).length > 0;
                          return (
                            <button
                              key={s.code}
                              role="option"
                              aria-selected={isSelected}
                              aria-expanded={isSelected && hasChildren}
                              onClick={() => setSelectedSpecificCode(s.code)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedSpecificCode(s.code); }
                                if (e.key === 'ArrowRight') { e.preventDefault(); setSelectedSpecificCode(s.code); }
                                if (e.key === 'ArrowLeft') { e.preventDefault(); setSelectedSpecificCode(null); }
                              }}
                              className={`w-full text-left px-3 py-2 rounded border ${isSelected ? 'border-blue-400 bg-blue-50' : 'border-transparent hover:bg-gray-50'} flex items-center gap-2`}
                            >
                              {hasChildren ? (
                                <ChevronRight className={`h-4 w-4 text-gray-600 ${rtl ? 'rotate-180' : ''}`} />
                              ) : (
                                <span className="inline-block w-4 h-4" />
                              )}
                              <span className="font-medium">{s.code} — {s.title}</span>
                              <span className="ml-auto rtl:mr-auto rtl:ml-0 inline-flex items-center gap-2">
                                <span className="inline-flex items-center px-2 py-1 rounded bg-green-50 text-green-700">{t('pages.reports.table.debit', rtl ? 'بدهکار' : 'Debit')}: {formatCurrency(s.debit)}</span>
                                <span className="inline-flex items-center px-2 py-1 rounded bg-red-50 text-red-700">{t('pages.reports.table.credit', rtl ? 'بستانکار' : 'Credit')}: {formatCurrency(s.credit)}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Column: Details */}
                <AnimatePresence initial={false}>
                  {selectedSpecificCode && (
                    <motion.div
                      key={`detail-${selectedSpecificCode}`}
                      initial={{ opacity: 0, x: rtl ? -40 : 40 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: rtl ? -40 : 40 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                      className="flex-1 min-w-[260px] border border-gray-200 rounded"
                    >
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-medium">
                        {t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail')}
                      </div>
                      <div role="listbox" aria-label={t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail')} className="p-2 space-y-1">
                        {getSelectedNodes().detailNodes.map((d) => (
                          <div key={d.code} className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 flex items-center gap-2">
                            <span className="inline-block w-4 h-4" />
                            <span className="font-medium">{d.code} — {d.title}</span>
                            <span className="ml-auto rtl:mr-auto rtl:ml-0 inline-flex items-center gap-2">
                              <span className="inline-flex items-center px-2 py-1 rounded bg-green-50 text-green-700">{t('pages.reports.table.debit', rtl ? 'بدهکار' : 'Debit')}: {formatCurrency(d.debit)}</span>
                              <span className="inline-flex items-center px-2 py-1 rounded bg-red-50 text-red-700">{t('pages.reports.table.credit', rtl ? 'بستانکار' : 'Credit')}: {formatCurrency(d.credit)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* Export actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={openPrintView} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-blue-600 text-white">
              <FileDown className="h-4 w-4" />
              {t('pages.reports.exportPdf', rtl ? 'صدور PDF' : 'Export PDF')}
            </button>
            <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-green-600 text-white">
              <Download className="h-4 w-4" />
              {t('pages.reports.exportExcel', rtl ? 'صدور Excel' : 'Export Excel')}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};

export default HierarchicalCodesReportPage;
