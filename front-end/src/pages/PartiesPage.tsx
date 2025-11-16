/**
 * PartiesPage
 * - Lists parties and provides a simple create form.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';

interface Party {
  id: number;
  name: string;
  mobileNumber?: string;
}

export const PartiesPage: React.FC = () => {
  const { t } = useTranslation();
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [form, setForm] = useState<{ name: string; mobileNumber?: string }>({ name: '', mobileNumber: '' });
  const [creating, setCreating] = useState<boolean>(false);

  /**
   * Fetch parties list.
   */
  async function fetchParties() {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/parties`);
      setParties(res.data.items || res.data || []);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Create a new party.
   */
  async function createParty(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/parties`, form);
      setForm({ name: '', mobileNumber: '' });
      await fetchParties();
    } catch (e) {
      setError(t('common.error', 'Error'));
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    fetchParties();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">{t('pages.parties.title', 'Parties')}</h1>

        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-2">{t('pages.parties.create', 'Create Party')}</h2>
          <form onSubmit={createParty} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('fields.name', 'Name')}
              className="border rounded px-3 py-2"
            />
            <input
              value={form.mobileNumber}
              onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })}
              placeholder={t('fields.mobileNumber', 'Mobile Number')}
              className="border rounded px-3 py-2"
            />
            <button type="submit" disabled={creating} className="bg-green-700 text-white rounded px-4 py-2">
              {creating ? t('actions.saving', 'Saving...') : t('actions.create', 'Create')}
            </button>
          </form>
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </section>

        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.parties.list', 'Parties List')}</h2>
          {loading && <p>{t('common.loading', 'Loading...')}</p>}
          {!loading && parties.length === 0 && <p>{t('common.noData', 'No data')}</p>}
          {!loading && parties.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left rtl:text-right">
                  <th className="py-2">{t('fields.id', 'ID')}</th>
                  <th className="py-2">{t('fields.name', 'Name')}</th>
                  <th className="py-2">{t('fields.mobileNumber', 'Mobile Number')}</th>
                </tr>
              </thead>
              <tbody>
                {parties.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-2">{p.id}</td>
                    <td className="py-2">{p.name}</td>
                    <td className="py-2">{p.mobileNumber || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
};

export default PartiesPage;