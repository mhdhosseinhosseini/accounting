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
  /** Controls the text displayed in the input when a value is selected */
  inputDisplayMode?: 'code' | 'label';
  /** Text to show when there are no options (translatable) */
  noOptionsText?: string;
  /** Optional ref to the underlying input for programmatic focus */
  inputRef?: React.Ref<HTMLInputElement>;
  /**
   * Optional callback invoked immediately after a selection is committed
   * (via Enter auto-select or normal option selection). Useful for focusing
   * a follow-up control like a Save button.
   */
  onCommitted?: (value: T | null) => void;
  /** Allow creating a new option from free text */
  creatable?: boolean;
  /** Callback when user chooses to create a new option from input */
  onCreateOption?: (inputText: string) => void;
}

/**
 * SearchableSelect
 * Reusable component for searching and selecting items (codes, details, etc.).
 * - Supports RTL via i18n language check and adjusts field direction.
 * - Allows customizing option label and equality behavior.
 * - Displays only the code in the input field while showing code + title in dropdown.
 * - Keyboard UX: if filtering yields exactly one option, pressing Enter selects it.
 * - Creatable UX: when enabled, shows a "Create 'input'" option that selects the new value.
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
  inputDisplayMode = 'code',
  noOptionsText,
  inputRef,
  onCommitted,
  creatable = false,
  onCreateOption,
}: SearchableSelectProps<T>) => {
  const { i18n, t } = useTranslation();
  const isRTL = i18n.language === 'fa';

  /**
   * defaultGetOptionLabel
   * Returns option.name or falls back to id string when no custom label is provided.
   */
  const defaultGetOptionLabel = (option: T): string => {
    return (option as any).name || String(option.id);
  };

  /**
   * getOptionDisplayText
   * Returns text shown inside the input. When `inputDisplayMode` is 'label',
   * uses the option's label; otherwise shows the code/id (default).
   */
  const getOptionDisplayText = (option: T | null): string => {
    if (!option) return '';
    if (inputDisplayMode === 'label') {
      return (getOptionLabel || defaultGetOptionLabel)(option);
    }
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
   * isNewOption
   * Helper to detect a synthetic "create new" option.
   */
  const isNewOption = (o: any): boolean => Boolean(o && o.__isNew__ === true);

  /**
   * mergedFilterOptions
   * Applies the provided or default filter, then injects a synthetic
   * "Create 'input'" option when `creatable` is enabled and the input
   * does not match an existing option by name.
   */
  const mergedFilterOptions = (opts: T[], state: FilterOptionsState<T>): T[] => {
    const fn = filterOptions || defaultFilterOptions;
    const filtered = fn(opts, state);
    if (!creatable) return filtered;
    const rawInput = String(state.inputValue || '').trim();
    if (!rawInput) return filtered;
    const normalized = normalizeDigits(rawInput).toLowerCase();
    const exists = opts.some((o) => normalizeDigits(String((o as any).name || '')).toLowerCase() === normalized);
    if (!exists) {
      const sentinel: any = { id: `__new__:${rawInput}`, name: rawInput, __isNew__: true };
      filtered.push(sentinel);
    }
    return filtered;
  };

  /**
   * Internal input value state used to display only the code when a value is selected.
   * When the user types, we follow their text; when a selection changes, we derive code.
   */
  const [inputValueInternal, setInputValueInternal] = useState<string>(getOptionDisplayText(value));

  /**
   * openInternal
   * Controls the Autocomplete popup visibility so we can close it programmatically
   * after Enter-based auto selection or any selection event.
   */
  const [openInternal, setOpenInternal] = useState<boolean>(false);

  useEffect(() => {
    setInputValueInternal(getOptionDisplayText(value));
  }, [value]);

  const computedInputValue = inputValue ?? inputValueInternal;

  // Handle Enter key to auto-select when only one option remains after filtering
  const handleInputKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (evt) => {
    if (!autoSelectSingleOnEnter || disabled) return;
    if (evt.key !== 'Enter') return;

    const filtered = mergedFilterOptions(options, { inputValue: computedInputValue } as FilterOptionsState<T>);

    if (filtered.length === 1) {
      evt.preventDefault();
      evt.stopPropagation();
      const selected = filtered[0] as any;
      if (creatable && isNewOption(selected)) {
        const text = String(selected.name || computedInputValue).trim();
        const created: any = { id: text, name: text };
        onChange(created);
        setInputValueInternal(getOptionDisplayText(created));
        setOpenInternal(false);
        onCommitted?.(created);
        onCreateOption?.(text);
      } else {
        onChange(selected);
        setInputValueInternal(getOptionDisplayText(selected));
        // Close dropdown after auto-select
        setOpenInternal(false);
        // Notify parent that selection is fully committed
        onCommitted?.(selected);
      }
    }
  };

  return (
    <Autocomplete
      options={options}
      value={value}
      onChange={(_, newValue) => {
        const nv: any = newValue as any;
        if (creatable && nv && isNewOption(nv)) {
          const text = String(nv.name || computedInputValue).trim();
          const created: any = { id: text, name: text };
          onChange(created);
          setInputValueInternal(getOptionDisplayText(created));
          setOpenInternal(false);
          onCommitted?.(created);
          onCreateOption?.(text);
          return;
        }
        onChange(newValue);
        // Ensure input reflects selected display mode (code or label)
        setInputValueInternal(getOptionDisplayText(newValue));
        // Close dropdown on any selection
        setOpenInternal(false);
        // Notify parent that selection is fully committed
        onCommitted?.(newValue);
      }}
      onInputChange={(event, newInputValue, reason) => {
        // Prevent MUI from overwriting the input with name (title) on blur/reset
        if (reason === 'reset' || reason === 'blur' || reason === 'clear') {
          const displayText = getOptionDisplayText(value);
          setInputValueInternal(displayText);
          onInputChange?.(displayText);
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
      filterOptions={mergedFilterOptions}
      noOptionsText={noOptionsText ?? t('common.noData', 'No data')}
      // Controlled open state to allow programmatic closing
      open={openInternal}
      onOpen={() => setOpenInternal(true)}
      onClose={() => setOpenInternal(false)}
      blurOnSelect
      renderOption={
        renderOption || ((props, option) => {
          const oo: any = option as any;
          if (creatable && isNewOption(oo)) {
            return (
              <li {...props} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', color: '#16a34a' }}>+</span>
                <span style={{ color: '#374151' }}>{t('actions.create', 'Create')} "{String(oo.name)}"</span>
              </li>
            );
          }
          // When no explicit `code` exists, do NOT fall back to showing `id`.
          // This keeps dropdowns clean (no internal IDs like GUIDs).
          const codeText = oo.code != null ? String(oo.code) : '';
          const nameText = (getOptionLabel || defaultGetOptionLabel)(option);
          return (
            <li {...props} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {codeText ? <span style={{ fontFamily: 'monospace' }}>{codeText}</span> : null}
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
          inputRef={inputRef}
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
        // Ensure dropdown appears above modals/dialogs like ConfirmDialog
        popper: {
          style: {
            zIndex: 3000,
          },
        },
      }}
    />
  );
};

export default SearchableSelect;