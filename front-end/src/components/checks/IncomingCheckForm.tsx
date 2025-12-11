import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, TextField, Typography } from '@mui/material';
import JalaliDatePicker from '../common/JalaliDatePicker';
import NumericInput from '../common/NumericInput';
import SearchableSelect, { SelectableOption } from '../common/SearchableSelect';

/**
 * IncomingCheckForm
 * Reusable controlled form component for creating or editing an Incoming Check.
 * - Accepts external state and callbacks to keep page-level logic intact
 * - Handles basic rendering of fields, validation messages, and submit/cancel buttons
 * - Uses existing i18n keys for labels, supporting Farsi translations and RTL
 * - NEW: Replaces free-text issuer with a details selector and tracks `party_detail_id`
 */
export interface IncomingFormState {
  issue_date: string;
  due_date: string;
  number: string;
  bank_name: string;
  issuer: string;
  party_detail_id: string;
  amount: string;
  notes: string;
}

/** Detail option for issuer selection */
interface DetailOption extends SelectableOption { code: string; title: string }

export interface IncomingCheckFormProps {
  /** Current form values */
  value: IncomingFormState;
  /** Field-level validation errors keyed by field name */
  errors: Record<string, string>;
  /** Optional general submit error to show at the top */
  submitError?: string;
  /** When set, renders primary button as Save instead of Issue */
  editingId?: string | null;
  /** Available party details for issuer selection */
  detailOptions: DetailOption[];
  /** Suggestions for bank name based on selected issuer detail */
  bankNameSuggestions?: string[];
  /** Change handler for text fields; component passes string values */
  onChange: (field: keyof IncomingFormState, value: string) => void;
  /** Change handler specifically for amount (NumericInput supports number | string) */
  onAmountChange: (value: number | string) => void;
  /** Invoked when the form is submitted; component will call preventDefault */
  onSubmit: () => void;
  /** Invoked when user clicks Close */
  onCancel: () => void;
}

const IncomingCheckForm: React.FC<IncomingCheckFormProps> = ({
  value,
  errors,
  submitError,
  editingId,
  detailOptions,
  bankNameSuggestions,
  onChange,
  onAmountChange,
  onSubmit,
  onCancel,
}) => {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'fa';

  /**
   * Feature: Bank name suggestions
   * When issuer detail has multiple associated bank names, show datalist options.
   * If only one suggestion is available, the parent page auto-fills the field.
   */
  const hasBankNameSuggestions = Array.isArray(bankNameSuggestions) && bankNameSuggestions.length > 1;

  /**
   * handleSubmit
   * Prevents default form submit and bubbles up to onSubmit.
   */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  /**
   * handleIssuerSelect
   * Updates both `party_detail_id` and the visible `issuer` text from selected detail.
   */
  function handleIssuerSelect(opt: DetailOption | null): void {
    onChange('party_detail_id', opt ? String(opt.id) : '');
    onChange('issuer', opt ? String(opt.title || '') : '');
  }

  return (
    <>
      <Typography variant="h6" className="mb-2">{t('pages.checks.issueIncoming', 'Issue Incoming Check')}</Typography>
      <div className={`${editingId ? 'bg-yellow-50 border border-yellow-200' : ''} rounded shadow p-4 mb-4`}>
        <form onSubmit={handleSubmit}>
          {submitError && <p className="text-xs text-red-600 mb-2">{submitError}</p>}

          <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={2}>
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

            {/* Due date optional */}
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

            {/* Bank name */}
            <div>
              <TextField
                label={t('fields.bankName','Bank Name')}
                value={value.bank_name}
                onChange={(e) => onChange('bank_name', e.target.value)}
                size="small"
                fullWidth
                inputProps={hasBankNameSuggestions ? { list: 'incoming-bank-suggestions' } : undefined}
              />
              {hasBankNameSuggestions && (
                <datalist id="incoming-bank-suggestions">
                  {bankNameSuggestions!.map((bn) => (
                    <option key={bn} value={bn} />
                  ))}
                </datalist>
              )}
            </div>

            {/* Issuer (select from Details) */}
            <div>
              <SearchableSelect<DetailOption>
                options={detailOptions}
                value={detailOptions.find(o => String(o.id) === String(value.party_detail_id)) || null}
                onChange={handleIssuerSelect}
                label={t('fields.issuer','Issuer')}
                // Show combined code-name in both dropdown and selected input (e.g., 1000-حسن)
                getOptionLabel={(opt) => `${(opt as any).code || ''}-${(opt as any).title || ''}`}
                renderOption={(props, option) => (<li {...props}>{`${(option as any).code || ''}-${(option as any).title || ''}`}</li>)}
                inputDisplayMode="label"
                error={errors.party_detail_id}
              />
              {/* Mirror issuer text for clarity when needed */}
              {value.issuer && <p className="text-xs text-gray-500 mt-1">{t('fields.issuer','Issuer')}: {value.issuer}</p>}
            </div>

            {/* Amount with floating label */}
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
              {editingId ? t('actions.save','Save') : t('actions.create','Issue Incoming Check')}
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

export default IncomingCheckForm;