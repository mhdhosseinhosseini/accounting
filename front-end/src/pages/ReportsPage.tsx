/**
 * ReportsPage
 * - Displays Trial Balance, Balance Sheet, and Profit & Loss.
 * - Provides date range and fiscal year filters.
 */
import React, { useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import JalaliDatePicker from '../components/JalaliDatePicker';

interface TrialBalanceItem {
  accountId: number;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

interface BalanceSheetSummary { assets: number; liabilities: number; equity: number; }
interface ProfitLossSummary { revenue: number; expense: number; profit: number; }

export const ReportsPage: React.FC = () => {
  const { t } = useTranslation();
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [fiscalYearId, setFiscalYearId] = useState<number | ''>('');

  const [tb, setTb] = useState<TrialBalanceItem[]>([]);
  const [bs, setBs] = useState<BalanceSheetSummary | null>(null);
  const [pl, setPl] = useState<ProfitLossSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  /**
   * Fetch Trial Balance.
   */
  async function fetchTrialBalance() {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/reports/trial-balance`, {
        params: { fromDate, toDate, fiscalYearId }
      });
      setTb(res.data.items || res.data || []);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Fetch Balance Sheet.
   */
  async function fetchBalanceSheet() {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/reports/balance-sheet`, {
        params: { fromDate, toDate, fiscalYearId }
      });
      setBs(res.data.summary || res.data || null);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Fetch Profit & Loss.
   */
  async function fetchProfitLoss() {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/reports/profit-loss`, {
        params: { fromDate, toDate, fiscalYearId }
      });
      setPl(res.data.summary || res.data || null);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">{t('pages.reports.title', 'Reports')}</h1>

        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-2">{t('pages.reports.filters', 'Filters')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm mb-1">{t('fields.fromDate', 'From Date')}</label>
              <JalaliDatePicker value={fromDate} onChange={setFromDate} />
            </div>
            <div>
              <label className="block text-sm mb-1">{t('fields.toDate', 'To Date')}</label>
              <JalaliDatePicker value={toDate} onChange={setToDate} />
            </div>
            <div>
              <label className="block text-sm mb-1">{t('fields.fiscalYearId', 'Fiscal Year ID')}</label>
              <input
                type="number"
                value={fiscalYearId}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setFiscalYearId(Number.isNaN(v) ? '' : v);
                }}
                className="border rounded px-3 py-2"
                placeholder={t('fields.fiscalYearId', 'Fiscal Year ID')}
              />
            </div>
          </div>
          {error && <p className="text-red-600 mt-2">{error}</p>}
        </section>

        <section className="bg-white rounded shadow p-4 mb-6">
          <div className="flex gap-2">
            <button onClick={fetchTrialBalance} className="bg-green-700 text-white rounded px-4 py-2">
              {t('pages.reports.trialBalance', 'Trial Balance')}
            </button>
            <button onClick={fetchBalanceSheet} className="bg-green-700 text-white rounded px-4 py-2">
              {t('pages.reports.balanceSheet', 'Balance Sheet')}
            </button>
            <button onClick={fetchProfitLoss} className="bg-green-700 text-white rounded px-4 py-2">
              {t('pages.reports.profitLoss', 'Profit & Loss')}
            </button>
          </div>
          {loading && <p className="mt-2">{t('common.loading', 'Loading...')}</p>}
        </section>

        {tb.length > 0 && (
          <section className="bg-white rounded shadow p-4 mb-6">
            <h2 className="text-lg font-medium mb-2">{t('pages.reports.trialBalance', 'Trial Balance')}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left rtl:text-right">
                  <th className="py-2">{t('fields.code', 'Code')}</th>
                  <th className="py-2">{t('fields.name', 'Name')}</th>
                  <th className="py-2">{t('fields.debit', 'Debit')}</th>
                  <th className="py-2">{t('fields.credit', 'Credit')}</th>
                </tr>
              </thead>
              <tbody>
                {tb.map((row) => (
                  <tr key={row.accountId} className="border-t">
                    <td className="py-2 font-mono">{row.accountCode}</td>
                    <td className="py-2">{row.accountName}</td>
                    <td className="py-2">{row.debit}</td>
                    <td className="py-2">{row.credit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {bs && (
          <section className="bg-white rounded shadow p-4 mb-6">
            <h2 className="text-lg font-medium mb-2">{t('pages.reports.balanceSheet', 'Balance Sheet')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="text-sm text-gray-600">{t('fields.assets', 'Assets')}</div>
                <div className="text-lg">{bs.assets}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">{t('fields.liabilities', 'Liabilities')}</div>
                <div className="text-lg">{bs.liabilities}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">{t('fields.equity', 'Equity')}</div>
                <div className="text-lg">{bs.equity}</div>
              </div>
            </div>
          </section>
        )}

        {pl && (
          <section className="bg-white rounded shadow p-4 mb-6">
            <h2 className="text-lg font-medium mb-2">{t('pages.reports.profitLoss', 'Profit & Loss')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="text-sm text-gray-600">{t('fields.revenue', 'Revenue')}</div>
                <div className="text-lg">{pl.revenue}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">{t('fields.expense', 'Expense')}</div>
                <div className="text-lg">{pl.expense}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600">{t('fields.profit', 'Profit')}</div>
                <div className="text-lg">{pl.profit}</div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default ReportsPage;