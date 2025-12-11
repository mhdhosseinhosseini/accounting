/**
 * JournalsPage
 * - Lists journals and provides a minimal create/post form.
 * - Uses JalaliDatePicker for date entry under Farsi locale.
 */
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import JalaliDatePicker from '../components/common/JalaliDatePicker';

/**
 * JournalItemForm
 * - Uses `codeId` referencing Codes table instead of Accounts.
 * - `codeId` is a string UUID supplied by backend.
 */
interface JournalItemForm {
  codeId: string;
  debit: number;
  credit: number;
}

interface Journal {
  id: number;
  date: string;
  description?: string;
  status?: string;
}

export const JournalsPage: React.FC = () => {
  const { t } = useTranslation();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);
  const [date, setDate] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [items, setItems] = useState<JournalItemForm[]>([
    { codeId: '', debit: 0, credit: 0 },
    { codeId: '', debit: 0, credit: 0 }
  ]);

  // Auto New York form state (no cost centers)
  const [nyFiscalYearId, setNyFiscalYearId] = useState<string>('');
  const [nyDate, setNyDate] = useState<string>('');
  const [nyAmount, setNyAmount] = useState<number>(0);
  const [nyDebitCodeId, setNyDebitCodeId] = useState<string>('');
  const [nyCreditCodeId, setNyCreditCodeId] = useState<string>('');
  const [nyDetailId, setNyDetailId] = useState<string>('');
  const [nyDescription, setNyDescription] = useState<string>('');
  const [nyCreating, setNyCreating] = useState<boolean>(false);
  const [nyMessage, setNyMessage] = useState<string>('');
  const [nyError, setNyError] = useState<string>('');

  /**
   * Fetch journals list from backend.
   */
  async function fetchJournals() {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/journals`);
      setJournals(res.data.items || res.data || []);
    } catch (e) {
      setError(t('fetch.error', 'Failed to fetch data'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * Create a new journal with items.
   * Maps frontend `codeId` to backend `code_id` for each item.
   */
  async function createJournal(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!date) {
      setError(t('validation.dateRequired', 'Please choose a date'));
      return;
    }
    const validItems = items.filter(it => (it.debit || it.credit) && !!it.codeId);
    if (validItems.length === 0) {
      setError(t('validation.noItems', 'No items to submit'));
      return;
    }
    setCreating(true);
    try {
      const res = await axios.post(`${config.API_ENDPOINTS.base}/v1/journals`, {
        date,
        description,
        items: validItems.map(it => ({ code_id: it.codeId, debit: it.debit, credit: it.credit }))
      });
      // Refresh list
      await fetchJournals();
      // Reset form
      setDate('');
      setDescription('');
      setItems([{ codeId: '', debit: 0, credit: 0 }, { codeId: '', debit: 0, credit: 0 }]);
    } catch (e) {
      setError(t('common.error', 'Error'));
    } finally {
      setCreating(false);
    }
  }

  /**
   * Create automatic New York journal (two-line, balanced).
   * Sends required IDs and amount; ignores cost centers per requirement.
   */
  async function createAutoNewYork(e: React.FormEvent) {
    e.preventDefault();
    setNyError('');
    setNyMessage('');
    if (!nyFiscalYearId || !nyDate || nyAmount <= 0 || !nyDebitCodeId || !nyCreditCodeId) {
      setNyError(t('validation.missingFields', 'Please fill all fields'));
      return;
    }
    setNyCreating(true);
    try {
      const body: any = {
        fiscal_year_id: nyFiscalYearId,
        date: nyDate,
        amount: nyAmount,
        debit_code_id: nyDebitCodeId,
        credit_code_id: nyCreditCodeId,
        description: nyDescription || undefined
      };
      if (nyDetailId) body.detail_id = nyDetailId;
      const res = await axios.post(`${config.API_ENDPOINTS.base}/v1/journals/auto/new-york`, body);
      const msg = res?.data?.message;
      setNyMessage(msg || t('pages.journals.autoNewYork.success', 'Automatic New York journal created'));
      await fetchJournals();
      setNyFiscalYearId('');
      setNyDate('');
      setNyAmount(0);
      setNyDebitCodeId('');
      setNyCreditCodeId('');
      setNyDetailId('');
      setNyDescription('');
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.response?.data?.message;
      setNyError(msg || t('pages.journals.autoNewYork.error', 'Failed to create automatic journal'));
    } finally {
      setNyCreating(false);
    }
  }

  /**
   * Post a journal (finalize).
   */
  async function postJournal(id: number) {
    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/journals/${id}/post`);
      await fetchJournals();
    } catch (e) {
      // noop
    }
  }

  useEffect(() => {
    fetchJournals();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-semibold mb-4">{t('pages.journals.title', 'Journals')}</h1>

        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-2">{t('pages.journals.create', 'Create Journal')}</h2>
          <form onSubmit={createJournal} className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-sm mb-1">{t('fields.date', 'Date')}</label>
              <JalaliDatePicker value={date} onChange={setDate} />
            </div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('fields.description', 'Description')}
              className="border rounded px-3 py-2"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={it.codeId}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = [...items];
                      next[idx].codeId = v.trim();
                      setItems(next);
                    }}
                    placeholder={t('fields.codeId', 'Code ID')}
                    className="border rounded px-3 py-2"
                  />
                  <input
                    type="number"
                    value={it.debit}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      const next = [...items];
                      next[idx].debit = Number.isNaN(v) ? 0 : v;
                      setItems(next);
                    }}
                    placeholder={t('fields.debit', 'Debit')}
                    className="border rounded px-3 py-2"
                  />
                  <input
                    type="number"
                    value={it.credit}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      const next = [...items];
                      next[idx].credit = Number.isNaN(v) ? 0 : v;
                      setItems(next);
                    }}
                    placeholder={t('fields.credit', 'Credit')}
                    className="border rounded px-3 py-2"
                  />
                </div>
              ))}
            </div>
            <button type="submit" disabled={creating} className="bg-green-700 text-white rounded px-4 py-2">
              {creating ? t('actions.saving', 'Saving...') : t('actions.create', 'Create')}
            </button>
            {error && <p className="text-red-600">{error}</p>}
          </form>
        </section>

        {/* Auto New York journal section */}
        <section className="bg-white rounded shadow p-4 mb-6">
          <h2 className="text-lg font-medium mb-2">{t('pages.journals.autoNewYork.title', 'Create Automatic New York Journal')}</h2>
          <form onSubmit={createAutoNewYork} className="grid grid-cols-1 gap-3">
            <input
              type="text"
              value={nyFiscalYearId}
              onChange={(e) => setNyFiscalYearId(e.target.value.trim())}
              placeholder={t('fields.fiscalYearId', 'Fiscal Year ID')}
              className="border rounded px-3 py-2"
            />
            <div>
              <label className="block text-sm mb-1">{t('fields.date', 'Date')}</label>
              <JalaliDatePicker value={nyDate} onChange={setNyDate} />
            </div>
            <input
              type="number"
              value={nyAmount}
              onChange={(e) => setNyAmount(Number(e.target.value) || 0)}
              placeholder={t('fields.amount', 'Amount')}
              className="border rounded px-3 py-2"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="text"
                value={nyDebitCodeId}
                onChange={(e) => setNyDebitCodeId(e.target.value.trim())}
                placeholder={t('fields.debitCodeId', 'Debit Code ID')}
                className="border rounded px-3 py-2"
              />
              <input
                type="text"
                value={nyCreditCodeId}
                onChange={(e) => setNyCreditCodeId(e.target.value.trim())}
                placeholder={t('fields.creditCodeId', 'Credit Code ID')}
                className="border rounded px-3 py-2"
              />
              <input
                type="text"
                value={nyDetailId}
                onChange={(e) => setNyDetailId(e.target.value.trim())}
                placeholder={t('fields.detailId', 'Detail ID')}
                className="border rounded px-3 py-2"
              />
            </div>
            <input
              type="text"
              value={nyDescription}
              onChange={(e) => setNyDescription(e.target.value)}
              placeholder={t('fields.description', 'Description')}
              className="border rounded px-3 py-2"
            />
            <button type="submit" disabled={nyCreating} className="bg-indigo-700 text-white rounded px-4 py-2">
              {nyCreating ? t('actions.saving', 'Saving...') : t('pages.journals.autoNewYork.create', 'Create Auto NY')}
            </button>
            {nyMessage && <p className="text-green-700">{nyMessage}</p>}
            {nyError && <p className="text-red-600">{nyError}</p>}
          </form>
        </section>

        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.journals.list', 'Journals List')}</h2>
          {loading && <p>{t('common.loading', 'Loading...')}</p>}
          {!loading && journals.length === 0 && <p>{t('common.noData', 'No data')}</p>}
          {!loading && journals.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left rtl:text-right">
                  <th className="py-2">{t('fields.id', 'ID')}</th>
                  <th className="py-2">{t('fields.date', 'Date')}</th>
                  <th className="py-2">{t('fields.description', 'Description')}</th>
                  <th className="py-2">{t('fields.status', 'Status')}</th>
                  <th className="py-2">{t('actions.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {journals.map((j) => (
                  <tr key={j.id} className="border-t">
                    <td className="py-2">{j.id}</td>
                    <td className="py-2">{j.date}</td>
                    <td className="py-2">{j.description || '-'}</td>
                    <td className="py-2">{j.status || '-'}</td>
                    <td className="py-2">
                      <button className="bg-blue-600 text-white rounded px-3 py-1" onClick={() => postJournal(j.id)}>
                        {t('pages.journals.post', 'Post')}
                      </button>
                    </td>
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

export default JournalsPage;