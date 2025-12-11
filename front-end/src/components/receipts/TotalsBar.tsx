/**
 * TotalsBar
 * Displays computed total amount for current receipt items.
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReceiptItem } from '../../types/receipts';

export interface TotalsBarProps {
  items: ReceiptItem[];
}

/**
 * formatAmountForLocale
 * Formats a numeric amount based on the active language.
 * - Uses Persian (Farsi) digits when language starts with 'fa'.
 * - Falls back to the browser default locale otherwise.
 */
function formatAmountForLocale(amount: number, lang: string): string {
  try {
    if (lang?.toLowerCase().startsWith('fa')) {
      return new Intl.NumberFormat('fa-IR').format(amount);
    }
    return new Intl.NumberFormat().format(amount);
  } catch {
    return amount.toString();
  }
}

/**
 * Calculates and renders the sum of amounts.
 */
/**
 * TotalsBar
 * Calculates the sum of receipt item amounts and renders it.
 * - Displays the total in a larger, bold style for emphasis.
 * - Shows amount in Farsi digits when the app language is Farsi.
 */
export const TotalsBar: React.FC<TotalsBarProps> = ({ items }) => {
  const { t, i18n } = useTranslation();
  const total = useMemo(() => (items || []).reduce((sum, it) => sum + Number(it.amount || 0), 0), [items]);
  return (
    <div className="flex justify-end py-3 text-lg font-bold text-gray-800">
      <span className="mr-3">{t('pages.receipts.totalAmount', 'Total')}</span>
      <span dir="auto" aria-label={t('pages.receipts.total', 'Total')}>
        {formatAmountForLocale(total, i18n.language)}
      </span>
    </div>
  );
};

export default TotalsBar;