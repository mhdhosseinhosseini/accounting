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
import { getCurrentLang } from '../../i18n';

export interface JalaliDatePickerProps {
  /** Current value as ISO string (YYYY-MM-DD) or Date */
  value?: string | Date;
  /** Called with ISO string (YYYY-MM-DD, Gregorian) */
  onChange: (isoDate: string) => void;
  /** Optional placeholder text */
  placeholder?: string;
  /** Optional className for input */
  inputClassName?: string;
  /** Disable input interaction */
  disabled?: boolean;
  /** Floating label text shown inside the input (like MUI TextField) */
  label?: string;
  /** Enable floating label behavior (default: true) */
  floatingLabel?: boolean;
}

/**
 * Convert a `Date` or ISO string to DateObject safely.
 */
function toDateObject(val?: string | Date): DateObject | undefined {
  if (!val) return undefined;
  const isFa = getCurrentLang() === 'fa';
  try {
    const obj = val instanceof Date ? new DateObject(val) : new DateObject(val as string);
    return obj.convert(isFa ? persian : gregorian);
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

/**
 * JalaliDatePicker
 * Renders a date input with styles aligned to MUI's outlined input.
 * - Default border color is gray (similar to MUI: rgba(0,0,0,0.23)).
 * - Allows callers to append classes (e.g., error red border) which take precedence.
 * - Supports floating label UI similar to MUI TextField when `label` is provided
 *   (or when `placeholder` is provided and `floatingLabel` is true).
 */
export const JalaliDatePicker: React.FC<JalaliDatePickerProps> = ({ value, onChange, placeholder, inputClassName, disabled, label, floatingLabel = true }) => {
  const lang = getCurrentLang();
  const isFa = lang === 'fa';

  // Base input classes to mimic MUI OutlinedInput gray border and height.
  // Set explicit height to match MUI TextField size="small" (~40px).
  // Use leading to vertically center text without extra vertical padding.
  const baseInputClasses = 'w-full h-10 leading-[40px] rounded-lg px-3 border border-gray-300 focus:border-gray-400 focus:ring-0 disabled:border-gray-200';

  // Determine whether we should show floating label and compute text.
  const effectiveLabel = label || placeholder || (isFa ? 'تاریخ' : 'Date');
  const showFloating = floatingLabel && !!effectiveLabel;

  // No extra top padding needed when the label floats on the border.
  const mergedInputClasses = [
    baseInputClasses,
    inputClassName
  ].filter(Boolean).join(' ');

  // Compute if the input has a value to float the label.
  const hasValue = Boolean(
    value && (value instanceof Date || (typeof value === 'string' && value.trim() !== ''))
  );

  // Side alignment: right in Farsi (RTL), left in English (LTR).
  const sideClass = isFa ? 'right-3 left-auto' : 'left-3';

  return (
    <div className="relative w-full group">
      {showFloating && (
        <span
          className={[
            'absolute text-gray-500 transition-all duration-200 pointer-events-none px-1 bg-white',
            sideClass,
            // Float onto the border when focused or when a value exists.
            hasValue ? 'top-0 -translate-y-1/2 text-xs transform' : 'top-3',
            'group-focus-within:top-0 group-focus-within:-translate-y-1/2 group-focus-within:text-xs group-focus-within:transform'
          ].filter(Boolean).join(' ')}
        >
          {effectiveLabel}
        </span>
      )}
      <DatePicker
        value={toDateObject(value)}
        calendar={isFa ? persian : gregorian}
        locale={isFa ? persian_fa : gregorian_en}
        containerClassName="w-full"
        inputClass={mergedInputClasses}
        placeholder={showFloating ? '' : (placeholder || effectiveLabel)}
        calendarPosition={isFa ? 'bottom-right' : 'bottom-left'}
        disabled={!!disabled}
        onChange={(val: unknown) => {
          const iso = toIso(val as DateObject);
          onChange(iso);
        }}
      />
    </div>
  );
};

export default JalaliDatePicker;