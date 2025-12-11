/*
 * Excel → Codes Import Script (TypeScript)
 *
 * Reads an Excel file and imports accounting codes into Postgres
 * with a three-kind hierarchy: group → general → specific.
 *
 * Usage:
 *   ts-node src/scripts/importCodesFromExcel.ts --file "/absolute/path.xlsx" [--sheet "Sheet1"] [--limit 100] [--commit]
 *
 * Defaults:
 *   - Without --commit, the script runs in dry-run mode and prints a summary.
 *   - Detects Farsi/English headers for code, name, group, nature.
 *   - Infers hierarchy by code length and prefix (2 → group, 4 → general, >4 → specific).
 */

import { getPool } from '../db/pg';
import * as XLSX from 'xlsx';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

interface HeaderDetection {
  codeCol?: string;
  nameCol?: string;
  groupCol?: string;
  natureCol?: string;
}

interface RowRecord {
  idx: number;
  code_raw?: any;
  code_norm?: string;
  name?: string;
  group?: string;
  nature_raw?: any;
  nature?: number | null;
}

/**
 * Normalize Persian digits to ASCII and strip non-digit characters.
 * Keeps only 0-9 for code processing.
 */
function normalizeDigits(input: any): string {
  if (input === undefined || input === null) return '';
  const s = String(input);
  // Persian (۰-۹) and Arabic-Indic (٠-٩) digits mapping
  const map: Record<string, string> = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
  };
  const replaced = s.replace(/[۰-۹٠-٩]/g, (ch) => map[ch] || ch);
  return replaced.replace(/[^0-9]/g, '');
}

/**
 * Parse nature field from Farsi or numeric values.
 * Returns 0 (Debitor), 1 (Creditor), or null for unknown.
 */
function parseNature(val: any): number | null {
  if (val === undefined || val === null || val === '') return null;
  const s = String(val).trim();
  const sn = s.replace(/[\s]+/g, '').toLowerCase();
  if (sn === '0' || sn.includes('بدهکار')) return 0;
  if (sn === '1' || sn.includes('بستانکار')) return 1;
  const num = Number(s);
  if (!Number.isNaN(num)) {
    if (num === 0) return 0;
    if (num === 1) return 1;
  }
  return null;
}

/**
 * Normalize Farsi text for consistent storage and comparisons.
 * - Replace Arabic Yeh 'ي' and Alef Maksura 'ى' with Persian Yeh 'ی'
 * - Replace Arabic Kaf 'ك' with Persian Kaf 'ک'
 * - Replace Taa Marbuta 'ة' with Heh 'ه'
 * - Strip Arabic diacritics (tashkeel) to avoid search mismatches
 */
function normalizeFarsiText(input: any): string | undefined {
  if (input === undefined || input === null) return undefined;
  let s = String(input);
  const map: Record<string, string> = {
    'ي': 'ی',
    'ى': 'ی',
    'ك': 'ک',
    'ة': 'ه',
  };
  s = s.replace(/[يىكة]/g, (ch) => map[ch] || ch);
  // Remove diacritics (\u064B-\u065F and \u0670)
  s = s.replace(/[\u064B-\u065F\u0670]/g, '');
  return s.trim();
}

/**
 * Detect commonly used Farsi/English headers for code, name, group, nature.
 * Prioritizes likely matches found in the first row.
 */
function detectHeaders(headers: string[]): HeaderDetection {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  const at = (preds: string[]): string | undefined => {
    for (const p of preds) {
      const idx = lower.findIndex((h) => h === p || (h.includes(p) && p.length >= 2));
      if (idx >= 0) return headers[idx];
    }
    return undefined;
  };

  const codeCol = at([
    'كد حساب', 'کد حساب', 'کد', 'كد', 'کد معین', 'کد کل', 'code', 'account code'
  ]);
  const nameCol = at([
    'عنوان', 'نام حساب', 'عنوان حساب', 'سرفصل', 'name', 'title'
  ]);
  // Refined group detection: include 'گروه' but exclude 'ماهیت'
  let groupCol: string | undefined = undefined;
  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    const hasGroup = h.includes('گروه') || h.includes('group');
    const mentionsNature = h.includes('ماهیت') || h.includes('ماهيت');
    if (hasGroup && !mentionsNature) {
      groupCol = headers[i];
      break;
    }
  }
  if (!groupCol) {
    groupCol = at(['گروه', 'گروه حساب', 'نام گروه', 'گروه سرفصل', 'account group', 'group']);
    if (groupCol && ((groupCol.toLowerCase().includes('ماهیت')) || (groupCol.toLowerCase().includes('ماهيت')))) {
      groupCol = undefined;
    }
  }

  const natureCol = at([
    'ماهيت گروه حساب', 'ماهیت گروه حساب', 'ماهيت', 'ماهیت', 'nature'
  ]);

  return { codeCol, nameCol, groupCol, natureCol };
}

/**
 * Read the first sheet (or named sheet) into array of row objects.
 */
function readSheet(filePath: string, sheetName?: string): { headers: string[]; rows: any[] } {
  const wb = XLSX.readFile(filePath);
  const sheet = sheetName ? wb.Sheets[sheetName] : wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Excel sheet not found');
  const json = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
  const headers = Object.keys(json[0] || {});
  return { headers, rows: json };
}

/**
 * Classify code kind by length: 2 → group, 4 → general, >4 → specific.
 */
function classifyKind(code: string): 'group' | 'general' | 'specific' {
  if (code.length <= 2) return 'group';
  if (code.length <= 4) return 'general';
  return 'specific';
}

/**
 * Build RowRecord[] from raw JSON rows using detected headers.
 */
function buildRowRecords(rows: any[], det: HeaderDetection, limit?: number): RowRecord[] {
  const out: RowRecord[] = [];
  const total = limit ? Math.min(rows.length, limit) : rows.length;
  for (let i = 0; i < total; i++) {
    const r = rows[i];
    const codeRaw = det.codeCol ? r[det.codeCol] : undefined;
    const codeNorm = normalizeDigits(codeRaw);
    const name = det.nameCol ? normalizeFarsiText(r[det.nameCol]) : undefined;
    const group = det.groupCol ? normalizeFarsiText(r[det.groupCol]) : undefined;
    const natureRaw = det.natureCol ? r[det.natureCol] : undefined;
    const nature = parseNature(natureRaw);
    out.push({ idx: i, code_raw: codeRaw, code_norm: codeNorm, name, group, nature_raw: natureRaw, nature });
  }
  return out;
}

/**
 * Upsert a code row (group/general/specific) and return its id.
 * Enforces two-digit code for group and sets parent relation via parentId.
 */
async function upsertCode(code: string, title: string, kind: 'group' | 'general' | 'specific', parentId: string | null, nature: number | null): Promise<string> {
  const p = getPool();
  const probe = await p.query('SELECT id FROM codes WHERE code = $1', [code]);
  if (probe.rowCount && probe.rows[0]) {
    const id = probe.rows[0].id as string;
    await p.query('UPDATE codes SET title = $2, kind = $3, parent_id = $4, nature = $5 WHERE id = $1', [id, title, kind, parentId, nature]);
    return id;
  }
  const newId = randomUUID();
  const idRes = await p.query('INSERT INTO codes (id, code, title, kind, parent_id, is_active, nature) VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING id', [newId, code, title, kind, parentId, nature]);
  return idRes.rows[0].id as string;
}

/**
 * Compute titles for group/general when explicit name not provided.
 * Fallbacks use Farsi-friendly labels.
 */
function fallbackTitle(kind: 'group' | 'general' | 'specific', code: string): string {
  if (kind === 'group') return `گروه ${code}`;
  if (kind === 'general') return `معین ${code}`;
  return `حساب ${code}`;
}

/**
 * Import logic: builds hierarchy and inserts/updates DB records.
 */
async function importExcel(file: string, sheetName?: string, limit?: number, commit?: boolean): Promise<void> {
  const { headers, rows } = readSheet(file, sheetName);
  const det = detectHeaders(headers);

  if (!det.codeCol) {
    console.log('Header detection:', det);
    throw new Error('No code column detected. Please ensure the sheet has a recognizable code header.');
  }

  const recs = buildRowRecords(rows, det, limit);

  // Aggregate group names by 2-digit prefix
  const groupNameByPrefix: Record<string, string> = {};
  const groupNatureByPrefix: Record<string, number | null> = {};
  for (const r of recs) {
    if (!r.code_norm || r.code_norm.length < 2) continue;
    const grp = r.code_norm.slice(0, 2);
    if (r.group && !groupNameByPrefix[grp]) groupNameByPrefix[grp] = r.group;
    if (typeof r.nature === 'number' && groupNatureByPrefix[grp] === undefined) groupNatureByPrefix[grp] = r.nature as number;
  }

  // Dry-run preview
  const preview = recs.map((r) => ({
    idx: r.idx,
    code: r.code_norm,
    kind: r.code_norm ? classifyKind(r.code_norm) : 'group',
    group_prefix: r.code_norm ? r.code_norm.slice(0, 2) : '',
    general_prefix: r.code_norm && r.code_norm.length >= 4 ? r.code_norm.slice(0, 4) : '',
    name: r.name,
    group_name: r.code_norm ? groupNameByPrefix[r.code_norm.slice(0, 2)] : undefined,
    nature: r.nature,
  }));

  console.log('Detected headers:', det);
  console.log('Sample (first 20 rows):');
  for (const row of preview.slice(0, 20)) {
    console.log(row);
  }

  if (!commit) {
    console.log('Dry-run only. Pass --commit to apply changes to DB.');
    return;
  }

  const p = getPool();
  // Ensure schema exists before insert
  // Note: backend boot normally calls ensureSchema; here we assume schema is ready.

  // Maps for id references
  const groupIdByCode: Record<string, string> = {};
  const generalIdByCode: Record<string, string> = {};

  for (const r of recs) {
    if (!r.code_norm) continue;
    const kind = classifyKind(r.code_norm);

    // Upsert group by 2-digit prefix
    const grpCode = r.code_norm.slice(0, 2);
    if (!groupIdByCode[grpCode]) {
      const grpTitle = groupNameByPrefix[grpCode] || fallbackTitle('group', grpCode);
      const grpNature = (typeof groupNatureByPrefix[grpCode] === 'number') ? groupNatureByPrefix[grpCode] as number : null;
      const gid = await upsertCode(grpCode, grpTitle, 'group', null, grpNature);
      groupIdByCode[grpCode] = gid;
    }

    // Upsert general by 4-digit prefix when applicable
    let genId: string | null = null;
    let genCode: string | null = null;
    if (r.code_norm.length >= 4) {
      genCode = r.code_norm.slice(0, 4);
      if (!generalIdByCode[genCode]) {
        const genTitle = r.name && classifyKind(r.code_norm) === 'general' ? r.name : fallbackTitle('general', genCode);
        const gid = groupIdByCode[grpCode];
        const nid = await upsertCode(genCode, genTitle, 'general', gid, null);
        generalIdByCode[genCode] = nid;
      }
      genId = generalIdByCode[genCode];
    }

    // Insert self node by kind
    if (kind === 'group') {
      // May already be inserted above; update title if present
      const existingId = groupIdByCode[grpCode];
      const title = r.name || groupNameByPrefix[grpCode] || fallbackTitle('group', grpCode);
      const effectiveNature = (typeof r.nature === 'number') ? r.nature : ((typeof groupNatureByPrefix[grpCode] === 'number') ? groupNatureByPrefix[grpCode] as number : null);
      await upsertCode(grpCode, title, 'group', null, effectiveNature);
      continue;
    }

    if (kind === 'general') {
      const title = r.name || fallbackTitle('general', r.code_norm);
      const parentId = groupIdByCode[grpCode];
      await upsertCode(r.code_norm, title, 'general', parentId, null);
      continue;
    }

    // Specific
    const title = r.name || fallbackTitle('specific', r.code_norm);
    await upsertCode(r.code_norm, title, 'specific', genId, null);
  }

  console.log('Import completed. Groups:', Object.keys(groupIdByCode).length, 'Generals:', Object.keys(generalIdByCode).length);
}

/**
 * Parse CLI args and execute import.
 */
async function main() {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.findIndex((a) => a === `--${name}`);
    if (idx >= 0) return args[idx + 1];
    const pair = args.find((a) => a.startsWith(`--${name}=`));
    return pair ? pair.split('=')[1] : undefined;
  };

  const file = getArg('file');
  const sheet = getArg('sheet');
  const limitStr = getArg('limit');
  const commit = args.includes('--commit');
  if (!file) {
    console.error('Missing --file "/absolute/path.xlsx"');
    process.exit(1);
  }
  const limit = limitStr ? Number(limitStr) : undefined;
  try {
    await importExcel(file, sheet, limit, commit);
  } catch (e: any) {
    console.error('Import failed:', e?.message || e);
    process.exit(1);
  }
}

// Run script
main();