/**
 * FiscalYearsPage
 * - Lists fiscal years and allows creating a new fiscal year.
 * - Applies Details page table theme, sortable headers, and pagination.
 * - Formats dates to Jalali with Persian digits in Farsi mode.
 */
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Navbar from '../components/Navbar';
import { useTranslation } from 'react-i18next';
import config from '../config';
import JalaliDatePicker from '../components/JalaliDatePicker';
import DateObject from 'react-date-object';
import persian from 'react-date-object/calendars/persian';
import { getCurrentLang } from '../i18n';
import TableSortHeader from '../components/common/TableSortHeader';
import Pagination from '../components/common/Pagination';
import { Lock, Unlock } from 'lucide-react';
import { Pencil, Trash2 } from 'lucide-react';
import ConfirmDialog from '../components/common/ConfirmDialog';
import AlertDialog from '../components/common/AlertDialog';

interface FiscalYear {
  id: number;
  name: string;
  startDate: string; // YYYY-MM-DD or ISO string
  endDate: string;   // YYYY-MM-DD or ISO string
  isClosed?: boolean;
  hasDocuments?: boolean;
}

const FiscalYearsPage: React.FC = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const [name, setName] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [endDateLocked, setEndDateLocked] = useState<boolean>(false);
/**
 * datesDisabled
 * When editing a fiscal year with associated documents, disable date inputs.
 */
const [datesDisabled, setDatesDisabled] = useState<boolean>(false);
  /**
   * showCreate
   * Controls visibility of the top create section. Hidden by default so
   * the page initially shows only the data table. Clicking the New button
   * reveals the create form.
   */
  const [showCreate, setShowCreate] = useState<boolean>(false);
  /**
   * editingId
   * Tracks the currently edited fiscal year id. When set, the create form
   * acts as an edit form and the primary action becomes Save.
   */
  const [editingId, setEditingId] = useState<string | number | null>(null);

  // Alert dialog state (localized, RTL-aware)
  const [alertOpen, setAlertOpen] = useState<boolean>(false);
  const [alertTitle, setAlertTitle] = useState<string | undefined>(undefined);
  const [alertMessage, setAlertMessage] = useState<string>('');
  const [alertType, setAlertType] = useState<'error' | 'warning' | 'info' | 'success'>('info');

  // Confirm dialog state for delete action
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmTitle, setConfirmTitle] = useState<string>('');
  const [confirmMessage, setConfirmMessage] = useState<string>('');
  const [confirmType, setConfirmType] = useState<'danger' | 'warning' | 'info' | 'success'>('danger');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | number | null>(null);

  const isRTL = getCurrentLang() === 'fa';

  /**
   * Converts ASCII digits to Persian digits for localized display.
   */
  function toPersianDigits(s: string): string {
    const map: Record<string, string> = {
      '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴',
      '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹',
    };
    return String(s).replace(/[0-9]/g, (d) => map[d] || d);
  }

  /**
   * Safely converts various date string formats into a DateObject.
   * Accepts `YYYY-MM-DD`, full ISO strings (e.g., `YYYY-MM-DDTHH:mm:ssZ`), or `YYYY/MM/DD`.
   * Returns null if the input cannot be parsed.
   */
  function toDateObjectSafe(iso?: string): DateObject | null {
    if (!iso) return null;
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        return new DateObject(iso);
      }
      const d = new Date(iso);
      if (!isNaN(d.getTime())) {
        return new DateObject(d);
      }
      const parts = iso.replace(/\//g, '-').split('-');
      if (parts.length === 3) {
        const [y, m, dd] = parts.map((p) => parseInt(p, 10));
        if (!isNaN(y) && !isNaN(m) && !isNaN(dd)) {
          return new DateObject({ year: y, month: m, day: dd });
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Converts an ISO `YYYY-MM-DD` Gregorian date string to a localized display string.
   * - In Farsi (`fa`), converts to Jalali (Persian) and formats `YYYY/MM/DD` with Persian digits.
   * - Otherwise, returns Gregorian `YYYY-MM-DD`.
   */
  function formatDisplayDate(iso?: string): string {
    const obj = toDateObjectSafe(iso);
    if (!obj) return '-';
    try {
      if (getCurrentLang() === 'fa') {
        const j = obj.convert(persian);
        const jy = String(j.year).padStart(4, '0');
        const jm = String(j.month.number).padStart(2, '0');
        const jd = String(j.day).padStart(2, '0');
        return toPersianDigits(`${jy}/${jm}/${jd}`);
      }
      const y = String(obj.year).padStart(4, '0');
      const m = String(obj.month.number).padStart(2, '0');
      const d = String(obj.day).padStart(2, '0');
      return `${y}-${m}-${d}`;
    } catch {
      return iso || '-';
    }
  }
  
  /**
   * computeDefaultEndDate
   * Given a start date (ISO `YYYY-MM-DD` or ISO string),
   * returns the default end date as "next year minus one day".
   * - In Farsi, computes in the Jalali calendar and converts back to Gregorian ISO.
   * - In English, computes in Gregorian directly.
   */
  function computeDefaultEndDate(startIso?: string): string {
    const sObj = toDateObjectSafe(startIso);
    if (!sObj) return '';
    try {
      if (getCurrentLang() === 'fa') {
        const jStart = sObj.convert(persian);
        const jNextStart = new DateObject({
          calendar: persian,
          year: jStart.year + 1,
          month: jStart.month.number,
          day: jStart.day,
        });
        const gEnd = new Date(jNextStart.toDate().getTime() - 86400000);
        const dObj = new DateObject(gEnd);
        const y = String(dObj.year).padStart(4, '0');
        const m = String(dObj.month.number).padStart(2, '0');
        const d = String(dObj.day).padStart(2, '0');
        return `${y}-${m}-${d}`;
      } else {
        const start = sObj.toDate();
        const next = new Date(start);
        next.setFullYear(next.getFullYear() + 1);
        const end = new Date(next.getTime() - 86400000);
        const dObj = new DateObject(end);
        const y = String(dObj.year).padStart(4, '0');
        const m = String(dObj.month.number).padStart(2, '0');
        const d = String(dObj.day).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch {
      return '';
    }
  }
  
  /**
   * Fetch list of fiscal years from backend.
   */
  async function fetchFiscalYears() {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get(`${config.API_ENDPOINTS.base}/v1/fiscal-years`, { headers: { 'Accept-Language': getCurrentLang() } });
      const raw = res.data.items || res.data || [];
      const normalized: FiscalYear[] = Array.isArray(raw)
        ? raw.map((fy: any) => ({
            id: fy.id,
            name: fy.name,
            startDate: fy.start_date ?? fy.startDate,
            endDate: fy.end_date ?? fy.endDate,
            isClosed: fy.is_closed ?? fy.isClosed,
            hasDocuments: fy.has_documents ?? fy.hasDocuments ?? false,
          }))
        : [];
      setItems(normalized);
    } catch (e: any) {
      const serverMsg = e?.response?.data?.error;
      const zodIssues = e?.response?.data?.details;
      const msg = serverMsg || (Array.isArray(zodIssues) ? zodIssues.map((i: any) => i.message).join(', ') : '') || t('errors.unknown', 'Unknown error occurred');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Load fiscal years on mount.
   */
  useEffect(() => {
    fetchFiscalYears();
  }, []);

  /**
   * Create a new fiscal year via backend.
   * Fills missing fields from the submitted form when server returns partial payload (id only).
   */
  /**
   * createFiscalYear
   * Creates a new fiscal year via API and ensures new records are closed by default.
   * Behavior: Backend now sets `is_closed = TRUE` on insert; when the server returns
   * a partial payload (e.g., only `id`), the UI falls back to `isClosed = true` to
   * reflect the closed status immediately.
   * i18n: No new labels introduced; existing English/Farsi strings continue to render
   * for closed/open indicators. Dates are submitted as Gregorian ISO strings.
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
        name,
        start_date: startDate,
        end_date: endDate,
      }, { headers: { 'Accept-Language': getCurrentLang() } });
      const rawCreated = res.data.item || res.data;
      const created: FiscalYear = {
        id: rawCreated.id,
        name: rawCreated.name ?? name,
        startDate: rawCreated.start_date ?? rawCreated.startDate ?? startDate,
        endDate: rawCreated.end_date ?? rawCreated.endDate ?? endDate,
        isClosed: (rawCreated.is_closed ?? rawCreated.isClosed ?? true) as boolean,
        hasDocuments: false,
      };
      setItems((prev) => [created, ...prev]);
      setName('');
      setStartDate('');
      setEndDate('');
      setEndDateLocked(false);
    } catch (e: any) {
      const serverMsg = e?.response?.data?.error;
      const zodIssues = e?.response?.data?.details;
      const msg = serverMsg || (Array.isArray(zodIssues) ? zodIssues.map((i: any) => i.message).join(', ') : '') || t('errors.unknown', 'Unknown error occurred');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }
  
  /**
   * updateFiscalYear
   * Sends a PATCH request to update the selected fiscal year and updates the local list.
   * i18n: Uses `Accept-Language` header to surface localized backend validation messages.
   */
  async function updateFiscalYear() {
    if (!editingId) return;
    if (!name || !startDate || !endDate) {
      setError(t('validation.missingFields', 'Please fill all fields'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await axios.patch(`${config.API_ENDPOINTS.base}/v1/fiscal-years/${editingId}` as string, {
        name,
        start_date: startDate,
        end_date: endDate,
      }, { headers: { 'Accept-Language': getCurrentLang() } });
      setItems((prev) => prev.map((fy) => (fy.id === editingId ? { ...fy, name, startDate, endDate } : fy)));
      setEditingId(null);
      setShowCreate(false);
      setEndDateLocked(false);
      setName('');
      setStartDate('');
      setEndDate('');
    } catch (e: any) {
      const serverMsg = e?.response?.data?.error;
      const zodIssues = e?.response?.data?.details;
      const msg = serverMsg || (Array.isArray(zodIssues) ? zodIssues.map((i: any) => i.message).join(', ') : '') || t('errors.unknown', 'Unknown error occurred');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  /**
   * saveFiscalYear
   * Chooses between create and update based on edit mode.
   */
  async function saveFiscalYear() {
    if (editingId) {
      await updateFiscalYear();
    } else {
      await createFiscalYear();
    }
  }

  /**
   * openEdit
   * Prefills the form with the selected fiscal year and switches to edit mode.
   */
  function openEdit(fy: FiscalYear): void {
    setEditingId(fy.id as any);
    setName(fy.name || '');
    setStartDate(fy.startDate || '');
    setEndDate(fy.endDate || '');
    setEndDateLocked(true);
    setDatesDisabled(!!(fy.hasDocuments));
    setShowCreate(true);
  }

  /**
   * deleteFiscalYear
   * Opens the confirmation dialog for deleting a fiscal year.
   * i18n: Texts come from pages.fiscalYears.* and actions.* keys.
   */
  function deleteFiscalYear(id: string | number): void {
    setPendingDeleteId(id);
    setConfirmTitle(t('actions.confirmDelete', 'Are you sure you want to delete?'));
    setConfirmMessage(t('pages.fiscalYears.deleteConfirm', 'Delete this fiscal year?'));
    setConfirmType('danger');
    setConfirmOpen(true);
  }

  /**
   * confirmDelete
   * Executes the deletion after user confirmation and shows a localized alert.
   * - Success: refreshes the list to reflect moved Open Fiscal, then shows success AlertDialog.
   * - Error: shows error AlertDialog, preferring server-provided message.
   */
  async function confirmDelete(): Promise<void> {
    if (!pendingDeleteId) { setConfirmOpen(false); return; }
    try {
      await axios.delete(`${config.API_ENDPOINTS.base}/v1/fiscal-years/${pendingDeleteId}` as string);
      // Refresh the list so UI reflects any Open Fiscal movement on backend
      await fetchFiscalYears();
      setPendingDeleteId(null);
      setConfirmOpen(false);
      setAlertTitle(undefined);
      setAlertMessage(t('pages.fiscalYears.deletedSuccess', 'Fiscal year deleted'));
      setAlertType('success');
      setAlertOpen(true);
    } catch (e: any) {
      const serverMsg = e?.response?.data?.error || e?.response?.data?.message;
      const msg = serverMsg || t('pages.fiscalYears.deleteFailed', 'Failed to delete fiscal year');
      setAlertTitle(t('common.error', 'Error'));
      setAlertMessage(String(msg));
      setAlertType('error');
      setAlertOpen(true);
    }
  }

  /**
   * closeConfirm
   * Closes the confirm dialog and clears any pending delete id.
   */
  function closeConfirm(): void {
    setConfirmOpen(false);
    setPendingDeleteId(null);
  }

  /**
   * closeAlert
   * Closes the alert dialog and resets its content.
   */
  function closeAlert(): void {
    setAlertOpen(false);
    setAlertTitle(undefined);
    setAlertMessage('');
  }
  
  /**
   * handleStatusClick
   * When clicking the status icon on a closed fiscal year, opens it
   * exclusively by calling the backend endpoint and closes all others.
   * If the fiscal year is already open, does nothing.
   * i18n: Sends `Accept-Language` header; backend returns localized message.
   */
  async function handleStatusClick(fy: FiscalYear): Promise<void> {
    if (!fy.isClosed) return; // Already open → no action
    try {
      await axios.post(`${config.API_ENDPOINTS.base}/v1/fiscal-years/${fy.id}/open`, {}, { headers: { 'Accept-Language': getCurrentLang() } });
      // Optimistically update local state to reflect exclusive open
      setItems((prev) => prev.map((x) => ({ ...x, isClosed: x.id === fy.id ? false : true })));
    } catch (e: any) {
      const serverMsg = e?.response?.data?.error || e?.response?.data?.message;
      const msg = serverMsg || t('pages.fiscalYears.openFailed', 'Failed to open fiscal year');
      setAlertTitle(t('common.error', 'Error'));
      setAlertMessage(String(msg));
      setAlertType('error');
      setAlertOpen(true);
    }
  }
  
  /**
   * Auto-fill endDate whenever startDate changes, unless user manually edits endDate.
   */
  useEffect(() => {
    if (!startDate) return;
    if (endDateLocked) return;
    const autoEnd = computeDefaultEndDate(startDate);
    if (autoEnd) setEndDate(autoEnd);
  }, [startDate, endDateLocked]);
  
  /**
   * Sorting & pagination state for the list table.
   */
  const [sortBy, setSortBy] = useState<keyof FiscalYear | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  /**
   * Handle sort toggle for a given column key.
   * - If clicking a new column, set ascending by default.
   * - If clicking the same column, toggle direction.
   */
  function handleSort(key: keyof FiscalYear): void {
    setSortBy((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
    setPage(1);
  }

  /**
   * Update page size and reset to first page.
   */
  function handlePageSizeChange(newSize: number): void {
    setPageSize(newSize);
    setPage(1);
  }

  /**
   * Sort items based on current sort settings (name, start/end dates, status).
   */
  const sortedItems = useMemo(() => {
    if (!sortBy) return items;
    const arr = [...items];
    arr.sort((a, b) => {
      const av = a[sortBy as keyof FiscalYear];
      const bv = b[sortBy as keyof FiscalYear];
      let cmp = 0;
      if (sortBy === 'startDate' || sortBy === 'endDate') {
        const ad = toDateObjectSafe(String(av || ''));
        const bd = toDateObjectSafe(String(bv || ''));
        const at = ad ? ad.toDate().getTime() : 0;
        const bt = bd ? bd.toDate().getTime() : 0;
        cmp = at - bt;
      } else if (sortBy === 'name') {
        cmp = String(av || '').localeCompare(String(bv || ''));
      } else if (sortBy === 'isClosed') {
        const ab = !!av;
        const bb = !!bv;
        cmp = ab === bb ? 0 : ab ? 1 : -1;
      } else {
        cmp = String(av || '').localeCompare(String(bv || ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [items, sortBy, sortDir]);

  /**
   * Paginate the sorted items.
   */
  const total = sortedItems.length;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, page, pageSize]);

  /**
   * StatusIcon
   * Renders a lock/unlock icon to represent fiscal year status.
   * - Closed => Lock icon with red/gray color.
   * - Open => Unlock icon with green color.
   * Provides i18n-driven aria-label and title for accessibility.
   */
  const StatusIcon: React.FC<{ closed?: boolean }> = ({ closed }) => {
    const label = closed ? t('fields.closed', 'Closed') : t('fields.open', 'Open');
    const Icon = closed ? Lock : Unlock;
    const colorClass = closed ? 'text-red-600' : 'text-green-600';
    return (
      <span className={`inline-flex items-center ${colorClass}`} aria-label={label} title={label}>
        <Icon className="w-5 h-5" aria-hidden="true" />
      </span>
    );
  };
  return (
    <div className={"min-h-screen bg-gray-50 text-gray-900"}>
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Header with localized New button placement: Farsi -> top-left, English -> top-right */}
        <div className="flex items-center justify-between mb-4">

            <>
              <h1 className="text-xl font-semibold">{t('pages.fiscalYears.title', 'Fiscal Years')}</h1>
              <button className="bg-green-700 text-white rounded px-4 py-2" onClick={() => { setEditingId(null); setDatesDisabled(false); setShowCreate(true); }}>
                {t('actions.new', 'New')}
              </button>
            </>
        </div>

        {showCreate && (
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
                <JalaliDatePicker value={startDate} onChange={setStartDate} disabled={datesDisabled} />
              </div>
              <div>
                <label className="block text-sm mb-1">{t('fields.endDate', 'End Date')}</label>
                <JalaliDatePicker value={endDate} onChange={(val) => { setEndDate(val); setEndDateLocked(true); }} disabled={datesDisabled} />
              </div>
            </div>
            {editingId && datesDisabled && (
              <p className="mt-2 text-sm text-gray-600">{t('pages.fiscalYears.datesLockedHint', 'Dates cannot be edited when documents exist.')}</p>
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={saveFiscalYear} className="bg-green-700 text-white rounded px-4 py-2">
                {editingId ? t('actions.save', 'Save') : t('actions.create', 'Create')}
              </button>
              <button type="button" onClick={() => { setShowCreate(false); setEditingId(null); setDatesDisabled(false); }} className="bg-gray-300 text-gray-900 rounded px-4 py-2">
                {t('common.close', 'Close')}
              </button>
              {loading && <span className="text-gray-600">{t('common.loading', 'Loading...')}</span>}
            </div>
            {error && <p className="text-red-600 mt-2">{error}</p>}
          </section>
        )}

        <section className="bg-white rounded shadow p-4">
          <h2 className="text-lg font-medium mb-2">{t('pages.fiscalYears.list', 'Fiscal Years List')}</h2>
          {loading && <p className="text-gray-600">{t('common.loading', 'Loading...')}</p>}
          {!loading && items.length === 0 && (
            <p className="text-gray-600">{t('common.noData', 'No data')}</p>
          )}
          {!loading && items.length > 0 && (
            <>
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-100" dir={isRTL ? "rtl" : "ltr"}>
                  <tr className="border-b border-gray-200">
                    <TableSortHeader
                      label={t('fields.name', 'Name')}
                      sortKey={'name'}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof FiscalYear)}
                    />
                    <TableSortHeader
                      label={t('fields.startDate', 'Start Date')}
                      sortKey={'startDate'}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof FiscalYear)}
                    />
                    <TableSortHeader
                      label={t('fields.endDate', 'End Date')}
                      sortKey={'endDate'}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof FiscalYear)}
                    />
                    <TableSortHeader
                      label={t('fields.status', 'Status')}
                      sortKey={'isClosed'}
                      currentSortBy={sortBy as any}
                      currentSortDir={sortDir}
                      onSort={(k) => handleSort(k as keyof FiscalYear)}
                    />
                    <th className="py-2 px-2">{t('common.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedItems.map((fy) => (
                    <tr key={fy.id} className={getRowClass(fy.isClosed)}>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{fy.name}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatDisplayDate(fy.startDate)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>{formatDisplayDate(fy.endDate)}</td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>
                        <button
                          onClick={() => handleStatusClick(fy)}
                          disabled={!fy.isClosed}
                          aria-label={fy.isClosed ? t('pages.fiscalYears.openThis','Open this fiscal year') : t('pages.fiscalYears.alreadyOpen','Already open')}
                          title={fy.isClosed ? t('pages.fiscalYears.openThis','Open this fiscal year') : t('pages.fiscalYears.alreadyOpen','Already open')}
                          className={`inline-flex items-center ${fy.isClosed ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <StatusIcon closed={!!fy.isClosed} />
                        </button>
                      </td>
                      <td className={`py-2 px-2 ${isRTL ? 'text-right' : 'text-left'}`}>
                        <span className="inline-flex items-center gap-2">
                          <button
                            onClick={() => openEdit(fy)}
                            className="text-blue-600 hover:text-blue-800"
                            aria-label={t('actions.edit','Edit')}
                            title={t('actions.edit','Edit')}
                          >
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </button>
                          {!(fy.hasDocuments ?? false) && (
                          <button
                            onClick={() => deleteFiscalYear(fy.id as any)}
                            className="text-red-600 hover:text-red-800"
                            aria-label={t('actions.delete','Delete')}
                            title={t('actions.delete','Delete')}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={handlePageSizeChange}
                className="mt-3"
              />
            </>
          )}
        </section>
      </main>
      {/* Confirm delete dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        type={confirmType}
        onConfirm={confirmDelete}
        onCancel={closeConfirm}
        dimBackground={false}
      />
      {/* Global alert dialog */}
      <AlertDialog
        open={alertOpen}
        title={alertTitle}
        message={alertMessage}
        onClose={closeAlert}
        type={alertType}
        dimBackground={false}

      />
    </div>
  );
};

export default FiscalYearsPage;

/**
 * getRowClass
 * Highlights open fiscal year rows in yellow for clarity.
 */
function getRowClass(isClosed?: boolean): string {
  const base = 'border-b border-gray-200';
  return isClosed === false ? `${base} bg-yellow-50 hover:bg-yellow-100` : `${base} hover:bg-gray-50`;
}