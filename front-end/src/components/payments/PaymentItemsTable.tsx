/**
 * PaymentItemsTable
 * Dynamic instrument-specific inputs for payment items without card reader.
 * - Cash: cashbox, amount
 * - Card: bank account, card ref code, amount
 * - Transfer: bank account, transfer ref, amount
 * - Check: check picker, destination (cashbox/bank), amount (read-only)
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Select, MenuItem, IconButton, TextField } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SearchableSelect, { type SelectableOption } from '../common/SearchableSelect';
import NumericInput from '../common/NumericInput';
import type { PaymentItem, InstrumentType } from '../../types/payments';
import type { Cashbox, BankAccount, Check } from '../../types/treasury';
import moment from 'moment-jalaali';
import { getCurrentLang } from '../../i18n';
import type { PaymentRowErrors } from '../../validators/payment';

export interface PaymentItemsTableProps {
  items: PaymentItem[];
  onChange: (items: PaymentItem[]) => void;
  cashboxes: Cashbox[];
  bankAccounts: BankAccount[];
  checks: Check[];
  /** Incoming checks for 'checkin' instrument */
  incomingChecks: Check[];
  /** Optional handler to open outgoing check issuance dialog */
  onIssueOutgoingCheck?: () => void;
  /** Current payer detail id from header; used for check filtering and auto fill */
  payerDetailId?: string | null;
  /** Callback to set payer detail id in header when selecting a check */
  onSetPayerDetailId?: (id: string) => void;
  /** Row-level validation errors keyed by row index */
  rowErrorsByIndex?: Record<number, PaymentRowErrors>;
  /** Header cashbox id to avoid overriding when already set */
  headerCashboxId?: string | null;
  /** Auto-set header cashbox from selected incoming check */
  onAutoSetCashboxId?: (id: string) => void;
}

/**
 * updateRow
 * Updates an item at a given index.
 */
function updateRow(items: PaymentItem[], idx: number, patch: Partial<PaymentItem>): PaymentItem[] {
  return (items || []).map((it, i) => (i === idx ? { ...it, ...patch } : it));
}

/**
 * resolveCheckOwnerDetailId
 * Returns the owner detail id of a check for outgoing payments.
 * - Prefers `party_detail_id` (current field)
 * - Falls back to `beneficiary_detail_id` (legacy)
 */
function resolveCheckOwnerDetailId(c: Check | (SelectableOption & Check) | null | undefined): string | null {
  if (!c) return null;
  const pid = (c as any).party_detail_id != null ? String((c as any).party_detail_id) : null;
  const legacy = (c as any).beneficiary_detail_id != null ? String((c as any).beneficiary_detail_id) : null;
  return pid || legacy || null;
}

const PaymentItemsTable: React.FC<PaymentItemsTableProps> = ({ items, onChange, cashboxes, bankAccounts, checks, incomingChecks, onIssueOutgoingCheck, payerDetailId, onSetPayerDetailId, rowErrorsByIndex, headerCashboxId, onAutoSetCashboxId }) => {
  const { t } = useTranslation();

  /**
   * addRow
   * Appends a default check item row (check is common for payments).
   */
  function addRow() {
    const next: PaymentItem = { instrumentType: 'check', amount: 0 };
    onChange([...(items || []), next]);
  }

  /**
   * removeRow
   * Removes an item at a given index.
   */
  function removeRow(idx: number) {
    const next = (items || []).filter((_, i) => i !== idx);
    onChange(next);
  }

  // Instrument type order: check first to streamline repeated entry
  const types: InstrumentType[] = ['check', 'cash', 'checkin', 'transfer'];

  /** Helper finders for selected option values
   * Accept both string and number IDs to align with treasury types.
   */
  const findCashbox = (id?: string | number | null) => (cashboxes || []).find((c) => String(c.id) === String(id ?? '')) || null;
  const findBankAccount = (id?: string | number | null) => (bankAccounts || []).find((b) => String(b.id) === String(id ?? '')) || null;
  const findCheck = (id?: string | number | null) => (checks || []).find((c) => String(c.id) === String(id ?? '')) || null;
  const findIncomingCheck = (id?: string | number | null) => (incomingChecks || []).find((c) => String(c.id) === String(id ?? '')) || null;

  /**
   * getBankAccountLabel
   * Returns "Name — AccountNumber"; localizes digits in Farsi ('fa').
   */
  const getBankAccountLabel = (acc: BankAccount): string => {
    const name = acc?.name || '';
    const numRaw = acc?.account_number || '';
    const lang = getCurrentLang();
    const num = lang === 'fa' ? toFarsiDigits(String(numRaw)) : String(numRaw);
    return name && num ? `${name} — ${num}` : (name || num);
  };

  /**
   * getBankAccountNameLabel
   * Returns only the account name for transfer dropdown per requirement.
   */
  const getBankAccountNameLabel = (acc: BankAccount): string => {
    return acc?.name || '';
  };

  /**
   * toFarsiDigits
   * Converts ASCII digits to Farsi digits for localized display in 'fa' locale.
   */
  function toFarsiDigits(str: string): string {
    const map: Record<string, string> = { '0':'۰','1':'۱','2':'۲','3':'۳','4':'۴','5':'۵','6':'۶','7':'۷','8':'۸','9':'۹' };
    return String(str).replace(/[0-9]/g, (d) => map[d] || d);
  }

  /**
   * formatDateLocalized
   * Formats an ISO date string for display: Jalali (YYYY/MM/DD) in 'fa', ISO in 'en'.
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
   * Builds a label: Account Name — Serial Number — Check Date (due if available).
   * - Account Name from bank account lookup via `bank_account_id`.
   * - Serial Number prefers `number`, falls back to `check_number`.
   * - Date prefers `due_date`, falls back to `issue_date`.
   * - Localizes digits and date for Farsi ('fa') locale.
   */
  const getCheckLabel = (c: Check): string => {
    const lang = getCurrentLang();
    const acc = (bankAccounts || []).find((b) => String(b.id) === String((c as any)?.bank_account_id || ''));
    const accountNameRaw = acc?.name || '';
    const accountName = String(accountNameRaw);
    const serialRaw = (c as any)?.number != null ? String((c as any).number) : (c?.check_number != null ? String(c.check_number) : '');
    const serial = lang === 'fa' ? toFarsiDigits(serialRaw) : serialRaw;
    const date = formatDateLocalized((c as any)?.due_date || (c as any)?.issue_date || '');
    return [accountName, serial, date].filter(Boolean).join(' — ');
  };

  /**
   * getIncomingCheckLabel
   * Returns "Bank Name — Serial Number — Date" for incoming checks.
   * - Bank Name from `bank_name`
   * - Serial Number prefers `number`, falls back to `check_number`
   * - Date prefers `due_date`, falls back to `issue_date`
   * - Localizes digits and date for Farsi ('fa') locale.
   */
  const getIncomingCheckLabel = (c: Check): string => {
    const lang = getCurrentLang();
    const bankNameRaw = (c as any)?.bank_name || '';
    const bankName = String(bankNameRaw);
    const serialRaw = (c as any)?.number != null ? String((c as any).number) : (c?.check_number != null ? String(c.check_number) : '');
    const serial = lang === 'fa' ? toFarsiDigits(serialRaw) : serialRaw;
    const date = formatDateLocalized((c as any)?.due_date || (c as any)?.issue_date || '');
    return [bankName, serial, date].filter(Boolean).join(' — ');
  };

  return (
    <div className="mb-4">
      <div className="flex items-center mb-2">
        <h2 className="text-lg font-semibold">{t('pages.payments.items.title', 'Items')}</h2>
      </div>
      <div className="flex items-center mb-2 justify-start gap-2">
        {/* Add Item uses primary style */}
        <button
          type="button"
          onClick={addRow}
          aria-label={t('pages.payments.items.add', 'Add Item')}
          className="gb-button gb-button-primary flex items-center gap-2"
        >
          <AddIcon fontSize="small" />
          {t('pages.payments.items.add', 'Add Item')}
        </button>
        {/* Issue Outgoing Check button, mirrors incoming check button styling */}
        {onIssueOutgoingCheck && (
          <button
            type="button"
            onClick={onIssueOutgoingCheck}
            aria-label={t('pages.checks.issueOutgoing', 'Issue Outgoing Check')}
            className="gb-button gb-button-info"
          >
            {t('pages.checks.issueOutgoing', 'Issue Outgoing Check')}
          </button>
        )}
      </div>
      {(items || []).length === 0 && (
        <div className="text-gray-600">{t('common.noItems', 'No items')}</div>
      )}
      {(items || []).map((it, idx) => {
        const rowErrs = (rowErrorsByIndex || {})[idx] || {};

        return (
          <div key={idx} className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-2 items-start">
            {/* Instrument type */}
            <div className="md:col-span-1">
              {/* Instrument type selector; reset related instrument and destination when changing */}
              <Select
                value={it.instrumentType}
                onChange={(e) => {
                  const newType = e.target.value as InstrumentType;
                  const patch: Partial<PaymentItem> = { instrumentType: newType, relatedInstrumentId: null };
                  if (newType === 'check' || newType === 'checkin') {
                    patch.destinationType = null;
                    patch.destinationId = null;
                  }
                  if (newType !== 'transfer') {
                    patch.reference = null;
                  }
                  onChange(updateRow(items, idx, patch));
                }}
                size="small"
              >
                {types.map((tp) => (
                  <MenuItem key={tp} value={tp}>{t(`pages.payments.items.instrument.${tp}`, tp)}</MenuItem>
                ))}
              </Select>
            </div>

            {/* Amount */}
            <div className="md:col-span-1 w-full">
              <NumericInput
                label={t('pages.payments.items.amount', 'Amount')}
                value={it.amount}
                onChange={(val) => onChange(updateRow(items, idx, { amount: Number(val || 0) }))}
                fullWidth
                size="small"
                allowDecimal={false}
                decimalScale={0}
                allowNegative={false}
                min={0}
                required
                disabled={it.instrumentType === 'check' || it.instrumentType === 'checkin'}
                showValidation={false}
                helperText={rowErrs.amount}
              />
            </div>

            {/* Instrument-specific fields */}
            <div className="md:col-span-3 w-full">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {/* Cash: no related instrument selector */}
                {it.instrumentType === 'cash' && (<></>)}

                {/* Incoming Check */}
                {it.instrumentType === 'checkin' && (
                  <>
                    <SearchableSelect<SelectableOption & Check>
                      options={incomingChecks as any}
                      value={findIncomingCheck(it.relatedInstrumentId || undefined) as any}
                      onChange={(val) => {
                        const amt = val ? Number((val as any).amount || 0) : 0;
                        onChange(updateRow(items, idx, { relatedInstrumentId: (val?.id ? String(val.id) : null), amount: amt }));
                        /**
                         * Auto-set header cashbox from the selected incoming check's cashbox_id
                         * Only applies when header cashbox is not already selected.
                         * Notes (FA): با انتخاب چک دریافتی، در صورت خالی بودن فیلد صندوق، مقدار صندوق از چک تنظیم می‌شود.
                         */
                        if (onAutoSetCashboxId && !headerCashboxId) {
                          const cbid = (val as any)?.cashbox_id;
                          if (cbid) onAutoSetCashboxId(String(cbid));
                        }
                      }}
                      label={t('pages.payments.items.check', 'Check')}
                      placeholder={t('pages.payments.items.check', 'Check')}
                      size="small"
                      fullWidth
                      inputDisplayMode="label"
                      getOptionLabel={(opt) => getIncomingCheckLabel(opt as unknown as Check)}
                      renderOption={(props, option) => (
                        <li {...props} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#111' }}>{getIncomingCheckLabel(option as unknown as Check)}</span>
                        </li>
                      )}
                      error={(rowErrorsByIndex || {})[idx]?.relatedInstrumentId}
                      helperText={(rowErrorsByIndex || {})[idx]?.relatedInstrumentId}
                    />
                  </>
                )}

                {/* Transfer */}
                {it.instrumentType === 'transfer' && (
                  <>
                    <SearchableSelect<SelectableOption & BankAccount>
                      options={bankAccounts as any}
                      value={findBankAccount(it.relatedInstrumentId || undefined) as any}
                      onChange={(val) => onChange(updateRow(items, idx, { relatedInstrumentId: (val?.id ? String(val.id) : null), reference: null }))}
                      label={t('pages.payments.items.bankAccount', 'Bank Account')}
                      placeholder={t('pages.payments.items.bankAccount', 'Bank Account')}
                      size="small"
                      fullWidth
                      inputDisplayMode="label"
                      getOptionLabel={(opt) => getBankAccountLabel(opt as unknown as BankAccount)}
                      renderOption={(props, option) => (
                        <li {...props} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#111' }}>{getBankAccountLabel(option as unknown as BankAccount)}</span>
                        </li>
                      )}
                      error={(rowErrorsByIndex || {})[idx]?.relatedInstrumentId}
                      helperText={(rowErrorsByIndex || {})[idx]?.relatedInstrumentId}
                    />
                    <TextField
                      label={t('pages.payments.items.reference', 'Reference')}
                      value={it.reference || ''}
                      onChange={(e) => onChange(updateRow(items, idx, { reference: e.target.value || null }))}
                      size="small"
                      error={Boolean(((rowErrorsByIndex || {})[idx] as any)?.reference)}
                      helperText={((rowErrorsByIndex || {})[idx] as any)?.reference}
                    />
                  </>
                )}

                {/* Check */}
                {it.instrumentType === 'check' && (
                  <>
                    <SearchableSelect<SelectableOption & Check>
                      options={checks as any}
                      value={findCheck(it.relatedInstrumentId || undefined) as any}
                      onChange={(val) => {
                        const amt = val ? Number((val as any).amount || 0) : 0;
                        onChange(updateRow(items, idx, { relatedInstrumentId: (val?.id ? String(val.id) : null), amount: amt }));
                        // Auto-fill payer from selected check owner when header is empty
                        if (!payerDetailId && onSetPayerDetailId) {
                          const ownerId = resolveCheckOwnerDetailId(val as any);
                          if (ownerId) onSetPayerDetailId(String(ownerId));
                        }
                      }}
                      label={t('pages.payments.items.check', 'Check')}
                      placeholder={t('pages.payments.items.check', 'Check')}
                      size="small"
                      fullWidth
                      inputDisplayMode="label"
                      getOptionLabel={(opt) => getCheckLabel(opt as unknown as Check)}
                      renderOption={(props, option) => (
                        <li {...props} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#111' }}>{getCheckLabel(option as unknown as Check)}</span>
                        </li>
                      )}
                      error={(rowErrorsByIndex || {})[idx]?.relatedInstrumentId}
                      helperText={(rowErrorsByIndex || {})[idx]?.relatedInstrumentId}
                    />

                  </>
                )}
              </div>
            </div>

            {/* Remove row */}
            <div className="md:col-span-1 flex md:justify-end">
              <IconButton size="small" color="error" onClick={() => removeRow(idx)} aria-label={t('actions.delete', 'Delete')}>
                <DeleteIcon />
              </IconButton>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default PaymentItemsTable;