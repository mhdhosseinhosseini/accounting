/**
 * Home page showing backend health with i18n and RTL.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import config from '../config';
import Navbar from '../components/Navbar';
import { i18n, Lang, updateDocLangDir } from '../i18n';

/**
 * Fetch health info from backend using Accept-Language header.
 * @param lang - current language code
 */
async function fetchHealth(lang: Lang): Promise<{ status: string; message: string }> {
  const response = await axios.get(`${config.API_ENDPOINTS.base}/health`, {
    headers: { 'Accept-Language': lang }
  });
  return response.data;
}

export const Home: React.FC = () => {
  const { t } = useTranslation();
  const [healthMsg, setHealthMsg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  /**
   * Subscribe to language changes: update RTL/LTR, persist lang, and refetch health.
   * IMPORTANT: Do NOT call `i18n.changeLanguage` here to avoid recursion;
   * this handler is triggered by `languageChanged` already.
   */
  useEffect(() => {
    const handleLang = (lang: string) => {
      const l = (lang || 'fa') as Lang;
      // Only update document attributes; don't change language again.
      updateDocLangDir(l);
      try { localStorage.setItem('lang', l); } catch { /* noop */ }
      fetchHealth(l)
        .then((data) => setHealthMsg(data.message))
        .catch(() => setError(t('fetch.error', 'Failed to fetch data')))
        .finally(() => setLoading(false));
    };

    // Run once on mount with current language
    handleLang((i18n.language || 'fa') as Lang);

    // Subscribe to future language changes
    i18n.on('languageChanged', handleLang);
    return () => {
      i18n.off('languageChanged', handleLang);
    };
  }, [t]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 py-6">
        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('health.title', 'System Health')}</h2>
          {loading && <p className="text-gray-500">Loading...</p>}
          {!loading && error && <p className="text-red-600">{error}</p>}
          {!loading && !error && (
            <p className="text-green-700">{healthMsg || t('health.message', 'System is healthy')}</p>
          )}
        </section>
      </main>
    </div>
  );
};