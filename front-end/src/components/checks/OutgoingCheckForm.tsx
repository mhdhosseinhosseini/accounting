import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, TextField, Typography } from '@mui/material';
import JalaliDatePicker from '../common/JalaliDatePicker';
import NumericInput from '../common/NumericInput';
import SearchableSelect, { SelectableOption } from '../common/SearchableSelect';

/**
 * OutgoingCheckForm
 * Reusable controlled form component for issuing or editing an Outgoing Check.
 * - Mirrors IncomingCheckForm patterns for consistency and reusability
 * - Receives external state and callbacks; contains no business logic
 * - Displays validation messages via `errors` prop and supports Farsi translations
 */
export interface OutgoingFormState {
  bank_account_id: string;
  checkbook_id: string;
  issue_date: string;
  due_date: string;
  number: string;
  party_detail_id: string;
  amount: string;
  notes: string;
}

/** Generic option interface used by SearchableSelect */
interface Option extends SelectableOption { extra?: string }

/** Detail option for recipient selection */
interface DetailOption extends SelectableOption { code: string; title: string }

export interface OutgoingCheckFormProps {
  /** Current form values */
  value: OutgoingFormState;
  /** Field-level validation errors keyed by field name */
  errors: Record<string, string>;
  /** Optional general submit error to show at the top */
  submitError?: string;
  /** When set, renders primary button as Save instead of Issue */
  editingId?: string | null;
  /** Bank account options */
  bankAccountOptions: Option[];
  /** Checkbook options (dependent on selected bank account) */
  checkbookOptions: Option[];
  /** Recipient detail options */
  detailOptions: DetailOption[];
  /** Optional range descriptor for the selected checkbook */
  rangeText?: string;
  /** Change handler for all simple string fields */
  onChange: (field: keyof OutgoingFormState, value: string) => void;
  /** Change handler specifically for amount (NumericInput supports number | string) */
  onAmountChange: (value: number | string) => void;
  /** Invoked when the form is submitted; component will call preventDefault */
  onSubmit: () => void;
  /** Invoked when user clicks Close */
  onCancel: () => void;
}

const OutgoingCheckForm: React.FC<OutgoingCheckFormProps> = ({
  value,
  errors,
  submitError,
  editingId,
  bankAccountOptions,
  checkbookOptions,
  detailOptions,
  rangeText,
  onChange,
  onAmountChange,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();

  /**
   * getBankAccountLabel
   * Returns a combined label for bank accounts: "name (account_number)".
   */
  function getBankAccountLabel(opt: Option): string {
    const name = String((opt as any).name || '');
    const num = String((opt as any).account_number || '');
    return num ? `${name} (${num})` : name;
  }

  /**
   * handleSubmit
   * Prevents default form submit and bubbles up to onSubmit.
   */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <>
      <Typography variant="h6" className="mb-2">{t('pages.checks.issueOutgoing', 'Issue Outgoing Check')}</Typography>
      <div className={`${editingId ? 'bg-yellow-50 border border-yellow-200' : ''} rounded shadow p-4 mb-4`}>
        <form onSubmit={handleSubmit}>
          {submitError && <p className="text-xs text-red-600 mb-2">{submitError}</p>}

          <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={2}>
            {/* Bank account selector */}
            <div>
              <SearchableSelect<Option>
                options={bankAccountOptions}
                value={bankAccountOptions.find(o => String(o.id) === String(value.bank_account_id)) || null}
                onChange={(opt) => onChange('bank_account_id', opt ? String(opt.id) : '')}
                label={t('fields.bankAccount', 'Bank Account')}
                getOptionLabel={getBankAccountLabel}
                renderOption={(props, option) => (<li {...props}>{getBankAccountLabel(option as any)}</li>)}
                error={errors.bank_account_id}
                inputDisplayMode="label"
              />
            </div>

            {/* Checkbook selector dependent on bank account */}
            <div>
              <SearchableSelect<Option>
                options={checkbookOptions}
                value={checkbookOptions.find(o => String(o.id) === String(value.checkbook_id)) || null}
                onChange={(opt) => onChange('checkbook_id', opt ? String(opt.id) : '')}
                label={t('fields.checkbook', 'Checkbook')}
                getOptionLabel={(opt) => String((opt as any).name || '')}
                renderOption={(props, option) => (<li {...props}>{String((option as any).name || '')}</li>)}
                error={errors.checkbook_id}
                inputDisplayMode="label"
              />
              {rangeText && <p className="text-xs text-gray-500 mt-1">{t('fields.range','Range')}: {rangeText}</p>}
            </div>

            {/* Issue date */}
            <div>
              <Typography variant="body2" className="mb-1">{t('fields.checkDate','Check Date')}</Typography>
              <JalaliDatePicker
                value={value.issue_date}
                onChange={(val: string) => onChange('issue_date', val)}
                placeholder={t('fields.checkDate','Check Date')}
                inputClassName={errors.issue_date ? 'w-full border-2 border-red-500 rounded-lg px-3 py-2' : undefined}
              />
              {errors.issue_date && <p className="text-xs text-red-600 mt-1">{errors.issue_date}</p>}
            </div>

            {/* Due date */}
            <div>
              <Typography variant="body2" className="mb-1">{t('fields.dueDate','Due Date')}</Typography>
              <JalaliDatePicker
                value={value.due_date}
                onChange={(val: string) => onChange('due_date', val)}
                placeholder={t('fields.dueDate','Due Date')}
                inputClassName={errors.due_date ? 'w-full border-2 border-red-500 rounded-lg px-3 py-2' : undefined}
              />
              {errors.due_date && <p className="text-xs text-red-600 mt-1">{errors.due_date}</p>}
            </div>

            {/* Serial number */}
            <div>
              <TextField
                label={t('fields.checkSerial','Serial Number')}
                value={value.number}
                onChange={(e) => onChange('number', e.target.value)}
                size="small"
                error={!!errors.number}
                helperText={errors.number}
              />
            </div>

            {/* Recipient detail */}
            <div>
              <SearchableSelect<DetailOption>
                options={detailOptions}
                value={detailOptions.find(o => String(o.id) === String(value.party_detail_id)) || null}
                onChange={(opt) => onChange('party_detail_id', opt ? String(opt.id) : '')}
                label={t('fields.recipientDetail','Recipient (Detail)')}
                // Display as code-title (e.g., 1000-حسن)
                getOptionLabel={(opt) => `${(opt as any).code || ''}-${(opt as any).title || ''}`}
                renderOption={(props, option) => (<li {...props}>{`${(option as any).code || ''}-${(option as any).title || ''}`}</li>)}
                inputDisplayMode="label"
                required
                error={errors.party_detail_id}
              />
            </div>

            {/* Amount */}
            <div>
              <NumericInput
                value={value.amount}
                onChange={(val) => onAmountChange(val)}
                label={t('fields.amount','Amount')}
                allowDecimal
                decimalScale={0}
                min={0}
                required
                fullWidth
                size="small"
              />
              {errors.amount && <p className="text-xs text-red-600 mt-1">{errors.amount}</p>}
            </div>

            {/* Notes */}
            <div className="md:col-span-2">
              <TextField
                label={t('fields.description','Description')}
                value={value.notes}
                onChange={(e) => onChange('notes', e.target.value)}
                size="small"
                multiline
                minRows={2}
                fullWidth
              />
            </div>
          </Box>

          <div className="mt-3 flex items-center gap-2">
            <button type="submit" className="gb-button gb-button-primary">
              {editingId ? t('actions.save','Save') : t('actions.issueCheck','Issue Check')}
            </button>
            <button type="button" className="gb-button gb-button-secondary" onClick={onCancel}>
              {t('actions.close','Close')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
};

export default OutgoingCheckForm;