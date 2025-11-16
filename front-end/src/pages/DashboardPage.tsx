/**
 * DashboardPage
 * - Simple landing for authenticated users.
 * - Shows backend health message with i18n and RTL.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import { updateDocLangDir, i18n, Lang } from '../i18n';

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

const DashboardPage: React.FC = () => {
  const { t } = useTranslation();
  const [healthMsg, setHealthMsg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  /**
   * Subscribe to language changes: set RTL/LTR, persist lang, and refetch health.
   * IMPORTANT: Avoid calling `i18n.changeLanguage` here to prevent recursion.
   */
  useEffect(() => {
    const handleLang = (lang: string) => {
      const l = (lang || 'fa') as Lang;
      // Update document attributes only; do not change i18n language here.
      updateDocLangDir(l);
      try { localStorage.setItem('lang', l); } catch { /* noop */ }
      fetchHealth(l)
        .then((data) => setHealthMsg(data.message))
        .catch(() => setError(t('fetch.error', 'Failed to fetch data')))
        .finally(() => setLoading(false));
    };
    // Initialize once on mount
    handleLang((i18n.language || 'fa') as Lang);
    // Subscribe to future language changes
    i18n.on('languageChanged', handleLang);
    return () => { i18n.off('languageChanged', handleLang); };
  }, [t]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">{t('navigation.dashboard', 'Dashboard')}</h1>
        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('health.title', 'Service Health')}</h2>
          {loading && <p className="text-gray-500">{t('common.loading', 'Loading...')}</p>}
          {!loading && error && <p className="text-red-600">{error}</p>}
          {!loading && !error && (
            <p className="text-green-700">{healthMsg || t('health.message', 'System is healthy')}</p>
          )}
        </section>
      </main>
    </div>
  );
};

export default DashboardPage;