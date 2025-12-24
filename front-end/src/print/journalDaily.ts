import axios from 'axios';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import config from '../config';
import { getCurrentLang, t } from '../i18n';

/**
 * toPersianDigits
 * Converts ASCII digits to Persian digits for localized display. Returns input unchanged in EN.
 */
function toPersianDigits(s: string): string {
  const lang = getCurrentLang();
  if (lang !== 'fa') return String(s);
  const map: Record<string, string> = {
    '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴',
    '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹',
  };
  return String(s).replace(/[0-9]/g, (d) => map[d] || d);
}

/**
 * toAsciiDigits
 * Normalizes Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII 0-9.
 */
function toAsciiDigits(str: string): string {
  return Array.from(String(str))
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 0x0660 && code <= 0x0669) return String.fromCharCode(48 + (code - 0x0660));
      if (code >= 0x06f0 && code <= 0x06f9) return String.fromCharCode(48 + (code - 0x06f0));
      return ch;
    })
    .join('');
}

/**
 * formatJalaliDisplayDate
 * Formats an ISO Gregorian date to Jalali (YYYY/MM/DD). Localizes digits based on language.
 */
function formatJalaliDisplayDate(iso?: string | null): string {
  const lang = getCurrentLang();
  if (!iso) return '-';
  try {
    const parts = String(iso).replace(/\//g, '-').split('-');
    const [y, m, d] = parts.map((p) => parseInt(p, 10));
    const obj = new DateObject({ year: y, month: m, day: d }).convert(persian);
    const jy = String(obj.year).padStart(4, '0');
    const jm = String(obj.month.number).padStart(2, '0');
    const jd = String(obj.day).padStart(2, '0');
    const out = `${jy}/${jm}/${jd}`;
    return lang === 'fa' ? toPersianDigits(out) : out;
  } catch {
    return String(iso);
  }
}

/**
 * formatAmountNoDecimals
 * Formats amounts with thousand separators, no decimals, localized digits in Farsi.
 */
function formatAmountNoDecimals(val?: number | string): string {
  const n = Number(val || 0);
  const lang = getCurrentLang();
  try {
    const fmt = new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
    return fmt.format(Math.round(n));
  } catch {
    const ascii = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return lang === 'fa' ? toPersianDigits(ascii) : ascii;
  }
}

/**
 * buildSpecificToGeneralMap
 * Loads all codes and builds a mapping specific.code → general.code using parent links.
 */
async function buildCodeMaps(): Promise<{ specToGenMap: Record<string, string>; genTitleMap: Record<string, string> }> {
  const lang = getCurrentLang();
  try {
    const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/codes`, { headers: { 'Accept-Language': lang } });
    const rows = Array.isArray(res.data?.data)
      ? res.data.data
      : Array.isArray(res.data?.items)
      ? res.data.items
      : Array.isArray(res.data)
      ? res.data
      : [];
    const byId: Record<string, any> = {};
    const genTitleMap: Record<string, string> = {};
    for (const r of rows) {
      byId[String(r.id)] = r;
      if (String(r.kind) === 'general') {
        const gc = String(r.code || '');
        const gt = String(r.title || '');
        if (gc) genTitleMap[gc] = gt;
      }
    }
    const specToGenMap: Record<string, string> = {};
    for (const r of rows) {
      if (String(r.kind) !== 'specific') continue;
      const gen = r.parent_id ? byId[String(r.parent_id)] : null;
      const generalCode = gen ? String(gen.code || '') : '';
      const specificCode = String(r.code || '');
      if (specificCode && generalCode) {
        specToGenMap[specificCode] = generalCode;
      }
    }
    return { specToGenMap, genTitleMap };
  } catch {
    return { specToGenMap: {}, genTitleMap: {} };
  }
}

/**
 * generalCodeOf
 * Returns the general-level code for a given account code using the specific→general map.
 * Falls back to slicing configured digits when map is missing.
 */
function generalCodeOf(accountCode: string, specToGen: Record<string, string>): string {
  const raw = toAsciiDigits(String(accountCode || '').trim());
  if (!raw) return '';
  if (specToGen[raw]) return specToGen[raw];
  const digits = (config.CODE_DIGITS?.general as number) || 4;
  return raw.slice(0, digits);
}

/**
 * safeText
 * Escapes &,<,> for HTML contexts.
 */
function safeText(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

/**
 * buildJournalDailyHtml
 * Builds printable HTML for a daily journal-style list:
 * Row | Date | Document No | Main Code | Description | Debit | Credit
 * Adds a separator row between documents.
 */
export function buildJournalDailyHtml(
  docs: any[],
  options?: { dateFrom?: string; dateTo?: string; filters?: string[]; specToGenMap?: Record<string, string>; genTitleMap?: Record<string, string> }
): string {
  const lang = getCurrentLang();
  const rtl = lang === 'fa';

  const colRow = rtl ? 'ردیف' : 'Row';
  const colDate = rtl ? 'تاریخ سند' : 'Date';
  const colNo = rtl ? 'شماره' : 'No';
  const colMainCode = rtl ? 'کد کل' : 'Main Code';
  const colMainName = rtl ? 'نام کد کل' : 'Main Code Name';
  const colDesc = rtl ? 'شرح' : 'Description';
  const colDebit = rtl ? 'بدهکار' : 'Debit';
  const colCredit = rtl ? 'بستانکار' : 'Credit';
  const sepLabel = rtl ? '' : 'By Journal Posting';
  const title = t('pages.print.journalDaily.title', rtl ? 'گزارش دفتر روزنامه' : 'Daily Journal Report');

  const specToGen = options?.specToGenMap || {};
  const genTitleMap = options?.genTitleMap || {};
  const df = options?.dateFrom ? formatJalaliDisplayDate(options?.dateFrom) : '';
  const dt = options?.dateTo ? formatJalaliDisplayDate(options?.dateTo) : '';
  const rangeLabel = rtl ? 'بازه تاریخ' : 'Date Range';
  const fromLabel = rtl ? 'از' : 'From';
  const toLabel = rtl ? 'تا' : 'To';
  const reportDateLabel = rtl ? 'تاریخ گزارش' : 'Report Date';
  const docLabel = rtl ? 'سند' : 'Document';

  /**
   * normalizeToISODate
   * Extracts YYYY-MM-DD from various incoming date forms (ISO with time, plain YYYY-MM-DD, localized strings).
   */
  function normalizeToISODate(input?: any): string {
    const s = String(input ?? '').trim();
    if (!s) return '';
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m2 = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m2}-${dd}`;
    }
    return '';
  }
  // Compute min/max date and document numbers
  const dates: string[] = (Array.isArray(docs) ? docs : []).map((d: any) => normalizeToISODate(d?.date)).filter((s) => !!s);
  const codesNum: number[] = (Array.isArray(docs) ? docs : [])
    .map((d: any) => String(d?.code || ''))
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10));
  const minDateISO = dates.length ? dates.slice().sort()[0] : '';
  const maxDateISO = dates.length ? dates.slice().sort().reverse()[0] : '';
  const minDocNum = codesNum.length ? Math.min(...codesNum) : NaN;
  const maxDocNum = codesNum.length ? Math.max(...codesNum) : NaN;
  const minDateDisp = minDateISO ? formatJalaliDisplayDate(minDateISO) : '-';
  const maxDateDisp = maxDateISO ? formatJalaliDisplayDate(maxDateISO) : '-';
  const minDocDisp = Number.isFinite(minDocNum) ? (rtl ? toPersianDigits(String(minDocNum)) : String(minDocNum)) : '-';
  const maxDocDisp = Number.isFinite(maxDocNum) ? (rtl ? toPersianDigits(String(maxDocNum)) : String(maxDocNum)) : '-';
  const today = new Date();
  const todayObj = new DateObject(today);
  const todayJ = todayObj.convert(persian);
  const tJy = String(todayJ.year).padStart(4, '0');
  const tJm = String(todayJ.month.number).padStart(2, '0');
  const tJd = String(todayJ.day).padStart(2, '0');
  const todayDispRaw = `${tJy}/${tJm}/${tJd}`;
  const todayDisp = rtl ? toPersianDigits(todayDispRaw) : todayDispRaw;
  console.log('[JournalDaily] date diagnostics', { dates, minDateISO, maxDateISO, minDateDisp, maxDateDisp });

  let rowCounter = 0;
  let sumDebit = 0;
  let sumCredit = 0;
  const sectionsHtml = (Array.isArray(docs) ? docs : []).map((doc: any) => {
    const dateDisplay = formatJalaliDisplayDate(String(doc?.date || ''));
    const docNoRaw = String(doc?.code || '');
    const docNoDisplay = rtl ? toPersianDigits(docNoRaw) : docNoRaw;
    const items: any[] = Array.isArray(doc?.items) ? doc.items : [];
    const rows = items.map((it: any) => {
      rowCounter += 1;
      const rowNum = rtl ? toPersianDigits(String(rowCounter)) : String(rowCounter);
      const acc = String(it?.account_code || it?.code || '');
      const mainCode = generalCodeOf(acc, specToGen);
      const mainCodeDisp = rtl ? toPersianDigits(mainCode) : mainCode;
      const mainNameRaw = genTitleMap[mainCode] || '';
      const mainName = safeText(mainNameRaw);
      const desc = safeText(String(it?.description || ''));
      const debitNum = Number(it?.debit ?? 0);
      const creditNum = Number(it?.credit ?? 0);
      sumDebit += debitNum;
      sumCredit += creditNum;
      const debit = formatAmountNoDecimals(debitNum);
      const credit = formatAmountNoDecimals(creditNum);
      return `<tr>
        <td>${rowNum}</td>
        <td>${dateDisplay || '-'}</td>
        <td>${docNoDisplay || '-'}</td>
        <td>${mainCodeDisp || '-'}</td>
        <td>${mainName || '-'}</td>
        <td>${desc || '-'}</td>
        <td class="amount text-end">${debit}</td>
        <td class="amount text-end">${credit}</td>
      </tr>`;
    }).join('');

    const sepRow = `<tr class="doc-sep"><td colspan="8">${safeText(sepLabel)}</td></tr>`;
    return `${rows}${sepRow}`;
  }).join('');

  const headerRange = '';
  
  let filtersHtml = '';
  if (options?.filters && options.filters.length > 0) {
      const filtersStr = options.filters.join(' | ');
      filtersHtml = `<div class="muted">${safeText(filtersStr)}</div>`;
  }

  return `<!doctype html>
<html lang="${rtl ? 'fa' : 'en'}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeText(title)}</title>
${rtl ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700&display=swap" />' : ''}
<style>
  body { font-family: ${rtl ? "'Vazirmatn', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" : "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"}; color: #0f172a; background: #ffffff; margin: 4px; }
  h1 { margin: 0 0 8px; }
  .muted { color: #475569; margin: 2px 0 10px; font-size: 0.9em; }
  .header-center { text-align: center; margin: 6px 0; }
  .header-left { text-align: ${rtl ? 'right' : 'left'}; margin: 4px 0 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 13px; }
  th { background: #f1f5f9; text-align: ${rtl ? 'right' : 'left'}; }
  td { text-align: ${rtl ? 'right' : 'left'}; }
  .text-end { text-align: ${rtl ? 'left' : 'right'}; }
  .amount { background: #f8fafc; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .doc-sep td { background: #fafafa; color: #334155; font-weight: 600; }
  .total-row td { background: #eef2ff; font-weight: 700; }
  @page { size: A4 portrait; margin: 10mm 4mm; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
</style>
</head>
<body>
  <h3 class="header-center">${safeText(title)}</h3>
  <div class="header-center">${safeText(fromLabel)} ${minDateDisp} ${safeText(toLabel)} ${maxDateDisp}</div>
  <div class="header-center">${rtl ? 'از ' + safeText(docLabel) : 'From ' + safeText(docLabel)} ${minDocDisp} ${rtl ? 'تا ' + safeText(docLabel) : 'To ' + safeText(docLabel)} ${maxDocDisp}</div>
  <div class="header-left"><strong>${safeText(reportDateLabel)}:</strong> ${todayDisp}</div>
  ${headerRange}
  ${filtersHtml}
  <table>
    <colgroup>
      <col style="width: 6%" />
      <col style="width: 13%" />
      <col style="width: 7%" />
      <col style="width: 7%" />
      <col style="width: 16%" />
      <col style="width: 23%" />
      <col style="width: 14%" />
      <col style="width: 14%" />
    </colgroup>
    <thead>
      <tr>
        <th>${safeText(colRow)}</th>
        <th>${safeText(colDate)}</th>
        <th>${safeText(colNo)}</th>
        <th>${safeText(colMainCode)}</th>
        <th>${safeText(colMainName)}</th>
        <th>${safeText(colDesc)}</th>
        <th>${safeText(colDebit)}</th>
        <th>${safeText(colCredit)}</th>
      </tr>
    </thead>
    <tbody>
      ${sectionsHtml}
      ${(() => {
        const totalLabel = rtl ? 'جمع' : 'Total';
        const totalDebitStr = formatAmountNoDecimals(sumDebit);
        const totalCreditStr = formatAmountNoDecimals(sumCredit);
        const grand = Math.max(sumDebit, sumCredit);
        const grandStr = formatAmountNoDecimals(grand);
        const grandLabel = rtl ? 'مجموع کل' : 'Total Value';
        return `
        <tr class="total-row">
          <td colspan="6">${safeText(totalLabel)}</td>
          <td class="amount text-end">${totalDebitStr}</td>
          <td class="amount text-end">${totalCreditStr}</td>
        </tr>
        <tr class="total-row">
          <td colspan="8">${safeText(grandLabel)}: ${rtl ? toPersianDigits(grandStr) : grandStr}</td>
        </tr>`;
      })()}
    </tbody>
  </table>
  <script>
    window.focus();
    window.addEventListener('load', function () {
      setTimeout(function () { try { window.print(); } catch (e) {} }, 200);
    });
  </script>
</body>
</html>`;
}

/**
 * openJournalDailyPrint
 * Builds mapping and opens a print window for the provided detailed docs.
 */
export async function openJournalDailyPrint(docs: any[], options?: { dateFrom?: string; dateTo?: string; filters?: string[] }): Promise<void> {
  const maps = await buildCodeMaps();
  const html = buildJournalDailyHtml(docs, { ...options, specToGenMap: maps.specToGenMap, genTitleMap: maps.genTitleMap });
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.open('text/html');
  win.document.write(html);
  win.document.close();
}

/**
 * openJournalDailyPrintByIds
 * Fetches journal details by ids and opens the daily journal print with date range header.
 */
export async function openJournalDailyPrintByIds(ids: string[], options?: { dateFrom?: string; dateTo?: string; filters?: string[] }): Promise<void> {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const lang = getCurrentLang();
  const responses = await Promise.all(ids.map((id) =>
    axios.get(`${config.API_ENDPOINTS.base}/v1/journals/${id}`, { headers: { 'Accept-Language': lang } }).catch(() => null)
  ));
  const docs = responses.map((res) => res?.data?.item || res?.data).filter(Boolean);
  await openJournalDailyPrint(docs, options);
}

/**
 * openJournalDailyPrintByFilter
 * Fetches all documents matching the filter and opens the daily journal print.
 */
export async function openJournalDailyPrintByFilter(params: any, options?: { dateFrom?: string; dateTo?: string; filters?: string[] }): Promise<void> {
  const lang = getCurrentLang();
  try {
    const pageSize = 100; // conservative page size to avoid server 400
    const ids: string[] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    // Use existing sort if provided; otherwise default to date desc
    const baseParams: Record<string, any> = { sort_by: 'date', sort_dir: 'desc', ...params };
    // Fetch pages until server indicates completion or we run out of items
    for (let guard = 0; guard < 200; guard++) {
      const q = { ...baseParams, page, page_size: pageSize };
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals`, { params: q, headers: { 'Accept-Language': lang } });
      const payload = res.data;
      const list = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
      const pageIds = list.map((d: any) => d.id).filter(Boolean);
      ids.push(...pageIds);
      const serverTotal = Number.isFinite(payload?.total) ? Number(payload.total) : undefined;
      if (serverTotal != null) total = serverTotal;
      // Break when fewer than pageSize items returned or collected all
      if (list.length < pageSize) break;
      if (ids.length >= total) break;
      page += 1;
    }
    await openJournalDailyPrintByIds(ids, options);
  } catch (e) {
    console.error('Print by filter failed', e);
    throw e;
  }
}
