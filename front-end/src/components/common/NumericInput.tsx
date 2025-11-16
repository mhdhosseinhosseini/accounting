import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  value: number | string;
  onChange: (value: number | string) => void;
  placeholder?: string;
  className?: string;
  showStepper?: boolean;
  stepperPosition?: 'left' | 'right';
  min?: number;
  max?: number;
  maxLength?: number;
  step?: number;
  disabled?: boolean;
  required?: boolean;
  dirOverride?: 'ltr' | 'rtl';
  allowDecimal?: boolean;
  decimalScale?: number;
  allowNegative?: boolean;
  showValidation?: boolean;
  selectAllOnFocus?: boolean;
}

/**
 * NumericInput
 * A locale-aware numeric input that:
 * - Accepts Persian/Arabic numerals and normalizes to ASCII
 * - Optionally allows decimals and negatives with scale enforcement
 * - Formats with thousands separators while typing
 * - Displays localized digits (Farsi) on blur
 * - Preserves caret position across reformatting
 */
const NumericInput: React.FC<Props> = ({
  value,
  onChange,
  className = '',
  placeholder,
  dirOverride,
  allowDecimal = false,
  decimalScale = 0,
  allowNegative = false,
  min,
  max,
  showValidation = true,
  selectAllOnFocus = true,
  step = 1,
  disabled = false,
  required = false,
  showStepper = false,
  stepperPosition = 'right',
  maxLength,
}) => {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.dir() === 'rtl';
  const isFa = i18n.language?.startsWith('fa') || isRTL;

  /**
   * toEnglishNumeric
   * Converts input string to ASCII digits, enforcing decimal/negative rules and stripping invalid characters.
   */
  const toEnglishNumeric = (
    s: string,
    allowDec = allowDecimal,
    decScale = decimalScale,
    allowNeg = allowNegative
  ): string => {
    const fa = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    const ar = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
    let out = s;
    for (let i = 0; i < 10; i++) {
      out = out.replace(new RegExp(fa[i], 'g'), String(i));
      out = out.replace(new RegExp(ar[i], 'g'), String(i));
    }
    out = out.split('٫').join('.');
    out = out.split('٬').join(',');
    const allowedChars = allowNeg ? /[^0-9.,-]/g : /[^0-9.,]/g;
    out = out.replace(allowedChars, '').replace(/,/g, '');
    if (allowNeg) {
      const hasMinusAtStart = out.startsWith('-');
      out = out.replace(/-/g, '');
      if (hasMinusAtStart) out = '-' + out;
    }
    if (!allowDec) { out = out.replace(/\./g, ''); return out; }
    const firstDot = out.indexOf('.');
    if (firstDot !== -1) {
      const left = out.slice(0, firstDot + 1).replace(/\./g, '.');
      const right = out.slice(firstDot + 1).replace(/\./g, '');
      out = left + right;
    }
    if (decScale >= 0 && firstDot !== -1) {
      const [intPart, fracRaw] = out.split('.');
      const frac = (fracRaw || '').slice(0, decScale);
      out = decScale === 0 ? intPart : `${intPart}.${frac}`;
    }
    return out;
  };

  /**
   * toPersianDigits
   * Maps ASCII digits to Persian digits for localized display.
   */
  const toPersianDigits = (s: string): string => {
    const fa = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    return s.replace(/[0-9]/g, (d) => fa[Number(d)]);
  };

  /**
   * formatWithCommas
   * Formats an ASCII numeric string with thousands separators; preserves negative sign and decimalScale.
   */
  const formatWithCommas = (digits: string): string => {
    if (!digits) return '';
    const isNeg = digits.startsWith('-');
    const abs = isNeg ? digits.slice(1) : digits;
    const [intRaw, fracRaw] = abs.split('.');
    const intTrimmed = intRaw.replace(/^0+(\d)/, '$1');
    const intWithCommas = intTrimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    let res = intWithCommas;
    if (allowDecimal && decimalScale > 0) { const frac = (fracRaw || '').slice(0, decimalScale); res = frac.length > 0 ? `${intWithCommas}.${frac}` : intWithCommas; }
    return isNeg ? `-${res}` : res;
  };

  /**
   * formatForTyping
   * Adds grouping commas during typing and preserves trailing '.' when present.
   */
  const formatForTyping = (ascii: string): string => {
    if (!ascii) return '';
    const isNeg = ascii.startsWith('-');
    const abs = isNeg ? ascii.slice(1) : ascii;
    if (!allowDecimal) {
      const intWithCommas = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return isNeg ? `-${intWithCommas}` : intWithCommas;
    }
    const parts = abs.split('.');
    if (parts.length > 1) {
      const intPart = parts[0]; const fracRaw = parts.slice(1).join('.');
      const intTrimmed = intPart.replace(/^0+(\d)/, '$1'); const intWithCommas = intTrimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const res = fracRaw === '' ? (intPart === '' ? '.' : `${intWithCommas}.`) : `${intWithCommas}.${fracRaw.slice(0, decimalScale)}`;
      return isNeg ? `-${res}` : res;
    }
    const intTrimmed = abs.replace(/^0+(\d)/, '$1'); const intWithCommas = intTrimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return isNeg ? `-${intWithCommas}` : intWithCommas;
  };

  // Canonical ASCII value and formatted display value
  const [asciiValue, setAsciiValue] = useState<string>(String(value) || '');
  const [displayVal, setDisplayVal] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef(false);

  // Padding for stepper overlay and side classes
  const padClass = showStepper ? (stepperPosition === 'left' ? 'pl-7' : 'pr-7') : '';
  const stepperSideClasses = 'rounded-md border border-gray-300 shadow-sm';

  /**
   * clampNumber
   * Clamps a numeric value to min/max and non-negative if negatives not allowed.
   */
  const clampNumber = (n: number): number => {
    let nn = n; if (!allowNegative) nn = Math.max(0, nn);
    if (min != null) nn = Math.max(min, nn); if (max != null) nn = Math.min(max, nn); return nn;
  };

  /**
   * formatNumToAscii
   * Formats a JS number to ASCII respecting decimalScale.
   */
  const formatNumToAscii = (n: number): string => {
    if (!allowDecimal || decimalScale <= 0) return String(Math.round(n));
    return n.toFixed(decimalScale).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  };

  /**
   * applyNumberUpdate
   * Applies programmatic updates: clamps, formats, updates state, and moves caret to end.
   */
  const applyNumberUpdate = (n: number) => {
    const clamped = clampNumber(n); const ascii = formatNumToAscii(clamped);
    setAsciiValue(ascii); const formatted = formatForTyping(ascii); setDisplayVal(formatted); onChange(ascii);
    requestAnimationFrame(() => { const el = inputRef.current; if (!el) return; const len = el.value.length; el.setSelectionRange(len, len); });
  };

  /**
   * increment
   * Increments current numeric value by step.
   */
  const increment = () => { const current = Number(asciiValue || '0'); const base = Number.isFinite(current) ? current : 0; applyNumberUpdate(base + step); };

  /**
   * decrement
   * Decrements current numeric value by step.
   */
  const decrement = () => { const current = Number(asciiValue || '0'); const base = Number.isFinite(current) ? current : 0; applyNumberUpdate(base - step); };

  /**
   * computeCaretIndex
   * Maps caret to correct position after formatting by matching left-side cleaned text.
   */
  const computeCaretIndex = (formatted: string, leftClean: string): number => {
    for (let i = 0; i <= formatted.length; i++) { const sub = formatted.slice(0, i); const subClean = toEnglishNumeric(sub, allowDecimal, decimalScale, allowNegative); if (subClean === leftClean) return i; }
    return formatted.length;
  };

  // Sync internal state from external value when not focused
  useEffect(() => {
    if (focusedRef.current) return; const ascii = String(value) || '';
    setAsciiValue(ascii); const withCommas = formatWithCommas(ascii); const localized = isFa ? toPersianDigits(withCommas) : withCommas; setDisplayVal(localized);
  }, [value, isFa]);

  /**
   * handleFocus
   * Prepares the input for typing: sets lang/dir, shows comma grouping, and selects content.
   */
  const handleFocus = () => {
    focusedRef.current = true;
    if (isFa) { try { document.documentElement.lang = 'fa'; document.documentElement.dir = 'rtl'; } catch {} }
    const formatted = formatForTyping(asciiValue || ''); setDisplayVal(formatted);
    requestAnimationFrame(() => {
      const el = inputRef.current; if (!el) return; try { el.setAttribute('lang', isFa ? 'fa' : 'en'); } catch {}
      if (selectAllOnFocus) { el.select(); } else { const len = el.value.length; el.setSelectionRange(len, len); }
    });
  };

  /**
   * handleChange
   * Normalizes user input to ASCII, reformats display, triggers onChange, and preserves caret.
   */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target; const caret = el.selectionStart ?? (el.value?.length || 0); const raw = el.value || '';
    const ascii = toEnglishNumeric(raw, allowDecimal, decimalScale, allowNegative); setAsciiValue(ascii); const formatted = formatForTyping(ascii); setDisplayVal(formatted); onChange(ascii);
    const leftRaw = raw.slice(0, caret); const leftClean = toEnglishNumeric(leftRaw, allowDecimal, decimalScale, allowNegative);
    requestAnimationFrame(() => { const el2 = inputRef.current; if (!el2) return; const idx = computeCaretIndex(formatted, leftClean); el2.setSelectionRange(idx, idx); });
  };

  /**
   * handleBlur
   * Finalizes display on blur using localized digits and thousands separators.
   */
  const handleBlur = () => { focusedRef.current = false; const ascii = asciiValue || ''; const withCommas = formatWithCommas(ascii); const localized = isFa ? toPersianDigits(withCommas) : withCommas; setDisplayVal(localized); };

  /**
   * handlePaste
   * Sanitizes pasted text to ASCII numeric content.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text'); const ascii = toEnglishNumeric(text, allowDecimal, decimalScale, allowNegative);
    if (ascii !== text) { e.preventDefault(); setAsciiValue(ascii); const formatted = formatForTyping(ascii); setDisplayVal(formatted); onChange(ascii);
      requestAnimationFrame(() => { const el = inputRef.current; if (!el) return; const len = el.value.length; el.setSelectionRange(len, len); }); }
  };

  /**
   * handleKeyDown
   * Allows only numeric-relevant keys, supports arrow step, and enforces decimal/negative rules.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); if (!disabled) increment(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!disabled) decrement(); return; }
    const allowKeys = new Set(['Backspace','Delete','ArrowLeft','ArrowRight','Home','End','Tab']); if (allowKeys.has(e.key)) return;
    if (/^[0-9]$/.test(e.key) || /^[۰-۹]$/.test(e.key) || /^[٠-٩]$/.test(e.key)) return;
    if (allowNegative && e.key === '-') { const asciiCurrent = toEnglishNumeric(displayVal, allowDecimal, decimalScale, allowNegative); const cursorPos = (e.target as HTMLInputElement).selectionStart || 0; if (cursorPos === 0 && !asciiCurrent.startsWith('-')) return; }
    if (allowDecimal && (e.key === '.' || e.key === '٫')) { const asciiCurrent = toEnglishNumeric(displayVal, allowDecimal, decimalScale, allowNegative); if (!asciiCurrent.includes('.')) return; }
    if (e.key === ',' || e.key === '٬') return; e.preventDefault();
  };

  // Validation
  const asciiForValidation = asciiValue || '';
  let error: string | null = null;
  if (showValidation) {
    if (required && !asciiForValidation) error = t('common.errors.required','This field is required');
    else if (asciiForValidation) {
      const numVal = Number(asciiForValidation);
      if (Number.isFinite(numVal)) {
        if (min != null && numVal < min) error = `Must be ≥ ${min}`;
        if (max != null && numVal > max) error = `Must be ≤ ${max}`;
        if (!allowDecimal && asciiForValidation.includes('.')) error = 'Decimals are not allowed';
        if (allowDecimal && decimalScale >= 0) { const frac = asciiForValidation.split('.')[1] || ''; if (frac.length > decimalScale) error = `Max ${decimalScale} decimal places`; }
      }
    }
  }
  const invalid = !!error;

  return (
    <div className="inline-flex flex-col">
      <div className="relative inline-block">
        <input
          ref={inputRef}
          type="text"
          dir={dirOverride || (isRTL ? 'rtl' : 'ltr')}
          lang={isFa ? 'fa' : 'en'}
          className={`w-28 border rounded px-2 py-1 ${invalid ? 'border-red-500 focus:ring-red-300' : ''} ${padClass} ${className}`}
          value={displayVal}
          onFocus={handleFocus}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={invalid || undefined}
        />
        {showStepper && (
          <div className={`absolute ${stepperPosition === 'left' ? 'left-2' : 'right-2'} top-1/2 -translate-y-1/2 h-8 w-5 bg-gray-100 flex flex-col overflow-hidden ${stepperSideClasses} ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <button type="button" className="h-4 flex items-center justify-center text-[10px] leading-none text-gray-700 hover:bg-gray-200" onClick={increment} disabled={disabled} aria-label={t('actions.increment','Increment')}>▲</button>
            <button type="button" className="h-4 flex items-center justify-center text-[10px] leading-none text-gray-700 hover:bg-gray-200 border-t" onClick={decrement} disabled={disabled} aria-label={t('actions.decrement','Decrement')}>▼</button>
          </div>
        )}
      </div>
      {showValidation && error && (
        <span className="mt-1 text-[11px] text-red-500">{isFa ? toPersianDigits(error) : error}</span>
      )}
    </div>
  );
};

export default NumericInput;