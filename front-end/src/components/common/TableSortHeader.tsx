import React from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface TableSortHeaderProps<T extends string> {
  label: string;
  sortKey: T;
  currentSortBy: T | null;
  currentSortDir: 'asc' | 'desc';
  onSort: (key: T) => void;
  className?: string;
  allowedSortKeys?: T[];
  headerAlign?: string;
}

/**
 * TableSortHeader
 * Renders a sortable table header cell with an ascending/descending icon.
 * - Uses `currentSortBy` and `currentSortDir` to show active state and icon.
 * - Calls `onSort(sortKey)` when clicked.
 * - Respects `allowedSortKeys` to disable sorting for specific headers.
 * - Adjusts icon spacing based on Farsi/English direction.
 * - Visuals: header text is slightly larger and gray by default.
 */
function TableSortHeader<T extends string>({
  label,
  sortKey,
  currentSortBy,
  currentSortDir,
  onSort,
  className = '',
  allowedSortKeys,
  headerAlign = 'text-left'
}: TableSortHeaderProps<T>) {
  const { i18n } = useTranslation();
  
  const isActive = currentSortBy === sortKey;
  const canSort = !allowedSortKeys || allowedSortKeys.includes(sortKey);
  
  if (!canSort) {
    return (
      <th className={`px-4 py-3 ${headerAlign} text-base font-medium text-gray-700 uppercase tracking-wider ${className}`}>
        {label}
      </th>
    );
  }
  
  const SortIcon = currentSortDir === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow;
  
  return (
    <th
      scope="col"
      className={`px-4 py-3 ${headerAlign} text-base font-medium text-gray-700 uppercase tracking-wider ${className}`}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={`w-full ${headerAlign} inline-flex items-center ${headerAlign === 'text-right' ? 'justify-end' : 'justify-start'} group ${
          isActive ? 'text-green-700' : 'text-gray-600'
        } hover:text-green-700 cursor-pointer`}
      >
        <span>{label}</span>
        {isActive && (
          <SortIcon className={`${i18n.language === 'fa' ? 'mr-1' : 'ml-1'} h-4 w-4 opacity-80`} />
        )}
      </button>
    </th>
  );
}

export default TableSortHeader;