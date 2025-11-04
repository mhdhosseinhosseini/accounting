/**
 * i18n configuration using i18next for the accounting project.
 * Provides translation functionality similar to the admin project.
 */
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import fa from './locales/fa.json';

export type Lang = 'fa' | 'en';

// Initialize i18next
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fa: { translation: fa }
    },
    lng: 'fa', // Default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage']
    }
  });

/**
 * Get initial language - defaults to Farsi.
 */
export function getInitialLang(): Lang {
  return 'fa';
}

/**
 * Translate a key with fallback English text (similar to admin project).
 * @param key - Translation key (e.g., 'common.save')
 * @param fallback - Fallback English text (e.g., 'Save')
 * @param options - Optional interpolation options
 */
export function t(key: string, fallback?: string, options?: any): string {
  const translation = i18n.t(key, options) as string;
  // If translation is the same as key (not found) and we have a fallback, use fallback
  if (translation === key && fallback) {
    return fallback;
  }
  return translation;
}

/**
 * Set document direction per language.
 */
export function applyDir(lang: Lang) {
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
  
  // Update i18next language
  i18n.changeLanguage(lang);
}

/**
 * Get current language from i18next.
 */
export function getCurrentLang(): Lang {
  return (i18n.language || getInitialLang()) as Lang;
}

// Export i18n instance and useTranslation hook for components
export { i18n, useTranslation };
export default i18n;