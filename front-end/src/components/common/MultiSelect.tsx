/**
 * MultiSelect
 * - Reusable MUI-based multi-select with chip rendering, similar to Admin.
 * - Accepts a list of options, selected values, and emits changes as string array.
 */
import React from 'react';
import {
  FormControl,
  InputLabel,
  Select,
  OutlinedInput,
  MenuItem,
  Chip,
  Box,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';

interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiSelectOption[];
  minWidth?: number;
  placeholder?: string;
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
}) => {
  /**
   * Handle change event from MUI Select (multiple mode).
   * Converts string or string[] into string[] for the consumer.
   */
  const handleChange = (event: SelectChangeEvent<string[]>) => {
    const selectedValue = event.target.value as unknown as string | string[];
    onChange(typeof selectedValue === 'string' ? selectedValue.split(',') : (selectedValue || []));
  };

  return (
    <FormControl sx={{ minWidth }}>
      <InputLabel>{label}</InputLabel>
      <Select
        multiple
        value={value}
        onChange={handleChange}
        input={<OutlinedInput label={label} />}
        renderValue={(selected) => (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {(selected as string[]).map((selectedValue) => {
              const option = options.find((opt) => opt.value === selectedValue);
              return (
                <Chip key={selectedValue} label={option?.label || selectedValue} size="small" />
              );
            })}
          </Box>
        )}
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
    </FormControl>
  );
};

export type { MultiSelectOption };
export default MultiSelect;