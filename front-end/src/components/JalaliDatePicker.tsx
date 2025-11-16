/**
 * JalaliDatePicker component using react-multi-date-picker.
 * - Supports Persian (fa) calendar with RTL layout.
 * - Emits ISO `YYYY-MM-DD` (Gregorian) strings to keep API consistent.
 * - Falls back to Gregorian when language is 'en'.
 */
import React from 'react';
import DatePicker from 'react-multi-date-picker';
import gregorian from 'react-date-object/calendars/gregorian';
import gregorian_en from 'react-date-object/locales/gregorian_en';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import DateObject from 'react-date-object';
import { getCurrentLang } from '../i18n';

export interface JalaliDatePickerProps {
  /** Current value as ISO string (YYYY-MM-DD) or Date */
  value?: string | Date;
  /** Called with ISO string (YYYY-MM-DD, Gregorian) */
  onChange: (isoDate: string) => void;
  /** Optional placeholder text */
  placeholder?: string;
  /** Optional className for input */
  inputClassName?: string;
}

/**
 * Convert a `Date` or ISO string to DateObject safely.
 */
function toDateObject(val?: string | Date): DateObject | undefined {
  if (!val) return undefined;
  if (val instanceof Date) return new DateObject(val);
  // Assume ISO YYYY-MM-DD
  try {
    const [y, m, d] = val.split('-').map(Number);
    return new DateObject({ year: y, month: m, day: d });
  } catch {
    return undefined;
  }
}

/**
 * Convert DateObject or library value to ISO YYYY-MM-DD (Gregorian).
 */
function toIso(date: DateObject | Date | string | null): string {
  if (!date) return '';
  // Normalize to DateObject
  const obj = date instanceof DateObject
    ? date
    : date instanceof Date
      ? new DateObject(date)
      : new DateObject(date as string);
  // Ensure Gregorian to keep API stable
  const g = obj.convert(gregorian);
  const y = String(g.year).padStart(4, '0');
  const m = String(g.month.number).padStart(2, '0');
  const d = String(g.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const JalaliDatePicker: React.FC<JalaliDatePickerProps> = ({ value, onChange, placeholder, inputClassName }) => {
  const lang = getCurrentLang();
  const isFa = lang === 'fa';

  return (
    <DatePicker
      value={toDateObject(value)}
      calendar={isFa ? persian : gregorian}
      locale={isFa ? persian_fa : gregorian_en}
      containerClassName="w-full"
      inputClass={inputClassName || 'w-full border rounded-lg px-3 py-2'}
      placeholder={placeholder || (isFa ? 'تاریخ' : 'Date')}
      calendarPosition={isFa ? 'bottom-right' : 'bottom-left'}
      onChange={(val: unknown) => {
        const iso = toIso(val as DateObject);
        onChange(iso);
      }}
    />
  );
};

export default JalaliDatePicker;