/**
 * i18n configuration using i18next for the accounting project.
 * Provides translation functionality similar to the admin project.
 */
import i18n, { TOptions } from 'i18next';
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

// Sync document attributes on init and language changes
updateDocLangDir((i18n.language as Lang) || 'fa');
i18n.on('languageChanged', (lang: string) => {
  updateDocLangDir((lang as Lang) || 'fa');
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
export function t(key: string, fallback?: string, options?: TOptions): string {
  const translation = i18n.t(key, { ...options, defaultValue: fallback }) as string;
  return translation;
}

/**
 * Set document direction and lang attributes without changing i18n language.
 */
export function updateDocLangDir(lang: Lang) {
  const dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
}

/**
 * Change i18n language and update document attributes.
 */
export function applyDir(lang: Lang) {
  updateDocLangDir(lang);
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