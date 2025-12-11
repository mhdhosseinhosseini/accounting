/**
 * DocumentFormPage
 * Implements the New Document page per spec:
 * - Auto document number with uniqueness check in fiscal year
 * - Daily count computed for the selected date
 * - Default header values (type, status, provider) when coming from New
 * - Editable reference number and type in header
 * - Dynamic lines table with auto-open next row
 * - Totals and difference; Save allowed even when unbalanced (saves as draft)
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import { getCurrentLang } from '../i18n';
import JalaliDatePicker from '../components/common/JalaliDatePicker';
import { useNavigate, useSearchParams } from 'react-router-dom';
import config from '../config';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import { TextField, IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import NumericInput from '../components/common/NumericInput';
import { Button } from '../components/Button';
import SearchableSelect, { SelectableOption } from '../components/common/SearchableSelect';
import gregorian from 'react-date-object/calendars/gregorian';
import ConfirmDialog from '../components/common/ConfirmDialog';
import AlertDialog from '../components/common/AlertDialog';

interface FiscalYearRef { id: number; name: string; start_date: string; end_date: string; is_closed?: boolean; }

interface DocumentLine {
  row: number;
  code: string;
  detailCode: string;
  description: string;
  debit: string;
  credit: string;
}

/**
 * CodeOption/DetailOption
 * Extend SelectableOption with code and title fields for our selectors.
 */
interface CodeOption extends SelectableOption { code: string; title: string; nature?: number | null; can_have_details?: boolean; }
interface DetailOption extends SelectableOption { code: string; title: string; }
interface DocumentFormState {
  fyId: string | null;
  date: string; // ISO YYYY-MM-DD (Gregorian from JalaliDatePicker)
  type: string; // readonly label on New
  statusLabel: string; // readonly: "موقت" / "Temporary"
  provider: string; // readonly default provider label
  refNo: string; // read-only when present on edit; not used on new
  code: string; // Document code (header)
  description: string;
  lines: DocumentLine[];
  serialNo?: string; // read-only sequential serial number
}

/**
 * DetailLevelNode
 * Represents a node in the hierarchical detail levels tree.
 */
interface DetailLevelNode { id: string; code: string; title: string; specific_code_ids: string[]; children?: DetailLevelNode[] }

/**
 * toPersianDigits
 * Converts ASCII digits to Persian digits for localized display.
 */
function toPersianDigits(s: string): string {
  const map: Record<string, string> = {
    '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴',
    '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹',
  };
  return String(s).replace(/[0-9]/g, (d) => map[d] || d);
}

/**
 * jalaliToIso
 * Converts Jalali YYYY/MM/DD to Gregorian ISO YYYY-MM-DD for backend.
 * If input is already ISO (YYYY-MM-DD), returns it unchanged.
 */
function jalaliToIso(jalali: string): string {
  if (!jalali) return '';
  const s = jalali.trim();
  // Already ISO Gregorian
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    // Normalize digits and separators to ASCII and /
    const ascii = toAsciiDigits(s.replace(/\-/g, '/'));
    const parts = ascii.split('/');
    if (parts.length !== 3) return '';
    const [yStr, mStr, dStr] = parts;
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);
    if ([y, m, d].some((n) => Number.isNaN(n))) return '';
    const j = new DateObject({ year: y, month: m, day: d, calendar: persian });
    const gDate = j.toDate();
    const y2 = String(gDate.getFullYear()).padStart(4, '0');
    const m2 = String(gDate.getMonth() + 1).padStart(2, '0');
    const d2 = String(gDate.getDate()).padStart(2, '0');
    return `${y2}-${m2}-${d2}`;
  } catch {
    return '';
  }
}

/**
 * selectDefaultFiscalYear
 * Prefers the most recent open FY; falls back to the latest by end_date.
 */
function selectDefaultFiscalYear(list: FiscalYearRef[]): string | null {
  if (!list || list.length === 0) return null;
  const openYears = list.filter((f) => !f.is_closed);
  const pick = (arr: FiscalYearRef[]) => arr.sort((a, b) => (a.end_date > b.end_date ? 1 : -1)).slice(-1)[0];
  const chosen = (openYears.length > 0 ? pick(openYears) : pick(list));
  return String(chosen.id);
}

/**
 * toAsciiDigits
 * Converts Farsi/Arabic-Indic digits to ASCII equivalents for sorting and matching.
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
 * formatWithCommas
 * Adds thousands separators to numeric strings while preserving sign and decimals.
 */
function formatWithCommas(value: string | number): string {
  const raw = String(value);
  const ascii = toAsciiDigits(raw.replace(/,/g, ''));
  const neg = ascii.startsWith('-') ? '-' : '';
  const body = ascii.replace(/^-/, '');
  const [intPart, fracPart] = body.split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg + withCommas + (fracPart ? '.' + fracPart : '');
}

/**
 * localizeNumber
 * Formats with separators and converts digits to Persian in fa locale.
 */
function localizeNumber(value: string | number): string {
  const withCommas = formatWithCommas(value);
  return getCurrentLang() === 'fa' ? toPersianDigits(withCommas) : withCommas;
}

const DocumentFormPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isRTL = getCurrentLang() === 'fa';
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');
  const isEdit = !!editId;

  const [fiscalYears, setFiscalYears] = useState<FiscalYearRef[]>([]);
  const [form, setForm] = useState<DocumentFormState>({
    fyId: null,
    date: '',
    type: isRTL ? 'عمومی' : 'General',
    statusLabel: isRTL ? 'موقت' : 'Temporary',
    provider: isRTL ? 'حسابداری' : 'Accounting',
    refNo: '',
    code: '',
    description: '',
    lines: [{ row: 1, code: '', detailCode: '', description: '', debit: '', credit: '' }],
    serialNo: '',
  });
  // Options for codes and details
  const [codeOptions, setCodeOptions] = useState<CodeOption[]>([]);
  const [detailOptions, setDetailOptions] = useState<DetailOption[]>([]);
  const [editItemsRaw, setEditItemsRaw] = useState<any[]>([]);

  // Dialog state: confirm dialog for unbalanced save and alert dialog for messages
  const [confirmUnbalancedOpen, setConfirmUnbalancedOpen] = useState(false);
  const [confirmNatureMismatchOpen, setConfirmNatureMismatchOpen] = useState(false);
  const [natureMismatchMessage, setNatureMismatchMessage] = useState<string>('');
  const [alertState, setAlertState] = useState<{ open: boolean; title?: string; message: string }>({
    open: false,
    title: undefined,
    message: '',
  });

  /**
   * Row input refs and pending focus target
   * Keeps references to each row's detail input and description input, so we can
   * programmatically focus the next field after selecting a specific code.
   */
  const codeInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const detailInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const descriptionRefs = useRef<Array<HTMLInputElement | null>>([]);
  const debitInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const creditInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [pendingFocus, setPendingFocus] = useState<{ row: number; target: 'code' | 'detail' | 'description' } | null>(null);
  
  /**
   * Focus effect
   * When a pending focus target is set (after code selection), focus the detail
   * input if detail options exist for the selected code; otherwise focus the description.
   */
  useEffect(() => {
    if (!pendingFocus) return;
    const i = pendingFocus.row;
    if (pendingFocus.target === 'code') {
      const el = codeInputRefs.current[i];
      if (el) { el.focus(); }
      else { descriptionRefs.current[i]?.focus(); }
    } else if (pendingFocus.target === 'detail') {
      const el = detailInputRefs.current[i];
      if (el) { el.focus(); } else { descriptionRefs.current[i]?.focus(); }
    } else {
      descriptionRefs.current[i]?.focus();
    }
    setPendingFocus(null);
  }, [pendingFocus, form.lines]);

  /**
   * showAlert
   * Opens the AlertDialog with provided message and optional title.
   */
  function showAlert(message: string, title?: string): void {
    setAlertState({ open: true, title, message });
  }

  /**
   * closeAlert
   * Closes the AlertDialog.
   */
  function closeAlert(): void {
    setAlertState((prev) => ({ ...prev, open: false }));
  }

  // Detail-level tree and links: detail id -> array of linked leaf level ids
  const [detailLevelTree, setDetailLevelTree] = useState<DetailLevelNode[]>([]);
  const [detailLevelLinksByDetailId, setDetailLevelLinksByDetailId] = useState<Record<string, string[]>>({});

  /**
   * loadJournalForEdit
   * Loads a journal by id and pre-fills the form header fields.
   * Only metadata (date, ref_no, description, fyId, status) are set here.
   * Also caches raw items for later line mapping.
   */
  useEffect(() => {
    if (!isEdit || !editId) return;
    (async () => {
      try {
        const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals/${editId}`, { headers: { 'Accept-Language': getCurrentLang() } });
        const item = res.data?.item || res.data;
        if (!item) return;
        const statusLabel = String(item.status) === 'permanent'
          ? t('pages.documentForm.status.permanent', isRTL ? 'دائمی' : 'Permanent')
          : t('pages.documentForm.status.temporary', isRTL ? 'موقت' : 'Temporary');
        setEditItemsRaw(Array.isArray(item.items) ? item.items : []);
        setForm((prev) => ({
          ...prev,
          fyId: String(item.fiscal_year_id || prev.fyId || ''),
          date: normalizeIsoFromBackend(String(item.date || prev.date || '')),
          description: String(item.description || prev.description || ''),
          refNo: String(item.ref_no || ''),
          code: String(item.code || ''),
          type: String(item.type || prev.type || ''),
          provider: String(item.provider || prev.provider || ''),
          statusLabel,
          serialNo: String(item.serial_no || ''),
        }));
      } catch {/* noop */}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, editId, isRTL]);

  /**
   * prefillLinesFromJournal
   * When journal items load in edit mode, map to form lines using detail options.
   * Note: backend returns `account_id` not `code_id`, so code cannot be auto-set without a join.
   */
  useEffect(() => {
    if (!isEdit || editItemsRaw.length === 0) return;
    const mapped: DocumentLine[] = editItemsRaw.map((it: any, idx: number) => {
      const detOpt = detailOptions.find((o) => String(o.id) === String(it.detail_id));
      return {
        row: idx + 1,
        code: String(it.account_code || ''),
        detailCode: detOpt ? String(detOpt.code) : '',
        description: String(it.description || ''),
        debit: String(it.debit || ''),
        credit: String(it.credit || ''),
      } as DocumentLine;
    });
    // Append one empty line to allow adding a new article in edit mode
    const appended = [
      ...mapped,
      { row: mapped.length + 1, code: '', detailCode: '', description: '', debit: '', credit: '' } as DocumentLine,
    ];
    setForm((prev) => ({ ...prev, lines: mapped.length ? appended : prev.lines }));
  }, [isEdit, editItemsRaw, detailOptions]);

  /**
   * fetchCodeOptions
   * Loads Specific codes from backend and prepares selector options.
   */
  async function fetchCodeOptions(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/codes`, { headers: { 'Accept-Language': getCurrentLang() } });
      const list: any[] = res.data?.data || res.data?.items || res.data || [];
      const normalize = (s: string) => toAsciiDigits(String(s));
      const isNum = (s: string) => /^\d+$/.test(s);
      const specific = list.filter((it: any) => it?.kind === 'specific');
      const mapped: CodeOption[] = specific.map((it: any) => ({ id: String(it.id), name: `${it.code} — ${it.title}`, code: String(it.code), title: String(it.title || ''), nature: (typeof it.nature === 'number') ? it.nature : null, can_have_details: (it.can_have_details === undefined || it.can_have_details === null) ? true : !!it.can_have_details }));
      const sorted = mapped.sort((a, b) => {
        const as = normalize(a.code);
        const bs = normalize(b.code);
        if (isNum(as) && isNum(bs)) return Number(as) - Number(bs);
        return as.localeCompare(bs, undefined, { numeric: true });
      });
      setCodeOptions(sorted);
    } catch (e) {
      setCodeOptions([]);
    }
  }

  /**
   * fetchDetailOptions
   * Loads Details from backend and prepares selector options.
   */
  async function fetchDetailOptions(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/details`, { headers: { 'Accept-Language': getCurrentLang() } });
      const list: any[] = res.data?.data || res.data?.items || res.data || [];
      const normalize = (s: string) => toAsciiDigits(String(s));
      const isNum = (s: string) => /^\d+$/.test(s);
      const mapped: DetailOption[] = list.map((it: any) => ({ id: String(it.id), name: `${it.code} — ${it.title}` , code: String(it.code), title: String(it.title || '') }));
      const sorted = mapped.sort((a, b) => {
        const as = normalize(a.code);
        const bs = normalize(b.code);
        if (isNum(as) && isNum(bs)) return Number(as) - Number(bs);
        return as.localeCompare(bs, undefined, { numeric: true });
      });
      setDetailOptions(sorted);
    } catch (e) {
      setDetailOptions([]);
    }
  }

  /**
   * fetchDetailLevelsTree
   * Loads the hierarchical detail levels with associated specific code ids.
   */
  async function fetchDetailLevelsTree(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/detail-levels/tree`, { headers: { 'Accept-Language': getCurrentLang() } });
      const list: any[] = res.data?.items || res.data || [];
      const nodes: DetailLevelNode[] = Array.isArray(list) ? list.map((n: any) => ({
        id: String(n.id),
        code: String(n.code || ''),
        title: String(n.title || ''),
        specific_code_ids: Array.isArray(n.specific_code_ids) ? n.specific_code_ids.map((x: any) => String(x)) : [],
        children: Array.isArray(n.children) ? n.children : [],
      })) : [];
      setDetailLevelTree(nodes);
    } catch {
      setDetailLevelTree([]);
    }
  }

  /**
   * fetchDetailLevelLinksForDetails
   * Builds a map of detail id -> linked leaf detail-level ids.
   */
  async function fetchDetailLevelLinksForDetails(details: DetailOption[]): Promise<void> {
    const map: Record<string, string[]> = {};
    for (const d of details) {
      try {
        const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/details/${d.id}/detail-levels`, { headers: { 'Accept-Language': getCurrentLang() } });
        const arr = Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
        map[d.id] = arr.map((x: any) => String(x.id));
      } catch {
        map[d.id] = [];
      }
    }
    setDetailLevelLinksByDetailId(map);
  }

  /**
   * canSelectDetailForCode
   * Returns true if details are allowed for the given specific code.
   * Defaults to true when the flag is missing, ensuring backward compatibility.
   */
  function canSelectDetailForCode(specificCodeStr: string): boolean {
    if (!specificCodeStr) return false;
    const spec = codeOptions.find((o) => String(o.code) === String(specificCodeStr));
    const flag = spec?.can_have_details;
    return flag === undefined || flag === null ? true : !!flag;
  }

  /**
   * flattenLevels
   * Flattens the detail level tree into an array for easy searching.
   */
  function flattenLevels(nodes: DetailLevelNode[]): DetailLevelNode[] {
    const out: DetailLevelNode[] = [];
    const stack = [...nodes];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      if (n.children && n.children.length) {
        for (let i = n.children.length - 1; i >= 0; i--) {
          stack.push(n.children[i] as DetailLevelNode);
        }
      }
    }
    return out;
  }

  /**
   * getLeafLevelIdsForSpecificCode
   * Finds leaf detail-level ids whose `specific_code_ids` contain the selected specific code id.
   */
  function getLeafLevelIdsForSpecificCode(specificCodeStr: string): string[] {
    if (!specificCodeStr) return [];
    if (!canSelectDetailForCode(specificCodeStr)) return [];
    const spec = codeOptions.find((o) => String(o.code) === String(specificCodeStr));
    const specId = spec ? String(spec.id) : '';
    if (!specId) return [];
    const flat = flattenLevels(detailLevelTree);
    const leaves = flat.filter((n) => !n.children || n.children.length === 0);
    return leaves
      .filter((n) => Array.isArray(n.specific_code_ids) && n.specific_code_ids.map((x) => String(x)).includes(specId))
      .map((n) => String(n.id));
  }

  /**
   * filterDetailsForSpecificCode
   * Filters detail options to those linked to any leaf level associated with the selected specific code.
   */
  function filterDetailsForSpecificCode(specificCodeStr: string, details: DetailOption[]): DetailOption[] {
    const leafIds = getLeafLevelIdsForSpecificCode(specificCodeStr);
    if (leafIds.length === 0) return [];
    return details.filter((d) => {
      const linked = detailLevelLinksByDetailId[String(d.id)] || [];
      return linked.some((lvlId) => leafIds.includes(String(lvlId)));
    });
  }

  // Load options on mount and when language changes
  useEffect(() => {
    fetchCodeOptions();
    fetchDetailOptions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRTL]);


  /**
   * fetchFiscalYears
   * Loads fiscal years and selects default FY for the form.
   */
  async function fetchFiscalYears(): Promise<void> {
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/fiscal-years`);
      const list: FiscalYearRef[] = res.data.items || res.data || [];
      setFiscalYears(list);
      setForm((prev) => ({ ...prev, fyId: prev.fyId ?? selectDefaultFiscalYear(list) }));
    } catch {/* non-blocking */}
  }

  /**
   * computeDailyCount
   * Counts journals for selected FY and date; sets dailyCount = total + 1.
   * Compares date-only (YYYY-MM-DD) against TIMESTAMPTZ values from backend.
   */
  async function computeDailyCount(fyId: string | null, jalaliDate: string): Promise<void> {
    if (!fyId || !jalaliDate) return;
    try {
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(jalaliDate) ? jalaliDate : jalaliToIso(jalaliDate);
      if (!iso) return;
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals`);
      const items: any[] = res.data?.items || res.data || [];
      const total = items.filter((it) => {
        const fyMatch = String(it.fiscal_year_id) === String(fyId);
        const dateOnly = String(it.date).slice(0, 10);
        return fyMatch && dateOnly === iso;
      }).length;
      // Daily count disabled; no state changes here
    } catch {/* noop */}
  }

  /**
   * getNextDocumentNo
   * Scans journals in FY and returns next numeric ref_no as string.
   */
  async function getNextDocumentNo(fyId: string | null): Promise<string> {
    if (!fyId) return '1';
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals`);
      const items: any[] = res.data?.items || res.data || [];
      const nums = items
        .filter((it) => String(it.fiscal_year_id) === String(fyId))
        .map((it) => String(it.ref_no || '0'))
        .map((s) => Number(String(s).replace(/[^0-9]/g, '')))
        .filter((n) => !isNaN(n));
      const max = nums.length ? Math.max(...nums) : 0;
      return String(max + 1);
    } catch { return '1'; }
  }

  /**
   * checkDocNoUnique
   * Ensures provided reference number does not exist in selected FY (journals).
   */
  async function checkDocNoUnique(fyId: string | null, docNo: string): Promise<boolean> {
    if (!fyId || !docNo) return true;
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals`);
      const items: any[] = res.data?.items || [];
      return items.filter((it) => String(it.fiscal_year_id) === String(fyId)).every((it) => String(it.ref_no) !== String(docNo));
    } catch { return true; }
  }

  /**
   * handleChange
   * Updates top-level form fields and triggers dependent computations.
   */
  function handleChange<K extends keyof DocumentFormState>(key: K, value: DocumentFormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * handleRefNoChange
   * Normalizes and updates reference number in form state.
   */
  function handleRefNoChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const normalized = normalizeCodeInput(e.target.value);
    setForm((prev) => ({ ...prev, refNo: normalized }));
  }

  /**
   * handleTypeChange
   * Updates document type label in form state.
   */
  function handleTypeChange(e: React.ChangeEvent<HTMLInputElement>): void {
    setForm((prev) => ({ ...prev, type: e.target.value }));
  }

  /**
   * updateLine
   * Updates a line field and auto-opens next row when last row becomes complete.
   * Also clears invalid detail selection when the specific code changes using detail-level constraints.
   */
  function updateLine(index: number, patch: Partial<DocumentLine>): void {
    setForm((prev) => {
      const lines = [...prev.lines];
      const current = lines[index];
      const nextLine = { ...current, ...patch } as DocumentLine;

      // If specific code changed, only enforce can_have_details toggle
      if (Object.prototype.hasOwnProperty.call(patch, 'code')) {
        if (!canSelectDetailForCode(nextLine.code)) {
          nextLine.detailCode = '';
        }
      }

      lines[index] = nextLine;
      const last = lines[lines.length - 1];
      const isComplete = !!(last.code && (Number(last.debit) > 0 || Number(last.credit) > 0));
      if (isComplete) {
        lines.push({ row: lines.length + 1, code: '', detailCode: '', description: '', debit: '', credit: '' });
      }
      return { ...prev, lines };
    });
  }

  /**
   * copyHeaderDescriptionToRow
   * Copies the top header description into the specified row's description.
   * If the header description is blank, it leaves the row unchanged.
   */
  function copyHeaderDescriptionToRow(index: number): void {
    const header = String(form.description || '').trim();
    if (!header) return;
    updateLine(index, { description: header });
  }

  /**
   * removeLine
   * Removes a non-first line.
   */
  function removeLine(index: number): void {
    setForm((prev) => {
      if (index === 0) return prev; // keep first row
      const lines = prev.lines.filter((_, i) => i !== index).map((ln, i) => ({ ...ln, row: i + 1 }));
      return { ...prev, lines };
    });
  }

  /**
   * totals
   * Computes debit and credit sums.
   */
  const totals = useMemo(() => {
    const debit = form.lines.reduce((sum, ln) => sum + (Number(ln.debit) || 0), 0);
    const credit = form.lines.reduce((sum, ln) => sum + (Number(ln.credit) || 0), 0);
    return { debit, credit, diff: Math.abs(debit - credit) };
  }, [form.lines]);

  /**
   * handleCancel
   * Navigates back to the documents list page.
   */
  function handleCancel(): void { navigate('/documents'); }

  /**
   * attemptSave
   * Maps current form lines and posts or patches the journal.
   * Shows AlertDialog on errors; navigates back on success.
   */
  async function attemptSave(forceDraft?: boolean): Promise<void> {
    // Reference number is not used on create; do not auto-number

    // Map line selections to journals items using IDs
    const linesWithAmounts = form.lines.filter((ln) => Number(ln.debit) > 0 || Number(ln.credit) > 0);
    const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? form.date : (jalaliToIso(form.date) || form.date);
    const items = linesWithAmounts
      .map((ln) => {
        const codeOpt = codeOptions.find((o) => String(o.code) === String(ln.code));
        const detailOpt = detailOptions.find((o) => String(o.code) === String(ln.detailCode));
        return {
          code_id: codeOpt ? String(codeOpt.id) : undefined,
          detail_id: detailOpt ? String(detailOpt.id) : undefined, // optional
          debit: Number(ln.debit) || 0,
          credit: Number(ln.credit) || 0,
          description: ln.description || undefined,
        };
      })
      .filter((it) => !!it.code_id);

    if (isEdit && editId) {
      // PATCH journal: update header fields and optionally replace items when provided
      try {
        const patchPayload: any = {
          date: isoDate,
          code: form.code || undefined,
          description: form.description || undefined,
          type: form.type || undefined,
        };
        if (items.length > 0) patchPayload.items = items;
        if (forceDraft) patchPayload.force_draft = true;
        await axios.patch(`${config.API_ENDPOINTS.base}/v1/journals/${editId}`, patchPayload, { headers: { 'Accept-Language': getCurrentLang() } });
        navigate('/documents');
        return;
      } catch (e: any) {
        showAlert(t('error.generic', 'Failed to save. Please try again.'));
        return;
      }
    }

    const payload: any = {
      fiscal_year_id: form.fyId,
      date: isoDate,
      code: form.code || undefined,
      description: form.description || undefined,
      type: form.type || undefined,
      items,
    };
    if (forceDraft) payload.force_draft = true;

    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/journals`, payload, { headers: { 'Accept-Language': getCurrentLang() } });
      navigate('/documents');
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 409) {
        showAlert(t('journals.duplicateRefNo', 'Duplicate reference number'));
      } else {
        showAlert(t('error.generic', 'Failed to save. Please try again.'));
      }
    }
  }

  /**
   * findNatureMismatches
   * Returns lines where the selected specific code has a required side
   * ('Debitor' => debit-only, 'Creditor' => credit-only) but the amount
   * was entered on the wrong side.
   */
  function findNatureMismatches(lines: DocumentLine[], codes: CodeOption[]): Array<{ row: number; code: string; nature: number; wrongSide: 'debit' | 'credit' }> {
    const out: Array<{ row: number; code: string; nature: number; wrongSide: 'debit' | 'credit' }> = [];
    for (const ln of lines) {
      const codeOpt = codes.find((o) => String(o.code) === String(ln.code));
      if (!codeOpt || typeof codeOpt.nature !== 'number') continue; // no constraint
      const nature = Number(codeOpt.nature); // 0 = Debitor, 1 = Creditor
      const debitAmt = Number(ln.debit) || 0;
      const creditAmt = Number(ln.credit) || 0;
      if (nature === 0 && creditAmt > 0) {
        out.push({ row: ln.row, code: String(ln.code), nature, wrongSide: 'credit' });
      } else if (nature === 1 && debitAmt > 0) {
        out.push({ row: ln.row, code: String(ln.code), nature, wrongSide: 'debit' });
      }
    }
    return out;
  }

  /**
   * handleConfirmUnbalancedSave
   * Closes the confirm dialog and proceeds with saving.
   */
  function handleConfirmUnbalancedSave(): void {
    setConfirmUnbalancedOpen(false);
    // Proceed with the actual save using current form state
    void attemptSave();
  }

  /**
   * handleConfirmNatureMismatchSave
   * Closes the confirm dialog and proceeds with saving as draft.
   */
  function handleConfirmNatureMismatchSave(): void {
    setConfirmNatureMismatchOpen(false);
    void attemptSave(true);
  }

  /**
   * handleSave
   * Validates, then opens confirm for unbalanced saves, otherwise saves immediately.
   */
  async function handleSave(): Promise<void> {
    if (!form.fyId || !form.date) { showAlert(t('validation.dateRequired', 'Please choose a date')); return; }

    // Validate required selections for each line with amount
    const linesWithAmounts = form.lines.filter((ln) => Number(ln.debit) > 0 || Number(ln.credit) > 0);
    if (!isEdit) {
      for (const ln of linesWithAmounts) {
        if (!ln.code) { showAlert(t('validation.codeRequired', 'Please select a code')); return; }
        // Detail is optional; do not block saving
      }
    }

    // Enforce code nature side: offer draft save when violated
    const natureViolations = findNatureMismatches(linesWithAmounts, codeOptions);
    if (natureViolations.length > 0) {
      const msg = t('pages.documentForm.confirmNatureMismatchDraft', 'Some codes violate debit/credit side. Save as draft?');
      setNatureMismatchMessage(msg);
      setConfirmNatureMismatchOpen(true);
      return;
    }

    // Unbalanced Save Confirmation: open modal instead of using window.confirm
    const isUnbalanced = totals.debit !== totals.credit;
    if (isUnbalanced) {
      setConfirmUnbalancedOpen(true);
      return;
    }

    await attemptSave();
  }

  // Initial load of fiscal years
  useEffect(() => { fetchFiscalYears(); }, []);
  // Daily count disabled in this flow

  const fyLabel = useMemo(() => {
    const fy = form.fyId ? fiscalYears.find((f) => String(f.id) === form.fyId) : undefined;
    return fy ? fy.name : t('fields.fiscalYear', 'Fiscal Year');
  }, [fiscalYears, form.fyId, t]);

  return (
    <div className={"min-h-screen bg-gray-50 text-gray-900"}>
      <Navbar />
      <main className="max-w-none mx-auto px-0 md:px-2 py-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold">{t('pages.documentForm.title', 'Document Form')}</h1>
          {/* Removed fiscal year label from header per spec */}
        </div>

        <section className="bg-white rounded shadow px-3 md:px-4 py-4">
          {/* Header fields: left active, right disabled */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Active fields */}
            <div className="space-y-4">
              <TextField
                label={t('fields.documentCode', 'Document Code')}
                variant="outlined"
                fullWidth
                value={formatCodeForDisplay(form.code)}
                onChange={(e) => setForm((p) => ({ ...p, code: normalizeCodeInput(e.target.value) }))}
              />
              <div>
                <JalaliDatePicker
                  value={form.date}
                  onChange={(v: string) => handleChange('date', v)}
                  placeholder={t('fields.date', 'Date')}
                  inputClassName="w-full px-3 py-2 rounded border border-gray-300 focus:border-blue-500"
                />
              </div>
              <TextField
                label={t('fields.description', 'Description')}
                variant="outlined"
                fullWidth
                multiline
                minRows={3}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            {/* Disabled fields two-column layout */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Reference number: editable */}
              <TextField
                label={t('fields.refNo', 'Reference Number')}
                variant="outlined"
                fullWidth
                value={formatCodeForDisplay(form.refNo)}
                onChange={handleRefNoChange}
              />
              {/* Type: editable */}
              <TextField
                label={t('fields.type', 'Type')}
                variant="outlined"
                fullWidth
                value={form.type}
                onChange={handleTypeChange}
              />
              {/* Serial number: read-only */}
              <TextField
                label={t('fields.serialNo', 'Serial Number')}
                variant="outlined"
                fullWidth
                value={getCurrentLang() === 'fa' ? toPersianDigits(String(form.serialNo || '')) : String(form.serialNo || '')}
                disabled
                InputProps={{ readOnly: true }}
              />
              {/* Status: read-only */}
              <TextField
                label={t('fields.status', 'Status')}
                variant="outlined"
                fullWidth
                value={form.statusLabel}
                disabled
                InputProps={{ readOnly: true }}
              />
              {/* Provider: read-only */}
              <TextField
                label={t('fields.provider', 'Provider')}
                variant="outlined"
                fullWidth
                value={form.provider}
                disabled
                InputProps={{ readOnly: true }}
              />
            </div>

          </div>

          {/* Lines table */}
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-2">{t('fields.lines', 'Lines')}</h3>
            <table className="w-full text-left border-collapse" dir={isRTL ? 'rtl' : 'ltr'}>
              <colgroup>
                <col style={{ width: '72px' }} />
                <col style={{ width: '220px' }} />
                <col style={{ width: '220px' }} />
                <col />
                <col style={{ width: '160px' }} />
                <col style={{ width: '160px' }} />
                <col style={{ width: '120px' }} />
              </colgroup>
              <thead className="bg-gray-100 text-center">
                <tr className="border-b border-gray-200">
                  <th className="py-2 px-2">{t('fields.row', 'Row')}</th>
                  <th className="py-2 px-2">{t('fields.code', 'Code')}</th>
                  <th className="py-2 px-2">{t('fields.detailCode', 'Detail Code')}</th>
                  <th className="py-2 px-2">{t('fields.description', 'Description')}</th>
                  <th className="py-2 px-2">{t('fields.debit', 'Debit')}</th>
                  <th className="py-2 px-2">{t('fields.credit', 'Credit')}</th>
                  <th className="py-2 px-2">{t('actions.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {form.lines.map((ln, idx) => {
                  const detailEnabled = !!ln.code && canSelectDetailForCode(ln.code);
                  const rowDetails = detailEnabled ? detailOptions : [];
                  return (
                    <tr key={idx} className="border-b border-gray-200">
                      <td className="py-2 px-2">{getCurrentLang() === 'fa' ? toPersianDigits(String(ln.row)) : ln.row}</td>
                      <td className="py-2 px-2">
                        <SearchableSelect
                          options={codeOptions}
                          value={codeOptions.find((o) => String(o.code) === String(ln.code)) || null}
                          onChange={(opt) => {
                            updateLine(idx, { code: opt ? String(opt.code) : '' });
                            const detailEnabled = opt ? canSelectDetailForCode(String(opt.code)) : false;
                            setPendingFocus({ row: idx, target: detailEnabled ? 'detail' : 'description' });
                          }}
                          label={t('fields.code', 'Code')}
                          placeholder={t('pages.codes.codeOrTitle', 'Search code or title')}
                          size="small"
                          fullWidth
                          getOptionLabel={(opt) => opt.name}
                          isOptionEqualToValue={(o, v) => String(o.code) === String(v.code)}
                          inputRef={(el) => { codeInputRefs.current[idx] = el; }}
                        />
                      </td>
                      <td className="py-2 px-2">
                         <SearchableSelect
                           options={rowDetails}
                           value={rowDetails.find((o) => String(o.code) === String(ln.detailCode)) || null}
                           onChange={(opt) => {
                             updateLine(idx, { detailCode: opt ? String(opt.code) : '' });
                             setPendingFocus({ row: idx, target: 'description' });
                           }}
                           label={t('fields.detailCode', 'Detail Code')}
                           placeholder={detailEnabled ? t('pages.codes.codeOrTitle', 'Search code or title') : t('pages.documentForm.detailsDisabled', 'Details disabled for selected code')}
                           size="small"
                           fullWidth
                           disabled={!detailEnabled}
                           getOptionLabel={(opt) => opt.name}
                           isOptionEqualToValue={(o, v) => String(o.code) === String(v.code)}
                           inputRef={(el) => { detailInputRefs.current[idx] = el; }}
                         />
                      </td>
                      <td className="py-2 px-2">
                        <TextField
                          label={t('fields.description', 'Description')}
                          variant="outlined"
                          size="small"
                          fullWidth
                          value={ln.description}
                          onChange={(e) => updateLine(idx, { description: e.target.value })}
                          inputRef={(el) => { descriptionRefs.current[idx] = el; }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.shiftKey) {
                              e.preventDefault();
                              copyHeaderDescriptionToRow(idx);
                              debitInputRefs.current[idx]?.focus();
                            } else if (e.key === 'Enter') {
                              e.preventDefault();
                              debitInputRefs.current[idx]?.focus();
                            }
                          }}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <NumericInput
                          value={ln.debit}
                          onChange={(v) => updateLine(idx, { debit: String(v) })}
                          onQuickFill={() => (totals.diff > 0 ? totals.diff : null)}
                          fullWidth
                          className="text-red-700"
                          size="medium"
                          allowDecimal={false}
                          allowNegative={false}
                          showValidation={false}
                          inputRef={(el) => { debitInputRefs.current[idx] = el; }}
                          onEnter={() => {
                            const current = form.lines[idx];
                            const debitEmpty = !current.debit || Number(current.debit) <= 0;
                            if (debitEmpty) {
                              creditInputRefs.current[idx]?.focus();
                            } else {
                              setPendingFocus({ row: idx + 1, target: 'code' });
                              codeInputRefs.current[idx + 1]?.focus();
                            }
                          }}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <NumericInput
                          value={ln.credit}
                          onChange={(v) => updateLine(idx, { credit: String(v) })}
                          onQuickFill={() => (totals.diff > 0 ? totals.diff : null)}
                          fullWidth
                          className="text-green-700"
                          size="medium"
                          allowDecimal={false}
                          allowNegative={false}
                          showValidation={false}
                          inputRef={(el) => { creditInputRefs.current[idx] = el; }}
                          onEnter={() => {
                            setPendingFocus({ row: idx + 1, target: 'code' });
                            codeInputRefs.current[idx + 1]?.focus();
                          }}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <IconButton onClick={() => removeLine(idx)} color="error" size="small" disabled={idx === 0} aria-label={t('actions.delete','Delete')}>
                          <DeleteIcon />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-gray-50 font-medium">
                  <td className="py-2 px-2" colSpan={4}>{t('fields.totals', 'Totals')}</td>
                  <td className="py-2 px-2 text-right text-red-700">{localizeNumber(totals.debit)}</td>
                  <td className="py-2 px-2 text-right text-green-700">{localizeNumber(totals.credit)}</td>
                      {/* Difference color: orange when extra debit, dark green when extra credit */}
                       <td className={`py-2 px-2 text-right ${totals.debit > totals.credit ? 'text-orange-600' : 'text-green-900'}`}>{localizeNumber(totals.diff)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
        {/* Save Actions: Centered and themed */}
        <div className="mt-4 flex items-center justify-center">
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="medium"
              onClick={handleCancel}
            >
              {t('actions.cancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              size="medium"
              onClick={handleSave}
              disabled={!form.date || !form.fyId}
            >
              {t('actions.save', 'Save')}
            </Button>
          </div>
        </div>

        {/* ConfirmDialog for unbalanced save */}
        <ConfirmDialog
          open={confirmUnbalancedOpen}
          title={t('pages.documentForm.title', 'Document Form')}
          message={t('pages.documentForm.confirmUnbalancedSave', 'This document is unbalanced and will be saved as a draft. Continue?')}
          type="warning"
          onConfirm={handleConfirmUnbalancedSave}
          onCancel={() => setConfirmUnbalancedOpen(false)}
        />

        {/* ConfirmDialog for nature mismatch save-as-draft */}
        <ConfirmDialog
          open={confirmNatureMismatchOpen}
          title={t('pages.documentForm.title', 'Document Form')}
          message={natureMismatchMessage}
          type="warning"
          onConfirm={handleConfirmNatureMismatchSave}
          onCancel={() => setConfirmNatureMismatchOpen(false)}
        />

        {/* AlertDialog for validation and error messages */}
        <AlertDialog
          open={alertState.open}
          title={alertState.title}
          message={alertState.message}
          onClose={closeAlert}
          dimBackground={true}
        />
      </main>
    </div>
  );
};

export default DocumentFormPage;

/**
 * normalizeIsoFromBackend
 * Converts backend date (may be ISO with time) to ISO YYYY-MM-DD in local context.
 * - If already `YYYY-MM-DD`, return as-is.
 * - If it includes time (T...), parse with `Date` then build ISO with DateObject(gregorian).
 */
function normalizeIsoFromBackend(input?: string): string {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const obj = new DateObject(d);
      const g = obj.convert(gregorian);
      const y = String(g.year).padStart(4, '0');
      const m = String(g.month.number).padStart(2, '0');
      const dd = String(g.day).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
  } catch {/* noop */}
  return s.slice(0, 10);
}

/**
 * formatCodeForDisplay
 * Returns the document code with Persian digits when language is Farsi; otherwise ASCII.
 */
function formatCodeForDisplay(code?: string): string {
  const s = String(code || '');
  return getCurrentLang() === 'fa' ? toPersianDigits(s) : s;
}

/**
 * normalizeCodeInput
 * Normalizes user input for code by converting Persian/Arabic-Indic digits to ASCII.
 */
function normalizeCodeInput(input?: string): string {
  return toAsciiDigits(String(input || ''));
}





/**
 * Focus effect
 * When a pending focus target is set (after code selection), focus the detail
 * input if detail options exist for the selected code; otherwise focus the description.
 */