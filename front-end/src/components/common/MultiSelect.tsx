/**
 * MultiSelect
 * - Reusable MUI-based multi-select with chip rendering.
 * - Supports deletable chips and searchable dropdown.
 * - Implements floating placeholder label behavior similar to MUI.
 */
import React, { useId, useMemo, useState } from 'react';
import {
  FormControl,
  InputLabel,
  Select,
  OutlinedInput,
  MenuItem,
  Chip,
  Box,
  Autocomplete,
  TextField,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';

interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label?: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiSelectOption[];
  minWidth?: number;
  placeholder?: string;
  size?: 'small' | 'medium';
  hideLabel?: boolean;
  fullWidth?: boolean;
  searchable?: boolean;
  error?: boolean;
}

/**
 * Handles selection changes and normalizes to string array for parent state.
 */
const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  value,
  onChange,
  options,
  minWidth = 150,
  placeholder,
  size = 'medium',
  hideLabel = false,
  fullWidth = false,
  searchable = false,
  error = false,
}) => {
  /**
   * Floating label state management
   * Tracks focus and whether any value is selected to control label shrink.
   */
  const [focused, setFocused] = useState(false);
  const inputId = useId();
  const labelId = `${inputId}-label`;
  const hasValue = (value || []).length > 0;
  const labelText = useMemo(() => {
    return (label && !hideLabel ? label : placeholder) || '';
  }, [label, hideLabel, placeholder]);

  /**
   * handleChange
   * Handle change event from MUI Select (multiple mode).
   * Converts string or string[] into string[] for the consumer.
   */
  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const selectedValue = event.target.value as unknown as string | string[];
    onChange(typeof selectedValue === 'string' ? selectedValue.split(',') : (selectedValue || []));
  };

  /**
   * removeValue
   * Removes a single selected value (used by Chip delete action).
   */
  const removeValue = (val: string) => {
    onChange((value || []).filter((v) => v !== val));
  };

  return (
    <FormControl sx={{ minWidth, width: '100%' }} size={size} fullWidth={fullWidth} error={error} variant="outlined">
      {!searchable && (
        <>
          {!!labelText && (
            <InputLabel
              id={labelId}
              htmlFor={inputId}
              shrink={focused || hasValue}
              sx={{
                transition: 'transform 240ms ease, color 240ms ease, top 240ms ease',
                '&.Mui-focused': { color: (theme) => theme.palette.primary.main },
                '&.Mui-error': { color: (theme) => theme.palette.error.main },
              }}
            >
              {labelText}
            </InputLabel>
          )}
          <Select
            multiple
            value={value}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            input={<OutlinedInput id={inputId} label={labelText} size={size} />}
            labelId={labelId}
            renderValue={(selected) => {
              const sel = selected as string[];
              if (sel.length === 0) return '';
              return (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {sel.map((selectedValue) => {
                    const option = options.find((opt) => opt.value === selectedValue);
                    return (
                      <Chip
                        key={selectedValue}
                        label={option?.label || selectedValue}
                        size="small"
                        onDelete={() => removeValue(selectedValue)}
                      />
                    );
                  })}
                </Box>
              );
            }}
            displayEmpty={!!placeholder}
          >
            {placeholder && (
              <MenuItem disabled value="">
                <em>{placeholder}</em>
              </MenuItem>
            )}
            {options.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </Select>
        </>
      )}
      {searchable && (
        <Autocomplete
          multiple
          options={options}
          value={options.filter((opt) => (value || []).includes(opt.value))}
          getOptionLabel={(opt) => opt.label}
          filterSelectedOptions
          disableCloseOnSelect
          onChange={(_, newValue) => onChange(newValue.map((opt) => opt.value))}
          renderTags={(tagValue, getTagProps) =>
            tagValue.map((option, index) => (
              <Chip
                {...getTagProps({ index })}
                key={option.value}
                label={option.label}
                size="small"
                onDelete={() => removeValue(option.value)}
              />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              id={inputId}
              label={labelText}
              placeholder=""
              size={size}
              InputLabelProps={{
                shrink: focused || hasValue,
                sx: {
                  transition: 'transform 240ms ease, color 240ms ease, top 240ms ease',
                  '&.Mui-focused': { color: (theme) => theme.palette.primary.main },
                  '&.Mui-error': { color: (theme) => theme.palette.error.main },
                },
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              error={error}
            />
          )}
          sx={{ width: '100%' }}
        />
      )}
    </FormControl>
  );
};

export type { MultiSelectOption };
export default MultiSelect;
