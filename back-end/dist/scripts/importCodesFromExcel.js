"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("../db/pg");
const XLSX = __importStar(require("xlsx"));
const dotenv_1 = __importDefault(require("dotenv"));
const crypto_1 = require("crypto");
dotenv_1.default.config();
/**
 * Normalize Persian digits to ASCII and strip non-digit characters.
 * Keeps only 0-9 for code processing.
 */
function normalizeDigits(input) {
    if (input === undefined || input === null)
        return '';
    const s = String(input);
    // Persian (۰-۹) and Arabic-Indic (٠-٩) digits mapping
    const map = {
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
function parseNature(val) {
    if (val === undefined || val === null || val === '')
        return null;
    const s = String(val).trim();
    const sn = s.replace(/[\s]+/g, '').toLowerCase();
    if (sn === '0' || sn.includes('بدهکار'))
        return 0;
    if (sn === '1' || sn.includes('بستانکار'))
        return 1;
    const num = Number(s);
    if (!Number.isNaN(num)) {
        if (num === 0)
            return 0;
        if (num === 1)
            return 1;
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
function normalizeFarsiText(input) {
    if (input === undefined || input === null)
        return undefined;
    let s = String(input);
    const map = {
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
function detectHeaders(headers) {
    const lower = headers.map((h) => String(h || '').trim().toLowerCase());
    const at = (preds) => {
        for (const p of preds) {
            const idx = lower.findIndex((h) => h === p || (h.includes(p) && p.length >= 2));
            if (idx >= 0)
                return headers[idx];
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
    let groupCol = undefined;
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
function readSheet(filePath, sheetName) {
    const wb = XLSX.readFile(filePath);
    const sheet = sheetName ? wb.Sheets[sheetName] : wb.Sheets[wb.SheetNames[0]];
    if (!sheet)
        throw new Error('Excel sheet not found');
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const headers = Object.keys(json[0] || {});
    return { headers, rows: json };
}
/**
 * Classify code kind by length: 2 → group, 4 → general, >4 → specific.
 */
function classifyKind(code) {
    if (code.length <= 2)
        return 'group';
    if (code.length <= 4)
        return 'general';
    return 'specific';
}
/**
 * Build RowRecord[] from raw JSON rows using detected headers.
 */
function buildRowRecords(rows, det, limit) {
    const out = [];
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
async function upsertCode(code, title, kind, parentId, nature) {
    const p = (0, pg_1.getPool)();
    const probe = await p.query('SELECT id FROM codes WHERE code = $1', [code]);
    if (probe.rowCount && probe.rows[0]) {
        const id = probe.rows[0].id;
        await p.query('UPDATE codes SET title = $2, kind = $3, parent_id = $4, nature = $5 WHERE id = $1', [id, title, kind, parentId, nature]);
        return id;
    }
    const newId = (0, crypto_1.randomUUID)();
    const idRes = await p.query('INSERT INTO codes (id, code, title, kind, parent_id, is_active, nature) VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING id', [newId, code, title, kind, parentId, nature]);
    return idRes.rows[0].id;
}
/**
 * Compute titles for group/general when explicit name not provided.
 * Fallbacks use Farsi-friendly labels.
 */
function fallbackTitle(kind, code) {
    if (kind === 'group')
        return `گروه ${code}`;
    if (kind === 'general')
        return `معین ${code}`;
    return `حساب ${code}`;
}
/**
 * Import logic: builds hierarchy and inserts/updates DB records.
 */
async function importExcel(file, sheetName, limit, commit) {
    const { headers, rows } = readSheet(file, sheetName);
    const det = detectHeaders(headers);
    if (!det.codeCol) {
        console.log('Header detection:', det);
        throw new Error('No code column detected. Please ensure the sheet has a recognizable code header.');
    }
    const recs = buildRowRecords(rows, det, limit);
    // Aggregate group names by 2-digit prefix
    const groupNameByPrefix = {};
    const groupNatureByPrefix = {};
    for (const r of recs) {
        if (!r.code_norm || r.code_norm.length < 2)
            continue;
        const grp = r.code_norm.slice(0, 2);
        if (r.group && !groupNameByPrefix[grp])
            groupNameByPrefix[grp] = r.group;
        if (typeof r.nature === 'number' && groupNatureByPrefix[grp] === undefined)
            groupNatureByPrefix[grp] = r.nature;
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
    const p = (0, pg_1.getPool)();
    // Ensure schema exists before insert
    // Note: backend boot normally calls ensureSchema; here we assume schema is ready.
    // Maps for id references
    const groupIdByCode = {};
    const generalIdByCode = {};
    for (const r of recs) {
        if (!r.code_norm)
            continue;
        const kind = classifyKind(r.code_norm);
        // Upsert group by 2-digit prefix
        const grpCode = r.code_norm.slice(0, 2);
        if (!groupIdByCode[grpCode]) {
            const grpTitle = groupNameByPrefix[grpCode] || fallbackTitle('group', grpCode);
            const grpNature = (typeof groupNatureByPrefix[grpCode] === 'number') ? groupNatureByPrefix[grpCode] : null;
            const gid = await upsertCode(grpCode, grpTitle, 'group', null, grpNature);
            groupIdByCode[grpCode] = gid;
        }
        // Upsert general by 4-digit prefix when applicable
        let genId = null;
        let genCode = null;
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
            const effectiveNature = (typeof r.nature === 'number') ? r.nature : ((typeof groupNatureByPrefix[grpCode] === 'number') ? groupNatureByPrefix[grpCode] : null);
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
    const getArg = (name) => {
        const idx = args.findIndex((a) => a === `--${name}`);
        if (idx >= 0)
            return args[idx + 1];
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
    }
    catch (e) {
        console.error('Import failed:', e?.message || e);
        process.exit(1);
    }
}
// Run script
main();
