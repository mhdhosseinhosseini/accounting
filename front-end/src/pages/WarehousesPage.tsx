/**
 * WarehousesPage
 * - Lists warehouses and provides a simple create form.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';

interface Warehouse {
  id: number;
  name: string;
  code?: string;
}

export const WarehousesPage: React.FC = () => {
  const { t } = useTranslation();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [form, setForm] = useState<{ name: string; code?: string }>({ name: '', code: '' });
  const [creating, setCreating] = useState<boolean>(false);

  /**
   * Fetch warehouses list.
   */
  async function fetchWarehouses() {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/warehouses`);
      setWarehouses(res.data.items || res.data || []);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Create a warehouse.
   */
  async function createWarehouse(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/warehouses`, form);
      setForm({ name: '', code: '' });
      await fetchWarehouses();
    } catch (e) {
      setError(t('common.error', 'Error'));
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    fetchWarehouses();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">{t('pages.warehouses.title', 'Warehouses')}</h1>

        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-2">{t('pages.warehouses.create', 'Create Warehouse')}</h2>
          <form onSubmit={createWarehouse} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('fields.name', 'Name')}
              className="border rounded px-3 py-2"
            />
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder={t('fields.code', 'Code')}
              className="border rounded px-3 py-2"
            />
            <button type="submit" disabled={creating} className="bg-green-700 text-white rounded px-4 py-2">
              {creating ? t('actions.saving', 'Saving...') : t('actions.create', 'Create')}
            </button>
          </form>
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </section>

        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.warehouses.list', 'Warehouses List')}</h2>
          {loading && <p>{t('common.loading', 'Loading...')}</p>}
          {!loading && warehouses.length === 0 && <p>{t('common.noData', 'No data')}</p>}
          {!loading && warehouses.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left rtl:text-right">
                  <th className="py-2">{t('fields.id', 'ID')}</th>
                  <th className="py-2">{t('fields.name', 'Name')}</th>
                  <th className="py-2">{t('fields.code', 'Code')}</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) => (
                  <tr key={w.id} className="border-t">
                    <td className="py-2">{w.id}</td>
                    <td className="py-2">{w.name}</td>
                    <td className="py-2">{w.code || '-'}</td>
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

export default WarehousesPage;