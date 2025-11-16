/**
 * FiscalYearsPage
 * - Lists fiscal years and allows creating a new fiscal year.
 * - Uses JalaliDatePicker for start/end date with RTL and i18n.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import JalaliDatePicker from '../components/JalaliDatePicker';

interface FiscalYear {
  id: number;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  isClosed?: boolean;
}

const FiscalYearsPage: React.FC = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const [name, setName] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  /**
   * Load fiscal years on mount.
   */
  useEffect(() => {
    fetchFiscalYears();
  }, []);

  /**
   * Fetch list of fiscal years from backend.
   */
  async function fetchFiscalYears() {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/fiscal-years`);
      setItems(res.data.items || res.data || []);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Create a new fiscal year via backend.
   */
  async function createFiscalYear() {
    if (!name || !startDate || !endDate) {
      setError(t('validation.missingFields', 'Please fill all fields'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${config.API_ENDPOINTS.base}/v1/fiscal-years`, {
        name, startDate, endDate,
      });
      const created = res.data.item || res.data;
      setItems((prev) => [created, ...prev]);
      setName('');
      setStartDate('');
      setEndDate('');
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">{t('pages.fiscalYears.title', 'Fiscal Years')}</h1>

        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-2">{t('pages.fiscalYears.create', 'Create Fiscal Year')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm mb-1">{t('fields.name', 'Name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border rounded px-3 py-2 w-full"
                placeholder={t('fields.name', 'Name')}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">{t('fields.startDate', 'Start Date')}</label>
              <JalaliDatePicker value={startDate} onChange={setStartDate} />
            </div>
            <div>
              <label className="block text-sm mb-1">{t('fields.endDate', 'End Date')}</label>
              <JalaliDatePicker value={endDate} onChange={setEndDate} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={createFiscalYear} className="bg-green-700 text-white rounded px-4 py-2">
              {t('actions.create', 'Create')}
            </button>
            {loading && <span className="text-gray-600">{t('common.loading', 'Loading...')}</span>}
          </div>
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </section>

        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.fiscalYears.list', 'Fiscal Years List')}</h2>
          {loading && <p className="text-gray-600">{t('common.loading', 'Loading...')}</p>}
          {!loading && items.length === 0 && (
            <p className="text-gray-600">{t('common.noData', 'No data')}</p>
          )}
          {!loading && items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left rtl:text-right">
                  <th className="py-2">{t('fields.name', 'Name')}</th>
                  <th className="py-2">{t('fields.startDate', 'Start Date')}</th>
                  <th className="py-2">{t('fields.endDate', 'End Date')}</th>
                  <th className="py-2">{t('fields.status', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((fy) => (
                  <tr key={fy.id} className="border-t">
                    <td className="py-2">{fy.name}</td>
                    <td className="py-2 font-mono">{fy.startDate}</td>
                    <td className="py-2 font-mono">{fy.endDate}</td>
                    <td className="py-2">{fy.isClosed ? t('fields.closed', 'Closed') : t('fields.open', 'Open')}</td>
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

export default FiscalYearsPage;