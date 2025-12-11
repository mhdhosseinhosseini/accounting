/**
 * ReceiptHeader
 * Header form for receipt meta fields (Phase 4):
 * - Date (Jalali/Gregorian input)
 * - Payer selection (details)
 * - Description
 * - Fiscal period (read-only or auto)
 * - Status (read-only)
 * - Number (read-only, auto on post)
 */
import React from 'react';
import { TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { JalaliDatePicker } from '../common/JalaliDatePicker';
import SearchableSelect, { type SelectableOption } from '../common/SearchableSelect';
import { Link } from 'react-router-dom';
import type { Cashbox } from '../../types/treasury';

/**
 * DetailOption
 * UI option type for details selection (code-title).
 */
interface DetailOption extends SelectableOption { code: string; title: string }
interface CodeOption extends SelectableOption { code: string; title: string }

export interface ReceiptHeaderProps {
  date: string;
  description: string;
  detailId: string | null | undefined;
  specialCodeId?: string | null;
  status?: string | null;
  number?: string | null;
  fiscalYearId?: string | null;
  detailOptions: DetailOption[];
  specialCodeOptions: CodeOption[];
  cashboxId?: string | null;
  cashboxes: Cashbox[];
  onChange: (patch: Partial<{ date: string; description: string; detailId: string | null; specialCodeId: string | null; cashboxId: string | null }>) => void;
}

/**
 * ReceiptHeader
 * Renders receipt header fields with controlled inputs and read-only badges.
 */
export const ReceiptHeader: React.FC<ReceiptHeaderProps> = ({ date, description, detailId, specialCodeId, status, number, fiscalYearId, detailOptions, specialCodeOptions, cashboxId, cashboxes, onChange }) => {
  const { t } = useTranslation();
  const selectedDetail: DetailOption | null = (detailOptions || []).find((d) => String(d.id) === String(detailId)) || null;
  const selectedSpecial: CodeOption | null = (specialCodeOptions || []).find((c) => String(c.id) === String(specialCodeId)) || null;
  const selectedCashbox: (SelectableOption & Cashbox) | null = (cashboxes || []).find((c) => String(c.id) === String(cashboxId || '')) as any || null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      {/* Date picker with floating label (inside the input) */}
      <div>
        <JalaliDatePicker
          value={date}
          onChange={(iso) => onChange({ date: iso })}
          label={t('pages.receipts.fields.date', 'Date')}
        />
      </div>
      {/* Read-only badges: Status, Number */}
      <div className="grid grid-cols-2 gap-3 items-end">
        <TextField
          label={t('pages.receipts.fields.status', 'Status')}
          value={status ? t(`pages.receipts.status.${String(status).toLowerCase()}`, String(status)) : '-'}
          size="small"
          disabled
        />
        <TextField
          label={t('pages.receipts.fields.number', 'Number')}
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
          label={t('pages.receipts.fields.payer', 'Payer')}
          placeholder={t('pages.receipts.fields.payer', 'Payer')}
          size="small"
          fullWidth
          getOptionLabel={(opt) => `${(opt as any).code || ''}-${(opt as any).title || ''}`}
          renderOption={(props, option) => (
            <li {...props}>{`${(option as any).code || ''}-${(option as any).title || ''}`}</li>
          )}
          inputDisplayMode="label"
          noOptionsText={t('pages.receipts.payer.noOptions', 'No payer found')}
        />
        {/**
         * Empty-details helper
         * When there are no details to select, guide the user to create one.
         * Links to the Details page. This is purely a hint; the select stays empty
         * until Details exist, keeping data model consistent (receipts.detail_id).
         */}
        {Array.isArray(detailOptions) && detailOptions.length === 0 && (
          <Typography variant="caption" className="mt-1 block text-gray-600">
            {t('pages.receipts.payer.noDetailsHelp', 'No Details exist yet. ')}
            <Link to="/details" className="text-blue-600">
              {t('pages.receipts.payer.createDetailCta', 'Create a Detail')}
            </Link>
            {t('pages.receipts.payer.thenSelectHint', ' and then select it here.')}
          </Typography>
        )}
      </div>

      {/* Special Code selection */}
      <div>
        <SearchableSelect<CodeOption>
          options={specialCodeOptions}
          value={selectedSpecial}
          onChange={(val) => onChange({ specialCodeId: (val?.id ? String(val.id) : null) })}
          label={t('pages.receipts.fields.specialCode', 'Special Code')}
          placeholder={t('pages.receipts.fields.specialCode', 'Special Code')}
          size="small"
          fullWidth
          getOptionLabel={(opt) => `${(opt as any).code || ''}-${(opt as any).title || ''}`}
          renderOption={(props, option) => (
            <li {...props}>{`${(option as any).code || ''}-${(option as any).title || ''}`}</li>
          )}
          inputDisplayMode="label"
          noOptionsText={t('pages.receipts.noSpecialCode', 'No code found')}
        />
      </div>

      {/* Cashbox selection (header-level) */}
      <div>
        <SearchableSelect<SelectableOption & Cashbox>
          options={cashboxes as any}
          value={selectedCashbox as any}
          onChange={(val) => onChange({ cashboxId: (val?.id ? String(val.id) : null) })}
          label={t('pages.receipts.fields.cashbox', 'Cashbox')}
          placeholder={t('pages.receipts.fields.cashbox', 'Cashbox')}
          size="small"
          fullWidth
          inputDisplayMode="label"
          noOptionsText={t('pages.receipts.items.cashbox', 'Cashbox')}
        />
      </div>

      {/* Description */}
      <TextField
        label={t('pages.receipts.fields.description', 'Description')}
        value={description}
        onChange={(e) => onChange({ description: e.target.value })}
        size="small"
      />


    </div>
  );
};

export default ReceiptHeader;