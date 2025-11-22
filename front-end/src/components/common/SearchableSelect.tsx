import React, { useEffect, useState } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import type { FilterOptionsState } from '@mui/material/useAutocomplete';
import { useTranslation } from 'react-i18next';

/**
 * SelectableOption
 * Generic interface for selectable options used by SearchableSelect.
 */
export interface SelectableOption {
  id: string | number;
  name: string;
  [key: string]: any; // Allow additional properties
}

/**
 * Props for the SearchableSelect component
 */
interface SearchableSelectProps<T extends SelectableOption> {
  /** Array of options to display in the dropdown */
  options: T[];
  /** Currently selected value */
  value: T | null;
  /** Callback when selection changes */
  onChange: (value: T | null) => void;
  /** Label for the input field */
  label: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Whether the field is required */
  required?: boolean;
  /** Custom function to format option labels */
  getOptionLabel?: (option: T) => string;
  /** Custom function to determine if options are equal */
  isOptionEqualToValue?: (option: T, value: T) => boolean;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show loading state */
  loading?: boolean;
  /** Error message to display */
  error?: string;
  /** Helper text to display */
  helperText?: string;
  /** Size variant */
  size?: 'small' | 'medium';
  /** Whether the input should take full width */
  fullWidth?: boolean;
  /** Callback when input text changes */
  onInputChange?: (value: string) => void;
  /** Current input value (controlled) */
  inputValue?: string;
  /** Open dropdown suggestions on focus (defaults to true) */
  openOnFocus?: boolean;
  /** Custom render for dropdown options */
  renderOption?: (props: React.HTMLAttributes<HTMLLIElement>, option: T) => React.ReactNode;
  /** Custom filter function; if omitted, filters by code or name */
  filterOptions?: (options: T[], state: FilterOptionsState<T>) => T[];
  /**
   * When true, pressing Enter auto-selects the single remaining filtered option.
   * Improves UX for code inputs: no need to arrow-select when only one result.
   */
  autoSelectSingleOnEnter?: boolean;
}

/**
 * SearchableSelect
 * Reusable component for searching and selecting items (codes, details, etc.).
 * - Supports RTL via i18n language check and adjusts field direction.
 * - Allows customizing option label and equality behavior.
 * - Displays only the code in the input field while showing code + title in dropdown.
 * - Keyboard UX: if filtering yields exactly one option, pressing Enter selects it.
 */
const SearchableSelect = <T extends SelectableOption>({
  options,
  value,
  onChange,
  label,
  placeholder,
  disabled = false,
  required = false,
  getOptionLabel,
  isOptionEqualToValue,
  className = '',
  loading = false,
  error,
  helperText,
  size = 'small',
  fullWidth = true,
  onInputChange,
  inputValue,
  openOnFocus = true,
  renderOption,
  filterOptions,
  autoSelectSingleOnEnter = true,
}: SearchableSelectProps<T>) => {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'fa';

  /**
   * defaultGetOptionLabel
   * Returns option.name or falls back to id string when no custom label is provided.
   */
  const defaultGetOptionLabel = (option: T): string => {
    return (option as any).name || String(option.id);
  };

  /**
   * getOptionCode
   * Returns a string "code" representation used for input display.
   * Prefers the `code` field, then `id`, then `name`.
   */
  const getOptionCode = (option: T | null): string => {
    if (!option) return '';
    const o: any = option as any;
    if (o.code != null) return String(o.code);
    if (option.id != null) return String(option.id);
    if (o.name != null) return String(o.name);
    return '';
  };

  /**
   * defaultIsOptionEqualToValue
   * Compares options by id if no custom equality function is provided.
   */
  const defaultIsOptionEqualToValue = (option: T, val: T): boolean => {
    return option.id === val.id;
  };

  /**
   * normalizeDigits
   * Converts Persian (۰-۹) and Arabic-Indic (٠-٩) numerals to English (0-9).
   * This ensures search works when users type Farsi numbers.
   */
  const normalizeDigits = (text: string): string => {
    if (!text) return '';
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      // Persian digits U+06F0..U+06F9
      if (code >= 0x06F0 && code <= 0x06F9) {
        out += String(code - 0x06F0);
        continue;
      }
      // Arabic-Indic digits U+0660..U+0669
      if (code >= 0x0660 && code <= 0x0669) {
        out += String(code - 0x0660);
        continue;
      }
      out += ch;
    }
    return out;
  };

  /**
   * defaultFilterOptions
   * Filters options by matching input text against both `code` and `name`.
   * Normalizes digits so Farsi/Arabic numerals match English digit codes.
   */
  const defaultFilterOptions = (opts: T[], state: FilterOptionsState<T>): T[] => {
    const rawInput = state.inputValue || '';
    const input = normalizeDigits(rawInput).toLowerCase();
    if (!input) return opts;
    return opts.filter((o) => {
      const oo: any = o as any;
      const name = normalizeDigits(String(oo.name || '')).toLowerCase();
      const code = normalizeDigits(String(oo.code || '')).toLowerCase();
      return name.includes(input) || code.includes(input);
    });
  };

  /**
   * Internal input value state used to display only the code when a value is selected.
   * When the user types, we follow their text; when a selection changes, we derive code.
   */
  const [inputValueInternal, setInputValueInternal] = useState<string>(getOptionCode(value));

  useEffect(() => {
    setInputValueInternal(getOptionCode(value));
  }, [value]);

  const computedInputValue = inputValue ?? inputValueInternal;

  // Handle Enter key to auto-select when only one option remains after filtering
  const handleInputKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (evt) => {
    if (!autoSelectSingleOnEnter || disabled) return;
    if (evt.key !== 'Enter') return;

    const filterFn = filterOptions || defaultFilterOptions;
    const filtered = filterFn(options, { inputValue: computedInputValue } as FilterOptionsState<T>);

    if (filtered.length === 1) {
      evt.preventDefault();
      evt.stopPropagation();
      const selected = filtered[0];
      onChange(selected);
      setInputValueInternal(getOptionCode(selected));
    }
  };

  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, newValue) => {
        onChange(newValue);
        // Ensure input always reflects only the code of the selected value
        setInputValueInternal(getOptionCode(newValue));
      }}
      onInputChange={(event, newInputValue, reason) => {
        // Prevent MUI from overwriting the input with name (title) on blur/reset
        if (reason === 'reset' || reason === 'blur' || reason === 'clear') {
          const codeOnly = getOptionCode(value);
          setInputValueInternal(codeOnly);
          onInputChange?.(codeOnly);
        } else {
          setInputValueInternal(newInputValue);
          onInputChange?.(newInputValue);
        }
      }}
      inputValue={computedInputValue}
      getOptionLabel={getOptionLabel || defaultGetOptionLabel}
      isOptionEqualToValue={isOptionEqualToValue || defaultIsOptionEqualToValue}
      disabled={disabled}
      loading={loading}
      className={className}
      size={size}
      fullWidth={fullWidth}
      openOnFocus={openOnFocus}
      filterOptions={filterOptions || defaultFilterOptions}
      renderOption={
        renderOption || ((props, option) => {
          const codeText = getOptionCode(option);
          const nameText = (getOptionLabel || defaultGetOptionLabel)(option);
          return (
            <li {...props} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontFamily: 'monospace' }}>{codeText}</span>
              <span style={{ color: '#6b7280' }}>{nameText}</span>
            </li>
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          error={!!error}
          helperText={error || helperText}
          dir={isRTL ? 'rtl' : 'ltr'}
          size={size}
          onKeyDown={(evt) => {
            handleInputKeyDown(evt as React.KeyboardEvent<HTMLInputElement>);
            // Preserve MUI Autocomplete's internal key handling
            (params.inputProps as any)?.onKeyDown?.(evt);
          }}
          InputProps={{
            ...params.InputProps,
            style: {
              textAlign: isRTL ? 'right' : 'left',
              height: size === 'small' ? '40px' : '48px',
            },
          }}
          sx={{
            '& .MuiInputBase-root': {
              minHeight: size === 'small' ? '40px' : '48px',
              height: size === 'small' ? '40px' : '48px',
            },
            '& .MuiInputBase-input': {
              padding: size === 'small' ? '8px 12px' : '12px 14px',
            },
            '& .MuiInputLabel-root': {
              transform: size === 'small'
                ? 'translate(12px, 12px) scale(1)'
                : 'translate(14px, 16px) scale(1)',
            },
            '& .MuiInputLabel-shrink': {
              transform: size === 'small'
                ? 'translate(12px, -9px) scale(0.75)'
                : 'translate(14px, -9px) scale(0.75)',
            },
          }}
        />
      )}
      // Handle RTL layout for dropdown panel
      componentsProps={{
        paper: {
          style: {
            direction: isRTL ? 'rtl' : 'ltr',
            // Make dropdown wider to improve readability of code and title
            minWidth: 480,
          },
        },
      }}
    />
  );
};

export default SearchableSelect;