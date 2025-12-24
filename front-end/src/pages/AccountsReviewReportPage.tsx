/**
 * AccountsReviewReportPage
 * - Accounts Review Report using Jalali date range picker
 * - Auto-fetches on date changes, no Apply button
 * - Aggregates raw journal items by top-level group code
 * - Shows Opening, Debit, Credit, and Closing balances per group
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import { getCurrentLang } from '../i18n';
import config from '../config';
import JalaliDateRangePicker from '../components/common/JalaliDateRangePicker';
import Pagination from '../components/common/Pagination';
import TableSortHeader from '../components/common/TableSortHeader';
import { listDetails } from '../services/details';

/**
 * FiscalYearRef
 * Minimal fiscal year model used for report filtering.
 */
interface FiscalYearRef {
  id: string | number;
  name?: string;
  start_date?: string; // YYYY-MM-DD
  end_date?: string;   // YYYY-MM-DD
  is_closed?: boolean;
}

/**
 * CodeRecord
 * Mirrors backend codes payload for hierarchy mapping.
 */
interface CodeRecord {
  id: string;
  code: string;
  title: string;
  kind: 'group' | 'general' | 'specific';
  parent_id: string | null;
}

/**
 * A single row in the Accounts Review Report results table.
 */
interface ReportRow {
  accountCode: string; // group code
  accountName: string; // group title
  openingBalance: number;
  debit: number;
  credit: number;
  closingBalance: number;
}

/**
 * JournalRawItem
 * Raw row returned by journals-pivot-raw used for aggregation.
 */
interface JournalRawItem {
  account_code: string | number;
  detail_code?: string | number | null;
  debit: number;
  credit: number;
}

/**
 * formatCurrency
 * Formats a number for display with locale-specific digits and thousands separators.
 * When language is Farsi, uses 'fa-IR'; otherwise 'en-US'.
 */
function formatCurrency(value: number, lang?: string): string {
  try {
    const isFa = (lang || '').toLowerCase().startsWith('fa');
    const formatter = new Intl.NumberFormat(isFa ? 'fa-IR' : 'en-US');
    return formatter.format(value ?? 0);
  } catch {
    return String(value ?? 0);
  }
}

/**
 * formatDateYmd
 * Returns YYYY-MM-DD for a given Date (Gregorian).
 */
function formatDateYmd(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * parseIsoDateYmd
 * Parses an ISO date string (YYYY-MM-DD) to a Date at local noon.
 * Setting time to 12:00 avoids DST/UTC offset issues that can display one-day off.
 */
function parseIsoDateYmd(s?: string): Date | null {
  if (!s) return null;
  const parts = s.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if ([y, m, d].some((n) => Number.isNaN(n))) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * subtractOneDay
 * Returns a new Date one day before input date.
 */
function subtractOneDay(d: Date): Date {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() - 1);
  return copy;
}

/**
 * selectDefaultFiscalYear
 * Prefers an open fiscal year; otherwise the latest by end_date.
 */
function selectDefaultFiscalYear(list: FiscalYearRef[]): string | null {
  const openFy = list.find((fy) => !fy.is_closed);
  if (openFy) return String(openFy.id);
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => String(a.end_date || '').localeCompare(String(b.end_date || '')));
  return String(sorted.slice(-1)[0].id);
}

/**
 * toAsciiDigits
 * Converts Persian digits (۰–۹) in a string to ASCII digits (0–9).
 * Ensures consistent code matching between API payloads and local maps.
 */
function toAsciiDigits(str: string): string {
  const map: Record<string, string> = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  };
  return String(str || '').replace(/[۰-۹]/g, (d) => map[d] || d);
}

/**
 * groupCodeOf
 * Returns the top-level group code from a full account code based on configured digits.
 */
function groupCodeOf(accountCode: string | number): string {
  const raw = String(accountCode || '').trim();
  const digits = config.CODE_DIGITS.group || 2;
  return toAsciiDigits(raw.slice(0, digits));
}

/**
 * resolveGroupTitle
 * Resolves the display title for a given aggregated group code.
 * - Uses normalized keying based on configured group digits to handle codes like "1100" → "11".
 * - Falls back to i18n "Group" if no matching title is found.
 */
function resolveGroupTitle(groupCode: string, titles: Record<string, string>, t: any): string {
  const normalizedKey = groupCodeOf(groupCode);
  return titles[normalizedKey] || titles[groupCode] || t('pages.reports.groupNameFallback', 'Group');
}

/**
 * Code helpers
 * Normalize account codes to configured digit lengths and resolve titles.
 */
function normalizeCode(accountCode: string | number, digits: number): string {
  const raw = String(accountCode || '').trim();
  if (!raw) return '';
  const n = typeof digits === 'number' && digits > 0 ? digits : raw.length;
  return raw.slice(0, n);
}

/**
 * generalCodeOf
 * Returns the general-level code based on configured digit length.
 */
function generalCodeOf(accountCode: string | number): string {
  const digits = config.CODE_DIGITS.general || 4;
  return toAsciiDigits(normalizeCode(accountCode, digits));
}

/**
 * specificCodeOf
 * Returns the specific-level code based on configured digit length.
 */
function specificCodeOf(accountCode: string | number): string {
  const digits = config.CODE_DIGITS.specific || 6;
  return toAsciiDigits(normalizeCode(accountCode, digits));
}

/**
 * detailCodeOf
 * Normalizes detail code to ASCII digits string. Details are global codes (no slicing).
 */
function detailCodeOf(detailCode: string | number | null | undefined): string {
  const raw = String(detailCode ?? '').trim();
  return toAsciiDigits(raw);
}

/**
 * resolveGeneralTitle
 * Looks up general code title with normalized key; falls back to i18n.
 */
function resolveGeneralTitle(code: string, titles: Record<string, string>, t: any): string {
  const key = generalCodeOf(code);
  return titles[key] || titles[code] || t('pages.reports.generalNameFallback', 'Main Code');
}

/**
 * resolveSpecificTitle
 * Looks up specific code title with normalized key; falls back to i18n.
 */
function resolveSpecificTitle(code: string, titles: Record<string, string>, t: any): string {
  const key = specificCodeOf(code);
  return titles[key] || titles[code] || t('pages.reports.specificNameFallback', 'Special Code');
}

/**
 * resolveDetailTitle
 * Looks up detail code title using ASCII-normalized key; falls back to i18n.
 */
function resolveDetailTitle(code: string, titles: Record<string, string>, t: any): string {
  const key = toAsciiDigits(String(code));
  return titles[key] || titles[code] || t('pages.reports.detailNameFallback', 'Detail');
}

/**
 * AccountsReviewReportPage
 * Renders date filters (Jalali), auto-fetches results, and displays grouped balances.
 */
const AccountsReviewReportPage: React.FC = () => {
  const { t } = useTranslation();
  const lang = getCurrentLang();

  // Active tab state
  const [tab, setTab] = useState<'group' | 'general' | 'specific' | 'detail'>('group');

  // Fiscal year and date range state
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRef[]>([]);
  const [fyId, setFyId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);

  // Results and UI state (per tab)
  const [rowsGroup, setRowsGroup] = useState<ReportRow[]>([]);
  const [rowsGeneral, setRowsGeneral] = useState<ReportRow[]>([]);
  const [rowsSpecific, setRowsSpecific] = useState<ReportRow[]>([]);
  const [rowsDetail, setRowsDetail] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Group code -> title mapping (from /v1/codes)
  const [groupTitles, setGroupTitles] = useState<Record<string, string>>({});
  const [generalTitles, setGeneralTitles] = useState<Record<string, string>>({});
  const [specificTitles, setSpecificTitles] = useState<Record<string, string>>({});
  const [detailTitles, setDetailTitles] = useState<Record<string, string>>({});
  const [codeToGroup, setCodeToGroup] = useState<Record<string, string>>({});

  // Sorting state for table
  const [sortBy, setSortBy] = useState<'accountCode' | 'accountName' | 'openingBalance' | 'debit' | 'credit' | 'closingBalance'>('accountCode');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  /**
   * handleSort
   * Toggles sort direction when clicking the same column, otherwise sets new column.
   */
  function handleSort(col: typeof sortBy): void {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  }

  // Pagination state
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(15);

  /**
   * memoRows
   * Returns rows for the active tab.
   */
  const memoRows = useMemo(() => {
    switch (tab) {
      case 'group':
        return rowsGroup;
      case 'general':
        return rowsGeneral;
      case 'specific':
        return rowsSpecific;
      case 'detail':
      default:
        return rowsDetail;
    }
  }, [tab, rowsGroup, rowsGeneral, rowsSpecific, rowsDetail]);

  /**
   * sortedRows
   * Applies client-side sorting to the computed report rows.
   */
  const sortedRows = useMemo(() => {
    const copy = [...memoRows];
    copy.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      const isNum = typeof av === 'number' && typeof bv === 'number';
      let cmp = 0;
      if (isNum) {
        cmp = (av as number) - (bv as number);
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [memoRows, sortBy, sortDir]);

  /**
   * pagedRows
   * Applies client-side pagination to sorted rows.
   */
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, page, pageSize]);

  // Reset to first page when the dataset changes
  useEffect(() => { setPage(1); }, [tab, rowsGroup, rowsGeneral, rowsSpecific, rowsDetail, sortBy, sortDir]);

  // Persistent multi-tab filters (group/general/specific/detail)
  type FilterKind = 'group' | 'general' | 'specific' | 'detail';
  interface ActiveFilters { groups: string[]; generals: string[]; specifics: string[]; details: string[]; }
  const [filters, setFilters] = useState<ActiveFilters>({ groups: [], generals: [], specifics: [], details: [] });

  /**
   * loadPersistedFilters
   * Reads persisted filters from localStorage; migrates legacy detail-only key if present.
   */
  useEffect(() => {
    try {
      const saved = localStorage.getItem('gb.reportFilters');
      if (saved) {
        const obj = JSON.parse(saved);
        const next: ActiveFilters = {
          groups: Array.isArray(obj?.groups) ? obj.groups.map((c: any) => toAsciiDigits(String(c))) : [],
          generals: Array.isArray(obj?.generals) ? obj.generals.map((c: any) => toAsciiDigits(String(c))) : [],
          specifics: Array.isArray(obj?.specifics) ? obj.specifics.map((c: any) => toAsciiDigits(String(c))) : [],
          details: Array.isArray(obj?.details) ? obj.details.map((c: any) => toAsciiDigits(String(c))) : [],
        };
        setFilters(next);
        return;
      }
      // Migrate legacy detailFilterCodes key
      const legacy = localStorage.getItem('gb.detailFilterCodes');
      if (legacy) {
        const arr = JSON.parse(legacy);
        if (Array.isArray(arr)) setFilters((prev) => ({ ...prev, details: arr.map((c: any) => toAsciiDigits(String(c))) }));
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  /**
   * persistFilters
   * Persists current filters to localStorage for session-wide consistency.
   */
  useEffect(() => {
    try {
      localStorage.setItem('gb.reportFilters', JSON.stringify(filters));
    } catch {
      // Ignore storage errors
    }
  }, [filters]);

  /**
   * kindKey
   * Maps filter kind to the corresponding ActiveFilters key.
   */
  function kindKey(kind: FilterKind): keyof ActiveFilters {
    return kind === 'group' ? 'groups' : kind === 'general' ? 'generals' : kind === 'specific' ? 'specifics' : 'details';
  }

  /**
   * toggleFilter
   * Adds or removes a normalized code from the active filters of given kind.
   */
  function toggleFilter(kind: FilterKind, code: string): void {
    const norm = toAsciiDigits(String(code));
    const key = kindKey(kind);
    setFilters((prev) => {
      const arr = prev[key] || [];
      const nextArr = (arr as string[]).includes(norm) ? (arr as string[]).filter((c) => c !== norm) : [...(arr as string[]), norm];
      return { ...prev, [key]: nextArr } as ActiveFilters;
    });
  }

  /**
   * clearFilter
   * Clears all active filters of given kind.
   */
  function clearFilter(kind: FilterKind): void {
    const key = kindKey(kind);
    setFilters((prev) => ({ ...prev, [key]: [] }));
  }

  /**
   * clearAllFilters
   * Clears all active filters.
   */
  function clearAllFilters(): void {
    setFilters({ groups: [], generals: [], specifics: [], details: [] });
  }

  /**
   * fetchFiscalYears
   * Loads fiscal years, sets default FY and initializes date range to FY span.
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
   * computeCodeToGroup
   * Given all codes, computes a mapping from any code (group/general/specific)
   * to its top-level group code by traversing parent links.
   */
  function computeCodeToGroup(allCodes: CodeRecord[]): Record<string, string> {
    const idMap: Record<string, CodeRecord> = {};
    for (const c of allCodes) idMap[c.id] = c;

    function findGroupCode(rec: CodeRecord): string {
      if (!rec) return '';
      if (rec.kind === 'group') return String(rec.code);
      if (rec.kind === 'general') {
        const parent = rec.parent_id ? idMap[rec.parent_id] : null;
        return parent && parent.kind === 'group' ? String(parent.code) : groupCodeOf(rec.code);
      }
      if (rec.kind === 'specific') {
        const gen = rec.parent_id ? idMap[rec.parent_id] : null;
        const grp = gen && gen.parent_id ? idMap[gen.parent_id] : null;
        return grp && grp.kind === 'group' ? String(grp.code) : groupCodeOf(rec.code);
      }
      return groupCodeOf(rec.code);
    }

    const map: Record<string, string> = {};
    for (const c of allCodes) {
      const top = findGroupCode(c);
      if (c.code && top) map[String(c.code)] = top;
    }
    return map;
  }

  /**
   * fetchGroupTitles
   * Loads group/general/specific codes for display titles and builds code→group mapping.
   */
  async function fetchGroupTitles(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/codes`, { headers: { 'Accept-Language': lang } });
      const payload = res.data;
      const list: any[] = payload?.items || payload?.data || payload || [];
      const records: CodeRecord[] = list as CodeRecord[];

      // Group titles (normalized to group digits)
      const groups = records.filter((it) => String(it.kind || '').toLowerCase() === 'group');
      const gTitles: Record<string, string> = {};
      for (const g of groups) {
        const code = String(g.code || '').trim();
        const title = String(g.title || '').trim();
        if (!code) continue;
        gTitles[groupCodeOf(code)] = title;
      }
      setGroupTitles(gTitles);

      // General titles (normalized to general digits)
      const generals = records.filter((it) => String(it.kind || '').toLowerCase() === 'general');
      const genTitles: Record<string, string> = {};
      for (const gen of generals) {
        const code = String(gen.code || '').trim();
        const title = String(gen.title || '').trim();
        if (!code) continue;
        genTitles[generalCodeOf(code)] = title;
      }
      setGeneralTitles(genTitles);

      // Specific titles (normalized to specific digits)
      const specifics = records.filter((it) => String(it.kind || '').toLowerCase() === 'specific');
      const spTitles: Record<string, string> = {};
      for (const sp of specifics) {
        const code = String(sp.code || '').trim();
        const title = String(sp.title || '').trim();
        if (!code) continue;
        spTitles[specificCodeOf(code)] = title;
      }
      setSpecificTitles(spTitles);

      // Build code→group mapping via parent traversal
      const map = computeCodeToGroup(records);
      setCodeToGroup(map);
    } catch {
      setGroupTitles({});
      setGeneralTitles({});
      setSpecificTitles({});
      setCodeToGroup({});
    }
  }

  /**
   * fetchDetailTitles
   * Loads detail codes and builds a code→title map used in the Detail tab.
   */
  async function fetchDetailTitles(): Promise<void> {
    try {
      const opts = await listDetails();
      const map: Record<string, string> = {};
      for (const d of opts) {
        const code = String(d.code || '').trim();
        const title = String(d.title || '').trim();
        if (!code) continue;
        map[code] = title;
      }
      setDetailTitles(map);
    } catch {
      setDetailTitles({});
    }
  }

  /**
   * aggregateByGroup
   * Sums debit/credit per group code for a set of raw items using hierarchical mapping.
   * Falls back to digit slicing when mapping is missing.
   */
  function aggregateByGroup(items: Array<{ account_code: string | number; debit: number; credit: number }>): {
    debits: Record<string, number>;
    credits: Record<string, number>;
    nets: Record<string, number>;
  } {
    const debits: Record<string, number> = {};
    const credits: Record<string, number> = {};
    const nets: Record<string, number> = {};
    for (const it of items || []) {
      const codeStr = String(it.account_code || '').trim();
      if (!codeStr) continue;
      const grp = codeToGroup[codeStr] || groupCodeOf(codeStr);
      const d = Number(it.debit || 0);
      const c = Number(it.credit || 0);
      debits[grp] = (debits[grp] || 0) + d;
      credits[grp] = (credits[grp] || 0) + c;
      nets[grp] = (nets[grp] || 0) + (d - c);
    }
    return { debits, credits, nets };
  }

  /**
   * aggregateBy
   * Generic aggregator keyed by a selector function. Skips empty keys.
   */
  function aggregateBy<T>(items: T[], getKey: (it: T) => string): {
    debits: Record<string, number>;
    credits: Record<string, number>;
    nets: Record<string, number>;
  } {
    const debits: Record<string, number> = {};
    const credits: Record<string, number> = {};
    const nets: Record<string, number> = {};
    for (const it of items || []) {
      const key = getKey(it) || '';
      if (!key) continue;
      const d = Number((it as any).debit || 0);
      const c = Number((it as any).credit || 0);
      debits[key] = (debits[key] || 0) + d;
      credits[key] = (credits[key] || 0) + c;
      nets[key] = (nets[key] || 0) + (d - c);
    }
    return { debits, credits, nets };
  }

  /**
   * fetchData
   * Queries backend /v1/reports/journals-pivot-raw twice:
   * - Opening: up to the day before start_date
   * - Period: between start_date and end_date
   * Then merges results into grouped rows with opening/closing balances.
   */
  async function fetchData(): Promise<void> {
    if (!fyId || !dateFrom || !dateTo) return;
    setLoading(true);
    setError('');
    try {
      const startStr = formatDateYmd(dateFrom);
      const endStr = formatDateYmd(dateTo);
      const prevStr = formatDateYmd(subtractOneDay(dateFrom));

      const headers = { 'Accept-Language': lang } as any;

      // Opening (<= day before start)
      const openRes = await axios.get(`${config.API_ENDPOINTS.base}/v1/reports/journals-pivot-raw`, {
        params: { fiscal_year_id: fyId, end_date: prevStr, row_dim: 'month', col_dim: 'status', status: 'all' },
        headers,
      });
      const openItems: JournalRawItem[] = openRes.data?.items || [];
      const periodRes = await axios.get(`${config.API_ENDPOINTS.base}/v1/reports/journals-pivot-raw`, {
        params: { fiscal_year_id: fyId, start_date: startStr, end_date: endStr, row_dim: 'month', col_dim: 'status', status: 'all' },
        headers,
      });
      const periodItems: JournalRawItem[] = periodRes.data?.items || [];
      // Apply unified multi-tab filters (group/general/specific/detail) with AND across dimensions, OR within each dimension
      const groupsSet = new Set((filters.groups || []).map((c) => toAsciiDigits(String(c))));
      const generalsSet = new Set((filters.generals || []).map((c) => toAsciiDigits(String(c))));
      const specificsSet = new Set((filters.specifics || []).map((c) => toAsciiDigits(String(c))));
      const detailsSet = new Set((filters.details || []).map((c) => toAsciiDigits(String(c))));
      const anyActive = groupsSet.size || generalsSet.size || specificsSet.size || detailsSet.size;
      const matchesAll = (it: JournalRawItem): boolean => {
        const acc = String(it.account_code || '');
        const grp = toAsciiDigits(codeToGroup[acc] || groupCodeOf(acc));
        const gen = generalCodeOf(acc);
        const sp = specificCodeOf(acc);
        const dt = detailCodeOf(it.detail_code);
        if (groupsSet.size && !groupsSet.has(grp)) return false;
        if (generalsSet.size && !generalsSet.has(gen)) return false;
        if (specificsSet.size && !specificsSet.has(sp)) return false;
        if (detailsSet.size && !detailsSet.has(dt)) return false;
        return true;
      };
      const openBase = anyActive ? openItems.filter(matchesAll) : openItems;
      const periodBase = anyActive ? periodItems.filter(matchesAll) : periodItems;
      // Group
      const openingGroup = aggregateByGroup(openBase);
      const periodGroup = aggregateByGroup(periodBase);
      const keysGroup = new Set<string>([
        ...Object.keys(openingGroup.nets),
        ...Object.keys(periodGroup.debits),
        ...Object.keys(periodGroup.credits),
      ]);
      const rowsG: ReportRow[] = Array.from(keysGroup).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((grp) => {
        const opening = openingGroup.nets[grp] || 0;
        const debit = periodGroup.debits[grp] || 0;
        const credit = periodGroup.credits[grp] || 0;
        const closing = opening + (debit - credit);
        return { accountCode: grp, accountName: resolveGroupTitle(grp, groupTitles, t), openingBalance: opening, debit, credit, closingBalance: closing };
      });
      // General (Main)
      const openingGen = aggregateBy(openBase, (it: JournalRawItem) => generalCodeOf(it.account_code as any));
      const periodGen = aggregateBy(periodBase, (it: JournalRawItem) => generalCodeOf(it.account_code as any));
      const keysGen = new Set<string>([...Object.keys(openingGen.nets), ...Object.keys(periodGen.debits), ...Object.keys(periodGen.credits)]);
      const rowsM: ReportRow[] = Array.from(keysGen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((code) => {
        const opening = openingGen.nets[code] || 0;
        const debit = periodGen.debits[code] || 0;
        const credit = periodGen.credits[code] || 0;
        const closing = opening + (debit - credit);
        return { accountCode: code, accountName: resolveGeneralTitle(code, generalTitles, t), openingBalance: opening, debit, credit, closingBalance: closing };
      });
      // Specific (Special)
      const openingSp = aggregateBy(openBase, (it: JournalRawItem) => specificCodeOf(it.account_code as any));
      const periodSp = aggregateBy(periodBase, (it: JournalRawItem) => specificCodeOf(it.account_code as any));
      const keysSp = new Set<string>([...Object.keys(openingSp.nets), ...Object.keys(periodSp.debits), ...Object.keys(periodSp.credits)]);
      const rowsS: ReportRow[] = Array.from(keysSp).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((code) => {
        const opening = openingSp.nets[code] || 0;
        const debit = periodSp.debits[code] || 0;
        const credit = periodSp.credits[code] || 0;
        const closing = opening + (debit - credit);
        return { accountCode: code, accountName: resolveSpecificTitle(code, specificTitles, t), openingBalance: opening, debit, credit, closingBalance: closing };
      });
      // Detail
      const openingDt = aggregateBy(openBase, (it: JournalRawItem) => detailCodeOf(it.detail_code));
      const periodDt = aggregateBy(periodBase, (it: JournalRawItem) => detailCodeOf(it.detail_code));
      const keysDt = new Set<string>([...Object.keys(openingDt.nets), ...Object.keys(periodDt.debits), ...Object.keys(periodDt.credits)]);
      const rowsD: ReportRow[] = Array.from(keysDt).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((code) => {
        const opening = openingDt.nets[code] || 0;
        const debit = periodDt.debits[code] || 0;
        const credit = periodDt.credits[code] || 0;
        const closing = opening + (debit - credit);
        return { accountCode: code, accountName: resolveDetailTitle(code, detailTitles, t), openingBalance: opening, debit, credit, closingBalance: closing };
      });
      setRowsGroup(rowsG);
      setRowsGeneral(rowsM);
      setRowsSpecific(rowsS);
      setRowsDetail(rowsD);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
      setRowsGroup([]);
      setRowsGeneral([]);
      setRowsSpecific([]);
      setRowsDetail([]);
    } finally {
      setLoading(false);
    }
  }

  // Initial data loads
  useEffect(() => { fetchFiscalYears(); }, []);
  useEffect(() => { fetchGroupTitles(); }, []);
  useEffect(() => { fetchDetailTitles(); }, []);
  /**
   * Relabel group rows when titles or rows change.
   * Guards against unnecessary state updates to avoid render loops.
   */
  useEffect(() => {
    if (!rowsGroup.length || !Object.keys(groupTitles).length) return;
    setRowsGroup((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const name = resolveGroupTitle(r.accountCode, groupTitles, t);
        if (name !== r.accountName) changed = true;
        return name !== r.accountName ? { ...r, accountName: name } : r;
      });
      return changed ? next : prev;
    });
  }, [groupTitles, rowsGroup, t]);

  /**
   * Relabel general rows when titles or rows change.
   */
  useEffect(() => {
    if (!rowsGeneral.length || !Object.keys(generalTitles).length) return;
    setRowsGeneral((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const name = resolveGeneralTitle(r.accountCode, generalTitles, t);
        if (name !== r.accountName) changed = true;
        return name !== r.accountName ? { ...r, accountName: name } : r;
      });
      return changed ? next : prev;
    });
  }, [generalTitles, rowsGeneral, t]);

  /**
   * Relabel specific rows when titles or rows change.
   */
  useEffect(() => {
    if (!rowsSpecific.length || !Object.keys(specificTitles).length) return;
    setRowsSpecific((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const name = resolveSpecificTitle(r.accountCode, specificTitles, t);
        if (name !== r.accountName) changed = true;
        return name !== r.accountName ? { ...r, accountName: name } : r;
      });
      return changed ? next : prev;
    });
  }, [specificTitles, rowsSpecific, t]);

  /**
   * Relabel detail rows when titles or rows change.
   */
  useEffect(() => {
    if (!rowsDetail.length || !Object.keys(detailTitles).length) return;
    setRowsDetail((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const name = resolveDetailTitle(r.accountCode, detailTitles, t);
        if (name !== r.accountName) changed = true;
        return name !== r.accountName ? { ...r, accountName: name } : r;
      });
      return changed ? next : prev;
    });
  }, [detailTitles, rowsDetail, t]);

  // Auto-fetch when FY or date range changes
  useEffect(() => {
    if (fyId && dateFrom && dateTo) {
      fetchData();
    }
  }, [fyId, dateFrom, dateTo]);

  // Re-fetch when filters change (any tab)
  useEffect(() => {
    if (fyId && dateFrom && dateTo) {
      fetchData();
    }
  }, [filters]);


  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="w-full max-w-none px-2 py-4">
        <h1 className="text-xl font-semibold mb-4">
          {t('navigation.accountsReviewReport', 'Accounts Review Report')}
        </h1>

        {/* Tabs */}
        <div className="mb-4">
          <div className="flex flex-wrap gap-2 border-b border-gray-200">
            <button
              type="button"
              onClick={() => setTab('group')}
              className={`${tab === 'group' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600 font-semibold' : 'bg-white text-gray-700'} px-3 py-2 rounded-t`}
            >
              {t('pages.reports.tabs.group', 'گروه')}
            </button>
            <button
              type="button"
              onClick={() => setTab('general')}
              className={`${tab === 'general' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600 font-semibold' : 'bg-white text-gray-700'} px-3 py-2 rounded-t`}
            >
              {t('pages.reports.tabs.general', 'کل')}
            </button>
            <button
              type="button"
              onClick={() => setTab('specific')}
              className={`${tab === 'specific' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600 font-semibold' : 'bg-white text-gray-700'} px-3 py-2 rounded-t`}
            >
              {t('pages.reports.tabs.specific', 'معین')}
            </button>
            <button
              type="button"
              onClick={() => setTab('detail')}
              className={`${tab === 'detail' ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600 font-semibold' : 'bg-white text-gray-700'} px-3 py-2 rounded-t`}
            >
              {t('pages.reports.tabs.detail', 'تفصیلی')}
            </button>
          </div>
        </div>
        {/* Filters */}
        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-3">
            {t('pages.reports.filters', 'Filters')}
          </h2>
          <div className="inline-block">
            <JalaliDateRangePicker
              fromDate={dateFrom}
              toDate={dateTo}
              onFromDateChange={(d) => setDateFrom(d)}
              onToDateChange={(d) => setDateTo(d)}
              onApply={() => { if (fyId && dateFrom && dateTo) fetchData(); }}
            />
          </div>
          {(filters.groups.length + filters.generals.length + filters.specifics.length + filters.details.length) > 0 && (
            <div className="mt-3">
              <span className="text-sm font-medium mr-2">{t('pages.reports.selectedFilters', 'انتخاب‌ها')}:</span>
              <div className="inline-flex flex-wrap gap-2 align-middle">
                {filters.groups.map((code) => (
                  <span key={`group-${code}`} className="inline-flex items-center bg-blue-50 text-blue-700 px-2 py-1 rounded">
                    {t('pages.reports.tabs.group', 'گروه')}: {code} — {resolveGroupTitle(code, groupTitles, t)}
                    <button type="button" className="ml-2 text-blue-700 hover:text-blue-900" onClick={() => toggleFilter('group', code)} aria-label={t('pages.reports.removeGroupFilter', 'حذف این گروه')}>
                      ×
                    </button>
                  </span>
                ))}
                {filters.generals.map((code) => (
                  <span key={`general-${code}`} className="inline-flex items-center bg-blue-50 text-blue-700 px-2 py-1 rounded">
                    {t('pages.reports.tabs.general', 'کل')}: {code} — {resolveGeneralTitle(code, generalTitles, t)}
                    <button type="button" className="ml-2 text-blue-700 hover:text-blue-900" onClick={() => toggleFilter('general', code)} aria-label={t('pages.reports.removeGeneralFilter', 'حذف این کل')}>
                      ×
                    </button>
                  </span>
                ))}
                {filters.specifics.map((code) => (
                  <span key={`specific-${code}`} className="inline-flex items-center bg-blue-50 text-blue-700 px-2 py-1 rounded">
                    {t('pages.reports.tabs.specific', 'معین')}: {code} — {resolveSpecificTitle(code, specificTitles, t)}
                    <button type="button" className="ml-2 text-blue-700 hover:text-blue-900" onClick={() => toggleFilter('specific', code)} aria-label={t('pages.reports.removeSpecificFilter', 'حذف این معین')}>
                      ×
                    </button>
                  </span>
                ))}
                {filters.details.map((code) => (
                  <span key={`detail-${code}`} className="inline-flex items-center bg-blue-50 text-blue-700 px-2 py-1 rounded">
                    {t('pages.reports.tabs.detail', 'تفصیلی')}: {code} — {resolveDetailTitle(code, detailTitles, t)}
                    <button type="button" className="ml-2 text-blue-700 hover:text-blue-900" onClick={() => toggleFilter('detail', code)} aria-label={t('pages.reports.removeDetailFilter', 'حذف این تفصیلی')}>
                      ×
                    </button>
                  </span>
                ))}
                <button type="button" onClick={clearAllFilters} className="inline-flex items-center bg-gray-200 text-gray-700 px-2 py-1 rounded">
                  {t('pages.reports.clearFilters', 'حذف فیلترها')}
                </button>
              </div>
            </div>
          )}
        </section>
        {/* Results */}
        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-4">
            {t('pages.reports.results', 'Results')}
          </h2>
          {error && (<p className="text-red-600 mb-3">{error}</p>)}
          {loading && (<p className="text-gray-600 mb-3">{t('common.loading', 'Loading...')}</p>)}
          {!loading && memoRows.length === 0 && (
            <p className="text-gray-600">{t('pages.reports.resultsPlaceholder', 'Report results will appear here.')}</p>
          )}
          {!loading && memoRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed border border-gray-300">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-center w-12">#</th>
                    <TableSortHeader label={tab === 'detail' ? t('pages.reports.table.detailCode', 'Detail Code') : t('pages.reports.table.accountCode', 'Account Code')} sortKey={'accountCode'} currentSortBy={sortBy} currentSortDir={sortDir} onSort={(k) => handleSort(k as any)} />
                    <TableSortHeader label={tab === 'detail' ? t('pages.reports.table.detailName', 'Detail Name') : t('pages.reports.table.accountName', 'Account Name')} sortKey={'accountName'} currentSortBy={sortBy} currentSortDir={sortDir} onSort={(k) => handleSort(k as any)} />
                    <TableSortHeader label={t('pages.reports.table.openingBalance', 'Opening Balance')} sortKey={'openingBalance'} currentSortBy={sortBy} currentSortDir={sortDir} onSort={(k) => handleSort(k as any)} />
                    <TableSortHeader label={t('pages.reports.table.debit', 'Debit')} sortKey={'debit'} currentSortBy={sortBy} currentSortDir={sortDir} onSort={(k) => handleSort(k as any)} />
                    <TableSortHeader label={t('pages.reports.table.credit', 'Credit')} sortKey={'credit'} currentSortBy={sortBy} currentSortDir={sortDir} onSort={(k) => handleSort(k as any)} />
                    <TableSortHeader label={t('pages.reports.table.closingBalance', 'Closing Balance')} sortKey={'closingBalance'} currentSortBy={sortBy} currentSortDir={sortDir} onSort={(k) => handleSort(k as any)} />
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((r) => (
                    <tr key={`${tab}-${r.accountCode}`} className="even:bg-gray-50">
                      <td className="px-3 py-2 border-b border-gray-300 text-center">
                        <input
                          type="checkbox"
                          checked={
                            tab === 'group' ? filters.groups.includes(toAsciiDigits(String(r.accountCode))) :
                            tab === 'general' ? filters.generals.includes(toAsciiDigits(String(r.accountCode))) :
                            tab === 'specific' ? filters.specifics.includes(toAsciiDigits(String(r.accountCode))) :
                            filters.details.includes(toAsciiDigits(String(r.accountCode)))
                          }
                          onChange={() => toggleFilter(tab, String(r.accountCode))}
                          aria-label={t('pages.reports.table.filterByCode', 'فیلتر بر اساس کد')}
                        />
                      </td>
                      <td className="px-3 py-2 border-b border-gray-300 text-right">{r.accountCode}</td>
                      <td className="px-3 py-2 border-b border-gray-300 text-right">{r.accountName}</td>
                      <td className={`px-3 py-2 border-b border-gray-300 text-right ${r.openingBalance < 0 ? 'text-red-600' : ''}`}>{formatCurrency(r.openingBalance, lang)}</td>
                      <td className={`px-3 py-2 border-b border-gray-300 text-right ${r.debit < 0 ? 'text-red-600' : ''}`}>{formatCurrency(r.debit, lang)}</td>
                      <td className={`px-3 py-2 border-b border-gray-300 text-right ${r.credit < 0 ? 'text-red-600' : ''}`}>{formatCurrency(r.credit, lang)}</td>
                      <td className={`px-3 py-2 border-b border-gray-300 text-right ${r.closingBalance < 0 ? 'text-red-600' : ''}`}>{formatCurrency(r.closingBalance, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={sortedRows.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                className="mt-3"
              />
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default AccountsReviewReportPage;
