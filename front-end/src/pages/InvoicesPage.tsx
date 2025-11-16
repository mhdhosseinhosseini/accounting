/**
 * InvoicesPage
 * - Lists invoices and provides post action.
 * - Uses JalaliDatePicker where needed for filters.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';

interface Invoice {
  id: number;
  date: string;
  status?: string;
  total?: number;
}

export const InvoicesPage: React.FC = () => {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  /**
   * Fetch invoices list from backend.
   */
  async function fetchInvoices() {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/invoices`);
      setInvoices(res.data.items || res.data || []);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Post invoice (finalize) with optional inventory linkage.
   */
  async function postInvoice(id: number) {
    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/invoices/${id}/post`, { withInventory: true });
      await fetchInvoices();
    } catch (e) {
      // noop
    }
  }

  useEffect(() => {
    fetchInvoices();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">{t('pages.invoices.title', 'Invoices')}</h1>
        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.invoices.list', 'Invoices List')}</h2>
          {loading && <p>{t('common.loading', 'Loading...')}</p>}
          {!loading && invoices.length === 0 && <p>{t('common.noData', 'No data')}</p>}
          {!loading && invoices.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left rtl:text-right">
                  <th className="py-2">{t('fields.id', 'ID')}</th>
                  <th className="py-2">{t('fields.date', 'Date')}</th>
                  <th className="py-2">{t('fields.status', 'Status')}</th>
                  <th className="py-2">{t('fields.total', 'Total')}</th>
                  <th className="py-2">{t('actions.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t">
                    <td className="py-2">{inv.id}</td>
                    <td className="py-2">{inv.date}</td>
                    <td className="py-2">{inv.status || '-'}</td>
                    <td className="py-2">{inv.total ?? '-'}</td>
                    <td className="py-2">
                      <button className="bg-blue-600 text-white rounded px-3 py-1" onClick={() => postInvoice(inv.id)}>
                        {t('pages.invoices.post', 'Post')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </section>
      </main>
    </div>
  );
};

export default InvoicesPage;