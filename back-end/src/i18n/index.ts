/**
 * i18n helper for backend responses.
 * Supports English (en) and Farsi (fa) using simple dictionaries.
 */
export type Lang = 'en' | 'fa';

const dict = {
  en: {
    'health.ok': 'Accounting service is healthy',
    'fiscalYears.list': 'Fiscal years fetched',
    'journal.created': 'Journal draft created',
    'journal.posted': 'Journal posted successfully',
    'error.unbalanced': 'Journal is not balanced',
  },
  fa: {
    'health.ok': 'سرویس حسابداری سالم است',
    'fiscalYears.list': 'سال‌های مالی بازیابی شد',
    'journal.created': 'سند پیش‌نویس ایجاد شد',
    'journal.posted': 'سند با موفقیت پست شد',
    'error.unbalanced': 'سند حسابداری بالانس نیست',
  },
} as const;

/**
 * Translate a message key to the selected language.
 */
export function t(key: keyof typeof dict['en'], lang: Lang = 'en'): string {
  const selected = dict[lang] || dict.en;
  return selected[key] || key;
}