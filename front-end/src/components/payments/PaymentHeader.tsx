/**
 * PaymentHeader
 * Renders header fields for payment form: date, payer, description, status, number, special code.
 * Mirrors ReceiptHeader structure and behavior for consistency across treasury forms.
 */
import React from 'react';
import { TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { JalaliDatePicker } from '../common/JalaliDatePicker';
import SearchableSelect, { type SelectableOption } from '../common/SearchableSelect';
import { Link } from 'react-router-dom';

/**
 * DetailOption
 * UI option type for details selection (code-title), same as receipts.
 */
interface DetailOption extends SelectableOption { code: string; title: string }
interface CodeOption extends SelectableOption { code: string; title: string }

export interface PaymentHeaderProps {
  date: string;
  description: string;
  detailId: string | null | undefined;
  specialCodeId?: string | null;
  status?: string | null;
  number?: string | null;
  fiscalYearId?: string | null;
  detailOptions: DetailOption[];
  specialCodeOptions: CodeOption[];
  onChange: (patch: Partial<{ date: string; description: string; detailId: string | null; specialCodeId: string | null }>) => void;
}

/**
 * PaymentHeader
 * Renders payment header fields with controlled inputs and read-only badges.
 */
const PaymentHeader: React.FC<PaymentHeaderProps> = ({ date, description, detailId, specialCodeId, status, number, fiscalYearId, detailOptions, specialCodeOptions, onChange }) => {
  const { t } = useTranslation();
  const selectedDetail: DetailOption | null = (detailOptions || []).find((d) => String(d.id) === String(detailId)) || null;
  const selectedSpecial: CodeOption | null = (specialCodeOptions || []).find((c) => String(c.id) === String(specialCodeId)) || null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      {/* Date picker with floating label (inside the input) */}
      <div>
        <JalaliDatePicker
          value={date}
          onChange={(iso) => onChange({ date: iso })}
          label={t('pages.payments.fields.date', 'Date')}
        />
      </div>
      {/* Read-only badges: Status, Number */}
      <div className="grid grid-cols-2 gap-3 items-end">
        <TextField
          label={t('pages.payments.fields.status', 'Status')}
          value={status ? t(`pages.payments.status.${String(status).toLowerCase()}`, String(status)) : '-'}
          size="small"
          disabled
        />
        <TextField
          label={t('pages.payments.fields.number', 'Number')}
          value={number ? String(number) : '-'}
          size="small"
          disabled
        />
      </div>
      {/* Payer selection */}
      <div>
        <SearchableSelect<DetailOption>
          options={detailOptions}
          value={selectedDetail}
          onChange={(val) => onChange({ detailId: (val?.id ? String(val.id) : null) })}
          label={t('pages.payments.fields.payer', 'Payer')}
          placeholder={t('pages.payments.fields.payer', 'Payer')}
          size="small"
          fullWidth
          getOptionLabel={(opt) => `${(opt as any).code || ''}-${(opt as any).title || ''}`}
          renderOption={(props, option) => (
            <li {...props}>{`${(option as any).code || ''}-${(option as any).title || ''}`}</li>
          )}
          inputDisplayMode="label"
          noOptionsText={t('pages.payments.payer.noOptions', 'No payer found')}
        />
        {/**
         * Empty-details helper
         * When there are no details to select, guide the user to create one.
         */}
        {Array.isArray(detailOptions) && detailOptions.length === 0 && (
          <Typography variant="caption" className="mt-1 block text-gray-600">
            {t('pages.payments.payer.noDetailsHelp', 'No Details exist yet. ')}
            <Link to="/details" className="text-blue-600">
              {t('pages.payments.payer.createDetailCta', 'Create a Detail')}
            </Link>
            {t('pages.payments.payer.thenSelectHint', ' and then select it here.')}
          </Typography>
        )}
      </div>

      {/* Special Code selection */}
      <div>
        <SearchableSelect<CodeOption>
          options={specialCodeOptions}
          value={selectedSpecial}
          onChange={(val) => onChange({ specialCodeId: (val?.id ? String(val.id) : null) })}
          label={t('pages.payments.fields.specialCode', 'Special Code')}
          placeholder={t('pages.payments.fields.specialCode', 'Special Code')}
          size="small"
          fullWidth
          getOptionLabel={(opt) => `${(opt as any).code || ''}-${(opt as any).title || ''}`}
          renderOption={(props, option) => (
            <li {...props}>{`${(option as any).code || ''}-${(option as any).title || ''}`}</li>
          )}
          inputDisplayMode="label"
          noOptionsText={t('pages.payments.noSpecialCode', 'No code found')}
        />
      </div>

      {/* Description */}
      <TextField
        label={t('pages.payments.fields.description', 'Description')}
        value={description}
        onChange={(e) => onChange({ description: e.target.value })}
        size="small"
      />
    </div>
  );
};

export default PaymentHeader;