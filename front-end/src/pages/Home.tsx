/**
 * Home page showing backend health with i18n and RTL.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import config from '../config';
import Navbar from '../components/Navbar';
import { applyDir, t, i18n, Lang } from '../i18n';

/**
 * Fetch health info from backend using Accept-Language header.
 */
async function fetchHealth(lang: Lang): Promise<{ status: string; message: string }> {
  const response = await axios.get(`${config.API_ENDPOINTS.base}/health`, {
    headers: { 'Accept-Language': lang }
  });
  return response.data;
}

export const Home: React.FC = () => {
  const [healthMsg, setHealthMsg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  // Apply direction and sync with localStorage when language changes
  useEffect(() => {
    const currentLang = (i18n.language || 'fa') as Lang;
    applyDir(currentLang);
    try { localStorage.setItem('lang', currentLang); } catch {}
  }, [i18n.language]);

  // Fetch health data when language changes
  useEffect(() => {
    const currentLang = (i18n.language || 'fa') as Lang;
    fetchHealth(currentLang)
      .then((data) => setHealthMsg(data.message))
      .catch(() => setError(t('fetch.error', 'Failed to fetch data')))
      .finally(() => setLoading(false));
  }, [i18n.language]);

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