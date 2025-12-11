/**
 * ReceiptItemsTable
 * Phase 5: Dynamic instrument-specific rows for cash, card, transfer, and check.
 * - Cash: cashbox, amount
 * - Card: bank account, card reader, ref code, amount
 * - Transfer: bank account, ref/trace no., amount
 * - Check: check picker, destination (cashbox/bank), amount (read-only)
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { TextField, Select, MenuItem, IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SearchableSelect, { type SelectableOption } from '../common/SearchableSelect';
import NumericInput from '../common/NumericInput';
import type { ReceiptItem, InstrumentType } from '../../types/receipts';
import type { Cashbox, BankAccount, CardReader, Check } from '../../types/treasury';
import moment from 'moment-jalaali';
import { getCurrentLang } from '../../i18n';
import { Button } from '../../components/Button';
import type { ReceiptRowErrors } from '../../validators/receipt';

export interface ReceiptItemsTableProps {
  items: ReceiptItem[];
  onChange: (items: ReceiptItem[]) => void;
  cashboxes: Cashbox[];
  bankAccounts: BankAccount[];
  checks: Check[];
  cardReadersByBankId?: Record<string, CardReader[]>;
  /** Row-level validation errors keyed by row index */
  rowErrorsByIndex?: Record<number, ReceiptRowErrors>;
  /** Optional handler to open the incoming check dialog */
  onIssueIncomingCheck?: () => void;
}

/**
 * Renders instrument-specific inputs with add/remove operations.
 */
export const ReceiptItemsTable: React.FC<ReceiptItemsTableProps> = ({ items, onChange, cashboxes, bankAccounts, checks, cardReadersByBankId, rowErrorsByIndex, onIssueIncomingCheck }) => {
  const { t } = useTranslation();

  /**
   * selectedCardReaderByIndex
   * UI-only state to track which card reader is selected per row.
   * This does NOT affect payload; card reference code remains manual.
   */
  const [selectedCardReaderByIndex, setSelectedCardReaderByIndex] = React.useState<Record<number, string>>({});

  // Sync UI card reader selections with existing items on load/change
  React.useEffect(() => {
    const map: Record<number, string> = {};
    (items || []).forEach((it, idx) => {
      map[idx] = it.cardReaderId ? String(it.cardReaderId) : '';
    });
    setSelectedCardReaderByIndex(map);
  }, [items]);

  /**
   * addRow
   * Appends a default item row (check).
   * Since checks can repeat, defaulting to 'check' reduces clicks for users.
   */
  function addRow() {
    const next: ReceiptItem = { instrumentType: 'check', amount: 0 };
    onChange([...(items || []), next]);
  }

  /**
   * updateRow
   * Updates an item at a given index.
   */
  function updateRow(idx: number, patch: Partial<ReceiptItem>) {
    const next = (items || []).map((it, i) => (i === idx ? { ...it, ...patch } : it));
    onChange(next);
  }

  /**
   * removeRow
   * Removes an item at a given index.
   */
  function removeRow(idx: number) {
    const next = (items || []).filter((_, i) => i !== idx);
    onChange(next);
  }

  // Instrument type order: put 'check' first to streamline repeated entry of checks
  const types: InstrumentType[] = ['check', 'cash', 'card', 'transfer'];

  /** Helper finders for selected option values */
  const findCashbox = (id?: string | null) => (cashboxes || []).find((c) => String(c.id) === String(id || '')) || null;
  const findBankAccount = (id?: string | null) => (bankAccounts || []).find((b) => String(b.id) === String(id || '')) || null;
  const findCheck = (id?: string | null) => (checks || []).find((c) => String(c.id) === String(id || '')) || null;

  /**
   * getBankAccountLabel
   * Returns a clean label for bank accounts without internal IDs; includes
   * account name and account number. Localizes digits for Farsi ('fa').
   */
  const getBankAccountLabel = (acc: BankAccount): string => {
    const name = acc?.name || '';
    const numRaw = acc?.account_number || '';
    const lang = getCurrentLang();
    const num = lang === 'fa' ? toFarsiDigits(String(numRaw)) : String(numRaw);
    return name && num ? `${name} — ${num}` : (name || num);
  };

  /**
   * getCardReaderLabel
   * Returns PSP provider name and terminal ID only; avoids showing internal IDs
   * to keep the dropdown clean and focused on essential identifiers.
   */
  const getCardReaderLabel = (r: CardReader): string => {
    const provider = r?.psp_provider || '';
    const terminal = r?.terminal_id || '';
    return [provider, terminal].filter(Boolean).join(' — ');
  };

  /**
   * toFarsiDigits
   * Converts ASCII digits to Farsi digits for localized display in 'fa' locale.
   */
  function toFarsiDigits(str: string): string {
    const map: Record<string, string> = { '0':'۰','1':'۱','2':'۲','3':'۳','4':'۴','5':'۵','6':'۶','7':'۷','8':'۸','9':'۹' };
    return str.replace(/[0-9]/g, (d) => map[d]);
  }

  /**
   * formatDateLocalized
   * Formats an ISO date string for display: Jalali with Farsi digits in 'fa', ISO in 'en'.
   */
  function formatDateLocalized(iso: string | null | undefined): string {
    if (!iso) return '';
    const lang = getCurrentLang();
    const m = moment(iso, 'YYYY-MM-DD', true);
    if (!m.isValid()) return '';
    if (lang === 'fa') {
      const j = m.format('jYYYY/jMM/jDD');
      return toFarsiDigits(j);
    }
    return m.format('YYYY-MM-DD');
  }

  /**
   * getCheckLabel
   * Builds a clean, localized label for check options.
   * Shows: Bank Name — Serial Number — Due Date
   * - Bank Name prefers `bank_name` on the check; falls back to lookup via `bank_account_id`.
   * - Serial Number prefers `number`; falls back to `check_number`.
   * - Due Date uses Jalali + Persian digits in Farsi; ISO YYYY-MM-DD in English.
   */
  const getCheckLabel = (c: Check): string => {
    const bankNameFromItem = (c as any)?.bank_name ? String((c as any).bank_name) : '';
    const acc = (bankAccounts || []).find((b) => String(b.id) === String((c as any)?.bank_account_id || ''));
    const bankName = bankNameFromItem || acc?.name || '';
    const lang = getCurrentLang();
    const serialRaw = (c as any)?.number != null ? String((c as any).number) : (c?.check_number != null ? String(c.check_number) : '');
    const serial = lang === 'fa' ? toFarsiDigits(serialRaw) : serialRaw;
    const due = formatDateLocalized((c as any)?.due_date || '');
    return [bankName, serial, due].filter(Boolean).join(' — ');
  };

  return (
    <div className="mb-4">
      <div className="flex items-center mb-2">
        <h2 className="text-lg font-semibold">{t('pages.receipts.items.title', 'Items')}</h2>
      </div>
      <div className="flex items-center mb-2 justify-start gap-2">
        <Button
          variant="primary"
          size="small"
          onClick={addRow}
          aria-label={t('actions.addToList', 'Add to list')}
          className="flex items-center gap-2"
        >
          <AddIcon fontSize="small" />
          {t('actions.addToList', 'Add to list')}
        </Button>
        {onIssueIncomingCheck && (
          <Button
            variant="info"
            size="small"
            onClick={onIssueIncomingCheck}
            aria-label={t('pages.checks.issueIncoming','Issue Incoming Check')}
            className="flex items-center gap-2"
          >
            {t('pages.checks.issueIncoming','Issue Incoming Check')}
          </Button>
        )}
      </div>
      {(items || []).length === 0 && (
        <div className="text-gray-600">{t('common.noItems', 'No items')}</div>
      )}
      {(items || []).map((it, idx) => {
        const bank = findBankAccount(it.bankAccountId || undefined);
        /**
         * allCardReaders
         * Flattens mapped readers across all bank accounts so card rows can
         * select a reader directly without pre-selecting a bank account.
         */
        const allCardReaders: CardReader[] = Object.values(cardReadersByBankId || {}).reduce(
          (acc: CardReader[], arr) => acc.concat(arr || []),
          []
        );
        const selectedBankAccount = bank;
        const selectedCheck = findCheck(it.checkId || undefined);
        const rowErrs = (rowErrorsByIndex || {})[idx] || {};

        return (
          <div key={idx} className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-2 items-start">
            {/* Instrument type (fixed column 1) */}
            <div className="md:col-span-1">
              <Select
                value={it.instrumentType}
                onChange={(e) => updateRow(idx, { instrumentType: e.target.value as InstrumentType })}
                size="small"
              >
                {types.map((tp) => (
                  <MenuItem key={tp} value={tp}>{t(`common.${tp}`, tp)}</MenuItem>
                ))}
              </Select>
            </div>

            {/* Amount (fixed column 2) */}
            <div className="md:col-span-1 w-full">
              <NumericInput
                label={t('pages.receipts.items.amount', 'Amount')}
                value={it.amount}
                onChange={(val) => updateRow(idx, { amount: Number(val || 0) })}
                fullWidth
                size="small"
                allowDecimal={false}
                decimalScale={0}
                allowNegative={false}
                min={0}
                required
                disabled={it.instrumentType === 'check'}
                showValidation={false}
                helperText={rowErrs.amount}
              />
            </div>

            {/* Instrument-specific fields container (columns 3-5) */}
            <div className="md:col-span-3 w-full">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {/* Card instrument fields */}
                {it.instrumentType === 'card' && (
                  <>
                    <SearchableSelect<SelectableOption & CardReader>
                      options={(allCardReaders || []) as any}
                      value={(allCardReaders || []).find((r) => String((r as any).id) === String(selectedCardReaderByIndex[idx] || '')) as any}
                      onChange={(val) => {
                        const id = val?.id ? String(val.id) : '';
                        const bankIdFromReader = (val as any)?.bank_account_id ? String((val as any).bank_account_id) : null;
                        const readerDetailId = (val as any)?.detail_id != null ? String((val as any).detail_id) : null;
                        setSelectedCardReaderByIndex((prev) => ({ ...prev, [idx]: id }));
                        updateRow(idx, { cardReaderId: id || null, bankAccountId: bankIdFromReader, detailId: readerDetailId });
                      }}
                      label={t('pages.receipts.items.cardReader', 'Card Reader')}
                      placeholder={t('pages.receipts.items.cardReader', 'Card Reader')}
                      size="small"
                      fullWidth
                      inputDisplayMode="label"
                      getOptionLabel={(opt) => getCardReaderLabel(opt as unknown as CardReader)}
                      renderOption={(props, option) => (
                        <li {...props} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#111' }}>{getCardReaderLabel(option as unknown as CardReader)}</span>
                        </li>
                      )}
                      error={rowErrs.cardReaderId}
                      helperText={rowErrs.cardReaderId}
                    />
                    <TextField
                      label={t('pages.receipts.items.reference', 'Reference')}
                      value={it.reference || ''}
                      onChange={(e) => updateRow(idx, { reference: e.target.value || null })}
                      size="small"
                      error={Boolean((rowErrs as any).reference)}
                      helperText={(rowErrs as any).reference}
                    />
                  </>
                )}

                {/* Transfer instrument fields */}
                {it.instrumentType === 'transfer' && (
                  <>
                    <SearchableSelect<SelectableOption & BankAccount>
                      options={bankAccounts as any}
                      value={selectedBankAccount as any}
                      onChange={(val) => {
                        const detId = (val as any)?.detail_id != null ? String((val as any).detail_id) : null;
                        updateRow(idx, { bankAccountId: (val?.id ? String(val.id) : null), reference: null, detailId: detId });
                      }}
                      label={t('pages.receipts.items.bankAccount', 'Bank Account')}
                      placeholder={t('pages.receipts.items.bankAccount', 'Bank Account')}
                      size="small"
                      fullWidth
                      inputDisplayMode="label"
                      getOptionLabel={(opt) => getBankAccountLabel(opt as unknown as BankAccount)}
                      renderOption={(props, option) => (
                        <li {...props} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#111' }}>{getBankAccountLabel(option as unknown as BankAccount)}</span>
                        </li>
                      )}
                      error={rowErrs.bankAccountId}
                      helperText={rowErrs.bankAccountId}
                    />
                    <TextField
                      label={t('pages.receipts.items.reference', 'Reference')}
                      value={it.reference || ''}
                      onChange={(e) => updateRow(idx, { reference: e.target.value || null })}
                      size="small"
                      error={Boolean((rowErrs as any).reference)}
                      helperText={(rowErrs as any).reference}
                    />
                  </>
                )}

                {/* Check instrument fields */}
                {it.instrumentType === 'check' && (
                  <>
                    <SearchableSelect<SelectableOption & Check>
                      options={checks as any}
                      value={selectedCheck as any}
                      onChange={(val) => {
                        const amt = val ? Number((val as any).amount || 0) : 0;
                        const detId = val ? (((val as any).party_detail_id != null ? String((val as any).party_detail_id) : ((val as any).beneficiary_detail_id != null ? String((val as any).beneficiary_detail_id) : null))) : null;
                        updateRow(idx, { checkId: (val?.id ? String(val.id) : null), amount: amt, detailId: detId });
                      }}
                      label={t('pages.receipts.items.check', 'Check')}
                      placeholder={t('pages.receipts.items.check', 'Check')}
                      size="small"
                      fullWidth
                      inputDisplayMode="label"
                      getOptionLabel={(opt) => getCheckLabel(opt as unknown as Check)}
                      renderOption={(props, option) => (
                        <li {...props} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#111' }}>{getCheckLabel(option as unknown as Check)}</span>
                        </li>
                      )}
                      error={rowErrs.checkId}
                      helperText={rowErrs.checkId}
                    />
                  </>
                )}
              </div>
            </div>

            {/* Remove row (fixed last column) */}
            <div className="md:col-span-1 flex md:justify-end">
              <IconButton size="small" color="error" onClick={() => removeRow(idx)} aria-label={t('actions.removeFromList', 'Remove from list')}>
                <DeleteIcon />
              </IconButton>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ReceiptItemsTable;