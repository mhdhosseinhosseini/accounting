/**
 * JournalReportBuilderPage
 * Dynamic report builder for Journals and Journal Items with:
 * - Selectable columns from journal and item fields
 * - Advanced filters (date range, document range, hierarchical codes)
 * - Grouping by Group/Main/Special/Detail with per-group totals
 * - Exports (CSV, Excel, PDF)
 * فارسی: سازنده گزارش پویا برای اسناد و اقلام سند با انتخاب ستون‌ها، فیلترها و گروه‌بندی.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import { getCurrentLang } from '../i18n';
import config from '../config';
import JalaliDateRangePicker from '../components/common/JalaliDateRangePicker';
import MultiSelect, { MultiSelectOption } from '../components/common/MultiSelect';
import NumericInput from '../components/common/NumericInput';
import Pagination from '../components/common/Pagination';
import { Download, FileDown, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import moment from 'moment-jalaali';

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
  description?: string | null;
  running_balance?: number;
}

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
 * ReportColumnKey
 * Supported dynamic columns mapping to journal/item fields.
 */
type ReportColumnKey =
  | 'date'
  | 'journal_code'
  | 'description'
  | 'group_code'
  | 'general_code'
  | 'specific_code'
  | 'detail_code'
  | 'debit'
  | 'credit'
  | 'running_balance';

/**
 * GroupKey
 * Supported grouping keys by hierarchical codes.
 */
type GroupKey = 'journal_code' | 'group_code' | 'general_code' | 'specific_code' | 'detail_code';

/**
 * GroupedBlock
 * Represents a grouped set of rows and their totals.
 */
interface GroupedBlock {
  keyParts: Record<GroupKey, string | null>;
  rows: JournalPivotRawItem[];
  totalDebit: number;
  totalCredit: number;
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
 * detailCodeOf
 * Returns ASCII-normalized detail code string (no slicing).
 */
function detailCodeOf(detailCode: string | number | null | undefined): string {
  const raw = String(detailCode ?? '').trim();
  return toAsciiDigits(raw);
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
 * parseIsoDateToLocalMidday
 * Parses ISO `YYYY-MM-DD` safely and sets time to 12:00 local to avoid day-shift issues.
 */
function parseIsoDateToLocalMidday(s?: string | null): Date | null {
  if (!s) return null;
  const parts = String(s).split('-');
  if (parts.length !== 3) return null;
  const [yy, mm, dd] = parts.map((p) => parseInt(p, 10));
  if ([yy, mm, dd].some((n) => Number.isNaN(n))) return null;
  return new Date(yy, mm - 1, dd, 12, 0, 0, 0);
}

/**
 * JournalReportBuilderPage
 * Builds dynamic report based on selected columns, filters, and grouping.
 */
const JournalReportBuilderPage: React.FC = () => {
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

  // Hierarchical filters (OR within same type, AND across types)
  const [groupFilter, setGroupFilter] = useState<string[]>([]);
  const [generalFilter, setGeneralFilter] = useState<string[]>([]);
  const [specificFilter, setSpecificFilter] = useState<string[]>([]);
  const [detailFilter, setDetailFilter] = useState<string[]>([]);

  // Titles and hierarchy relationships
  const [groupTitles, setGroupTitles] = useState<Record<string, string>>({});
  const [generalTitles, setGeneralTitles] = useState<Record<string, string>>({});
  const [specificTitles, setSpecificTitles] = useState<Record<string, string>>({});
  const [detailTitles, setDetailTitles] = useState<Record<string, string>>({});
  const [groupToGenerals, setGroupToGenerals] = useState<Record<string, string[]>>({});
  const [generalToSpecifics, setGeneralToSpecifics] = useState<Record<string, string[]>>({});

  // Raw items and cache
  const [rawItems, setRawItems] = useState<JournalPivotRawItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const cacheRef = useRef<Map<string, JournalPivotRawItem[]>>(new Map());

  // Column selection and grouping
  const [selectedColumns, setSelectedColumns] = useState<ReportColumnKey[]>(['date', 'journal_code', 'group_code', 'general_code', 'specific_code', 'detail_code', 'debit', 'credit']);
  const [groupBy, setGroupBy] = useState<GroupKey[]>([]);
  const [consolidateEnabled, setConsolidateEnabled] = useState<boolean>(false);
  const [consolidateWithinDoc, setConsolidateWithinDoc] = useState<boolean>(true);
  const [consolidateTargets, setConsolidateTargets] = useState<GroupKey[]>(['specific_code', 'detail_code']);
  const [showGroupTotals, setShowGroupTotals] = useState<boolean>(true);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [statusFilter, setStatusFilter] = useState<'all' | 'permanent' | 'temporary' | 'draft'>('all');
  const [dragCol, setDragCol] = useState<ReportColumnKey | null>(null);
  const [saveName, setSaveName] = useState<string>('');
  const [savedConfigs, setSavedConfigs] = useState<Array<{ id: string; name: string; ts: number; version: number; data: Record<string, unknown> }>>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [cfgMessage, setCfgMessage] = useState<string>('');
  const [cfgBusy, setCfgBusy] = useState<boolean>(false);

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
        const mCode = generalCodeOf(s.code);
        const sCode = specificCodeOf(s.code);
        if (!m2s[mCode]) m2s[mCode] = [];
        if (!m2s[mCode].includes(sCode)) m2s[mCode].push(sCode);
      }
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
   * Fetches all details to build a title map and filter options.
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
      `status=${statusFilter}`,
    ];
    return parts.join('|');
  }

  function buildCurrentConfig(): Record<string, unknown> {
    const cfg: Record<string, unknown> = {};
    cfg['dateFrom'] = dateFrom ? formatDateYmd(dateFrom) : null;
    cfg['dateTo'] = dateTo ? formatDateYmd(dateTo) : null;
    cfg['docFrom'] = docFrom ?? null;
    cfg['docTo'] = docTo ?? null;
    cfg['groupFilter'] = groupFilter.slice();
    cfg['generalFilter'] = generalFilter.slice();
    cfg['specificFilter'] = specificFilter.slice();
    cfg['detailFilter'] = detailFilter.slice();
    cfg['statusFilter'] = statusFilter;
    cfg['selectedColumns'] = selectedColumns.slice();
    cfg['groupBy'] = groupBy.slice();
    cfg['consolidateEnabled'] = consolidateEnabled;
    cfg['consolidateTargets'] = consolidateTargets.slice();
    cfg['consolidateWithinDoc'] = consolidateWithinDoc;
    cfg['showGroupTotals'] = showGroupTotals;
    cfg['pageSize'] = pageSize;
    cfg['sortKey'] = null;
    cfg['sortDir'] = null;
    cfg['lang'] = lang;
    return cfg;
  }

  function packConfig(obj: Record<string, unknown>): { version: number; data: Record<string, unknown> } {
    const map: Record<string, string> = {
      dateFrom: 'a',
      dateTo: 'b',
      docFrom: 'c',
      docTo: 'd',
      groupFilter: 'e',
      generalFilter: 'f',
      specificFilter: 'g',
      detailFilter: 'h',
      statusFilter: 'i',
      selectedColumns: 'j',
      groupBy: 'k',
      consolidateEnabled: 'l',
      consolidateTargets: 'm',
      consolidateWithinDoc: 'n',
      showGroupTotals: 'o',
      pageSize: 'p',
      sortKey: 'q',
      sortDir: 'r',
      lang: 's',
    };
    const out: Record<string, unknown> = {};
    Object.keys(map).forEach((k) => {
      out[map[k]] = obj[k];
    });
    return { version: 1, data: out };
  }

  function unpackConfig(packed: { version: number; data: Record<string, unknown> } | null): Record<string, unknown> | null {
    if (!packed || typeof packed !== 'object') return null;
    const map: Record<string, string> = {
      a: 'dateFrom',
      b: 'dateTo',
      c: 'docFrom',
      d: 'docTo',
      e: 'groupFilter',
      f: 'generalFilter',
      g: 'specificFilter',
      h: 'detailFilter',
      i: 'statusFilter',
      j: 'selectedColumns',
      k: 'groupBy',
      l: 'consolidateEnabled',
      m: 'consolidateTargets',
      n: 'consolidateWithinDoc',
      o: 'showGroupTotals',
      p: 'pageSize',
      q: 'sortKey',
      r: 'sortDir',
      s: 'lang',
    };
    const data = packed.data || {};
    const out: Record<string, unknown> = {};
    Object.keys(map).forEach((shortKey) => {
      out[map[shortKey]] = data[shortKey];
    });
    return out;
  }

  function loadSavedConfigs(): void {
    try {
      const raw = localStorage.getItem('notebook_report_configs');
      if (!raw) {
        setSavedConfigs([]);
        return;
      }
      const arr = JSON.parse(raw) as Array<{ id: string; name: string; ts: number; version: number; data: Record<string, unknown> }>;
      if (Array.isArray(arr)) {
        setSavedConfigs(arr.slice(0, 10));
      } else {
        setSavedConfigs([]);
      }
    } catch {
      setSavedConfigs([]);
    }
  }

  function saveCurrentConfig(): void {
    if (!saveName.trim()) {
      setCfgMessage(t('pages.reports.config.error', rtl ? 'ثبت نام تنظیمات نامعتبر است' : 'Invalid config name'));
      setTimeout(() => setCfgMessage(''), 2000);
      return;
    }
    setCfgBusy(true);
    try {
      const payload = packConfig(buildCurrentConfig());
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const entry = { id, name: saveName.trim(), ts: Date.now(), version: payload.version, data: payload.data };
      const next = [entry, ...savedConfigs].slice(0, 10);
      localStorage.setItem('notebook_report_configs', JSON.stringify(next));
      setSavedConfigs(next);
      setSelectedConfigId(entry.id);
      setCfgMessage(t('pages.reports.config.saved', rtl ? 'تنظیمات ذخیره شد' : 'Saved configuration'));
      setTimeout(() => setCfgMessage(''), 2000);
    } catch (err) {
      const msg = (err as any)?.name === 'QuotaExceededError'
        ? t('pages.reports.config.storageFull', rtl ? 'فضای ذخیره‌سازی پر شده است' : 'Storage limit reached')
        : t('pages.reports.config.error', rtl ? 'ذخیره تنظیمات ناموفق بود' : 'Could not save configuration');
      setCfgMessage(msg);
      setTimeout(() => setCfgMessage(''), 2500);
    } finally {
      setCfgBusy(false);
    }
  }

  function applyConfig(conf: Record<string, unknown> | null): void {
    if (!conf) {
      setCfgMessage(t('pages.reports.config.error', rtl ? 'بارگذاری تنظیمات نامعتبر' : 'Could not apply configuration'));
      setTimeout(() => setCfgMessage(''), 2500);
      return;
    }
    try {
      const dfStr = conf['dateFrom'] as string | null;
      const dtStr = conf['dateTo'] as string | null;
      setDateFrom(dfStr ? parseIsoDateToLocalMidday(dfStr) : null);
      setDateTo(dtStr ? parseIsoDateToLocalMidday(dtStr) : null);
      setDocFrom((conf['docFrom'] as number | null) ?? null);
      setDocTo((conf['docTo'] as number | null) ?? null);
      setGroupFilter(Array.isArray(conf['groupFilter']) ? (conf['groupFilter'] as string[]) : []);
      setGeneralFilter(Array.isArray(conf['generalFilter']) ? (conf['generalFilter'] as string[]) : []);
      setSpecificFilter(Array.isArray(conf['specificFilter']) ? (conf['specificFilter'] as string[]) : []);
      setDetailFilter(Array.isArray(conf['detailFilter']) ? (conf['detailFilter'] as string[]) : []);
      setStatusFilter((conf['statusFilter'] as any) ?? 'all');
      setSelectedColumns(Array.isArray(conf['selectedColumns']) ? (conf['selectedColumns'] as ReportColumnKey[]) : selectedColumns);
      setGroupBy(Array.isArray(conf['groupBy']) ? (conf['groupBy'] as GroupKey[]) : groupBy);
      setConsolidateEnabled(Boolean(conf['consolidateEnabled']));
      setConsolidateTargets(Array.isArray(conf['consolidateTargets']) ? (conf['consolidateTargets'] as GroupKey[]) : consolidateTargets);
      setConsolidateWithinDoc(true);
      setShowGroupTotals(Boolean(conf['showGroupTotals']));
      setPageSize(Number(conf['pageSize'] ?? pageSize));
      setCfgMessage(t('pages.reports.config.loaded', rtl ? 'تنظیمات بارگذاری شد' : 'Loaded configuration'));
      setTimeout(() => setCfgMessage(''), 2000);
    } catch {
      setCfgMessage(t('pages.reports.config.error', rtl ? 'بارگذاری تنظیمات ناموفق بود' : 'Could not apply configuration'));
      setTimeout(() => setCfgMessage(''), 2500);
    }
  }

  function handleLoadSelected(): void {
    const entry = savedConfigs.find((c) => c.id === selectedConfigId);
    if (!entry) {
      setCfgMessage(t('pages.reports.config.error', rtl ? 'گزینه ذخیره‌شده یافت نشد' : 'Saved configuration not found'));
      setTimeout(() => setCfgMessage(''), 2000);
      return;
    }
    applyConfig(unpackConfig({ version: entry.version, data: entry.data }));
  }

  function handleDeleteSelected(): void {
    const idx = savedConfigs.findIndex((c) => c.id === selectedConfigId);
    if (idx === -1) return;
    const next = savedConfigs.slice(0, idx).concat(savedConfigs.slice(idx + 1));
    localStorage.setItem('notebook_report_configs', JSON.stringify(next));
    setSavedConfigs(next);
    setSelectedConfigId('');
    setCfgMessage(t('pages.reports.config.deleted', rtl ? 'تنظیمات حذف شد' : 'Deleted configuration'));
    setTimeout(() => setCfgMessage(''), 2000);
  }

  /**
   * applyFilters
   * Applies AND across code types, OR within a code type, and ranges for date and document numbers.
   */
  function applyFilters(items: JournalPivotRawItem[]): JournalPivotRawItem[] {
    const gSet = new Set(groupFilter.map((c) => toAsciiDigits(c)));
    const mSet = new Set(generalFilter.map((c) => toAsciiDigits(c)));
    const sSet = new Set(specificFilter.map((c) => toAsciiDigits(c)));
    const dSet = new Set(detailFilter.map((c) => toAsciiDigits(c)));
    const anyActive = gSet.size || mSet.size || sSet.size || dSet.size;
    return items.filter((it) => {
      if (dateFrom && it.date < formatDateYmd(dateFrom)) return false;
      if (dateTo && it.date > formatDateYmd(dateTo)) return false;
      if (docFrom != null && (Number(it.journal_code || 0) < Number(docFrom))) return false;
      if (docTo != null && (Number(it.journal_code || 0) > Number(docTo))) return false;
      if (!anyActive) return true;
      const acc = String(it.account_code || '');
      const g = groupCodeOf(acc);
      const m = generalCodeOf(acc);
      const s = specificCodeOf(acc);
      const d = detailCodeOf(it.detail_code);
      if (gSet.size && !gSet.has(g)) return false;
      if (mSet.size && !mSet.has(m)) return false;
      if (sSet.size && !sSet.has(s)) return false;
      if (dSet.size && !dSet.has(d)) return false;
      return true;
    });
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
   * fetchRawItems
   * Calls `/v1/reports/journals-pivot-raw` and applies client-side precise filters.
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
      const params: Record<string, string | number> = {
        fiscal_year_id: fyId!,
        start_date: formatDateYmd(dateFrom!),
        end_date: formatDateYmd(dateTo!),
        status: statusFilter,
        row_dim: 'date',
        col_dim: 'status',
      };
      if (docFrom != null) params.journal_code_from = Number(docFrom);
      if (docTo != null) params.journal_code_to = Number(docTo);
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/reports/journals-pivot-raw`, { params, headers: { 'Accept-Language': lang } });
      const items = (res.data?.items || []) as JournalPivotRawItem[];
      const filtered = applyFilters(items);
      cacheRef.current.set(sig, filtered);
      setRawItems(filtered);
    } catch {
      setError(t('fetch.error', 'Failed to fetch data'));
      setRawItems([]);
    } finally {
      setLoading(false);
    }
  }

  /**
   * buildColumnOptions
   * Options for dynamic column selection UI.
   */
  const columnOptions: MultiSelectOption[] = useMemo(() => {
    return [
      { value: 'date', label: t('fields.date', rtl ? 'تاریخ' : 'Date') },
      { value: 'journal_code', label: t('fields.documentNumber', rtl ? 'شماره سند' : 'Document Number') },
      { value: 'description', label: t('fields.description', rtl ? 'توضیحات' : 'Description') },
      { value: 'group_code', label: t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group') },
      { value: 'general_code', label: t('pages.reports.tabs.general', rtl ? 'کل' : 'Main') },
      { value: 'specific_code', label: t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special') },
      { value: 'detail_code', label: t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail') },
      { value: 'debit', label: t('pages.reports.table.debit', rtl ? 'بدهکار' : 'Debit') },
      { value: 'credit', label: t('pages.reports.table.credit', rtl ? 'بستانکار' : 'Credit') },
      { value: 'running_balance', label: t('pages.reports.table.runningBalance', rtl ? 'مانده جاری' : 'Running Balance') },
    ];
  }, [t, rtl]);

  /**
   * buildGroupByOptions
   * Options for grouping selection UI.
   */
  const groupByOptions: MultiSelectOption[] = useMemo(() => {
    return [
      { value: 'journal_code', label: t('fields.documentNumber', rtl ? 'شماره سند' : 'Document Number') },
      { value: 'group_code', label: t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group') },
      { value: 'general_code', label: t('pages.reports.tabs.general', rtl ? 'کل' : 'Main') },
      { value: 'specific_code', label: t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special') },
      { value: 'detail_code', label: t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail') },
    ];
  }, [t, rtl]);

  /**
   * buildFilterOptions
   * Multi-select options for hierarchical code filters.
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
   * groupedBlocks
   * Groups items by selected keys in hierarchy order and computes per-group totals.
   * فارسی: گروه‌بندی اقلام بر اساس کلیدهای انتخابی و محاسبه جمع هر گروه.
   */
  const groupedBlocks: GroupedBlock[] = useMemo(() => {
    if (!groupBy.length) {
      const totalDebit = rawItems.reduce((acc, it) => acc + Number(it.debit || 0), 0);
      const totalCredit = rawItems.reduce((acc, it) => acc + Number(it.credit || 0), 0);
      return [{ keyParts: { journal_code: null, group_code: null, general_code: null, specific_code: null, detail_code: null }, rows: rawItems, totalDebit, totalCredit }];
    }
    // Fixed hierarchy order: journal_code -> group -> general -> specific -> detail
    const order: GroupKey[] = ['journal_code', 'group_code', 'general_code', 'specific_code', 'detail_code'];
    const keys = order.filter((k) => groupBy.includes(k));
    let effectiveKeys = keys.slice();
    if (consolidateEnabled) {
      const primary = effectiveKeys[0];
      if (primary) {
        const removable = new Set(consolidateTargets.filter((k) => k !== primary));
        effectiveKeys = effectiveKeys.filter((k) => !removable.has(k));
      }
      if (effectiveKeys.includes('journal_code') && consolidateWithinDoc) {
        effectiveKeys = ['journal_code'];
      }
    }
    const map = new Map<string, GroupedBlock>();
    const titleKey = (k: GroupKey, v: string) => `${k}:${v}`;
    for (const it of rawItems) {
      const parts: Record<GroupKey, string | null> = {
        journal_code: keys.includes('journal_code') ? String(it.journal_code ?? '') : null,
        group_code: keys.includes('group_code') ? groupCodeOf(it.account_code) : null,
        general_code: keys.includes('general_code') ? generalCodeOf(it.account_code) : null,
        specific_code: keys.includes('specific_code') ? specificCodeOf(it.account_code) : null,
        detail_code: keys.includes('detail_code') ? detailCodeOf(it.detail_code) : null,
      };
      const key = effectiveKeys.map((k) => titleKey(k, String(parts[k] || ''))).join('|');
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(it);
        existing.totalDebit += Number(it.debit || 0);
        existing.totalCredit += Number(it.credit || 0);
      } else {
        map.set(key, {
          keyParts: parts,
          rows: [it],
          totalDebit: Number(it.debit || 0),
          totalCredit: Number(it.credit || 0),
        });
      }
    }
    // Stable sort by key
    return Array.from(map.values()).sort((a, b) => {
      const aKey = effectiveKeys.map((k) => String(a.keyParts[k] || '')).join('|');
      const bKey = effectiveKeys.map((k) => String(b.keyParts[k] || '')).join('|');
      return aKey.localeCompare(bKey, undefined, { numeric: true });
    });
  }, [rawItems, groupBy, consolidateEnabled, consolidateTargets, consolidateWithinDoc]);

  /**
   * getHeaderLabelForKey
   * Builds a localized header label for any level with code and count.
   * فارسی: ساخت برچسبِ سرتاسری برای هر سطح با کد و تعداد.
   */
  function getHeaderLabelForKey(level: GroupKey, code: string, count: number): string {
    const prefix =
      level === 'journal_code' ? t('fields.documentNumber', rtl ? 'شماره سند' : 'Document Number') :
      level === 'group_code' ? t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group') :
      level === 'general_code' ? t('pages.reports.tabs.general', rtl ? 'کل' : 'Main') :
      level === 'specific_code' ? t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special') :
      t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail');
    const title =
      level === 'journal_code' ? '' :
      level === 'group_code' ? (groupTitles[code] || '') :
      level === 'general_code' ? (generalTitles[code] || '') :
      level === 'specific_code' ? (specificTitles[code] || '') :
      (detailTitles[code] || '');
    const countLabel = t('pages.reports.groupHeader.count', rtl ? 'تعداد' : 'Count');
    const joinedTitle = title ? ` — ${title}` : '';
    return `${prefix}: ${code}${joinedTitle} (${countLabel}: ${formatCurrency(count)})`;
  }

  /**
   * flattenBlocksHierarchical
   * Recursively flattens grouped blocks into header rows per selected level, rows, and totals.
   * فارسی: تبدیل گروه‌ها به ردیف‌های سربرگ چندسطحی، ردیف‌ها و جمع‌ها به‌صورت بازگشتی.
   */
  type FlatRow = { kind: 'header'; level: GroupKey; code: string; count: number } | { kind: 'row'; item: JournalPivotRawItem } | { kind: 'total'; block: GroupedBlock };
  type NonJournalKey = Exclude<GroupKey, 'journal_code'>;
  function consolidateRows(rows: JournalPivotRawItem[], targets: GroupKey[]): JournalPivotRawItem[] {
    const selected = targets.filter((t) => t !== 'journal_code') as NonJournalKey[];
    if (!consolidateEnabled || selected.length === 0) return rows;
    const orderByGranularity: NonJournalKey[] = ['group_code', 'general_code', 'specific_code', 'detail_code'];
    const pickStrict = orderByGranularity.filter((k) => selected.includes(k)).slice(-1)[0];
    const chosen: NonJournalKey | undefined = pickStrict;
    if (!chosen) return rows;
    const keyOf = (it: JournalPivotRawItem): string => {
      if (chosen === 'group_code') return groupCodeOf(it.account_code);
      if (chosen === 'general_code') return generalCodeOf(it.account_code);
      if (chosen === 'specific_code') return specificCodeOf(it.account_code);
      return detailCodeOf(it.detail_code);
    };
    const grouped = new Map<string, { debit: number; credit: number; sample: JournalPivotRawItem; minDate: string }>();
    for (const it of rows) {
      const k = `${chosen}:${keyOf(it)}`;
      const prev = grouped.get(k);
      if (prev) {
        prev.debit += Number(it.debit || 0);
        prev.credit += Number(it.credit || 0);
        const d = String(it.date || '');
        if (!prev.minDate || (d && d < prev.minDate)) prev.minDate = d;
      } else {
        grouped.set(k, { debit: Number(it.debit || 0), credit: Number(it.credit || 0), sample: it, minDate: String(it.date || '') });
      }
    }
    const out: JournalPivotRawItem[] = [];
    for (const [k, rec] of Array.from(grouped.entries()).sort((a, b) => {
      const ka = a[0].split(':')[1] || '';
      const kb = b[0].split(':')[1] || '';
      return ka.localeCompare(kb, undefined, { numeric: true });
    })) {
      const sample = rec.sample;
      const codeVal = k.split(':')[1] || '';
      const accountCodeForSpecific = chosen === 'specific_code' ? codeVal : String(sample.account_code || '');
      const detailCodeForDetail = chosen === 'detail_code' ? codeVal : String(sample.detail_code || '');
      out.push({
        date: rec.minDate || String(sample.date || ''),
        journal_code: consolidateWithinDoc ? sample.journal_code ?? null : null,
        account_code: accountCodeForSpecific || null,
        detail_code: detailCodeForDetail || null,
        debit: rec.debit,
        credit: rec.credit,
        description: null,
        running_balance: 0,
      });
    }
    const sortKey = (it: JournalPivotRawItem): string => {
      if (chosen === 'group_code') return groupCodeOf(it.account_code);
      if (chosen === 'general_code') return generalCodeOf(it.account_code);
      if (chosen === 'specific_code') return specificCodeOf(it.account_code);
      return detailCodeOf(it.detail_code);
    };
    return out.sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true }));
  }
  function flattenBlocksHierarchical(
    blocks: GroupedBlock[],
    keys: GroupKey[],
    accRef?: { value: number },
    resetLevel?: GroupKey
  ): FlatRow[] {
    if (!keys.length) {
      const out: FlatRow[] = [];
      const acc = accRef || { value: 0 };
      for (const gb of blocks) {
        const displayRows = consolidateRows(gb.rows, consolidateTargets);
        for (const r of displayRows) {
          const delta = Number(r.debit || 0) - Number(r.credit || 0);
          acc.value += delta;
          const cloned: JournalPivotRawItem = { ...r, running_balance: acc.value };
          out.push({ kind: 'row', item: cloned });
        }
        if (showGroupTotals) out.push({ kind: 'total', block: gb });
      }
      return out;
    }
    const level = keys[0];
    const buckets = new Map<string, GroupedBlock[]>();
    for (const gb of blocks) {
      const code = String(gb.keyParts[level] || '');
      const list = buckets.get(code) || [];
      list.push(gb);
      buckets.set(code, list);
    }
    const codes = Array.from(buckets.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const out: FlatRow[] = [];
    for (const code of codes) {
      const sub = buckets.get(code)!;
      const count = sub.reduce((acc, b) => acc + b.rows.length, 0);
      out.push({ kind: 'header', level, code, count });
      const childAcc = level === resetLevel ? { value: 0 } : (accRef || { value: 0 });
      out.push(...flattenBlocksHierarchical(sub, keys.slice(1), childAcc, resetLevel));
    }
    return out;
  }

  /**
   * visibleBlocks
   * Applies pagination to flattened hierarchical rows.
   * فارسی: اِعمال صفحه‌بندی روی خروجی تخت‌شده‌ی چندسطحی.
   */
  const allFlatRows: FlatRow[] = useMemo(() => {
    if (!groupBy.length) {
      const flat: FlatRow[] = [];
      for (const gb of groupedBlocks) {
        const displayRows = consolidateRows(gb.rows, consolidateTargets);
        let acc = 0;
        for (const r of displayRows) {
          const delta = Number(r.debit || 0) - Number(r.credit || 0);
          acc += delta;
          const cloned: JournalPivotRawItem = { ...r, running_balance: acc };
          flat.push({ kind: 'row', item: cloned });
        }
        if (showGroupTotals) flat.push({ kind: 'total', block: gb });
      }
      return flat;
    }
    const order: GroupKey[] = ['journal_code', 'group_code', 'general_code', 'specific_code', 'detail_code'];
    let keys = order.filter((k) => groupBy.includes(k));
    if (consolidateEnabled) {
      const primary = keys[0];
      if (primary) {
        const removable = new Set(consolidateTargets.filter((k) => k !== primary));
        keys = keys.filter((k) => !removable.has(k));
      }
      if (keys.includes('journal_code') && consolidateWithinDoc) {
        keys = ['journal_code'];
      }
    }
    return flattenBlocksHierarchical(groupedBlocks, keys, undefined, keys[0]);
  }, [groupedBlocks, groupBy, consolidateEnabled, consolidateTargets, consolidateWithinDoc, showGroupTotals]);

  const visibleBlocks: FlatRow[] = useMemo(() => {
    const start = (page - 1) * pageSize;
    return allFlatRows.slice(start, start + pageSize);
  }, [allFlatRows, page, pageSize]);

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
   * getGroupHeaderLabel
   * Composes a full-width header label for each grouped block with code, title, and count.
   * فارسی: ساخت برچسبِ سرتاسری برای هر بلوک گروه‌بندی با کد، عنوان و تعداد.
   */
  function getGroupHeaderLabel(block: GroupedBlock): string {
    const order: GroupKey[] = ['group_code', 'general_code', 'specific_code', 'detail_code'];
    const keys = order.filter((k) => groupBy.includes(k));
    const primary = keys[0];
    if (!primary) return '';
    const code = String(block.keyParts[primary] || '');
    let title = '';
    if (primary === 'group_code') title = groupTitles[code] || '';
    else if (primary === 'general_code') title = generalTitles[code] || '';
    else if (primary === 'specific_code') title = specificTitles[code] || '';
    else if (primary === 'detail_code') title = detailTitles[code] || '';
    const prefix =
      primary === 'group_code' ? t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group') :
      primary === 'general_code' ? t('pages.reports.tabs.general', rtl ? 'کل' : 'Main') :
      primary === 'specific_code' ? t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special') :
      t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail');
    const countLabel = t('pages.reports.groupHeader.count', rtl ? 'تعداد' : 'Count');
    const joinedTitle = title ? ` — ${title}` : '';
    return `${prefix}: ${code}${joinedTitle} (${countLabel}: ${formatCurrency(block.rows.length)})`;
  }

  /**
   * getColumnLabel
   * Returns display label for a column key.
   */
  function getColumnLabel(col: ReportColumnKey): string {
    const opt = columnOptions.find((o) => o.value === col);
    return opt ? String(opt.label) : col;
  }

  /**
   * getCellValue
   * Returns display value for a given item column based on selected key.
   */
  function getCellValue(it: JournalPivotRawItem, col: ReportColumnKey): string {
    switch (col) {
      case 'date':
        return it.date ? formatDateJalali(new Date(it.date)) : '';
      case 'journal_code':
        return String(it.journal_code ?? '');
      case 'description':
        return String(it.description ?? '');
      case 'running_balance':
        return formatCurrency(Number(it.running_balance || 0));
      case 'group_code': {
        const g = groupCodeOf(it.account_code);
        return `${g}${groupTitles[g] ? ` — ${groupTitles[g]}` : ''}`;
      }
      case 'general_code': {
        const m = generalCodeOf(it.account_code);
        return `${m}${generalTitles[m] ? ` — ${generalTitles[m]}` : ''}`;
      }
      case 'specific_code': {
        const s = specificCodeOf(it.account_code);
        return `${s}${specificTitles[s] ? ` — ${specificTitles[s]}` : ''}`;
      }
      case 'detail_code': {
        const d = detailCodeOf(it.detail_code);
        return `${d}${detailTitles[d] ? ` — ${detailTitles[d]}` : ''}`;
      }
      case 'debit':
        return formatCurrency(Number(it.debit || 0));
      case 'credit':
        return formatCurrency(Number(it.credit || 0));
      default:
        return '';
    }
  }

  /**
   * handleThDragStart
   * Starts a drag operation for a table header to reorder columns.
   * فارسی: شروع کشیدن برای جابجایی ستون‌های جدول.
   */
  function handleThDragStart(e: React.DragEvent<HTMLTableCellElement>, col: ReportColumnKey): void {
    try {
      e.dataTransfer.setData('text/col', col);
      setDragCol(col);
    } catch {
      setDragCol(col);
    }
  }

  /**
   * handleThDragOver
   * Allows dropping by preventing default on drag over header cell.
   * فارسی: اجازه رها کردن با جلوگیری از پیش‌فرض در رویداد کشیدن روی سرستون.
   */
  function handleThDragOver(e: React.DragEvent<HTMLTableCellElement>): void {
    e.preventDefault();
  }

  /**
   * handleThDrop
   * Drops a dragged header onto target header and reorders selectedColumns.
   * فارسی: رها کردن سرستون کشیده‌شده روی هدف و بازچینی ستون‌ها.
   */
  function handleThDrop(e: React.DragEvent<HTMLTableCellElement>, targetCol: ReportColumnKey): void {
    e.preventDefault();
    let srcCol: any = null;
    try {
      srcCol = e.dataTransfer.getData('text/col');
    } catch {
      srcCol = dragCol;
    }
    const fromCol = String(srcCol || '') as ReportColumnKey;
    setDragCol(null);
    if (!fromCol) return;
    if (fromCol === targetCol) return;
    const fromIdx = selectedColumns.indexOf(fromCol);
    const toIdx = selectedColumns.indexOf(targetCol);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = selectedColumns.slice();
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromCol);
    setSelectedColumns(next);
  }

  /**
   * downloadCsv
   * Exports current visible rows (respecting grouping and totals) to CSV.
   */
  function downloadCsv(): void {
    const header = selectedColumns.map(getColumnLabel);
    const rows: (string | number)[][] = [header];
    for (const v of visibleBlocks) {
      if (v.kind === 'header') {
        const label = getHeaderLabelForKey(v.level, v.code, v.count);
        const empty = Array(Math.max(0, selectedColumns.length - 1)).fill('');
        rows.push([label, ...empty]);
        continue;
      }
      if (v.kind === 'row' && v.item) {
        rows.push(selectedColumns.map((col) => getCellValue(v.item!, col)));
      } else if (v.kind === 'total' && v.block) {
        const gb = v.block!;
        const label = t('pages.reports.groupTotal', rtl ? 'جمع گروه' : 'Group Total');
        const colVals = selectedColumns.map((col) => {
          if (col === 'debit') return formatCurrency(gb.totalDebit);
          if (col === 'credit') return formatCurrency(gb.totalCredit);
          return '';
        });
        rows.push([label, ...colVals.slice(1)]);
      }
    }
    const csv = rows.map((r) => r.map((c) => String(c).replace(/"/g, '""')).map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal_report_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * downloadExcel
   * Exports current visible rows to Excel (.xlsx).
   */
  function downloadExcel(): void {
    const header = selectedColumns.map(getColumnLabel);
    const aoa: (string | number)[][] = [header];
    for (const v of visibleBlocks) {
      if (v.kind === 'header') {
        const label = getHeaderLabelForKey(v.level, v.code, v.count);
        const empty = Array(Math.max(0, selectedColumns.length - 1)).fill('');
        aoa.push([label, ...empty]);
        continue;
      }
      if (v.kind === 'row' && v.item) {
        aoa.push(selectedColumns.map((col) => getCellValue(v.item!, col)));
      } else if (v.kind === 'total' && v.block) {
        const gb = v.block!;
        const label = t('pages.reports.groupTotal', rtl ? 'جمع گروه' : 'Group Total');
        const colVals = selectedColumns.map((col) => {
          if (col === 'debit') return formatCurrency(gb.totalDebit);
          if (col === 'credit') return formatCurrency(gb.totalCredit);
          return '';
        });
        aoa.push([label, ...colVals.slice(1)]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      ...Array(selectedColumns.length).fill({ wch: 20 }),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, rtl ? 'گزارش دفاتر' : 'Notebook Reports');
    if (rtl) {
      (wb as any).Workbook = { Views: [{ RTL: true }] };
      (ws as any)['!rtl'] = true;
      (ws as any)['!sheetViews'] = [{ rightToLeft: 1 }];
    }
    XLSX.writeFile(wb, `journal_report_${Date.now()}.xlsx`);
  }

  /**
   * openPrintView
   * Opens a printable view (PDF via browser print) of the current visible rows.
   */
  function openPrintView(): void {
    const title = t('pages.reports.dynamic.title', rtl ? 'گزارش دفاتر' : 'Notebook Reports');
    const rtlDir = rtl ? 'rtl' : 'ltr';
    const langAttr = rtl ? 'fa' : 'en';
    const headerRange = `${t('pages.reports.filters', rtl ? 'فیلترها' : 'Filters')}: ${dateFrom ? formatDateJalali(dateFrom) : ''} ${rtl ? 'تا' : 'to'} ${dateTo ? formatDateJalali(dateTo) : ''}`;
    const ths = selectedColumns.map(getColumnLabel);
    const bodyRows = visibleBlocks.map((v) => {
      if (v.kind === 'header') {
        const label = getHeaderLabelForKey(v.level, v.code, v.count);
        return `<tr class="group-header"><td colspan="${selectedColumns.length}">${label}</td></tr>`;
      } else
      if (v.kind === 'row') {
        return `<tr>${selectedColumns.map((c) => `<td>${getCellValue(v.item, c)}</td>`).join('')}</tr>`;
      } else {
        const gb = v.block;
        const label = t('pages.reports.groupTotal', rtl ? 'جمع گروه' : 'Group Total');
        const cells = selectedColumns.map((col, idx) => {
          if (idx === 0) return `<td>${label}</td>`;
          if (col === 'debit') return `<td class="amount">${formatCurrency(gb.totalDebit)}</td>`;
          if (col === 'credit') return `<td class="amount">${formatCurrency(gb.totalCredit)}</td>`;
          return `<td></td>`;
        }).join('');
        return `<tr class="group-total">${cells}</tr>`;
      }
    }).join('\n');
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
  .group-total { background: #f8fafc; font-weight: 600; }
  @page { size: A4 landscape; margin: 10mm 6mm; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="muted">${headerRange}</div>
  <style>.group-header { background: #eef2ff; font-weight: 600; }</style>
  <table>
    <thead>
      <tr>${ths.map((h) => `<th>${h}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
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
  useEffect(() => { fetchFiscalYears(); loadSavedConfigs(); }, []);
  useEffect(() => { buildHierarchyMaps(); buildDetailTitles(); }, []);

  /**
   * Auto-refresh raw items when filters change.
   */
  useEffect(() => {
    if (fyId && dateFrom && dateTo) {
      fetchRawItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyId, dateFrom, dateTo, docFrom, docTo, groupFilter, generalFilter, specificFilter, detailFilter, statusFilter]);

  /**
   * Reset to first page when the dataset changes.
   */
  useEffect(() => { setPage(1); }, [rawItems, selectedColumns, groupBy]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="w-full max-w-none px-2 py-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">
            {t('pages.reports.dynamic.title', rtl ? 'گزارش دفاتر' : 'Notebook Reports')}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="border border-gray-300 rounded px-2 py-1 w-48"
              placeholder={t('pages.reports.config.saveName', rtl ? 'نام تنظیمات' : 'Config name')}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              disabled={cfgBusy}
            />
            <button type="button" onClick={saveCurrentConfig} disabled={cfgBusy || !saveName.trim()} className="px-3 py-1 rounded bg-blue-600 text-white">
              {t('pages.reports.config.save', rtl ? 'ذخیره' : 'Save')}
            </button>
            <select
              className="border border-gray-300 rounded px-2 py-1 w-56 bg-white"
              value={selectedConfigId}
              onChange={(e) => setSelectedConfigId(e.target.value)}
              title={t('pages.reports.config.selectSaved', rtl ? 'تنظیمات ذخیره‌شده' : 'Saved configurations')}
            >
              <option value="">{t('pages.reports.config.selectSaved', rtl ? 'تنظیمات ذخیره‌شده' : 'Saved configurations')}</option>
              {savedConfigs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={handleLoadSelected} disabled={!selectedConfigId} className="px-3 py-1 rounded bg-green-600 text-white">
              {t('pages.reports.config.load', rtl ? 'بارگذاری' : 'Load')}
            </button>
            <button type="button" onClick={handleDeleteSelected} disabled={!selectedConfigId} className="px-3 py-1 rounded bg-red-600 text-white">
              {t('pages.reports.config.delete', rtl ? 'حذف' : 'Delete')}
            </button>
            {cfgMessage && <span className="text-sm text-gray-700">{cfgMessage}</span>}
          </div>
        </div>

        {/* Filters and configuration */}
        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-3">{t('pages.reports.filters', rtl ? 'فیلترها' : 'Filters')}</h2>
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <div className="flex-1 min-w-[260px]">
                <div className="relative">
                  <input className="w-full border border-gray-300 rounded px-2 py-2 pr-8 rtl:pl-8" placeholder={t('pages.reports.search', rtl ? 'جستجو' : 'Search')} />
                  <Search className="absolute right-2 top-2.5 h-4 w-4 text-gray-500 rtl:left-2 rtl:right-auto" />
                </div>
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
                <div className="w-40">
                  <label className="block text-sm text-gray-700 mb-1">{t('pages.reports.statusFilter', rtl ? 'فیلتر وضعیت' : 'Status')}</label>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="w-full border border-gray-300 rounded px-2 py-2 bg-white">
                    <option value="all">{t('common.all', rtl ? 'همه' : 'All')}</option>
                    <option value="permanent">{t('status.permanent', rtl ? 'دائمی' : 'Permanent')}</option>
                    <option value="temporary">{t('status.temporary', rtl ? 'موقت' : 'Temporary')}</option>
                    <option value="draft">{t('status.draft', rtl ? 'پیش‌نویس' : 'Draft')}</option>
                  </select>
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
        </section>

        {/* Configuration: columns and grouping */}
        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-3">{t('pages.reports.configuration', rtl ? 'پیکربندی' : 'Configuration')}</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <MultiSelect hideLabel fullWidth searchable placeholder={t('pages.reports.columns', rtl ? 'ستون‌ها' : 'Columns')} options={columnOptions} value={selectedColumns} onChange={(vals) => setSelectedColumns(vals as ReportColumnKey[])} />
            </div>
            <div className="flex-1 min-w-[260px]">
              <MultiSelect hideLabel fullWidth searchable placeholder={t('pages.reports.groupBy', rtl ? 'گروه‌بندی بر اساس' : 'Group By')} options={groupByOptions} value={groupBy} onChange={(vals) => setGroupBy(vals as GroupKey[])} />
            </div>
            <div className="w-full flex flex-wrap items-center gap-3 mt-2">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={consolidateEnabled} onChange={(e) => setConsolidateEnabled(e.target.checked)} />
                <span>{t('pages.reports.consolidation.enable', rtl ? 'تجمیع فعال' : 'Enable Consolidation')}</span>
              </label>
              {consolidateEnabled && (
                <>
                  <div className="min-w=[260px] flex-1">
                    <MultiSelect
                      hideLabel
                      fullWidth
                      searchable
                      placeholder={t('pages.reports.consolidation.targets', rtl ? 'کدهای قابل تجمیع' : 'Consolidate Codes')}
                      options={['journal_code','group_code','general_code','specific_code','detail_code'].filter((k) => !groupBy.length || k !== (['journal_code','group_code','general_code','specific_code','detail_code'].find((kk) => groupBy.includes(kk as GroupKey)))).map((k) => ({
                        value: k,
                        label:
                          k === 'journal_code' ? t('fields.documentNumber', rtl ? 'شماره سند' : 'Document Number') :
                          k === 'group_code' ? t('pages.reports.tabs.group', rtl ? 'گروه' : 'Group') :
                          k === 'general_code' ? t('pages.reports.tabs.general', rtl ? 'کل' : 'Main') :
                          k === 'specific_code' ? t('pages.reports.tabs.specific', rtl ? 'معین' : 'Special') :
                          t('pages.reports.tabs.detail', rtl ? 'تفصیل' : 'Detail'),
                      }))}
                      value={consolidateTargets}
                      onChange={(vals) => setConsolidateTargets(vals as GroupKey[])}
                    />
                  </div>
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={showGroupTotals} onChange={(e) => setShowGroupTotals(e.target.checked)} />
                    <span>{t('pages.reports.consolidation.showTotals', rtl ? 'نمایش جمع هر گروه' : 'Show sum after each group')}</span>
                  </label>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-3">{t('pages.reports.results', rtl ? 'نتایج' : 'Results')}</h2>
          {error && (<p className="text-red-600 mb-3">{error}</p>)}
          {loading && (<p className="text-gray-600 mb-3">{t('common.loading', rtl ? 'در حال بارگذاری...' : 'Loading...')}</p>)}
          {!loading && rawItems.length === 0 && (
            <p className="text-gray-600">{t('pages.reports.resultsPlaceholder', rtl ? 'نتایج گزارش در اینجا نمایش داده می‌شود.' : 'Report results will appear here.')}</p>
          )}
          {!loading && rawItems.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {selectedColumns.map((col) => (
                      <th
                        key={col}
                        className="border border-gray-200 bg-gray-50 px-3 py-2 text-left rtl:text-right cursor-move select-none"
                        draggable
                        onDragStart={(e) => handleThDragStart(e, col)}
                        onDragOver={handleThDragOver}
                        onDrop={(e) => handleThDrop(e, col)}
                        title={rtl ? 'برای جابجایی ستون، بکشید و رها کنید' : 'Drag to reorder columns'}
                      >
                        {getColumnLabel(col)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleBlocks.map((v, idx) => {
                    if (v.kind === 'header') {
                      return (
                        <tr key={`h-${idx}`} className="bg-gray-100">
                          <td colSpan={selectedColumns.length} className="border border-gray-200 px-3 py-2 text-sm font-semibold">
                            {getHeaderLabelForKey(v.level, v.code, v.count)}
                          </td>
                        </tr>
                      );
                    }
                    if (v.kind === 'row' && v.item) {
                      return (
                        <tr key={`r-${idx}`} className="hover:bg-gray-50">
                          {selectedColumns.map((col) => (
                            <td key={`${idx}-${col}`} className={`border border-gray-200 px-3 py-2 text-sm ${col === 'debit' || col === 'credit' ? 'text-right rtl:text-left font-variant-numeric-tabular' : ''}`}>
                              {getCellValue(v.item!, col)}
                            </td>
                          ))}
                        </tr>
                      );
                    }
                    if (v.kind === 'total' && v.block) {
                      return (
                        <tr key={`t-${idx}`} className="bg-gray-50 font-medium">
                          {selectedColumns.map((col, i) => {
                            if (i === 0) return <td key={`${idx}-${col}`} className="border border-gray-200 px-3 py-2 text-sm">{t('pages.reports.groupTotal', rtl ? 'جمع گروه' : 'Group Total')}</td>;
                            if (col === 'debit') return <td key={`${idx}-${col}`} className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">{formatCurrency(v.block.totalDebit)}</td>;
                            if (col === 'credit') return <td key={`${idx}-${col}`} className="border border-gray-200 px-3 py-2 text-sm text-right rtl:text-left font-variant-numeric-tabular">{formatCurrency(v.block.totalCredit)}</td>;
                            return <td key={`${idx}-${col}`} className="border border-gray-200 px-3 py-2 text-sm"></td>;
                          })}
                        </tr>
                      );
                    }
                    return null;
                  })}
                </tbody>
              </table>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={allFlatRows.length}
                onPageChange={(p) => setPage(p)}
                onPageSizeChange={(ps) => setPageSize(ps)}
                pageSizeOptions={[10, 20, 25, 50, 100]}
                showPageSizeSelector={true}
              />
            </div>
          )}

          {/* Export actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={openPrintView} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-blue-600 text-white">
              <FileDown className="h-4 w-4" />
              {t('pages.reports.exportPdf', rtl ? 'صدور PDF' : 'Export PDF')}
            </button>
            <button type="button" onClick={downloadExcel} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-green-600 text-white">
              <Download className="h-4 w-4" />
              {t('pages.reports.exportExcel', rtl ? 'صدور Excel' : 'Export Excel')}
            </button>
            <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-gray-700 text-white">
              {rtl ? 'صدور CSV' : 'Export CSV'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};

export default JournalReportBuilderPage;
