/**
 * Initializes i18next for the Accounting frontend with Farsi-first defaults.
 * Reads default language from `VITE_DEFAULT_LANG` and sets up basic catalogs.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import faCommon from './locales/fa/common.json';
import enCommon from './locales/en/common.json';

/**
 * Initialize the i18n instance.
 * This function should be called once during app bootstrap.
 */
export function initI18n(): void {
  const defaultLang = import.meta.env.VITE_DEFAULT_LANG || 'fa';

  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        fa: { common: faCommon },
        en: { common: enCommon },
      },
      ns: ['common'],
      defaultNS: 'common',
      fallbackLng: 'fa',
      lng: defaultLang,
      interpolation: { escapeValue: false },
      detection: {
        order: ['querystring', 'localStorage', 'navigator'],
        caches: ['localStorage'],
      },
    })
    .then(() => {
      /**
       * Update document language and direction when i18n is initialized.
       * Ensures RTL (`fa`) and LTR (`en`) are handled for layout.
       */
      const lang = i18n.language || defaultLang;
      const dir = lang === 'fa' ? 'rtl' : 'ltr';
      document.documentElement.lang = lang;
      document.documentElement.dir = dir;
    });

  /**
   * React to language changes at runtime to update `lang` and `dir` attributes.
   */
  i18n.on('languageChanged', (lang: string) => {
    const dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  });
}