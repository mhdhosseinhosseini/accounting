import express, { Request, Response } from 'express';
import { t, Lang } from '../i18n';
import { getPool } from '../db/pg';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth';
import { Pool } from 'pg';

export const treasuryRouter = express.Router();

// Require authentication for all treasury endpoints
/** Middleware: enforce authentication */
treasuryRouter.use(requireAuth);

/**
 * getOrCreateInstrumentLink
 * Finds or creates a row in `instrument_links` for the given instrument type and source id.
 * Returns the `instrument_links.id` to store in `receipt_items.related_instrument_id`.
 * - instrumentType: one of 'card' | 'transfer' | 'check'
 * - sourceId: the underlying foreign key id (card_reader_id, bank_account_id, or check_id)
 */
async function getOrCreateInstrumentLink(p: Pool, instrumentType: 'card' | 'transfer' | 'check', sourceId: string | null): Promise<string | null> {
  if (!sourceId) return null;
  if (instrumentType === 'check') {
    const ex = await p.query(`SELECT id FROM instrument_links WHERE instrument_type='check' AND check_id=$1 LIMIT 1`, [sourceId]);
    if (ex.rowCount && ex.rows[0]?.id) return String(ex.rows[0].id);
    const linkId = randomUUID();
    await p.query(`INSERT INTO instrument_links (id, instrument_type, check_id) VALUES ($1,'check',$2)`, [linkId, sourceId]);
    return linkId;
  }
  if (instrumentType === 'card') {
    const ex = await p.query(`SELECT id FROM instrument_links WHERE instrument_type='card' AND card_reader_id=$1 LIMIT 1`, [sourceId]);
    if (ex.rowCount && ex.rows[0]?.id) return String(ex.rows[0].id);
    const linkId = randomUUID();
    await p.query(`INSERT INTO instrument_links (id, instrument_type, card_reader_id) VALUES ($1,'card',$2)`, [linkId, sourceId]);
    return linkId;
  }
  if (instrumentType === 'transfer') {
    const ex = await p.query(`SELECT id FROM instrument_links WHERE instrument_type='transfer' AND bank_account_id=$1 LIMIT 1`, [sourceId]);
    if (ex.rowCount && ex.rows[0]?.id) return String(ex.rows[0].id);
    const linkId = randomUUID();
    await p.query(`INSERT INTO instrument_links (id, instrument_type, bank_account_id) VALUES ($1,'transfer',$2)`, [linkId, sourceId]);
    return linkId;
  }
  return null;
}

/**
 * markIncomingChecksInCashbox
 * Given a receipt id, finds all incoming checks referenced by its items
 * and updates their status from 'created' to 'incashbox' (stored in cashbox).
 * Also assigns the receipt's `cashbox_id` onto the checks for filtering.
 * It only affects non-checkbook incoming checks with status 'created'.
 * Notes (FA): وضعیت چک‌های دریافتی از 'ایجاد شده' به 'در صندوق' تغییر می‌کند و صندوق مربوطه ثبت می‌شود.
 */
async function markIncomingChecksInCashbox(p: Pool, receiptId: string): Promise<void> {
  // Fetch cashbox assigned to the receipt to propagate onto checks
  const rc = await p.query(`SELECT cashbox_id FROM receipts WHERE id = $1 LIMIT 1`, [receiptId]);
  const cashboxId: string | null = rc.rows?.[0]?.cashbox_id ? String(rc.rows[0].cashbox_id) : null;

  const list = await p.query(
    `SELECT ri.check_id AS id
       FROM receipt_items ri
      WHERE ri.receipt_id = $1
        AND ri.instrument_type = 'check'
        AND ri.check_id IS NOT NULL`,
    [receiptId]
  );
  const ids: string[] = (list.rows || []).map((r: any) => String(r.id)).filter(Boolean);
  if (!ids.length) return;
  await p.query(
    `UPDATE checks
        SET status = 'incashbox', cashbox_id = $2
      WHERE id = ANY($1)
        AND type = 'incoming'
        AND checkbook_id IS NULL
        AND (status = 'created' OR status IS NULL)`,
    [ids, cashboxId]
  );
}

/**
 * revertIncomingChecksRemovedFromReceipt
 * Revert incoming checks removed from a receipt back to 'created'.
 * This considers verification history via 'incashbox' status set when a check
 * was previously verified/stored by a receipt. We only revert when the check is
 * no longer referenced by any receipt item across the system and its status is 'incashbox'.
 * Notes (FA): هنگامی که آیتم چک از رسید حذف و ذخیره می‌شود، اگر چک قبلاً در صندوق
 * ثبت (incashbox) شده و دیگر در هیچ آیتم رسیدی ارجاع ندارد، وضعیت آن به 'ایجاد شده' برگردانده می‌شود.
 */
async function revertIncomingChecksRemovedFromReceipt(p: Pool, receiptId: string, prevCheckIds: string[], newCheckIds: string[]): Promise<void> {
  const prev = new Set(prevCheckIds.map(String));
  for (const nid of newCheckIds) prev.delete(String(nid));
  const deletedIds = Array.from(prev);
  if (!deletedIds.length) return;

  for (const cid of deletedIds) {
    // If no receipt items reference this check anymore, revert status
    const ref = await p.query(`SELECT COUNT(1) AS cnt FROM receipt_items WHERE check_id = $1`, [cid]);
    const cnt = Number(ref.rows?.[0]?.cnt || 0);
    if (cnt === 0) {
      await p.query(
        `UPDATE checks SET status='created', cashbox_id=NULL
           WHERE id=$1
             AND type='incoming'
             AND checkbook_id IS NULL
             AND status='incashbox'`,
        [cid]
      );
    }
  }
}

/**
 * resolveCodeIdFromEnv
 * Resolves a `codes.id` for treasury posting from environment or settings.
 * Sources are checked in order:
 * 1) Environment variable `varName`: if it is a UUID, verifies and uses `codes.id`; if it is a code string, resolves via `codes.code`.
 * 2) Settings table row with `code = varName`: prefers `special_id` (UUID of `codes.id`), else inspects `value` which may be a plain code string or an object `{ code: string }`.
 * 3) Optional `defaultCode` parameter when provided.
 *
 * Required mappings for receipts:
 * - `CODE_TREASURY_CASH_RECEIPT` → debit line for cashbox receipts.
 * - `CODE_TREASURY_CARD_RECEIPT` → debit line for POS/card reader receipts.
 * - `CODE_TREASURY_TRANSFER_RECEIPT` → debit line for bank transfer receipts.
 * - `CODE_TREASURY_CHECK_RECEIPT` → debit line for received checks.
 * - `CODE_TREASURY_COUNTERPARTY_RECEIPT` → credit line for the counterparty detail at receipt header.
 *
 * Example (settings API): POST /api/v1/settings
 * { code: "CODE_TREASURY_CARD_RECEIPT", name: "کد حساب رسید کارت", value: "111007", type: "digits" }
 *
 * یادداشت (FA): برای ارسال دائمی رسیدها، نگاشت کدهای حساب بالا باید تنظیم شود.
 * این نگاشت‌ها می‌تواند از محیط اجرا یا جدول تنظیمات خوانده شود و در اولویت‌های فوق بررسی می‌گردد.
 */
async function resolveCodeIdFromEnv(p: Pool, varName: string, defaultCode?: string): Promise<string> {
  const raw = process.env[varName];
  const isUuid = (v?: string | null) => !!v && /^[0-9a-fA-F-]{36}$/.test(String(v));

  // Use environment UUID directly after verifying it exists
  if (isUuid(raw)) {
    const r = await p.query(`SELECT id FROM codes WHERE id = $1 LIMIT 1`, [String(raw)]);
    if (r.rowCount) return String(r.rows[0].id);
  }

  // Fallback to settings table: use special_id only
  const s = await p.query(`SELECT special_id FROM settings WHERE code = $1 LIMIT 1`, [varName]);
  if (s.rowCount) {
    const sid = s.rows[0]?.special_id ? String(s.rows[0].special_id) : null;
    if (isUuid(sid)) {
      const r = await p.query(`SELECT id FROM codes WHERE id = $1 LIMIT 1`, [sid]);
      if (r.rowCount) return String(r.rows[0].id);
    }
  }

  // Fallback to provided default code, if any
  if (defaultCode) {
    const r = await p.query(`SELECT id FROM codes WHERE code = $1 LIMIT 1`, [String(defaultCode)]);
    if (r.rowCount) return String(r.rows[0].id);
  }

  throw new Error(`Missing code mapping for ${varName}`);
}

/**
 * resolveNumericSetting
 * Reads a numeric configuration value from the `settings` table by `code`.
 * - If settings row exists, attempts to parse integer from `value` (supports raw number, numeric string, or object with `code`/`value`/`start`)
 * - Otherwise falls back to environment variable `envName`
 * - Finally falls back to provided `def` value
 */
async function resolveNumericSetting(p: Pool, code: string, envName: string, def: number): Promise<number> {
  try {
    const r = await p.query(`SELECT value FROM settings WHERE code = $1 LIMIT 1`, [code]);
    if (r.rowCount) {
      const v = r.rows[0]?.value;
      const parseCandidate = (src: any): number | null => {
        if (src == null) return null;
        if (typeof src === 'number') return Number.isFinite(src) ? Math.floor(src) : null;
        if (typeof src === 'string') {
          const n = parseInt(src.trim(), 10);
          return Number.isFinite(n) ? n : null;
        }
        if (typeof src === 'object') {
          const s = (src.code ?? src.value ?? src.start);
          if (s != null) {
            const n = parseInt(String(s).trim(), 10);
            return Number.isFinite(n) ? n : null;
          }
        }
        return null;
      };
      const num = parseCandidate(v);
      if (num != null) return num;
    }
  } catch {}
  const raw = process.env[envName];
  const envNum = parseInt(String(raw ?? ''), 10);
  if (Number.isFinite(envNum)) return envNum;
  return def;
}

/**
 * GET /banks
 * List available banks from database.
 * Returns bank name, branch number, branch name, and city.
 */
treasuryRouter.get('/banks', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, name, branch_number, branch_name, city
       FROM banks
       ORDER BY name ASC, city ASC`
    );
    return res.json({ ok: true, items: rows, message: t('treasury.banks.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * GET /cashboxes/next-code
 * Suggest the next cashbox code based on highest numeric code + 1.
 * Uses env CASHBOX_START_CODE (4-digit) when no prior code or as lower bound.
 */
treasuryRouter.get('/cashboxes/next-code', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();

    // Read starting code from settings, fallback to env, then 6000
    const configuredStartRaw = await resolveNumericSetting(p, 'VITE_CASHBOX_START_CODE', 'CASHBOX_START_CODE', 6000);
    const configuredStart = Math.min(9999, Math.max(1000, configuredStartRaw));

    // Find highest 4-digit numeric code in cashboxes
    const maxRes = await p.query(
      `SELECT code FROM cashboxes WHERE code ~ '^[0-9]{4}$' ORDER BY code::int DESC LIMIT 1`
    );
    const start = maxRes.rowCount
      ? Math.max(parseInt(maxRes.rows[0].code, 10) + 1, configuredStart)
      : configuredStart;

    // Preload used codes (4-digit numeric) from both tables
    const usedRes = await p.query(
      `SELECT code FROM details WHERE code ~ '^[0-9]{4}$'
       UNION
       SELECT code FROM cashboxes WHERE code ~ '^[0-9]{4}$'`
    );
    const used = new Set<string>(usedRes.rows.map((r: any) => String(r.code)));

    // Try sequentially from start up to 9999
    let candidate = start;
    while (candidate <= 9999) {
      const s = String(candidate);
      if (!used.has(s)) {
        return res.json({ ok: true, code: s, message: t('treasury.cashboxes.nextCode', lang) });
      }
      candidate++;
    }

    // Fallback: search the configured start..9999 range for any free code
    for (let n = configuredStart; n <= 9999; n++) {
      const s = String(n);
      if (!used.has(s)) {
        return res.json({ ok: true, code: s, message: t('treasury.cashboxes.nextCode', lang) });
      }
    }

    return res.status(409).json({ ok: false, error: 'No available code' });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * POST /banks
 * Create a bank definition.
 * Required: name. Optional: branch_number, branch_name, city.
 */
treasuryRouter.post('/banks', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const payload = req.body || {};
  const name = String(payload.name || '').trim();
  const branchNumber = payload.branch_number != null && !isNaN(Number(payload.branch_number))
    ? Number(payload.branch_number) : null;
  const branchName = payload.branch_name != null ? String(payload.branch_name).trim() : null;
  const city = payload.city != null ? String(payload.city).trim() : null;

  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });

  try {
    const p = getPool();
    const id = randomUUID();
    const { rows } = await p.query(
      `INSERT INTO banks (id, name, branch_number, branch_name, city)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, branch_number, branch_name, city, created_at`,
      [id, name, branchNumber, branchName, city]
    );
    return res.status(201).json({ ok: true, item: rows[0], message: t('treasury.banks.created', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * GET /banks/:id
 * Fetch a single bank record.
 */
treasuryRouter.get('/banks/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, name, branch_number, branch_name, city, created_at
       FROM banks WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, item: rows[0], message: t('treasury.banks.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * PATCH /banks/:id
 * Update bank fields: name, branch_number, branch_name, city.
 */
treasuryRouter.patch('/banks/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  const payload = req.body || {};
  const name = payload.name != null ? String(payload.name).trim() : undefined;
  const branchNumber = payload.branch_number != null
    ? (isNaN(Number(payload.branch_number)) ? 0 : Number(payload.branch_number))
    : undefined;
  const branchName = payload.branch_name != null ? String(payload.branch_name).trim() : undefined;
  const city = payload.city != null ? String(payload.city).trim() : undefined;

  try {
    const p = getPool();
    const existing = await p.query('SELECT id FROM banks WHERE id = $1', [id]);
    if (!existing.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (branchNumber !== undefined) { fields.push(`branch_number = $${idx++}`); values.push(branchNumber); }
    if (branchName !== undefined) { fields.push(`branch_name = $${idx++}`); values.push(branchName); }
    if (city !== undefined) { fields.push(`city = $${idx++}`); values.push(city); }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No changes provided' });

    values.push(id);
    const sql = `UPDATE banks SET ${fields.join(', ')} WHERE id = $${idx}
                 RETURNING id, name, branch_number, branch_name, city, created_at`;
    const { rows } = await p.query(sql, values);
    return res.json({ ok: true, item: rows[0], message: t('treasury.banks.updated', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * DELETE /banks/:id
 * Delete a bank record.
 */
treasuryRouter.delete('/banks/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    const del = await p.query('DELETE FROM banks WHERE id = $1', [id]);
    if (!del.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, message: t('treasury.banks.deleted', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * GET /bank-accounts
 * List available bank accounts from database.
 * Returns account_number, name, kind_of_account, card_number, bank_name, iban, is_active, starting_amount, starting_date, created_at.
 */
treasuryRouter.get('/bank-accounts', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT a.id, a.account_number, a.name, a.kind_of_account, a.card_number,
              CASE
                WHEN a.bank_id IS NOT NULL THEN (
                  COALESCE(b.name, '') ||
                  COALESCE(CASE WHEN b.branch_name IS NOT NULL AND b.branch_name <> '' THEN ' - ' || b.branch_name ELSE '' END, '') ||
                  COALESCE(CASE WHEN b.branch_number IS NOT NULL THEN ' - #' || b.branch_number::text ELSE '' END, '')
                )
                ELSE ''
              END AS bank_name,
              a.iban, a.is_active, a.starting_amount, a.starting_date, a.created_at, a.handler_detail_id, a.bank_id,
              COALESCE(cb.checkbook_count, 0) AS checkbook_count,
              COALESCE(cr.card_reader_count, 0) AS card_reader_count
       FROM bank_accounts a
       LEFT JOIN banks b ON b.id = a.bank_id
       LEFT JOIN (
         SELECT bank_account_id, COUNT(*) AS checkbook_count FROM checkbooks GROUP BY bank_account_id
       ) cb ON cb.bank_account_id = a.id
       LEFT JOIN (
         SELECT bank_account_id, COUNT(*) AS card_reader_count FROM card_readers GROUP BY bank_account_id
       ) cr ON cr.bank_account_id = a.id
       ORDER BY a.account_number ASC`
    );
    return res.json({ ok: true, items: rows, message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * GET /bank-accounts/kinds
 * Returns distinct kind_of_account values for searchable select options.
 */
treasuryRouter.get('/bank-accounts/kinds', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT DISTINCT kind_of_account AS kind
       FROM bank_accounts
       WHERE kind_of_account IS NOT NULL AND kind_of_account <> ''
       ORDER BY kind_of_account ASC`
    );
    const items = rows.map((r: any) => ({ id: String(r.kind), name: String(r.kind) }));
    return res.json({ ok: true, items, message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * POST /bank-accounts
 * Create a bank account definition.
 * Required: account_number, name, bank_id. Optional: kind_of_account, card_number, iban, is_active, starting_amount, starting_date.
 * Also auto-creates a system-managed Details row with a 4-digit code starting
 * from BANK_DETAIL_START_CODE (env, defaults to 6100) and prevents duplicates.
 */
treasuryRouter.post('/bank-accounts', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const payload = req.body || {};
  const accountNumber = String(payload.account_number ?? payload.code ?? '').trim();
  const name = String(payload.name || '').trim();
  const kindOfAccount = payload.kind_of_account != null ? String(payload.kind_of_account).trim() : null;
  const cardNumber = payload.card_number != null ? String(payload.card_number).trim() : null;

  const bankId = payload.bank_id != null ? String(payload.bank_id).trim() : null;
  const iban = payload.iban != null ? String(payload.iban).trim() : null;
  const isActive = payload.is_active === false ? false : true;
  const startingAmount = payload.starting_amount != null && !isNaN(Number(payload.starting_amount)) ? Number(payload.starting_amount) : 0;
  const startingDate = payload.starting_date != null ? new Date(payload.starting_date) : new Date();

  if (!accountNumber || !name) return res.status(400).json({ ok: false, error: 'account_number and name are required' });
  if (!bankId) return res.status(400).json({ ok: false, error: 'bank_id is required' });

  try {
    const p = getPool();
    const dupe = await p.query('SELECT 1 FROM bank_accounts WHERE account_number = $1', [accountNumber]);
    if (dupe.rowCount) return res.status(409).json({ ok: false, error: 'Bank account number already exists' });

    /**
     * computeNextBankDetailCode
     * Returns the next sequential 4-digit Details.code for bank accounts.
     * - Starts at env BANK_DETAIL_START_CODE (default 6100) for the first account
     * - Next codes follow previous bank account's code + 1 (e.g., 6100, 6101, 6102)
     * - Skips any occupied codes in `details` (if 6101 is taken, use 6102)
     * - Naturally continues past 6199 to 6200, etc.; enforces 4-digit range
     */
    async function computeNextBankDetailCode(): Promise<string> {
      const startRaw = await resolveNumericSetting(p, 'VITE_BANK_DETAIL_START_CODE', 'BANK_DETAIL_START_CODE', 6100);
      const minStart = Math.min(9999, Math.max(1000, startRaw));

      // Compute next code based on previous bank account detail code, starting at env value (e.g., 6100).
      // Skip any codes already occupied by other Details rows.
      const prevRes = await p.query(
        `SELECT MAX(d.code::int) AS prev
         FROM bank_accounts a
         JOIN details d ON d.id = a.handler_detail_id
         WHERE d.code ~ '^[0-9]{4}$' AND d.code::int >= $1`,
        [minStart]
      );
      const prev = (prevRes.rows[0]?.prev ?? null) as number | null;
      let candidate = prev != null ? prev + 1 : minStart;

      while (candidate <= 9999) {
        const candidateStr = String(candidate).padStart(4, '0');
        const exists = await p.query(`SELECT 1 FROM details WHERE code = $1`, [candidateStr]);
        if (!exists.rowCount) return candidateStr;
        candidate++;
      }

      throw new Error('No available 4-digit detail codes remain');
    }

    // Create a system-managed Details row first; prevent duplicates under contention
    // Title includes both bank name and account number for clarity.
    let createdDetailId: string | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const nextCode = await computeNextBankDetailCode();
      try {
        const detailId = randomUUID();
        const detailTitle = `${name} - ${accountNumber}`;
        await p.query(
          `INSERT INTO details (id, code, title, is_active, kind)
           VALUES ($1, $2, $3, $4, FALSE)`,
          [detailId, nextCode, detailTitle, isActive]
        );
        createdDetailId = detailId;
        break; // success
      } catch (err: any) {
        // 23505 = unique_violation; try next code if conflict occurs
        if (err?.code === '23505') continue;
        // Other errors: break and ignore details creation to not block account creation
        break;
      }
    }

    const id = randomUUID();
    const { rows } = await p.query(
      `INSERT INTO bank_accounts (id, account_number, name, kind_of_account, card_number, bank_id, iban, is_active, starting_amount, starting_date, handler_detail_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, account_number, name, kind_of_account, card_number, bank_id, iban, is_active, starting_amount, starting_date, handler_detail_id, created_at`,
      [id, accountNumber, name, kindOfAccount, cardNumber, bankId, iban, isActive, startingAmount, startingDate, createdDetailId]
    );

    return res.status(201).json({ ok: true, item: rows[0], message: t('treasury.bankAccounts.created', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * GET /bank-accounts/:id
 * Fetch a single bank account record.
 */
treasuryRouter.get('/bank-accounts/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT a.id, a.account_number, a.name, a.kind_of_account, a.card_number,
              CASE
                WHEN a.bank_id IS NOT NULL THEN (
                  COALESCE(b.name, '') ||
                  COALESCE(CASE WHEN b.branch_name IS NOT NULL AND b.branch_name <> '' THEN ' - ' || b.branch_name ELSE '' END, '') ||
                  COALESCE(CASE WHEN b.branch_number IS NOT NULL THEN ' - #' || b.branch_number::text ELSE '' END, '')
                )
                ELSE ''
              END AS bank_name,
              a.bank_id,
              a.handler_detail_id,
              a.iban, a.is_active, a.starting_amount, a.starting_date, a.created_at
       FROM bank_accounts a
       LEFT JOIN banks b ON b.id = a.bank_id
       WHERE a.id = $1 LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, item: rows[0], message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * PATCH /bank-accounts/:id
 * Update bank account fields: account_number, name, kind_of_account, card_number, bank_id, iban, is_active, starting_amount, starting_date.
 */
treasuryRouter.patch('/bank-accounts/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  const payload = req.body || {};
  const accountNumber = payload.account_number != null ? String(payload.account_number).trim() : undefined;
  const name = payload.name != null ? String(payload.name).trim() : undefined;
  const kindOfAccount = payload.kind_of_account != null ? String(payload.kind_of_account).trim() : undefined;
  const cardNumber = payload.card_number != null ? String(payload.card_number).trim() : undefined;
  const bankId = payload.bank_id != null ? String(payload.bank_id).trim() : undefined;
  const iban = payload.iban != null ? String(payload.iban).trim() : undefined;
  const isActive = payload.is_active != null ? !!payload.is_active : undefined;
  const startingAmount = payload.starting_amount != null && !isNaN(Number(payload.starting_amount)) ? Number(payload.starting_amount) : (payload.starting_amount != null ? 0 : undefined);
  const startingDate = payload.starting_date != null ? new Date(payload.starting_date) : undefined;

  try {
    const p = getPool();
    const existing = await p.query('SELECT id FROM bank_accounts WHERE id = $1', [id]);
    if (!existing.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    if (accountNumber) {
      const dupe = await p.query('SELECT 1 FROM bank_accounts WHERE account_number = $1 AND id <> $2', [accountNumber, id]);
      if (dupe.rowCount) return res.status(409).json({ ok: false, error: 'Bank account number already exists' });
    }
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (accountNumber !== undefined) { fields.push(`account_number = $${idx++}`); values.push(accountNumber); }
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (kindOfAccount !== undefined) { fields.push(`kind_of_account = $${idx++}`); values.push(kindOfAccount); }
    if (cardNumber !== undefined) { fields.push(`card_number = $${idx++}`); values.push(cardNumber); }
    if (bankId !== undefined) { fields.push(`bank_id = $${idx++}`); values.push(bankId); }
    if (iban !== undefined) { fields.push(`iban = $${idx++}`); values.push(iban); }
    if (isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(isActive); }
    if (startingAmount !== undefined) { fields.push(`starting_amount = $${idx++}`); values.push(startingAmount); }
    if (startingDate !== undefined) { fields.push(`starting_date = $${idx++}`); values.push(startingDate); }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No changes provided' });

    values.push(id);
    const sql = `UPDATE bank_accounts SET ${fields.join(', ')} WHERE id = $${idx}
                 RETURNING id, account_number, name, kind_of_account, card_number, bank_id, iban, is_active, starting_amount, starting_date, handler_detail_id, created_at`;
    const { rows } = await p.query(sql, values);
    return res.json({ ok: true, item: rows[0], message: t('treasury.bankAccounts.updated', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * PUT /bank-accounts/:id
 * Convenience endpoint to mirror front-end's PUT usage.
 */
treasuryRouter.put('/bank-accounts/:id', async (req: Request, res: Response) => {
  // Delegate to patch logic by calling the same handler code path
  // Implementation duplicated here for simplicity.
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  const payload = req.body || {};
  const accountNumber = payload.account_number != null ? String(payload.account_number).trim() : undefined;
  const name = payload.name != null ? String(payload.name).trim() : undefined;
  const kindOfAccount = payload.kind_of_account != null ? String(payload.kind_of_account).trim() : undefined;
  const cardNumber = payload.card_number != null ? String(payload.card_number).trim() : undefined;
  const bankId = payload.bank_id != null ? String(payload.bank_id).trim() : undefined;
  const iban = payload.iban != null ? String(payload.iban).trim() : undefined;
  const isActive = payload.is_active != null ? !!payload.is_active : undefined;
  const startingAmount = payload.starting_amount != null && !isNaN(Number(payload.starting_amount)) ? Number(payload.starting_amount) : (payload.starting_amount != null ? 0 : undefined);
  const startingDate = payload.starting_date != null ? new Date(payload.starting_date) : undefined;

  try {
    const p = getPool();
    const existing = await p.query('SELECT id FROM bank_accounts WHERE id = $1', [id]);
    if (!existing.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    if (accountNumber) {
      const dupe = await p.query('SELECT 1 FROM bank_accounts WHERE account_number = $1 AND id <> $2', [accountNumber, id]);
      if (dupe.rowCount) return res.status(409).json({ ok: false, error: 'Bank account number already exists' });
    }
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (accountNumber !== undefined) { fields.push(`account_number = $${idx++}`); values.push(accountNumber); }
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (kindOfAccount !== undefined) { fields.push(`kind_of_account = $${idx++}`); values.push(kindOfAccount); }
    if (cardNumber !== undefined) { fields.push(`card_number = $${idx++}`); values.push(cardNumber); }
    if (bankId !== undefined) { fields.push(`bank_id = $${idx++}`); values.push(bankId); }
    if (iban !== undefined) { fields.push(`iban = $${idx++}`); values.push(iban); }
    if (isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(isActive); }
    if (startingAmount !== undefined) { fields.push(`starting_amount = $${idx++}`); values.push(startingAmount); }
    if (startingDate !== undefined) { fields.push(`starting_date = $${idx++}`); values.push(startingDate); }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No changes provided' });

    values.push(id);
    const sql = `UPDATE bank_accounts SET ${fields.join(', ')} WHERE id = $${idx}
                 RETURNING id, account_number, name, kind_of_account, card_number, bank_id, iban, is_active, starting_amount, starting_date, handler_detail_id, created_at`;
    const { rows } = await p.query(sql, values);
    return res.json({ ok: true, item: rows[0], message: t('treasury.bankAccounts.updated', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * DELETE /bank-accounts/:id
 * Delete a bank account record and its associated Details row (handler_detail_id).
 * If the Details row cannot be removed due to foreign key references,
 * it will be soft-disabled (is_active = FALSE).
 */
treasuryRouter.delete('/bank-accounts/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();

    // Fetch associated handler_detail_id before deleting the bank account
    const existing = await p.query('SELECT handler_detail_id FROM bank_accounts WHERE id = $1', [id]);
    if (!existing.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    const handlerDetailId: string | null = existing.rows[0]?.handler_detail_id || null;

    // Delete the bank account itself
    const del = await p.query('DELETE FROM bank_accounts WHERE id = $1', [id]);
    if (!del.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });

    // Attempt to delete the associated Details record
    if (handlerDetailId) {
      try {
        await p.query('DELETE FROM details WHERE id = $1', [handlerDetailId]);
      } catch (err: any) {
        // If deletion fails due to FK constraints, soft-disable the detail
        if (err?.code === '23503' /* foreign_key_violation */) {
          await p.query('UPDATE details SET is_active = FALSE WHERE id = $1', [handlerDetailId]);
        } else {
          // For other errors, rethrow to surface unexpected issues
          throw err;
        }
      }
    }

    return res.json({ ok: true, message: t('treasury.bankAccounts.deleted', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * GET /bank-accounts/:id/checkbooks
 * List checkbooks for a bank account.
 */
treasuryRouter.get('/bank-accounts/:id/checkbooks', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const bankAccountId = String(req.params.id || '');
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, bank_account_id, series, start_number, page_count, issue_date, received_date, status, description, created_at
       FROM checkbooks WHERE bank_account_id = $1 ORDER BY created_at DESC`,
      [bankAccountId]
    );
    return res.json({ ok: true, items: rows, message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * POST /bank-accounts/:id/checkbooks
 * Create a checkbook for a bank account.
 */
treasuryRouter.post('/bank-accounts/:id/checkbooks', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const bankAccountId = String(req.params.id || '');
  const payload = req.body || {};
  const series = payload.series != null ? String(payload.series) : null;
  const startNumber = Number(payload.start_number ?? 1);
  const pageCount = Number(payload.page_count ?? 1);
  const issueDate = payload.issue_date ? new Date(payload.issue_date) : null;
  const receivedDate = payload.received_date ? new Date(payload.received_date) : null;
  const status = payload.status ? String(payload.status) : 'active';
  const description = payload.description ? String(payload.description) : null;

  if (!bankAccountId) return res.status(400).json({ ok: false, error: 'bank_account_id required' });
  if (!Number.isFinite(startNumber) || !Number.isFinite(pageCount)) {
    return res.status(400).json({ ok: false, error: 'Invalid numbers' });
  }
  if (pageCount <= 0) return res.status(400).json({ ok: false, error: 'page_count must be > 0' });

  try {
    const p = getPool();
    const id = randomUUID();
    const { rows } = await p.query(
      `INSERT INTO checkbooks (id, bank_account_id, series, start_number, page_count, issue_date, received_date, status, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, bank_account_id, series, start_number, page_count, issue_date, received_date, status, description, created_at`,
      [id, bankAccountId, series, startNumber, pageCount, issueDate, receivedDate, status, description]
    );
    return res.status(201).json({ ok: true, item: rows[0], message: t('treasury.bankAccounts.created', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/** Fetch single checkbook */
treasuryRouter.get('/checkbooks/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    const { rows } = await p.query(`SELECT * FROM checkbooks WHERE id = $1 LIMIT 1`, [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, item: rows[0], message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message || 'Error' }); }
});

/** Update checkbook */
treasuryRouter.patch('/checkbooks/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  const payload = req.body || {};
  const series = payload.series != null ? String(payload.series) : undefined;
  const startNumber = payload.start_number != null ? Number(payload.start_number) : undefined;
  const pageCount = payload.page_count != null ? Number(payload.page_count) : undefined;
  const issueDate = payload.issue_date != null ? new Date(payload.issue_date) : undefined;
  const receivedDate = payload.received_date != null ? new Date(payload.received_date) : undefined;
  const status = payload.status != null ? String(payload.status) : undefined;
  const description = payload.description != null ? String(payload.description) : undefined;

  try {
    const p = getPool();
    const fields: string[] = []; const values: any[] = []; let idx = 1;
    if (series !== undefined) { fields.push(`series = $${idx++}`); values.push(series); }
    if (startNumber !== undefined) { fields.push(`start_number = $${idx++}`); values.push(startNumber); }
    if (pageCount !== undefined) { fields.push(`page_count = $${idx++}`); values.push(pageCount); }
    if (issueDate !== undefined) { fields.push(`issue_date = $${idx++}`); values.push(issueDate); }
    if (receivedDate !== undefined) { fields.push(`received_date = $${idx++}`); values.push(receivedDate); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No changes provided' });
    values.push(id);
    const sql = `UPDATE checkbooks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const { rows } = await p.query(sql, values);
    return res.json({ ok: true, item: rows[0], message: t('treasury.bankAccounts.updated', lang) });
  } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message || 'Error' }); }
});

/** Delete checkbook */
treasuryRouter.delete('/checkbooks/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    const ref = await p.query('SELECT 1 FROM checks WHERE checkbook_id = $1 LIMIT 1', [id]);
    if (ref.rowCount) return res.status(400).json({ ok: false, error: 'Checkbook has issued checks' });
    const del = await p.query('DELETE FROM checkbooks WHERE id = $1', [id]);
    if (!del.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, message: t('treasury.bankAccounts.deleted', lang) });
  } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message || 'Error' }); }
});

/**
 * Card readers endpoints
 */
treasuryRouter.get('/bank-accounts/:id/card-readers', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const bankAccountId = String(req.params.id || '');
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, bank_account_id, psp_provider, terminal_id, merchant_id, device_serial, brand, model, install_date, last_settlement_date, is_active, description, created_at
       FROM card_readers WHERE bank_account_id = $1 ORDER BY created_at DESC`,
      [bankAccountId]
    );
    return res.json({ ok: true, items: rows, message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message || 'Error' }); }
});

/**
 * POST /bank-accounts/:id/card-readers
 * Creates a card reader and a linked Details row in a transaction.
 * The Details.title is set to "[PSP Provider] - [Terminal ID]".
 */
treasuryRouter.post('/bank-accounts/:id/card-readers', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const bankAccountId = String(req.params.id || '');
  const payload = req.body || {};
  const pspProvider = String(payload.psp_provider || '');
  const terminalId = String(payload.terminal_id || '');
  const merchantId = payload.merchant_id ? String(payload.merchant_id) : null;
  const deviceSerial = payload.device_serial ? String(payload.device_serial) : null;
  const brand = payload.brand ? String(payload.brand) : null;
  const model = payload.model ? String(payload.model) : null;
  const installDate = payload.install_date ? new Date(payload.install_date) : null;
  const lastSettlementDate = payload.last_settlement_date ? new Date(payload.last_settlement_date) : null;
  const isActive = payload.is_active === false ? false : true;
  const description = payload.description ? String(payload.description) : null;

  if (!bankAccountId || !pspProvider || !terminalId) return res.status(400).json({ ok: false, error: 'bank_account_id, psp_provider, terminal_id required' });

  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');

      async function computeNextCardReaderDetailCode(): Promise<string> {
        const start = Number(process.env.CARD_READER_DETAIL_START_CODE ?? '6200');
        const minStart = Number.isFinite(start) && start > 0 ? Math.floor(start) : 6200;
        const prevRes = await client.query(
          `SELECT MAX(d.code::int) AS prev
           FROM card_readers cr
           JOIN details d ON d.id = cr.handler_detail_id
           WHERE d.code ~ '^[0-9]{4}$' AND d.code::int >= $1`,
          [minStart]
        );
        const prev = (prevRes.rows[0]?.prev ?? null) as number | null;
        let candidate = prev != null ? prev + 1 : minStart;
        while (candidate <= 9999) {
          const candidateStr = String(candidate).padStart(4, '0');
          const exists = await client.query(`SELECT 1 FROM details WHERE code = $1`, [candidateStr]);
          if (!exists.rowCount) return candidateStr;
          candidate++;
        }
        throw new Error('No available 4-digit detail codes remain');
      }

      let createdDetailId: string | null = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        const nextCode = await computeNextCardReaderDetailCode();
        try {
          const detailId = randomUUID();
          // Title uses data values: "[PSP Provider] - [Terminal ID]"
          const detailTitle = `${pspProvider} - ${terminalId}`;
          await client.query(
            `INSERT INTO details (id, code, title, is_active, kind)
             VALUES ($1, $2, $3, $4, FALSE)`,
            [detailId, nextCode, detailTitle, isActive]
          );
          createdDetailId = detailId;
          break;
        } catch (err: any) {
          if (err?.code === '23505') continue;
          throw err;
        }
      }
      if (!createdDetailId) throw new Error('Failed to create detail for card reader');

      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO card_readers (id, bank_account_id, psp_provider, terminal_id, merchant_id, device_serial, brand, model, install_date, last_settlement_date, is_active, description, handler_detail_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, bank_account_id, psp_provider, terminal_id, merchant_id, device_serial, brand, model, install_date, last_settlement_date, is_active, description, handler_detail_id, created_at`,
        [id, bankAccountId, pspProvider, terminalId, merchantId, deviceSerial, brand, model, installDate, lastSettlementDate, isActive, description, createdDetailId]
      );

      await client.query('COMMIT');
      return res.status(201).json({ ok: true, item: rows[0], message: t('treasury.bankAccounts.created', lang) });
    } catch (err: any) {
      await client.query('ROLLBACK');
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    } finally {
      client.release();
    }
  } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message || 'Error' }); }
});

treasuryRouter.get('/card-readers/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    const { rows } = await p.query(`SELECT * FROM card_readers WHERE id = $1 LIMIT 1`, [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, item: rows[0], message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message || 'Error' }); }
});

/**
 * PATCH /card-readers/:id
 * Updates card reader fields and synchronizes the linked Details.title
 * to "[PSP Provider] - [Terminal ID]" when PSP or Terminal changes.
 */
treasuryRouter.patch('/card-readers/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  const payload = req.body || {};
  const pspProvider = payload.psp_provider != null ? String(payload.psp_provider) : undefined;
  const terminalId = payload.terminal_id != null ? String(payload.terminal_id) : undefined;
  const merchantId = payload.merchant_id != null ? String(payload.merchant_id) : undefined;
  const deviceSerial = payload.device_serial != null ? String(payload.device_serial) : undefined;
  const brand = payload.brand != null ? String(payload.brand) : undefined;
  const model = payload.model != null ? String(payload.model) : undefined;
  const installDate = payload.install_date != null ? new Date(payload.install_date) : undefined;
  const lastSettlementDate = payload.last_settlement_date != null ? new Date(payload.last_settlement_date) : undefined;
  const isActive = payload.is_active != null ? !!payload.is_active : undefined;
  const description = payload.description != null ? String(payload.description) : undefined;

  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      // Fetch current values and handler_detail_id
      const cur = await client.query('SELECT psp_provider, terminal_id, handler_detail_id FROM card_readers WHERE id = $1 LIMIT 1', [id]);
      if (!cur.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
      const current = cur.rows[0];

      const fields: string[] = []; const values: any[] = []; let idx = 1;
      if (pspProvider !== undefined) { fields.push(`psp_provider = $${idx++}`); values.push(pspProvider); }
      if (terminalId !== undefined) { fields.push(`terminal_id = $${idx++}`); values.push(terminalId); }
      if (merchantId !== undefined) { fields.push(`merchant_id = $${idx++}`); values.push(merchantId); }
      if (deviceSerial !== undefined) { fields.push(`device_serial = $${idx++}`); values.push(deviceSerial); }
      if (brand !== undefined) { fields.push(`brand = $${idx++}`); values.push(brand); }
      if (model !== undefined) { fields.push(`model = $${idx++}`); values.push(model); }
      if (installDate !== undefined) { fields.push(`install_date = $${idx++}`); values.push(installDate); }
      if (lastSettlementDate !== undefined) { fields.push(`last_settlement_date = $${idx++}`); values.push(lastSettlementDate); }
      if (isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(isActive); }
      if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description); }
      if (!fields.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'No changes provided' });
      }

      values.push(id);
      const sql = `UPDATE card_readers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
      const upd = await client.query(sql, values);
      const updated = upd.rows[0];

      // Update linked details title when PSP/Terminal changed
      const effectivePsp = pspProvider !== undefined ? pspProvider : String(current.psp_provider || '');
      const effectiveTerminal = terminalId !== undefined ? terminalId : String(current.terminal_id || '');
      const shouldUpdateTitle = (pspProvider !== undefined) || (terminalId !== undefined);
      const handlerDetailId = current.handler_detail_id ? String(current.handler_detail_id) : null;
      if (shouldUpdateTitle && handlerDetailId) {
        const newTitle = `${effectivePsp} - ${effectiveTerminal}`;
        await client.query(`UPDATE details SET title = $1, kind = FALSE WHERE id = $2`, [newTitle, handlerDetailId]);
      }

      await client.query('COMMIT');
      return res.json({ ok: true, item: updated, message: t('treasury.bankAccounts.updated', lang) });
    } catch (err: any) {
      await client.query('ROLLBACK');
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    } finally {
      client.release();
    }
  } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message || 'Error' }); }
});

treasuryRouter.delete('/card-readers/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    const ref = await p.query('SELECT 1 FROM treasury_payments WHERE card_reader_id = $1 LIMIT 1', [id]);
    if (ref.rowCount) return res.status(400).json({ ok: false, error: 'Card reader referenced by payments' });

    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT handler_detail_id FROM card_readers WHERE id = $1 LIMIT 1', [id]);
      if (!cur.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
      const handlerDetailId = cur.rows[0]?.handler_detail_id ? String(cur.rows[0].handler_detail_id) : null;
      if (handlerDetailId) {
        await client.query('DELETE FROM details WHERE id = $1', [handlerDetailId]);
      }
      const del = await client.query('DELETE FROM card_readers WHERE id = $1', [id]);
      if (!del.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
      await client.query('COMMIT');
      return res.json({ ok: true, message: t('treasury.bankAccounts.deleted', lang) });
    } catch (err: any) {
      await client.query('ROLLBACK');
      return res.status(500).json({ ok: false, error: err?.message || 'Error' });
    } finally {
      client.release();
    }
  } catch (e: any) { return res.status(500).json({ ok: false, error: e?.message || 'Error' }); }
});
/**
 * GET /checks
 * List incoming checks not tied to a checkbook.
 * Supports optional filters:
 * - available=true: exclude checks already referenced by receipt_items (used in other receipts)
 * - exclude_receipt_id=<id>: when available=true, include checks used in the specified receipt id (editing case)
 * - status=<status>: filter by check status (e.g., 'incashbox')
 * - cashbox_id=<id>: filter by cashbox assignment for incoming checks
 */
treasuryRouter.get('/checks', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const type = String((req.query.type || 'incoming')).toLowerCase();
  if (type !== 'incoming') return res.status(400).json({ ok: false, error: 'Only incoming supported' });
  const availableOnly = String(req.query.available || 'false').toLowerCase() === 'true';
  const excludeReceiptId = req.query.exclude_receipt_id ? String(req.query.exclude_receipt_id) : null;
  const statusFilter = req.query.status ? String(req.query.status) : null;
  const cashboxIdFilter = req.query.cashbox_id ? String(req.query.cashbox_id) : null;
  try {
    const p = getPool();
    let sql = `SELECT checks.id, checks.type, checks.number, checks.bank_name, checks.issuer, checks.beneficiary_detail_id,
                      checks.issue_date, checks.due_date, checks.amount, checks.status, checks.notes, checks.created_at, checks.cashbox_id,
                      d.code AS beneficiary_detail_code, d.title AS beneficiary_detail_title
               FROM checks
               LEFT JOIN details d ON d.id = checks.beneficiary_detail_id
               WHERE checks.checkbook_id IS NULL AND checks.type = 'incoming'`;
    const params: any[] = [];
    if (availableOnly) {
      sql += ` AND NOT EXISTS (
                 SELECT 1 FROM receipt_items ri
                  WHERE ri.check_id = checks.id
                    AND ($1::TEXT IS NULL OR ri.receipt_id <> $1::TEXT)
               )`;
      params.push(excludeReceiptId);
    }
    // Dynamic filters using incremental parameter positions
    let paramIndex = params.length + 1;
    if (statusFilter) {
      sql += ` AND checks.status = $${paramIndex}`;
      params.push(statusFilter);
      paramIndex++;
    }
    if (cashboxIdFilter) {
      sql += ` AND checks.cashbox_id = $${paramIndex}`;
      params.push(cashboxIdFilter);
      paramIndex++;
    }
    sql += ` ORDER BY checks.issue_date DESC, checks.created_at DESC LIMIT 100`;
    const { rows } = await p.query(sql, params);
    return res.json({ ok: true, items: rows, message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});
/**
 * GET /checks/bank-names
 * Returns distinct bank names used for incoming checks for a beneficiary detail.
 * Query param: detail_id=<uuid>
 */
treasuryRouter.get('/checks/bank-names', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const detailId = req.query.detail_id ? String(req.query.detail_id) : '';
  if (!detailId) return res.status(400).json({ ok: false, error: 'detail_id required' });
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT DISTINCT bank_name
         FROM checks
        WHERE type = 'incoming'
          AND beneficiary_detail_id = $1
          AND bank_name IS NOT NULL
          AND LENGTH(TRIM(bank_name)) > 0
        ORDER BY bank_name ASC
        LIMIT 50`,
      [detailId]
    );
    const items = rows.map(r => String(r.bank_name));
    return res.json({ ok: true, items, message: t('treasury.checks.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});
/**
 * POST /checks
 * Create an incoming check (no checkbook).
 */
treasuryRouter.post('/checks', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const payload = req.body || {};
  const type = String(payload.type || 'incoming');
  if (type !== 'incoming') return res.status(400).json({ ok: false, error: 'Only incoming supported' });
  const issueDate = payload.issue_date ? new Date(payload.issue_date) : null;
  const dueDate = payload.due_date ? new Date(payload.due_date) : null;
  const rawNumber = String(payload.number || '');
  const number = toAsciiDigits(rawNumber).trim();
  const bankName = payload.bank_name ? String(payload.bank_name) : null;
  const issuer = payload.issuer ? String(payload.issuer) : null;
  const beneficiaryDetailId = payload.beneficiary_detail_id ? String(payload.beneficiary_detail_id) : null;
  const amount = Number(payload.amount ?? NaN);
  const notes = payload.notes ? String(payload.notes) : null;

  if (!issueDate || isNaN(issueDate.getTime())) return res.status(400).json({ ok: false, error: 'Invalid issue_date' });
  if (!/^[0-9]+$/.test(number)) return res.status(400).json({ ok: false, error: 'number must be digits' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'amount must be > 0' });

  try {
    const p = getPool();
    // Optional recipient validation (issuer detail used as beneficiary on incoming)
    if (beneficiaryDetailId) {
      const d = await p.query(`SELECT 1 FROM details WHERE id = $1 AND is_active = TRUE LIMIT 1`, [beneficiaryDetailId]);
      if (!d.rowCount) return res.status(400).json({ ok: false, error: 'Recipient detail not found or inactive' });
    }
    const id = randomUUID();
    const { rows } = await p.query(
      `INSERT INTO checks (id, type, number, bank_name, issuer, beneficiary_detail_id, issue_date, due_date, amount, status, notes)
       VALUES ($1, 'incoming', $2, $3, $4, $5, $6, $7, $8, 'created', $9)
       RETURNING id, type, number, bank_name, issuer, beneficiary_detail_id, issue_date, due_date, amount, status, notes, created_at`,
      [id, number, bankName, issuer, beneficiaryDetailId, issueDate, dueDate, amount, notes]
    );
    return res.status(201).json({ ok: true, item: rows[0], message: t('treasury.checks.created', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});
/**
 * GET /checkbooks/:id/checks
 * List checks for a checkbook, filterable by type.
 */
treasuryRouter.get('/checkbooks/:id/checks', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const checkbookId = String(req.params.id || '');
  const type = String((req.query.type || 'outgoing')).toLowerCase();
  const availableOnly = String(req.query.available || 'false').toLowerCase() === 'true';
  const excludePaymentId = req.query.exclude_payment_id ? String(req.query.exclude_payment_id) : null;
  try {
    const p = getPool();
    let sql = `SELECT c.id, c.type, c.number, c.beneficiary, c.beneficiary_detail_id,
              d.title AS beneficiary_detail_title, d.code AS beneficiary_detail_code,
              c.issue_date, c.due_date, c.amount, c.status, c.notes, c.created_at
       FROM checks c
       LEFT JOIN details d ON d.id = c.beneficiary_detail_id
       WHERE c.checkbook_id = $1 AND ($2::TEXT IS NULL OR c.type = $2)`;
    const params: any[] = [checkbookId, type || null];
    if (availableOnly) {
      sql += ` AND NOT EXISTS (
                 SELECT 1 FROM payment_items pi
                  WHERE pi.check_id = c.id
                    AND pi.instrument_type = 'check'
                    AND ($3::TEXT IS NULL OR pi.payment_id <> $3::TEXT)
               )`;
      params.push(excludePaymentId);
    }
    sql += ` ORDER BY c.issue_date DESC, c.created_at DESC LIMIT 100`;
    const { rows } = await p.query(sql, params);
    return res.json({ ok: true, items: rows, message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * GET /checkbooks/:id/last-issued-number
 * Returns the last issued serial number and a next suggestion for outgoing checks.
 */
treasuryRouter.get('/checkbooks/:id/last-issued-number', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const checkbookId = String(req.params.id || '');
  try {
    const p = getPool();
    const cbRes = await p.query(`SELECT start_number, page_count FROM checkbooks WHERE id = $1 LIMIT 1`, [checkbookId]);
    if (!cbRes.rows.length) return res.status(404).json({ ok: false, error: 'Checkbook not found' });
    const startNum = Number(cbRes.rows[0].start_number);
    const endNum = startNum + Number(cbRes.rows[0].page_count) - 1;
    const { rows } = await p.query(
      `SELECT number FROM checks WHERE checkbook_id = $1 AND type = 'outgoing' AND status = 'issued' ORDER BY (number::INT) DESC LIMIT 1`,
      [checkbookId]
    );
    const lastIssuedNumber = rows.length ? String(rows[0].number) : null;
    let nextSuggestion: string | null = null;
    if (lastIssuedNumber) {
      const next = Number(lastIssuedNumber) + 1;
      if (Number.isFinite(next) && next <= endNum) nextSuggestion = String(next);
    } else {
      nextSuggestion = String(startNum);
    }
    return res.json({ ok: true, lastIssuedNumber, nextSuggestion, range: { start: startNum, end: endNum }, message: t('treasury.bankAccounts.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * POST /checkbooks/:id/checks
 * Issue a new outgoing check from a checkbook.
 */
function toAsciiDigits(str: string): string {
  return Array.from(String(str)).map((ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String.fromCharCode(48 + (code - 0x0660));
    if (code >= 0x06f0 && code <= 0x06f9) return String.fromCharCode(48 + (code - 0x06f0));
    return ch;
  }).join('');
}

treasuryRouter.post('/checkbooks/:id/checks', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const checkbookId = String(req.params.id || '');
  const payload = req.body || {};
  const type = String(payload.type || 'outgoing');
  const issueDate = payload.issue_date ? new Date(payload.issue_date) : null;
  const dueDate = payload.due_date ? new Date(payload.due_date) : null;
  const rawNumber = String(payload.number || '');
  const number = toAsciiDigits(rawNumber).trim();
  const beneficiaryDetailId = payload.beneficiary_detail_id ? String(payload.beneficiary_detail_id) : null;
  const beneficiary = payload.beneficiary ? String(payload.beneficiary) : null; // optional free-text
  const amount = Number(payload.amount ?? NaN);
  const notes = payload.notes ? String(payload.notes) : null;

  if (!checkbookId) return res.status(400).json({ ok: false, error: 'checkbook_id required' });
  if (type !== 'outgoing' && type !== 'incoming') return res.status(400).json({ ok: false, error: 'Invalid type' });
  if (!issueDate || isNaN(issueDate.getTime())) return res.status(400).json({ ok: false, error: 'Invalid issue_date' });
  if (!/^[0-9]+$/.test(number)) return res.status(400).json({ ok: false, error: 'number must be digits' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'amount must be > 0' });

  try {
    const p = getPool();
    const cbRes = await p.query(`SELECT id, status, start_number, page_count FROM checkbooks WHERE id = $1 LIMIT 1`, [checkbookId]);
    if (!cbRes.rows.length) return res.status(404).json({ ok: false, error: 'Checkbook not found' });
    const cb = cbRes.rows[0];
    if (String(cb.status) !== 'active') return res.status(400).json({ ok: false, error: 'Checkbook not active' });
    const startNum = Number(cb.start_number);
    const endNum = startNum + Number(cb.page_count) - 1;
    const serialNum = Number(number);
    if (!Number.isFinite(serialNum) || serialNum < startNum || serialNum > endNum) {
      return res.status(400).json({ ok: false, error: 'number out of range' });
    }

    // Uniqueness within checkbook for given type
    const exists = await p.query(`SELECT 1 FROM checks WHERE checkbook_id = $1 AND type = $2 AND number = $3 LIMIT 1`, [checkbookId, type, number]);
    if (exists.rowCount) return res.status(400).json({ ok: false, error: 'Duplicate check number' });

    // Optional recipient validation
    if (beneficiaryDetailId) {
      const d = await p.query(`SELECT 1 FROM details WHERE id = $1 AND is_active = TRUE LIMIT 1`, [beneficiaryDetailId]);
      if (!d.rowCount) return res.status(400).json({ ok: false, error: 'Recipient detail not found or inactive' });
    }

    const id = randomUUID();
    const { rows } = await p.query(
      `INSERT INTO checks (id, type, checkbook_id, number, beneficiary, beneficiary_detail_id, issue_date, due_date, amount, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'issued', $10)
       RETURNING id, type, checkbook_id, number, beneficiary, beneficiary_detail_id, issue_date, due_date, amount, status, notes, created_at`,
      [id, type, checkbookId, number, beneficiary, beneficiaryDetailId, issueDate, dueDate, amount, notes]
    );

    // If this issued serial is the last page of the checkbook, mark checkbook exhausted
    if (serialNum === endNum) {
      await p.query(`UPDATE checkbooks SET status = 'exhausted' WHERE id = $1 AND status = 'active'`, [checkbookId]);
    }

    return res.status(201).json({ ok: true, item: rows[0], message: t('treasury.checks.created', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * PATCH /checks/:id
 * Update an existing check (only for 'outgoing' or 'incoming'); enforces range/uniqueness.
 */
treasuryRouter.patch('/checks/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  const payload = req.body || {};
  try {
    const p = getPool();
    const curRes = await p.query(`SELECT * FROM checks WHERE id = $1 LIMIT 1`, [id]);
    if (!curRes.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    const cur = curRes.rows[0];

    // Apply incoming/outgoing fields
    const issueDate = payload.issue_date != null ? new Date(payload.issue_date) : undefined;
    const dueDate = payload.due_date != null ? new Date(payload.due_date) : undefined;
    const rawNumber = payload.number != null ? String(payload.number) : undefined;
    const number = rawNumber != null ? toAsciiDigits(rawNumber).trim() : undefined;
    const beneficiaryDetailId = payload.beneficiary_detail_id != null ? String(payload.beneficiary_detail_id) : undefined;
    const beneficiary = payload.beneficiary != null ? String(payload.beneficiary) : undefined;
    const amount = payload.amount != null ? Number(payload.amount) : undefined;
    const notes = payload.notes != null ? String(payload.notes) : undefined;
    // Incoming-only optional fields
    const bankName = payload.bank_name != null ? String(payload.bank_name) : undefined;
    const issuer = payload.issuer != null ? String(payload.issuer) : undefined;

    // Validate basics
    if (issueDate !== undefined && (isNaN(issueDate.getTime()))) return res.status(400).json({ ok: false, error: 'Invalid issue_date' });
    if (dueDate !== undefined && (isNaN(dueDate.getTime()))) return res.status(400).json({ ok: false, error: 'Invalid due_date' });
    if (number !== undefined && !/^[0-9]+$/.test(number)) return res.status(400).json({ ok: false, error: 'number must be digits' });
    if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) return res.status(400).json({ ok: false, error: 'amount must be > 0' });
    if (beneficiaryDetailId) {
      const d = await p.query(`SELECT 1 FROM details WHERE id = $1 AND is_active = TRUE LIMIT 1`, [beneficiaryDetailId]);
      if (!d.rowCount) return res.status(400).json({ ok: false, error: 'Recipient detail not found or inactive' });
    }

    // If number changed, validate for outgoing checks with checkbook; skip for incoming without checkbook
    let finalNumber = number != null ? number : String(cur.number);
    if (number !== undefined) {
      if (cur.checkbook_id == null || String(cur.type) === 'incoming') {
        // Incoming checks without a checkbook: no range/uniqueness constraints
        finalNumber = number;
      } else {
        const cbRes = await p.query(`SELECT start_number, page_count, status FROM checkbooks WHERE id = $1 LIMIT 1`, [cur.checkbook_id]);
        if (!cbRes.rows.length) return res.status(404).json({ ok: false, error: 'Checkbook not found' });
        const startNum = Number(cbRes.rows[0].start_number);
        const endNum = startNum + Number(cbRes.rows[0].page_count) - 1;
        const serialNum = Number(number);
        if (!Number.isFinite(serialNum) || serialNum < startNum || serialNum > endNum) {
          return res.status(400).json({ ok: false, error: 'number out of range' });
        }
        const exists = await p.query(`SELECT 1 FROM checks WHERE checkbook_id = $1 AND type = $2 AND number = $3 AND id <> $4 LIMIT 1`, [cur.checkbook_id, cur.type, number, id]);
        if (exists.rowCount) return res.status(400).json({ ok: false, error: 'Duplicate check number' });
        finalNumber = number;
      }
    }

    // Build dynamic update
    const fields: string[] = []; const values: any[] = []; let idx = 1;
    if (issueDate !== undefined) { fields.push(`issue_date = $${idx++}`); values.push(issueDate); }
    if (dueDate !== undefined) { fields.push(`due_date = $${idx++}`); values.push(dueDate); }
    if (finalNumber !== String(cur.number)) { fields.push(`number = $${idx++}`); values.push(finalNumber); }
    if (beneficiaryDetailId !== undefined) { fields.push(`beneficiary_detail_id = $${idx++}`); values.push(beneficiaryDetailId); }
    if (beneficiary !== undefined) { fields.push(`beneficiary = $${idx++}`); values.push(beneficiary); }
    if (bankName !== undefined) { fields.push(`bank_name = $${idx++}`); values.push(bankName); }
    if (issuer !== undefined) { fields.push(`issuer = $${idx++}`); values.push(issuer); }
    if (amount !== undefined) { fields.push(`amount = $${idx++}`); values.push(amount); }
    if (notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(notes); }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No changes provided' });
    values.push(id);
    const sql = `UPDATE checks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const upd = await p.query(sql, values);

    // If number equals last page, ensure checkbook exhausted (outgoing only)
    if (cur.checkbook_id) {
      const cb2 = await p.query(`SELECT start_number, page_count FROM checkbooks WHERE id = $1 LIMIT 1`, [cur.checkbook_id]);
      if (cb2.rows.length) {
        const st = Number(cb2.rows[0].start_number); const end = st + Number(cb2.rows[0].page_count) - 1;
        if (Number(finalNumber) === end) {
          await p.query(`UPDATE checkbooks SET status = 'exhausted' WHERE id = $1 AND status = 'active'`, [cur.checkbook_id]);
        }
      }
    }

    return res.json({ ok: true, item: upd.rows[0], message: t('treasury.bankAccounts.updated', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * DELETE /checks/:id
 * Remove a check by id; allow delete for outgoing 'issued' and incoming 'created'.
 */
treasuryRouter.delete('/checks/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    const curRes = await p.query(`SELECT id, type, status FROM checks WHERE id = $1 LIMIT 1`, [id]);
    if (!curRes.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    const row = curRes.rows[0];
    if (String(row.type) === 'incoming') {
      if (String(row.status) !== 'created') return res.status(400).json({ ok: false, error: 'Delete allowed only for created incoming checks' });
    } else {
      if (String(row.status) !== 'issued') return res.status(400).json({ ok: false, error: 'Delete allowed only for issued checks' });
    }
    const del = await p.query(`DELETE FROM checks WHERE id = $1`, [id]);
    if (!del.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, message: t('treasury.bankAccounts.deleted', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * GET /cashboxes
 * List all cashboxes with basic fields.
 */
treasuryRouter.get('/cashboxes', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, code, name, handler_detail_id, is_active, starting_amount, starting_date, created_at
       FROM cashboxes
       ORDER BY code ASC`
    );
    return res.json({ ok: true, items: rows, message: t('treasury.cashboxes.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * GET /cashboxes/:id
 * Retrieve a single cashbox by id.
 */
treasuryRouter.get('/cashboxes/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, code, name, handler_detail_id, is_active, starting_amount, starting_date, created_at
       FROM cashboxes WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json({ ok: true, item: rows[0], message: t('treasury.cashboxes.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * POST /cashboxes
 * Create a cashbox and sync a Details row by code.
 * - Auto-sets `handler_detail_id` to the Details row for the cashbox code when omitted
 *   so the relationship is established on save (uses existing row if code already exists).
 */
treasuryRouter.post('/cashboxes', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const payload = req.body || {};
  const code = String(payload.code || '').trim();
  const name = String(payload.name || '').trim();
  const providedHandlerDetailId = payload.handler_detail_id ? String(payload.handler_detail_id) : null;
  const isActive = payload.is_active != null ? !!payload.is_active : true;
  const startingAmount = payload.starting_amount != null ? Number(payload.starting_amount) : 0;
  const startingDate = payload.starting_date ? new Date(String(payload.starting_date)) : null;

  if (!code) return res.status(400).json({ ok: false, error: 'code is required' });
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  if (startingDate && Number.isNaN(startingDate.getTime())) return res.status(400).json({ ok: false, error: 'Invalid starting_date' });

  try {
    const p = getPool();
    // Prevent duplicate cashbox codes
    const dup = await p.query(`SELECT 1 FROM cashboxes WHERE code = $1 LIMIT 1`, [code]);
    if (dup.rowCount) return res.status(409).json({ ok: false, error: 'Duplicate code' });

    // Transaction: upsert Details for code, then insert cashbox with computed handler_detail_id
    await p.query('BEGIN');

    // Upsert details row for code; mark as system-managed (kind = FALSE) and get its id
    const did = randomUUID();
    const detRes = await p.query(
      `INSERT INTO details (id, code, title, is_active, kind)
       VALUES ($1, $2, $3, $4, FALSE)
       ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, is_active = EXCLUDED.is_active, kind = FALSE
       RETURNING id`,
      [did, code, name, isActive]
    );
    const detailsIdForCode = String(detRes.rows[0].id);

    const id = randomUUID();
    const handlerIdToUse = providedHandlerDetailId ?? detailsIdForCode;

    const ins = await p.query(
      `INSERT INTO cashboxes (id, code, name, handler_detail_id, is_active, starting_amount, starting_date)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))
       RETURNING id, code, name, handler_detail_id, is_active, starting_amount, starting_date, created_at`,
      [id, code, name, handlerIdToUse, isActive, startingAmount, startingDate]
    );

    // Ensure the handler Details row is marked system-managed
    await p.query(`UPDATE details SET kind = FALSE WHERE id = $1`, [handlerIdToUse]);

    await p.query('COMMIT');
    return res.status(201).json({ ok: true, item: ins.rows[0], message: t('treasury.cashboxes.created', lang) });
  } catch (e: any) {
    try { const p = getPool(); await p.query('ROLLBACK'); } catch {}
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * PATCH /cashboxes/:id
 * Update mutable fields of a cashbox.
 * - When `handler_detail_id` is explicitly null, auto-populates it from the Details row
 *   for the cashbox code (upserted if missing) to preserve linkage.
 */
treasuryRouter.patch('/cashboxes/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  const payload = req.body || {};
  const name = payload.name !== undefined ? String(payload.name).trim() : undefined;
  const isActive = payload.is_active !== undefined ? !!payload.is_active : undefined;
  const handlerDetailId = payload.handler_detail_id !== undefined ? (payload.handler_detail_id ? String(payload.handler_detail_id) : null) : undefined;
  const startingAmount = payload.starting_amount !== undefined ? Number(payload.starting_amount) : undefined;
  const startingDate = payload.starting_date !== undefined ? (payload.starting_date ? new Date(String(payload.starting_date)) : null) : undefined;

  try {
    const p = getPool();
    const cur = await p.query(`SELECT id, code, name, is_active FROM cashboxes WHERE id = $1 LIMIT 1`, [id]);
    if (!cur.rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
    const curRow = cur.rows[0];

    const fields: string[] = []; const values: any[] = []; let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
    if (isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(isActive); }

    let effectiveHandlerDetailId: string | null | undefined = undefined;
    if (handlerDetailId !== undefined) {
      if (handlerDetailId === null) {
        // Auto-populate from Details row for the cashbox code; upsert and get id
        const did = randomUUID();
        const detRes = await p.query(
          `INSERT INTO details (id, code, title, is_active, kind)
           VALUES ($1, $2, $3, $4, FALSE)
           ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, is_active = EXCLUDED.is_active, kind = FALSE
           RETURNING id`,
          [did, String(curRow.code), name !== undefined ? name : String(curRow.name), isActive !== undefined ? !!isActive : !!curRow.is_active]
        );
        effectiveHandlerDetailId = String(detRes.rows[0].id);
      } else {
        effectiveHandlerDetailId = handlerDetailId;
      }
      fields.push(`handler_detail_id = $${idx++}`); values.push(effectiveHandlerDetailId);
    }

    if (startingAmount !== undefined) { fields.push(`starting_amount = $${idx++}`); values.push(startingAmount); }
    // Only update starting_date when a non-empty value is provided
    if (startingDate !== undefined && startingDate !== null) {
      if (Number.isNaN((startingDate as Date).getTime())) return res.status(400).json({ ok: false, error: 'Invalid starting_date' });
      fields.push(`starting_date = $${idx++}`); values.push(startingDate as Date);
    }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No changes provided' });
    values.push(id);

    const sql = `UPDATE cashboxes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, code, name, handler_detail_id, is_active, starting_amount, starting_date, created_at`;
    const upd = await p.query(sql, values);

    // Keep details title/is_active in sync on update
    await p.query(
      `UPDATE details d SET title = $1, is_active = $2 FROM cashboxes c WHERE c.id = $3 AND c.code = d.code`,
      [name !== undefined ? name : upd.rows[0].name, isActive !== undefined ? isActive : upd.rows[0].is_active, id]
    );

    // Ensure handler Details row is marked system-managed when used
    if (effectiveHandlerDetailId) {
      await p.query(`UPDATE details SET kind = FALSE WHERE id = $1`, [effectiveHandlerDetailId]);
    }

    return res.json({ ok: true, item: upd.rows[0], message: t('treasury.cashboxes.updated', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * DELETE /cashboxes/:id
 * Delete a cashbox by id (fails if referenced).
 */
treasuryRouter.delete('/cashboxes/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '');
  try {
    const p = getPool();
    // Begin transaction: delete cashbox, then remove its synced Details row by code
    await p.query('BEGIN');

    // Get the cashbox code to target the associated Details row
    const cur = await p.query(`SELECT id, code FROM cashboxes WHERE id = $1 LIMIT 1`, [id]);
    if (!cur.rowCount) {
      await p.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const code: string = String(cur.rows[0].code);

    // Delete cashbox (will fail if referenced due to RESTRICT FKs)
    await p.query(`DELETE FROM cashboxes WHERE id = $1`, [id]);

    // Attempt to delete the auto-managed Details row that mirrors the cashbox code
    // If deletion is blocked (RESTRICT), fall back to deactivating the detail
    try {
      await p.query(`DELETE FROM details WHERE code = $1 AND kind = FALSE`, [code]);
    } catch (err: any) {
      await p.query(`UPDATE details SET is_active = FALSE WHERE code = $1 AND kind = FALSE`, [code]);
    }

    await p.query('COMMIT');
    return res.json({ ok: true, message: t('treasury.cashboxes.deleted', lang) });
  } catch (e: any) {
    try { const p = getPool(); await p.query('ROLLBACK'); } catch {}
    // Most likely foreign key restriction (referenced by receipts/payments)
    return res.status(400).json({ ok: false, error: e?.message || 'Cannot delete cashbox' });
  }
});

/**
 * GET /receipts
 * List receipts (basic header fields) ordered by date desc.
 */
treasuryRouter.get('/receipts', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id, journal_id, created_at
       FROM receipts
       ORDER BY date DESC, created_at DESC
       LIMIT 200`
    );
    const items = (rows || []).map((r: any) => ({
      id: r.id,
      number: r.number ?? null,
      status: r.status,
      date: r.date,
      fiscalYearId: r.fiscal_year_id ?? null,
      detailId: r.detail_id ?? null,
      specialCodeId: r.special_code_id ?? null,
      description: r.description ?? null,
      totalAmount: Number(r.total_amount || 0),
      cashboxId: r.cashbox_id ?? null,
      journalId: r.journal_id ?? null,
    }));
    return res.json({ ok: true, items, message: t('treasury.receipts.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * POST /receipts
 * Create a draft receipt (header + items).
 * Auto-generates a sequential `number` when omitted, scoped by `fiscalYearId` if provided.
 */
treasuryRouter.post('/receipts', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const payload = req.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];

  // Basic validations
  if (!items.length) {
    return res.status(400).json({ ok: false, error: t('treasury.receipts.missingItems', lang) });
  }
  const totalClient = Number(payload.totalAmount ?? 0);
  const totalItems = items.reduce((sum: number, it: any) => sum + Number(it?.amount || 0), 0);
  if (Number(totalClient) !== Number(totalItems)) {
    return res.status(400).json({ ok: false, error: t('treasury.receipts.invalidTotal', lang) });
  }
  const date = payload.date ? new Date(payload.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  }
  const mapStatus = (s?: string) => {
    const v = String(s || '').toLowerCase();
    if (v === 'draft') return 'temporary';
    if (v === 'posted') return 'permanent';
    if (v === 'temporary' || v === 'permanent') return v;
    return 'temporary';
  };
  const status = mapStatus(payload.status);
  const fiscalYearId = payload.fiscalYearId ? String(payload.fiscalYearId) : null;
  const detailId = payload.detailId ? String(payload.detailId) : null;
  const specialCodeId = payload.specialCodeId ? String(payload.specialCodeId) : null;
  const description = payload.description != null ? String(payload.description) : null;
  const number = payload.number != null ? String(payload.number) : null;
  const cashboxIdHeader = payload.cashboxId ? String(payload.cashboxId) : null;

  const allowed = new Set(['cash', 'card', 'transfer', 'check']);
  for (const it of items) {
    const inst = String(it?.instrumentType || '').toLowerCase();
    if (!allowed.has(inst)) {
      return res.status(400).json({ ok: false, error: t('treasury.receipts.invalidInstrument', lang) });
    }
  }
  const needsCashbox = items.some((it: any) => {
    const inst = String(it?.instrumentType || '').toLowerCase();
    return inst === 'cash' || inst === 'check';
  });
  if (needsCashbox && !cashboxIdHeader) {
    return res.status(400).json({ ok: false, error: t('treasury.receipts.cashboxRequired', lang) });
  }

  try {
    const p = getPool();
    await p.query('BEGIN');

    // Auto-generate sequential number if not provided.
    // Uses max numeric part of `number` within the same fiscal year (if provided),
    // otherwise across all receipts. Stored as TEXT to keep flexibility.
    let numberFinal: string | null = number;
    if (!numberFinal) {
      const nx = await p.query(
        `SELECT COALESCE(MAX(CASE WHEN number ~ '^\\d+$' THEN CAST(number AS INTEGER) ELSE NULL END), 0) + 1 AS next_number
         FROM receipts
         WHERE ($1::text IS NULL OR fiscal_year_id = $1)`,
        [fiscalYearId]
      );
      numberFinal = String(nx.rows?.[0]?.next_number || 1);
    }

    const id = randomUUID();
    await p.query(
      `INSERT INTO receipts (id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, numberFinal, status, date, fiscalYearId, detailId, specialCodeId, description, totalItems, cashboxIdHeader]
    );

    let pos = 1;
    for (const it of items) {
      const iid = randomUUID();
      const inst = String(it?.instrumentType || '').toLowerCase();
      const amount = Number(it?.amount || 0);
      const bankAccountId = it?.bankAccountId ? String(it.bankAccountId) : null;
      const cardReaderId = it?.cardReaderId ? String(it.cardReaderId) : null;
      const reference = it?.reference != null ? String(it.reference) : (inst === 'card' ? (it?.cardRef != null ? String(it.cardRef) : null) : (inst === 'transfer' ? (it?.transferRef != null ? String(it.transferRef) : null) : null));
      const checkId = it?.checkId ? String(it.checkId) : null;
      const position = it?.position != null ? Number(it.position) : pos;
      pos++;

      await p.query(
        `INSERT INTO receipt_items (id, receipt_id, instrument_type, amount, reference, bank_account_id, card_reader_id, check_id, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [iid, id, inst, amount, reference, bankAccountId, cardReaderId, checkId, position]
      );
    }

    // Update incoming checks status to 'incashbox' when saved
    await markIncomingChecksInCashbox(p as any, id);

    await p.query('COMMIT');

    // Fetch the created receipt in camelCase shape
    const hr = await p.query(
      `SELECT id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id
       FROM receipts WHERE id = $1 LIMIT 1`,
      [id]
    );
    const ir = await p.query(
      `SELECT ri.id, ri.instrument_type, ri.amount, ri.bank_account_id, ri.card_reader_id, ri.reference, ri.check_id, ri.position
       FROM receipt_items ri
       WHERE ri.receipt_id = $1
       ORDER BY COALESCE(ri.position, 0) ASC, ri.created_at ASC`,
      [id]
    );

    const itemsOut = (ir.rows || []).map((r: any) => ({
      id: r.id,
      instrumentType: r.instrument_type,
      amount: Number(r.amount || 0),
      bankAccountId: r.bank_account_id ?? null,
      cardReaderId: r.card_reader_id ?? null,
      reference: r.reference ?? null,
      checkId: r.check_id ?? null,
      position: r.position ?? null,
    }));
    const h = hr.rows[0];
    const item = {
      id: String(h.id),
      number: h.number ?? null,
      status: h.status,
      date: h.date,
      fiscalYearId: h.fiscal_year_id ?? null,
      detailId: h.detail_id ?? null,
      specialCodeId: h.special_code_id ?? null,
      description: h.description ?? null,
      totalAmount: Number(h.total_amount || totalItems),
      cashboxId: h.cashbox_id ?? null,
      items: itemsOut,
    };

    return res.status(201).json({ ok: true, item, message: t('treasury.receipts.created', lang) });
  } catch (e: any) {
    try { const p = getPool(); await p.query('ROLLBACK'); } catch {}
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * PUT /receipts/:id
 * Update an existing draft receipt (header + items).
 * Preserves existing `number` when omitted in payload.
 */
treasuryRouter.put('/receipts/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });

  const payload = req.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return res.status(400).json({ ok: false, error: t('treasury.receipts.missingItems', lang) });
  }
  const totalClient = Number(payload.totalAmount ?? 0);
  const totalItems = items.reduce((sum: number, it: any) => sum + Number(it?.amount || 0), 0);
  if (Number(totalClient) !== Number(totalItems)) {
    return res.status(400).json({ ok: false, error: t('treasury.receipts.invalidTotal', lang) });
  }
  const date = payload.date ? new Date(payload.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  }
  const mapStatus = (s?: string) => {
    const v = String(s || '').toLowerCase();
    if (v === 'draft') return 'temporary';
    if (v === 'posted') return 'permanent';
    if (v === 'temporary' || v === 'permanent') return v;
    return 'temporary';
  };
  const status = mapStatus(payload.status);
  const fiscalYearId = payload.fiscalYearId ? String(payload.fiscalYearId) : null;
  const detailId = payload.detailId ? String(payload.detailId) : null;
  const specialCodeId = payload.specialCodeId ? String(payload.specialCodeId) : null;
  const description = payload.description != null ? String(payload.description) : null;
  const number = payload.number != null ? String(payload.number) : null;
  const cashboxIdHeader = payload.cashboxId ? String(payload.cashboxId) : null;

  const allowed = new Set(['cash', 'card', 'transfer', 'check']);
  for (const it of items) {
    const inst = String(it?.instrumentType || '').toLowerCase();
    if (!allowed.has(inst)) {
      return res.status(400).json({ ok: false, error: t('treasury.receipts.invalidInstrument', lang) });
    }
  }
  const needsCashbox = items.some((it: any) => {
    const inst = String(it?.instrumentType || '').toLowerCase();
    return inst === 'cash' || inst === 'check';
  });
  if (needsCashbox && !cashboxIdHeader) {
    return res.status(400).json({ ok: false, error: t('treasury.receipts.cashboxRequired', lang) });
  }

  try {
    const p = getPool();
    // Guard against modifying posted receipts
    const ex = await p.query(`SELECT id, status FROM receipts WHERE id = $1 LIMIT 1`, [id]);
    if (!ex.rows?.length) {
      return res.status(404).json({ ok: false, error: t('treasury.receipts.notFound', lang) });
    }
    const currentStatus = String(ex.rows[0].status || '').toLowerCase();
    if (currentStatus === 'permanent' || currentStatus === 'posted') {
      return res.status(409).json({ ok: false, error: t('treasury.receipts.cannotModifyPosted', lang) });
    }

    await p.query('BEGIN');

    // Preserve existing number if client did not provide one.
    let numberFinal: string | null = number;
    if (numberFinal == null) {
      const nx = await p.query(`SELECT number FROM receipts WHERE id = $1 LIMIT 1`, [id]);
      numberFinal = nx.rows?.[0]?.number ?? null;
    }

    await p.query(
      `UPDATE receipts SET number=$2, status=$3, date=$4, fiscal_year_id=$5, detail_id=$6, special_code_id=$7, description=$8, total_amount=$9, cashbox_id=$10
       WHERE id=$1`,
      [id, numberFinal, status, date, fiscalYearId, detailId, specialCodeId, description, totalItems, cashboxIdHeader]
    );

    // Snapshot previous checks linked to this receipt before items are replaced
    const prevCheckRows = await p.query(
      `SELECT ri.check_id AS id
         FROM receipt_items ri
        WHERE ri.receipt_id = $1
          AND ri.instrument_type = 'check'
          AND ri.check_id IS NOT NULL`,
      [id]
    );
    const prevCheckIds: string[] = (prevCheckRows.rows || []).map((r: any) => String(r.id)).filter(Boolean);

    await p.query(`DELETE FROM receipt_items WHERE receipt_id=$1`, [id]);

    let pos = 1;
    for (const it of items) {
      const iid = randomUUID();
      const inst = String(it?.instrumentType || '').toLowerCase();
      const amount = Number(it?.amount || 0);
      const bankAccountId = it?.bankAccountId ? String(it.bankAccountId) : null;
      const cardReaderId = it?.cardReaderId ? String(it.cardReaderId) : null;
      const reference = it?.reference != null ? String(it.reference) : (inst === 'card' ? (it?.cardRef != null ? String(it.cardRef) : null) : (inst === 'transfer' ? (it?.transferRef != null ? String(it.transferRef) : null) : null));
      const checkId = it?.checkId ? String(it.checkId) : null;
      const position = it?.position != null ? Number(it.position) : pos;
      pos++;

      await p.query(
        `INSERT INTO receipt_items (id, receipt_id, instrument_type, amount, reference, bank_account_id, card_reader_id, check_id, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [iid, id, inst, amount, reference, bankAccountId, cardReaderId, checkId, position]
      );
    }

    // Update incoming checks status to 'incashbox' when saved
    const newCheckIds: string[] = items
      .filter((it: any) => String(it?.instrumentType || '').toLowerCase() === 'check' && it?.checkId)
      .map((it: any) => String(it.checkId));

    await markIncomingChecksInCashbox(p as any, id);

    // Revert status back to 'created' for checks removed from this receipt
    await revertIncomingChecksRemovedFromReceipt(p as any, id, prevCheckIds, newCheckIds);

    await p.query('COMMIT');

    // Fetch the updated receipt in camelCase shape
    const hr = await p.query(
      `SELECT id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id
       FROM receipts WHERE id = $1 LIMIT 1`,
      [id]
    );
    const ir = await p.query(
      `SELECT ri.id, ri.instrument_type, ri.amount, ri.bank_account_id, ri.card_reader_id, ri.reference, ri.check_id, ri.position
       FROM receipt_items ri
       WHERE ri.receipt_id = $1
       ORDER BY COALESCE(ri.position, 0) ASC, ri.created_at ASC`,
      [id]
    );

    const itemsOut = (ir.rows || []).map((r: any) => ({
      id: r.id,
      instrumentType: r.instrument_type,
      amount: Number(r.amount || 0),
      bankAccountId: r.bank_account_id ?? null,
      cardReaderId: r.card_reader_id ?? null,
      reference: r.reference ?? null,
      checkId: r.check_id ?? null,
      position: r.position ?? null,
    }));
    const h = hr.rows[0];
    const item = {
      id: String(h.id),
      number: h.number ?? null,
      status: h.status,
      date: h.date,
      fiscalYearId: h.fiscal_year_id ?? null,
      detailId: h.detail_id ?? null,
      specialCodeId: h.special_code_id ?? null,
      description: h.description ?? null,
      totalAmount: Number(h.total_amount || totalItems),
      cashboxId: h.cashbox_id ?? null,
      items: itemsOut,
    };

    return res.status(200).json({ ok: true, item, message: t('treasury.receipts.updated', lang) });
  } catch (e: any) {
    try { const p = getPool(); await p.query('ROLLBACK'); } catch {}
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * DELETE /receipts/:id
 * Deletes a draft receipt. Fails for posted/permanent receipts.
 */
treasuryRouter.delete('/receipts/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });

  try {
    const p = getPool();
    const ex = await p.query(`SELECT id, status FROM receipts WHERE id = $1 LIMIT 1`, [id]);
    if (!ex.rows?.length) {
      return res.status(404).json({ ok: false, error: t('treasury.receipts.notFound', lang) });
    }
    const currentStatus = String(ex.rows[0].status || '').toLowerCase();
    if (currentStatus === 'permanent' || currentStatus === 'posted') {
      return res.status(409).json({ ok: false, error: t('treasury.receipts.cannotModifyPosted', lang) });
    }

    await p.query('DELETE FROM receipts WHERE id = $1', [id]);
    return res.json({ ok: true, message: t('treasury.receipts.deleted', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * GET /receipts/:id
 * Fetch a single receipt with header and items.
 */
treasuryRouter.get('/receipts/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const p = getPool();
    const hr = await p.query(
      `SELECT id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id
       FROM receipts
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    if (!hr.rows[0]) return res.status(404).json({ ok: false, error: t('treasury.receipts.notFound', lang) });
    const ir = await p.query(
      `SELECT ri.id, ri.instrument_type, ri.amount, ri.bank_account_id, ri.card_reader_id, ri.reference, ri.check_id, ri.position
       FROM receipt_items ri
       WHERE ri.receipt_id = $1
       ORDER BY COALESCE(ri.position, 0) ASC, ri.created_at ASC`,
      [id]
    );
    const items = (ir.rows || []).map((r: any) => ({
      id: r.id,
      instrumentType: r.instrument_type,
      amount: Number(r.amount || 0),
      bankAccountId: r.bank_account_id ?? null,
      cardReaderId: r.card_reader_id ?? null,
      reference: r.reference ?? null,
      checkId: r.check_id ?? null,
      position: r.position ?? null,
    }));
    const h = hr.rows[0];
    const item = {
      id: String(h.id),
      number: h.number ?? null,
      status: h.status,
      date: h.date,
      fiscalYearId: h.fiscal_year_id ?? null,
      detailId: h.detail_id ?? null,
      specialCodeId: h.special_code_id ?? null,
      description: h.description ?? null,
      totalAmount: Number(h.total_amount || 0),
      cashboxId: h.cashbox_id ?? null,
      items,
    };
    return res.json({ ok: true, item, message: t('treasury.receipts.fetchOne', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * GET /receipts/by-journal/:journalId
 * Resolves a receipt by its linked journal_id.
 */
treasuryRouter.get('/receipts/by-journal/:journalId', async (req: Request, res: Response) => {
  // Function: resolve receipt by journal_id for navigation from DocumentsPage
  const lang: Lang = (req as any).lang || 'en';
  const journalId = String(req.params.journalId || '').trim();
  if (!journalId) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const p = getPool();
    const hr = await p.query(
      `SELECT id FROM receipts WHERE journal_id = $1 LIMIT 1`,
      [journalId]
    );
    if (!hr.rows[0]) {
      return res.status(404).json({ ok: false, error: t('treasury.receipts.notFound', lang) });
    }
    return res.json({ ok: true, item: { id: String(hr.rows[0].id) }, message: t('treasury.receipts.fetchOne', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * POST /receipts/:id/post
 * Create a temporary journal for the receipt and mark it temporary.
 * Validates totals, resolves code IDs via env/settings, and uses handler detail IDs.
 */
treasuryRouter.post('/receipts/:id/post', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const hr = await client.query(
        `SELECT id, number, status, date, fiscal_year_id, detail_id, description, total_amount, cashbox_id
         FROM receipts WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!hr.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: t('treasury.receipts.notFound', lang) });
      }
      const r = hr.rows[0];
      const currentStatus = String(r.status || '').toLowerCase();
      if (currentStatus === 'posted' || currentStatus === 'permanent') {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: t('treasury.receipts.cannotModifyPosted', lang) });
      }

      const ir = await client.query(
        `SELECT ri.id, ri.instrument_type, ri.amount, ri.bank_account_id, ri.card_reader_id, ri.reference, ri.check_id, ri.position
         FROM receipt_items ri
         WHERE ri.receipt_id = $1
         ORDER BY COALESCE(ri.position, 0) ASC, ri.created_at ASC`,
        [id]
      );
      const items = ir.rows || [];
      if (!items.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: t('treasury.receipts.missingItems', lang) });
      }
      const total = Number(r.total_amount || 0);
      const sumItems = items.reduce((sum: number, it: any) => sum + Number(it.amount || 0), 0);
      if (Math.abs(total - sumItems) > 0.0001) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: t('treasury.receipts.invalidTotal', lang) });
      }

      // Resolve code ids for instrument accounts and counterparty
      const codeCash = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_CASH_RECEIPT');
      const codeCard = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_CARD_RECEIPT');
      const codeTransfer = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_TRANSFER_RECEIPT');
      const codeCheck = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_CHECK_RECEIPT');
      const codeCounter = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_COUNTERPARTY_RECEIPT');

      const journalItems: Array<{ code_id: string; debit: number; credit: number; description: string | null; detail_id: string | null }> = [];

      for (const it of items) {
        const inst = String(it.instrument_type || '').toLowerCase();
        const amt = Number(it.amount || 0);
        if (inst === 'cash') {
          if (!r.cashbox_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ ok: false, error: t('treasury.receipts.cashboxRequired', lang) });
          }
          const cb = await client.query(`SELECT id, code, name, handler_detail_id FROM cashboxes WHERE id = $1 LIMIT 1`, [String(r.cashbox_id)]);
          const cbRow = cb.rows[0];
          journalItems.push({
            code_id: codeCash,
            debit: amt,
            credit: 0,
            detail_id: cbRow?.handler_detail_id ?? null,
            description: `${lang === 'fa' ? 'دریافت وجه نقد' : 'Receipt Cash'}`.trim()
          });
        } else if (inst === 'transfer') {
          const ba = it.bank_account_id ? await client.query(`SELECT id, account_number, name, handler_detail_id FROM bank_accounts WHERE id = $1 LIMIT 1`, [String(it.bank_account_id)]) : { rows: [] } as any;
          const baRow = ba.rows[0];
          journalItems.push({
            code_id: codeTransfer,
            debit: amt,
            credit: 0,
            detail_id: baRow?.handler_detail_id ?? null,
            description: `${lang === 'fa' ? 'واریز طی حواله شماره' : 'Deposit via bank transfer'}${it.reference ? ` ${String(it.reference)}` : ''}`.trim()
          });
        } else if (inst === 'card') {
          const cr = it.card_reader_id ? await client.query(`SELECT id, psp_provider, terminal_id, handler_detail_id FROM card_readers WHERE id = $1 LIMIT 1`, [String(it.card_reader_id)]) : { rows: [] } as any;
          const crRow = cr.rows[0];
          journalItems.push({
            code_id: codeCard,
            debit: amt,
            credit: 0,
            detail_id: crRow?.handler_detail_id ?? null,
            description: `${lang === 'fa' ? 'دریافت از کارت خوان به شماره' : 'Receive from card reader to number'} ${crRow?.terminal_id ?? ''}${it.reference ? ` ${String(it.reference)}` : ''}`.trim()
          });
        } else if (inst === 'check') {
          const ck = it.check_id ? await client.query(`SELECT id, number, bank_name, due_date FROM checks WHERE id = $1 LIMIT 1`, [String(it.check_id)]) : { rows: [] } as any;
          const ckRow = ck.rows[0];
          let dd = '';
          if (ckRow?.due_date) {
            const d = new Date(ckRow.due_date);
            dd = lang === 'fa'
              ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
              : d.toISOString().slice(0, 10);
          }
          journalItems.push({
            code_id: codeCheck,
            debit: amt,
            credit: 0,
            detail_id: r.detail_id ?? null,
            description: `${lang === 'fa' ? 'دریافت ' : ''}${t('journals.receipt.instrument.check', lang)}: ${ckRow?.bank_name ?? ''} ${ckRow?.number ?? ''} ${dd}`.trim()
          });
        } else {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: t('treasury.receipts.invalidInstrument', lang) });
        }
      }

      // Credit line for counterparty (receipt header detail)
      // Use header-selected special code when present; fallback to settings/env.
      const counterCodeId = r.special_code_id ?? codeCounter;
      journalItems.push({
        code_id: counterCodeId,
        debit: 0,
        credit: total,
        detail_id: r.detail_id ?? null,
        description: String(r.description ?? '') || null
      });

      // Compute next ref_no and next code within fiscal year (if available)
      const fyId = r.fiscal_year_id ?? null;
      let nextRef: string | null = null;
      let nextCode: string | null = null;
      if (fyId) {
        const probeRef = await client.query(
          `SELECT COALESCE(MAX(CAST(ref_no AS INT)), 0) AS max_ref
           FROM journals
           WHERE fiscal_year_id = $1 AND ref_no ~ '^[0-9]+'`,
          [fyId]
        );
        nextRef = String(Number(probeRef.rows[0]?.max_ref || 0) + 1);

        const probeCode = await client.query(
          `SELECT COALESCE(MAX(CAST(code AS INT)), 0) AS max_code
           FROM journals
           WHERE fiscal_year_id = $1 AND code ~ '^[0-9]+'`,
          [fyId]
        );
        nextCode = String(Number(probeCode.rows[0]?.max_code || 0) + 1);
      }

      // Insert journal as temporary
      const journalId = randomUUID();
      await client.query(
        `INSERT INTO journals (id, fiscal_year_id, ref_no, code, date, description, type, provider, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [journalId, fyId, nextRef, nextCode, r.date, r.description ?? null, 'receipt', 'treasury', 'temporary']
      );
      for (const it of journalItems) {
        await client.query(
          `INSERT INTO journal_items (id, journal_id, code_id, party_id, debit, credit, description, detail_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), journalId, it.code_id, null, it.debit, it.credit, it.description ?? null, it.detail_id ?? null]
        );
      }

      // Mark receipt as sent and link journal
      await client.query(`UPDATE receipts SET status = 'sent', journal_id = $2 WHERE id = $1`, [id, journalId]);

      await client.query('COMMIT');
      return res.json({ ok: true, journalId, message: t('treasury.receipts.sent', lang) });
    } catch (err: any) {
      await client.query('ROLLBACK');
      return res.status(500).json({ ok: false, error: err?.message || t('error.generic', lang) });
    } finally {
      client.release();
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * GET /payments
 * List payments (basic header fields) ordered by date desc.
 * Returns camelCase fields and array under `data` to match frontend.
 * Note (FA): این مسیر فهرست پرداخت‌ها را برمی‌گرداند و اکنون شناسه سند روزنامه (journalId) را نیز شامل می‌شود.
 */
treasuryRouter.get('/payments', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, number, status, date, detail_id, total_amount, fiscal_year_id, cashbox_id, description, created_at, journal_id
       FROM payments
       ORDER BY date DESC, created_at DESC
       LIMIT 200`
    );
    const items = (rows || []).map((r: any) => ({
      id: String(r.id),
      number: r.number ?? null,
      status: String(r.status || '').toLowerCase() === 'temporary' ? 'draft' : (String(r.status || '').toLowerCase() === 'permanent' ? 'posted' : r.status),
      date: r.date,
      fiscalYearId: r.fiscal_year_id ?? null,
      detailId: r.detail_id ?? null,
      description: r.description ?? null,
      totalAmount: Number(r.total_amount || 0),
      cashboxId: r.cashbox_id ?? null,
      journalId: r.journal_id ?? null,
      items: [],
    }));
    return res.json({ ok: true, data: items, message: t('treasury.payments.list', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Error' });
  }
});

/**
 * POST /payments
 * Creates a draft payment (header + items) using direct instrument columns.
 * - 'transfer': store `bank_account_id` and optional `reference`.
 * - 'card': store `card_reader_id`.
 * - 'check' and 'checkin': store `check_id`; 'checkin' marks incashbox checks as 'spent'.
 * - Outgoing 'check' items mark corresponding checks as 'spent'.
 * Note (FA): در این مسیر، پرداخت با ستون‌های مستقیم ابزار ذخیره می‌شود و وضعیت چک‌ها بر اساس نوع به‌روز می‌گردد.
 */
treasuryRouter.post('/payments', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const payload = req.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (!items.length) {
    return res.status(400).json({ ok: false, error: t('treasury.payments.missingItems', lang) });
  }
  const totalClient = Number(payload.totalAmount ?? items.reduce((s: number, it: any) => s + Number(it?.amount || 0), 0));
  const totalItems = items.reduce((sum: number, it: any) => sum + Number(it?.amount || 0), 0);
  if (Number(totalClient) !== Number(totalItems)) {
    return res.status(400).json({ ok: false, error: t('treasury.payments.invalidTotal', lang) });
  }

  const date = payload.date ? new Date(payload.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  }
  const mapStatus = (s?: string) => {
    const v = String(s || '').toLowerCase();
    if (v === 'draft') return 'temporary';
    if (v === 'posted') return 'permanent';
    if (v === 'temporary' || v === 'permanent') return v;
    return 'temporary';
  };
  const status = mapStatus(payload.status);
  const fiscalYearId = payload.fiscalYearId ? String(payload.fiscalYearId) : null;
  const detailId = payload.detailId ? String(payload.detailId) : null;
  const specialCodeId = payload.specialCodeId ? String(payload.specialCodeId) : null;
  const description = payload.description != null ? String(payload.description) : null;
  const number = payload.number != null ? String(payload.number) : null;
  const cashboxIdHeader = payload.cashboxId ? String(payload.cashboxId) : null;

  const allowed = new Set(['cash', 'transfer', 'check', 'checkin']);
  for (const it of items) {
    const inst = String(it?.instrumentType || '').toLowerCase();
    if (!allowed.has(inst)) {
      return res.status(400).json({ ok: false, error: t('treasury.payments.invalidInstrument', lang) });
    }
  }
  const needsCashbox = items.some((it: any) => {
    const inst = String(it?.instrumentType || '').toLowerCase();
    return inst === 'cash' || inst === 'checkin';
  });
  if (needsCashbox && !cashboxIdHeader) {
    return res.status(400).json({ ok: false, error: t('treasury.receipts.cashboxRequired', lang) });
  }

  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');

      // Auto-generate sequential number if not provided.
      let numberFinal: string | null = number;
      if (!numberFinal) {
        const nx = await client.query(
          `SELECT COALESCE(MAX(CASE WHEN number ~ '^\\d+$' THEN CAST(number AS INTEGER) ELSE NULL END), 0) + 1 AS next_number
           FROM payments
           WHERE ($1::text IS NULL OR fiscal_year_id = $1)`,
          [fiscalYearId]
        );
        numberFinal = String(nx.rows?.[0]?.next_number || 1);
      }

      const id = randomUUID();
      await client.query(
        `INSERT INTO payments (id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, numberFinal, status, date, fiscalYearId, detailId, specialCodeId, description, totalItems, cashboxIdHeader]
      );

      let pos = 1;
      for (const it of items) {
        const iid = randomUUID();
        const inst = String(it?.instrumentType || '').toLowerCase();
        const amount = Number(it?.amount || 0);
        const reference = it?.reference != null ? String(it.reference) : null;
        const position = it?.position != null ? Number(it.position) : pos;
        pos++;

        const bankAccountId = it?.bankAccountId ? String(it.bankAccountId) : null;
        const checkId = it?.checkId ? String(it.checkId) : null;

        await client.query(
          `INSERT INTO payment_items (id, payment_id, instrument_type, amount, reference, bank_account_id, check_id, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [iid, id, inst, amount, reference, bankAccountId, checkId, position]
        );
      }

      // Mark incoming checks as 'spent' for any payment items of type 'checkin'
      // This ensures checks used for payments exit the available incashbox pool.
      await client.query(
        `UPDATE checks SET status = 'spent'
         WHERE id IN (
           SELECT pi.check_id
           FROM payment_items pi
           WHERE pi.payment_id = $1 AND pi.instrument_type = 'checkin' AND pi.check_id IS NOT NULL
         )
         AND status = 'incashbox'`
      , [id]);

      // Mark outgoing checks as 'spent' for any payment items of type 'check'
      await client.query(
        `UPDATE checks SET status = 'spent'
         WHERE id IN (
           SELECT pi.check_id
           FROM payment_items pi
           JOIN checks c ON c.id = pi.check_id
           WHERE pi.payment_id = $1 AND pi.instrument_type = 'check' AND pi.check_id IS NOT NULL AND c.type = 'outgoing'
         )
         AND status <> 'spent'`
      , [id]);


      await client.query('COMMIT');

      // Fetch created payment in camelCase shape
      const hr = await client.query(
        `SELECT id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id
         FROM payments WHERE id = $1 LIMIT 1`,
        [id]
      );
      const ir = await client.query(
        `SELECT id, instrument_type, amount, reference, bank_account_id, check_id, position
         FROM payment_items
         WHERE payment_id = $1
         ORDER BY COALESCE(position, 0) ASC, created_at ASC`,
        [id]
      );

      const itemsOut = (ir.rows || []).map((r: any) => ({
        id: r.id,
        instrumentType: r.instrument_type,
        amount: Number(r.amount || 0),
        reference: r.reference ?? null,
        bankAccountId: r.bank_account_id ?? null,
        checkId: r.check_id ?? null,
        position: r.position ?? null,
      }));
      const h = hr.rows[0];
      const item = {
        id: String(h.id),
        number: h.number ?? null,
        status: String(h.status || '').toLowerCase() === 'temporary' ? 'draft' : (String(h.status || '').toLowerCase() === 'permanent' ? 'posted' : h.status),
        date: h.date,
        fiscalYearId: h.fiscal_year_id ?? null,
        detailId: h.detail_id ?? null,
        specialCodeId: h.special_code_id ?? null,
        description: h.description ?? null,
        cashboxId: h.cashbox_id ?? null,
        items: itemsOut,
      };

      client.release();
      return res.status(201).json({ ok: true, item, message: t('treasury.payments.created', lang) });
    } catch (e: any) {
      try { await client.query('ROLLBACK'); } catch {}
      client.release();
      return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * PUT /payments/:id
 * Updates a draft payment using direct instrument columns.
 * - 'transfer': store `bank_account_id` (+ optional `reference`).
 * - 'check' and 'checkin': store `check_id`; 'checkin' marks incashbox checks as 'spent'.
 * - Outgoing 'check' items mark corresponding checks as 'spent'.
 * Note (FA): در این مسیر، ویرایش پرداخت با ستون‌های مستقیم ابزار انجام می‌شود؛ کارت در پرداخت‌ها استفاده نمی‌شود و ستون آن حذف شده است.
 */
treasuryRouter.put('/payments/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });

  const payload = req.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return res.status(400).json({ ok: false, error: t('treasury.payments.missingItems', lang) });
  }
  const totalClient = Number(payload.totalAmount ?? items.reduce((s: number, it: any) => s + Number(it?.amount || 0), 0));
  const totalItems = items.reduce((sum: number, it: any) => sum + Number(it?.amount || 0), 0);
  if (Number(totalClient) !== Number(totalItems)) {
    return res.status(400).json({ ok: false, error: t('treasury.payments.invalidTotal', lang) });
  }
  const date = payload.date ? new Date(payload.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  }
  const mapStatus = (s?: string) => {
    const v = String(s || '').toLowerCase();
    if (v === 'draft') return 'temporary';
    if (v === 'posted') return 'permanent';
    if (v === 'temporary' || v === 'permanent') return v;
    return 'temporary';
  };
  const status = mapStatus(payload.status);
  const fiscalYearId = payload.fiscalYearId ? String(payload.fiscalYearId) : null;
  const detailId = payload.detailId ? String(payload.detailId) : null;
  const specialCodeId = payload.specialCodeId ? String(payload.specialCodeId) : null;
  const description = payload.description != null ? String(payload.description) : null;
  const number = payload.number != null ? String(payload.number) : null;
  const cashboxIdHeader = payload.cashboxId ? String(payload.cashboxId) : null;

  const allowed = new Set(['cash', 'transfer', 'check', 'checkin']);
  for (const it of items) {
    const inst = String(it?.instrumentType || '').toLowerCase();
    if (!allowed.has(inst)) {
      return res.status(400).json({ ok: false, error: t('treasury.payments.invalidInstrument', lang) });
    }
  }
  const needsCashbox = items.some((it: any) => {
    const inst = String(it?.instrumentType || '').toLowerCase();
    return inst === 'cash' || inst === 'checkin';
  });
  if (needsCashbox && !cashboxIdHeader) {
    return res.status(400).json({ ok: false, error: t('treasury.receipts.cashboxRequired', lang) });
  }

  try {
    const p = getPool();
    const ex = await p.query(`SELECT id, status FROM payments WHERE id = $1 LIMIT 1`, [id]);
    if (!ex.rows?.length) {
      return res.status(404).json({ ok: false, error: t('treasury.payments.notFound', lang) });
    }
    const currentStatus = String(ex.rows[0].status || '').toLowerCase();
    if (currentStatus === 'permanent' || currentStatus === 'posted') {
      return res.status(409).json({ ok: false, error: t('treasury.payments.cannotModifyPosted', lang) });
    }

    const client = await p.connect();
    try {
      await client.query('BEGIN');

      // Preserve existing number if not provided
      let numberFinal: string | null = number;
      if (numberFinal == null) {
        const nx = await client.query(`SELECT number FROM payments WHERE id = $1 LIMIT 1`, [id]);
        numberFinal = nx.rows?.[0]?.number ?? null;
      }

      await client.query(
        `UPDATE payments SET number=$2, status=$3, date=$4, fiscal_year_id=$5, detail_id=$6, special_code_id=$7, description=$8, total_amount=$9, cashbox_id=$10
         WHERE id=$1`,
        [id, numberFinal, status, date, fiscalYearId, detailId, specialCodeId, description, totalItems, cashboxIdHeader]
      );

      // Fetch currently associated check IDs (before delete) to detect removals
      // Persian note (FA): برای شناسایی چک‌های حذف‌شده از پرداخت، شناسه‌های قبلی استخراج می‌شود.
      const oldOutgoingRows = await client.query(
        `SELECT c.id AS id
         FROM payment_items pi
         JOIN checks c ON c.id = pi.check_id
         WHERE pi.payment_id = $1 AND pi.instrument_type = 'check' AND pi.check_id IS NOT NULL AND c.type = 'outgoing'`,
        [id]
      );
      const oldIncomingRows = await client.query(
        `SELECT c.id AS id
         FROM payment_items pi
         JOIN checks c ON c.id = pi.check_id
         WHERE pi.payment_id = $1 AND pi.instrument_type = 'checkin' AND pi.check_id IS NOT NULL AND c.type = 'incoming'`,
        [id]
      );
      const oldOutgoingIds: string[] = (oldOutgoingRows.rows || []).map((r: any) => String(r.id));
      const oldIncomingIds: string[] = (oldIncomingRows.rows || []).map((r: any) => String(r.id));

      await client.query(`DELETE FROM payment_items WHERE payment_id=$1`, [id]);

      let pos = 1;
      for (const it of items) {
        const iid = randomUUID();
        const inst = String(it?.instrumentType || '').toLowerCase();
        const amount = Number(it?.amount || 0);
        const reference = it?.reference != null ? String(it.reference) : null;
        const position = it?.position != null ? Number(it.position) : pos;
        pos++;

        // Using direct instrument columns for 'transfer' (bank_account_id) and others.
        // Note (FA): در این بخش، از ستون‌های مستقیم ابزار استفاده می‌شود و تبدیل‌های instrument_links حذف شده‌اند.

        const bankAccountId = it?.bankAccountId ? String(it.bankAccountId) : null;
        const checkId = it?.checkId ? String(it.checkId) : null;

        await client.query(
          `INSERT INTO payment_items (id, payment_id, instrument_type, amount, reference, bank_account_id, check_id, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [iid, id, inst, amount, reference, bankAccountId, checkId, position]
        );
      }

      // Mark incoming checks as 'spent' for any payment items of type 'checkin'
      // This ensures checks used for payments exit the available incashbox pool.
      await client.query(
        `UPDATE checks SET status = 'spent'
         WHERE id IN (
           SELECT pi.check_id
           FROM payment_items pi
           WHERE pi.payment_id = $1 AND pi.instrument_type = 'checkin' AND pi.check_id IS NOT NULL
         )
         AND status = 'incashbox'`
      , [id]);

      // Mark outgoing checks as 'spent' for any payment items of type 'check'
      await client.query(
        `UPDATE checks SET status = 'spent'
         WHERE id IN (
           SELECT pi.check_id
           FROM payment_items pi
           JOIN checks c ON c.id = pi.check_id
           WHERE pi.payment_id = $1 AND pi.instrument_type = 'check' AND pi.check_id IS NOT NULL AND c.type = 'outgoing'
         )
         AND status <> 'spent'`
      , [id]);

      // Revert statuses for checks removed from the payment compared to previous items
      // - Outgoing checks: 'spent' -> 'issued'
      // - Incoming checks (check-in): 'spent' -> 'incashbox'
      // Persian note (FA): با حذف آیتم‌های چک/چک‌دریافتی، وضعیت چک به حالت قبل برگردانده می‌شود.
      const newOutgoingIds = Array.from(new Set((items || [])
        .filter((it: any) => String(it?.instrumentType || '').toLowerCase() === 'check')
        .map((it: any) => (it?.checkId != null ? String(it.checkId) : null))
        .filter((v: any) => v))) as string[];
      const newIncomingIds = Array.from(new Set((items || [])
        .filter((it: any) => String(it?.instrumentType || '').toLowerCase() === 'checkin')
        .map((it: any) => (it?.checkId != null ? String(it.checkId) : null))
        .filter((v: any) => v))) as string[];

      const removedOutgoing = oldOutgoingIds.filter((id0) => !newOutgoingIds.includes(id0));
      const removedIncoming = oldIncomingIds.filter((id0) => !newIncomingIds.includes(id0));

      if (removedOutgoing.length > 0) {
        await client.query(
          `UPDATE checks SET status = 'issued'
           WHERE id IN (SELECT unnest($1::text[])) AND status = 'spent'`,
          [removedOutgoing]
        );
      }
      if (removedIncoming.length > 0) {
        await client.query(
          `UPDATE checks SET status = 'incashbox'
           WHERE id IN (SELECT unnest($1::text[])) AND status = 'spent'`,
          [removedIncoming]
        );
      }

      await client.query('COMMIT');

      // Fetch updated payment in camelCase shape
      const hr = await client.query(
        `SELECT id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id
         FROM payments WHERE id = $1 LIMIT 1`,
        [id]
      );
      const ir = await client.query(
        `SELECT id, instrument_type, amount, reference, bank_account_id, check_id, position
         FROM payment_items
         WHERE payment_id = $1
         ORDER BY COALESCE(position, 0) ASC, created_at ASC`,
        [id]
      );

      const itemsOut = (ir.rows || []).map((r: any) => ({
        id: r.id,
        instrumentType: r.instrument_type,
        amount: Number(r.amount || 0),
        reference: r.reference ?? null,
        bankAccountId: r.bank_account_id ?? null,
        checkId: r.check_id ?? null,
        position: r.position ?? null,
      }));
      const h = hr.rows[0];
      const item = {
        id: String(h.id),
        number: h.number ?? null,
        status: String(h.status || '').toLowerCase() === 'temporary' ? 'draft' : (String(h.status || '').toLowerCase() === 'permanent' ? 'posted' : h.status),
        date: h.date,
        fiscalYearId: h.fiscal_year_id ?? null,
        detailId: h.detail_id ?? null,
        specialCodeId: h.special_code_id ?? null,
        description: h.description ?? null,
        cashboxId: h.cashbox_id ?? null,
        items: itemsOut,
      };

      client.release();
      return res.status(200).json({ ok: true, item, message: t('treasury.payments.updated', lang) });
    } catch (e: any) {
      try { await client.query('ROLLBACK'); } catch {}
      client.release();
      return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * DELETE /payments/:id
 * Deletes a draft payment; fails if posted.
 */
treasuryRouter.delete('/payments/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const p = getPool();
    const ex = await p.query(`SELECT id, status FROM payments WHERE id = $1 LIMIT 1`, [id]);
    if (!ex.rows?.length) {
      return res.status(404).json({ ok: false, error: t('treasury.payments.notFound', lang) });
    }
    const currentStatus = String(ex.rows[0].status || '').toLowerCase();
    if (currentStatus === 'permanent' || currentStatus === 'posted') {
      return res.status(409).json({ ok: false, error: t('treasury.payments.cannotModifyPosted', lang) });
    }

    const client = await p.connect();
    try {
      await client.query('BEGIN');

      // Revert check statuses prior to deletion
      // - Outgoing checks in this payment: 'spent' -> 'issued'
      // - Incoming check-ins in this payment: 'spent' -> 'incashbox'
      // Persian note (FA): پیش از حذف پرداخت، وضعیت چک‌ها به حالت مناسب بازگردانده می‌شود.
      const outRows = await client.query(
        `SELECT c.id AS id
         FROM payment_items pi
         JOIN checks c ON c.id = pi.check_id
         WHERE pi.payment_id = $1 AND pi.instrument_type = 'check' AND pi.check_id IS NOT NULL AND c.type = 'outgoing'`,
        [id]
      );
      const inRows = await client.query(
        `SELECT c.id AS id
         FROM payment_items pi
         JOIN checks c ON c.id = pi.check_id
         WHERE pi.payment_id = $1 AND pi.instrument_type = 'checkin' AND pi.check_id IS NOT NULL AND c.type = 'incoming'`,
        [id]
      );
      const outIds: string[] = (outRows.rows || []).map((r: any) => String(r.id));
      const inIds: string[] = (inRows.rows || []).map((r: any) => String(r.id));

      if (outIds.length > 0) {
        await client.query(
          `UPDATE checks SET status = 'issued'
           WHERE id IN (SELECT unnest($1::text[])) AND status = 'spent'`,
          [outIds]
        );
      }
      if (inIds.length > 0) {
        await client.query(
          `UPDATE checks SET status = 'incashbox'
           WHERE id IN (SELECT unnest($1::text[])) AND status = 'spent'`,
          [inIds]
        );
      }

      await client.query('DELETE FROM payment_items WHERE payment_id = $1', [id]);
      await client.query('DELETE FROM payments WHERE id = $1', [id]);
      await client.query('COMMIT');
      client.release();
      return res.json({ ok: true, message: t('treasury.payments.deleted', lang) });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      console.error('[DELETE /payments/:id] Transaction error:', err);
      client.release();
      return res.status(500).json({ ok: false, error: (err as any)?.message || t('error.generic', lang) });
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * GET /payments/:id
 * Fetch a single payment with header and items using direct instrument columns.
 * Items include `bank_account_id` and `check_id`.
 * Note (FA): در این مسیر، جزئیات ابزار به‌صورت ستون‌های مستقیم بازگردانده می‌شود؛ کارت در پرداخت‌ها حذف شده است.
 */
treasuryRouter.get('/payments/:id', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const p = getPool();
    const hr = await p.query(
      `SELECT id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id, journal_id
       FROM payments
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    if (!hr.rows[0]) return res.status(404).json({ ok: false, error: t('treasury.payments.notFound', lang) });
    // Items include direct instrument columns for instruments: bank_account_id, card_reader_id, check_id.
    // Note (FA): آیتم‌ها شامل ستون‌های مستقیم ابزار هستند؛ دیگر از instrument_links استفاده نمی‌شود.
    const ir = await p.query(
      `SELECT pi.id, pi.instrument_type, pi.amount, pi.reference, pi.bank_account_id, pi.check_id, pi.position
       FROM payment_items pi
       WHERE pi.payment_id = $1
       ORDER BY COALESCE(pi.position, 0) ASC, pi.created_at ASC`,
      [id]
    );
    const items = (ir.rows || []).map((r: any) => ({
      id: r.id,
      instrumentType: r.instrument_type,
      amount: Number(r.amount || 0),
      reference: r.reference ?? null,
      bankAccountId: r.bank_account_id ?? null,
      checkId: r.check_id ?? null,
      position: r.position ?? null,
    }));
    const h = hr.rows[0];
    const item = {
      id: String(h.id),
      number: h.number ?? null,
      status: String(h.status || '').toLowerCase() === 'temporary' ? 'draft' : (String(h.status || '').toLowerCase() === 'permanent' ? 'posted' : h.status),
      date: h.date,
      fiscalYearId: h.fiscal_year_id ?? null,
      detailId: h.detail_id ?? null,
      specialCodeId: h.special_code_id ?? null,
      description: h.description ?? null,
      totalAmount: Number(h.total_amount || 0),
      cashboxId: h.cashbox_id ?? null,
      journalId: h.journal_id ?? null,
      items,
    };
    return res.json({ ok: true, data: item, message: t('treasury.payments.fetchOne', lang) });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

/**
 * POST /payments/:id/post
 * Create a temporary journal for the payment and mark it as sent.
 * Mirrors receipt posting with inverted debit/credit logic.
 * FA: ایجاد سند موقت برای پرداخت و تغییر وضعیت به «ارسال‌شده».
 */
treasuryRouter.post('/payments/:id/post', async (req: Request, res: Response) => {
  const lang: Lang = (req as any).lang || 'en';
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: t('error.invalidInput', lang) });
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('BEGIN');

      const hr = await client.query(
        `SELECT id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id
         FROM payments WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!hr.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: t('treasury.payments.notFound', lang) });
      }
      const h = hr.rows[0];
      const currentStatus = String(h.status || '').toLowerCase();
      if (currentStatus === 'posted' || currentStatus === 'permanent') {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: t('treasury.payments.cannotModifyPosted', lang) });
      }

      const ir = await client.query(
        `SELECT pi.id, pi.instrument_type, pi.amount, pi.reference, pi.bank_account_id, pi.check_id, pi.position
         FROM payment_items pi
         WHERE pi.payment_id = $1
         ORDER BY COALESCE(pi.position, 0) ASC, pi.created_at ASC`,
        [id]
      );
      const items = ir.rows || [];
      if (!items.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: t('treasury.payments.missingItems', lang) });
      }
      const total = Number(h.total_amount || 0);
      const sumItems = items.reduce((sum: number, it: any) => sum + Number(it.amount || 0), 0);
      if (Math.abs(total - sumItems) > 0.0001) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: t('treasury.payments.invalidTotal', lang) });
      }

      // Resolve code ids for instrument accounts and counterparty (payment variant)
      const codeCash = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_CASH_PAYMENT');
      const codeTransfer = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_TRANSFER_PAYMENT');
      const codeCheckPayment = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_CHECK_PAYMENT');
      const codeCheckReceipt = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_CHECK_RECEIPT');
      const codeCounter = await resolveCodeIdFromEnv(client as any, 'CODE_TREASURY_COUNTERPARTY_PAYMENT');

      const journalItems: Array<{ code_id: string; debit: number; credit: number; description: string | null; detail_id: string | null }> = [];

      for (const it of items) {
        const inst = String(it.instrument_type || '').toLowerCase();
        const amt = Number(it.amount || 0);
        if (inst === 'cash') {
          if (!h.cashbox_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ ok: false, error: t('treasury.receipts.cashboxRequired', lang) });
          }
          const cb = await client.query(`SELECT id, code, name, handler_detail_id FROM cashboxes WHERE id = $1 LIMIT 1`, [String(h.cashbox_id)]);
          const cbRow = cb.rows[0];
          journalItems.push({
            code_id: codeCash,
            debit: 0,
            credit: amt,
            detail_id: cbRow?.handler_detail_id ?? null,
            description: `${lang === 'fa' ? 'پرداخت وجه نقد' : 'Payment Cash'}`.trim()
          });
        } else if (inst === 'transfer') {
          const ba = it.bank_account_id ? await client.query(`SELECT id, account_number, name, handler_detail_id FROM bank_accounts WHERE id = $1 LIMIT 1`, [String(it.bank_account_id)]) : { rows: [] } as any;
          const baRow = ba.rows[0];
          journalItems.push({
            code_id: codeTransfer,
            debit: 0,
            credit: amt,
            detail_id: baRow?.handler_detail_id ?? null,
            description: `${lang === 'fa' ? 'برداشت طی حواله شماره' : 'Withdraw via bank transfer'}${it.reference ? ` ${String(it.reference)}` : ''}`.trim()
          });
        } else if (inst === 'check') {
          const ck = it.check_id ? await client.query(`SELECT id, number, bank_name, due_date FROM checks WHERE id = $1 LIMIT 1`, [String(it.check_id)]) : { rows: [] } as any;
          const ckRow = ck.rows[0];
          let dd = '';
          if (ckRow?.due_date) {
            const d = new Date(ckRow.due_date);
            dd = lang === 'fa'
              ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
              : d.toISOString().slice(0, 10);
          }
          journalItems.push({
            code_id: codeCheckPayment,
            debit: 0,
            credit: amt,
            detail_id: h.detail_id ?? null,
            description: `${lang === 'fa' ? 'پرداخت ' : ''}${ckRow?.bank_name ?? ''} ${ckRow?.number ?? ''} ${dd}`.trim()
          });
        } else if (inst === 'checkin') {
          const ck = it.check_id ? await client.query(`SELECT id, number, bank_name, due_date, beneficiary_detail_id FROM checks WHERE id = $1 LIMIT 1`, [String(it.check_id)]) : { rows: [] } as any;
          const ckRow = ck.rows[0];
          let dd = '';
          if (ckRow?.due_date) {
            const d = new Date(ckRow.due_date);
            dd = lang === 'fa'
              ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
              : d.toISOString().slice(0, 10);
          }
          journalItems.push({
            code_id: codeCheckReceipt,
            debit: 0,
            credit: amt,
            detail_id: ckRow?.beneficiary_detail_id ?? null,
            description: `${lang === 'fa' ? 'پرداخت ' : ''}${ckRow?.bank_name ?? ''} ${ckRow?.number ?? ''} ${dd}`.trim()
          });
        } else {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: t('treasury.payments.invalidInstrument', lang) });
        }
      }

      // Debit line for counterparty (payment header detail)
      const counterCodeId = h.special_code_id ?? codeCounter;
      journalItems.push({
        code_id: counterCodeId,
        debit: total,
        credit: 0,
        detail_id: h.detail_id ?? null,
        description: String(h.description ?? '') || null
      });

      // Compute next ref_no and next code within fiscal year (if available)
      const fyId = h.fiscal_year_id ?? null;
      let nextRef: string | null = null;
      let nextCode: string | null = null;
      if (fyId) {
        const probeRef = await client.query(
          `SELECT COALESCE(MAX(CAST(ref_no AS INT)), 0) AS max_ref
           FROM journals
           WHERE fiscal_year_id = $1 AND ref_no ~ '^[0-9]+'`,
          [fyId]
        );
        nextRef = String(Number(probeRef.rows[0]?.max_ref || 0) + 1);

        const probeCode = await client.query(
          `SELECT COALESCE(MAX(CAST(code AS INT)), 0) AS max_code
           FROM journals
           WHERE fiscal_year_id = $1 AND code ~ '^[0-9]+'`,
          [fyId]
        );
        nextCode = String(Number(probeCode.rows[0]?.max_code || 0) + 1);
      }

      // Insert journal as temporary
      const journalId = randomUUID();
      await client.query(
        `INSERT INTO journals (id, fiscal_year_id, ref_no, code, date, description, type, provider, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [journalId, fyId, nextRef, nextCode, h.date, h.description ?? null, 'payment', 'treasury', 'temporary']
      );
      for (const it of journalItems) {
        await client.query(
          `INSERT INTO journal_items (id, journal_id, code_id, party_id, debit, credit, description, detail_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), journalId, it.code_id, null, it.debit, it.credit, it.description ?? null, it.detail_id ?? null]
        );
      }

      // Mark payment as sent and link journal
      await client.query(`UPDATE payments SET status = 'sent', journal_id = $2 WHERE id = $1`, [id, journalId]);

      // Build response item
      const hr2 = await client.query(
        `SELECT id, number, status, date, fiscal_year_id, detail_id, special_code_id, description, total_amount, cashbox_id
         FROM payments
         WHERE id = $1
         LIMIT 1`,
        [id]
      );
      const ir2 = await client.query(
        `SELECT id, instrument_type, amount, reference, bank_account_id, check_id, position
         FROM payment_items
         WHERE payment_id = $1
         ORDER BY COALESCE(position, 0) ASC, created_at ASC`,
        [id]
      );
      const items2 = (ir2.rows || []).map((r: any) => ({
        id: r.id,
        instrumentType: r.instrument_type,
        amount: Number(r.amount || 0),
        reference: r.reference ?? null,
        bankAccountId: r.bank_account_id ?? null,
        checkId: r.check_id ?? null,
        position: r.position ?? null,
      }));
      const h2 = hr2.rows[0];
      const item = {
        id: String(h2.id),
        number: h2.number ?? null,
        status: String(h2.status || '').toLowerCase() === 'temporary' || String(h2.status || '').toLowerCase() === 'sent' ? 'draft' : (String(h2.status || '').toLowerCase() === 'permanent' ? 'posted' : h2.status),
        date: h2.date,
        fiscalYearId: h2.fiscal_year_id ?? null,
        detailId: h2.detail_id ?? null,
        specialCodeId: h2.special_code_id ?? null,
        description: h2.description ?? null,
        totalAmount: Number(h2.total_amount || 0),
        cashboxId: h2.cashbox_id ?? null,
        items: items2,
      };

      await client.query('COMMIT');
      return res.json({ ok: true, item, journalId, message: t('treasury.payments.sent', lang) });
    } catch (err: any) {
      await client.query('ROLLBACK');
      return res.status(500).json({ ok: false, error: err?.message || t('error.generic', lang) });
    } finally {
      client.release();
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || t('error.generic', lang) });
  }
});

export default treasuryRouter;