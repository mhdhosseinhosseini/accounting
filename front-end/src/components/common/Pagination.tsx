import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Props interface for the Pagination component
 */
interface PaginationProps {
  /** Current page number (1-based) */
  page: number;
  /** Number of items per page */
  pageSize: number;
  /** Total number of items */
  total: number;
  /** Callback when page changes */
  onPageChange: (page: number) => void;
  /** Callback when page size changes */
  onPageSizeChange: (pageSize: number) => void;
  /** Available page size options */
  pageSizeOptions?: number[];
  /** Whether to show page size selector */
  showPageSizeSelector?: boolean;
  /** Custom class name for styling */
  className?: string;
}

/**
 * Reusable Pagination component
 * Provides pagination controls with page navigation and page size selection
 * - Shows range (showing X to Y of results: Z) with i18n-aware numbers.
 * - Page size selector with common options.
 * - Prev/Next and a capped set of page number buttons.
 */
const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 15, 20, 25, 50],
  showPageSizeSelector = true,
  className = ''
}) => {
  const { t, i18n } = useTranslation();
  
  const isFa = i18n.language?.toLowerCase().startsWith('fa');
  
  /**
   * Format numbers based on current language
   */
  const formatNumber = (value: number | string): string => {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return String(value);
    return isFa ? new Intl.NumberFormat('fa-IR').format(num) : String(num);
  };

  // Calculate total pages
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 1;

  /**
   * Handle page size change and reset to first page
   */
  const handlePageSizeChange = (newPageSize: number) => {
    onPageSizeChange(newPageSize);
    onPageChange(1); // Reset to first page when changing page size
  };

  /**
   * Handle previous page navigation
   */
  const handlePreviousPage = () => {
    if (page > 1) {
      onPageChange(page - 1);
    }
  };

  /**
   * Handle next page navigation
   */
  const handleNextPage = () => {
    if (page < totalPages) {
      onPageChange(page + 1);
    }
  };

  /**
   * Navigate to the first page
   */
  const handleFirstPage = () => {
    if (page > 1) {
      onPageChange(1);
    }
  };

  /**
   * Navigate to the last page
   */
  const handleLastPage = () => {
    if (page < totalPages) {
      onPageChange(totalPages);
    }
  };

  return (
    <div className={`mt-4 flex items-center justify-between ${className}`}>
      <div className="flex items-center space-x-4">
        <div className="text-gray-700">
          {t('common.showing', 'Showing')} {formatNumber(((page - 1) * pageSize) + 1)} {t('common.to', 'to')} {formatNumber(Math.min(page * pageSize, total))} {t('common.of', 'of')} {t('common.totalRow', 'results')}:{formatNumber(total)}
        </div>
        
        {/* Page Size Selector */}
        {showPageSizeSelector && (
          <div className="flex items-center space-x-2">
            &emsp;&emsp;&emsp;
            <label className="text-gray-700">
              {isFa ? 'تعداد در صفحه:' : 'Items per page:'}
            </label>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1"
            >
              {pageSizeOptions.map(option => (
                <option key={option} value={option}>
                  {formatNumber(option)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      
      <div className="flex items-center space-x-2">
        <button
          onClick={handleFirstPage}
          disabled={page <= 1}
          className="px-2 py-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          title={isFa ? 'صفحه اول' : 'First page'}
          aria-label={isFa ? 'صفحه اول' : 'First page'}
        >
          {isFa ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
        <button
          onClick={handlePreviousPage}
          disabled={page <= 1}
          className="px-2 py-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          title={isFa ? 'قبلی' : 'Previous'}
          aria-label={isFa ? 'قبلی' : 'Previous'}
        >
          {isFa ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        
        <div className="flex items-center space-x-1">
          {/* Show page numbers */}
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let pageNum;
            if (totalPages <= 5) {
              pageNum = i + 1;
            } else if (page <= 3) {
              pageNum = i + 1;
            } else if (page >= totalPages - 2) {
              pageNum = totalPages - 4 + i;
            } else {
              pageNum = page - 2 + i;
            }
            
            return (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                className={`px-3 py-1 rounded ${
                  page === pageNum
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {formatNumber(pageNum)}
              </button>
            );
          })}
        </div>
        
        <button
          onClick={handleNextPage}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          title={isFa ? 'بعدی' : 'Next'}
          aria-label={isFa ? 'بعدی' : 'Next'}
        >
          {isFa ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <button
          onClick={handleLastPage}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          title={isFa ? 'صفحه آخر' : 'Last page'}
          aria-label={isFa ? 'صفحه آخر' : 'Last page'}
        >
          {isFa ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
};

export default Pagination;
