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
import JalaliDatePicker from '../components/JalaliDatePicker';

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