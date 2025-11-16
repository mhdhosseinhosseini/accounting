/*
 * Reads an Excel workbook and prints a concise summary of sheet names,
 * detected headers, and sample rows focusing on accounting coding fields.
 *
 * Usage:
 *   node scripts/read_excel_codes.js "/absolute/path/to/file.xlsx" [--sheet "Sheet Name"] [--limit 20]
 *
 * Notes:
 * - Supports Farsi digits by normalizing them to ASCII for code parsing.
 * - Heuristically detects likely columns for code, name/title, and parent code.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

/**
 * Converts Farsi/Arabic-Indic digits to ASCII digits.
 * @param {string|number} input - The string or number containing possible Farsi digits.
 * @returns {string} - String with ASCII digits.
 */
function toAsciiDigits(input) {
  const s = String(input ?? '').trim();
  const map = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
  };
  return s.replace(/[۰-۹٠-٩]/g, ch => map[ch] || ch);
}

/**
 * Checks if a header name likely represents an account code column.
 * @param {string} header - Header label to test.
 * @returns {boolean}
 */
function isCodeHeader(header) {
  const h = (header || '').toString().toLowerCase();
  return [
    'code', 'account_code', 'accountcode', 'شماره', 'کد', 'كد', 'کد حساب', 'كد حساب', 'کدینگ'
  ].some(k => h.includes(k));
}

/**
 * Checks if a header name likely represents an account name/title/description.
 * @param {string} header - Header label to test.
 * @returns {boolean}
 */
function isNameHeader(header) {
  const h = (header || '').toString().toLowerCase();
  return [
    'name', 'title', 'description', 'شرح', 'نام', 'عنوان'
  ].some(k => h.includes(k));
}

/**
 * Checks if a header name likely represents a parent code or grouping.
 * @param {string} header - Header label to test.
 * @returns {boolean}
 */
function isParentHeader(header) {
  const h = (header || '').toString().toLowerCase();
  return [
    'parent', 'parent_code', 'parentcode', 'والد', 'کد والد', 'گروه', 'سرفصل', 'ارتباط با سرفصل'
  ].some(k => h.includes(k));
}

/**
 * Parses CLI args for file path, sheet name and sample limit.
 * @returns {{ filePath: string, sheetName?: string, limit: number }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.error('Error: Excel file path is required.');
    process.exit(1);
  }
  const filePath = args[0];
  let sheetName;
  let limit = 20;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--sheet') {
      sheetName = args[i + 1];
      i++;
    } else if (a === '--limit') {
      limit = parseInt(args[i + 1], 10) || limit;
      i++;
    }
  }
  return { filePath, sheetName, limit };
}

/**
 * Loads workbook and returns parsed rows from a selected sheet.
 * @param {string} filePath - Absolute path to the Excel file.
 * @param {string|undefined} sheetName - Optional explicit sheet name.
 * @returns {{workbook: XLSX.WorkBook, sheetName: string, rows: any[], headers: string[]}}
 */
function loadWorkbook(filePath, sheetName) {
  if (!fs.existsSync(filePath)) {
    console.error('Error: File not found:', filePath);
    process.exit(1);
  }
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetNames = workbook.SheetNames;
  if (!sheetNames.length) {
    console.error('Error: No sheets found in workbook.');
    process.exit(1);
  }
  const chosen = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  const sheet = workbook.Sheets[chosen];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const headers = Object.keys(rows[0] || {});
  return { workbook, sheetName: chosen, rows, headers };
}

/**
 * Attempts to identify primary columns for coding: code, name, parent.
 * Also detects auxiliary columns like nature and group link.
 * @param {string[]} headers - List of header names in the sheet.
 * @returns {{ codeCol?: string, nameCol?: string, parentCol?: string, natureCol?: string, groupLinkCol?: string }}
 */
function detectColumns(headers) {
  let codeCol = headers.find(isCodeHeader);
  let nameCol = headers.find(isNameHeader);
  let parentCol = headers.find(isParentHeader);
  const natureCol = headers.find(h => /ماهيت گروه حساب/i.test(h));
  const groupLinkCol = headers.find(h => /ارتباط با سرفصل/i.test(h));
  // Fallbacks if heuristics fail
  if (!codeCol) {
    codeCol = headers.find(h => /code|کد|كد/i.test(h));
  }
  if (!nameCol) {
    nameCol = headers.find(h => /name|title|شرح|نام|عنوان/i.test(h));
  }
  if (!parentCol) {
    parentCol = headers.find(h => /parent|والد|گروه|سرفصل|ارتباط با سرفصل/i.test(h));
  }
  return { codeCol, nameCol, parentCol, natureCol, groupLinkCol };
}

/**
 * Prints a concise summary including sheet names, detected columns,
 * and sample rows with normalized code values.
 * @param {string} filePath - Absolute path to the file.
 * @param {string} activeSheet - Sheet name used.
 * @param {string[]} headers - Headers detected.
 * @param {any[]} rows - Parsed row objects.
 * @param {{ codeCol?: string, nameCol?: string, parentCol?: string }} cols - Detected columns.
 * @param {number} limit - Max number of sample rows to print.
 */
function printSummary(filePath, activeSheet, headers, rows, cols, limit) {
  console.log('Excel file:', filePath);
  console.log('Active sheet:', activeSheet);
  console.log('Headers:', headers);
  console.log('Detected columns:', cols);
  const samples = rows.slice(0, limit).map((r, idx) => {
    const codeRaw = cols.codeCol ? r[cols.codeCol] : '';
    const nameRaw = cols.nameCol ? r[cols.nameCol] : '';
    const parentRaw = cols.parentCol ? r[cols.parentCol] : '';
    const natureRaw = cols.natureCol ? r[cols.natureCol] : '';
    const groupLinkRaw = cols.groupLinkCol ? r[cols.groupLinkCol] : '';
    const code = toAsciiDigits(codeRaw);
    const parent = toAsciiDigits(parentRaw);
    return {
      idx,
      code_raw: codeRaw,
      code_norm: code,
      name: nameRaw,
      parent_raw: parentRaw,
      parent_norm: parent,
      nature: natureRaw,
      group_link: groupLinkRaw,
    };
  });
  console.log('Sample rows (first N):', JSON.stringify(samples, null, 2));
  const withCode = rows.filter(r => {
    const codeRaw = cols.codeCol ? r[cols.codeCol] : '';
    return String(codeRaw).trim() !== '';
  }).slice(0, limit).map((r, idx) => {
    const codeRaw = cols.codeCol ? r[cols.codeCol] : '';
    const nameRaw = cols.nameCol ? r[cols.nameCol] : '';
    const parentRaw = cols.parentCol ? r[cols.parentCol] : '';
    const natureRaw = cols.natureCol ? r[cols.natureCol] : '';
    const groupLinkRaw = cols.groupLinkCol ? r[cols.groupLinkCol] : '';
    const code = toAsciiDigits(codeRaw);
    const parent = toAsciiDigits(parentRaw);
    return {
      idx,
      code_raw: codeRaw,
      code_norm: code,
      name: nameRaw,
      parent_raw: parentRaw,
      parent_norm: parent,
      nature: natureRaw,
      group_link: groupLinkRaw,
    };
  });
  console.log('Sample rows (with code):', JSON.stringify(withCode, null, 2));
  const withGroupLink = rows.filter(r => {
    const groupLinkRaw = cols.groupLinkCol ? r[cols.groupLinkCol] : '';
    return String(groupLinkRaw).trim() !== '';
  }).slice(0, limit).map((r, idx) => {
    const codeRaw = cols.codeCol ? r[cols.codeCol] : '';
    const nameRaw = cols.nameCol ? r[cols.nameCol] : '';
    const parentRaw = cols.parentCol ? r[cols.parentCol] : '';
    const natureRaw = cols.natureCol ? r[cols.natureCol] : '';
    const groupLinkRaw = cols.groupLinkCol ? r[cols.groupLinkCol] : '';
    const code = toAsciiDigits(codeRaw);
    const parent = toAsciiDigits(parentRaw);
    return {
      idx,
      code_raw: codeRaw,
      code_norm: code,
      name: nameRaw,
      parent_raw: parentRaw,
      parent_norm: parent,
      nature: natureRaw,
      group_link: groupLinkRaw,
    };
  });
  console.log('Sample rows (with group link):', JSON.stringify(withGroupLink, null, 2));
}

/**
 * Main entry: parse args, load workbook, detect columns, and print summary.
 */
function main() {
  const { filePath, sheetName, limit } = parseArgs();
  const { sheetName: activeSheet, rows, headers } = loadWorkbook(filePath, sheetName);
  const cols = detectColumns(headers);
  printSummary(filePath, activeSheet, headers, rows, cols, limit);
}

main();