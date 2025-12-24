/**
 * Root application routes with protected Home and LoginPage.
 * Applies RTL/LTR and aligns with admin theme/logo.
 */
import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { applyDir, getInitialLang } from './i18n';
import { useAuth } from './context/AuthContext';
import { Home } from './pages/Home';
import { LoginPage } from './pages/LoginPage';

// import JournalsPage from './pages/JournalsPage';
// import InvoicesPage from './pages/InvoicesPage';
// import WarehousesPage from './pages/WarehousesPage';
import CashboxesPage from './pages/CashboxesPage';
import CashboxFormPage from './pages/CashboxFormPage';
// Consolidation: Banks routed to unified Manage Banks page
import BankFormPage from './pages/BankFormPage';
import TreasuryPaymentsPage from './pages/TreasuryPaymentsPage';
import ReceiptsPage from './pages/ReceiptsPage';
import DashboardPage from './pages/DashboardPage';
import FiscalYearsPage from './pages/FiscalYearsPage';
import CodesPage from './pages/CodesPage';
import DetailsPage from './pages/DetailsPage';
import DetailLevelsPage from './pages/DetailLevelsPage';
import DocumentsPage from './pages/DocumentsPage';
import DocumentFormPage from './pages/DocumentFormPage';
import BankAccountsPage from './pages/BankAccountsPage';
import BankAccountFormPage from './pages/BankAccountFormPage';
import BankAccountCheckbooksPage from './pages/BankAccountCheckbooksPage';
import BankAccountCardReadersPage from './pages/BankAccountCardReadersPage';
import ChecksPage from './pages/ChecksPage';
import ReceiptFormPage from './pages/ReceiptFormPage';
import PaymentFormPage from './pages/PaymentFormPage';
import TreasurySettingsPage from './pages/TreasurySettingsPage';
import AccountsReviewReportPage from './pages/AccountsReviewReportPage';
import HierarchicalCodesReportPage from './pages/HierarchicalCodesReportPage';
import JournalReportBuilderPage from './pages/JournalReportBuilderPage';

/**
 * Protected component wraps routes requiring authentication.
 * If not authenticated, redirects user to the login page.
 */
function Protected({ children }: { children: React.ReactElement }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}


export default function App() {
  const lang = getInitialLang();
  const devAutoLogin = String(import.meta.env.VITE_DEV_AUTO_LOGIN || '').toLowerCase() === 'true';

  useEffect(() => {
    applyDir(lang);
    axios.defaults.headers.common['Accept-Language'] = lang;
    try { localStorage.setItem('lang', lang); } catch { /* noop */ }
  }, [lang]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Set Dashboard as the root page; Home is no longer the landing page */}
      <Route path="/" element={<Protected><DashboardPage /></Protected>} />
      {/* Keep /dashboard for backward compatibility, pointing to the same page */}
      <Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />

      <Route path="/codes" element={<Protected><CodesPage /></Protected>} />
      <Route path="/details" element={<Protected><DetailsPage /></Protected>} />
      <Route path="/detail-levels" element={<Protected><DetailLevelsPage /></Protected>} />
      {/* Removed routes per request: Journals, Invoices, Warehouses */}
      {/* <Route path="/journals" element={<Protected><JournalsPage /></Protected>} /> */}
      {/* <Route path="/invoices" element={<Protected><InvoicesPage /></Protected>} /> */}
      {/* <Route path="/warehouses" element={<Protected><WarehousesPage /></Protected>} /> */}
      {/* <Route path="/parties" element={<Protected><PartiesPage /></Protected>} /> */}
      <Route path="/treasury/cashboxes" element={<Protected><CashboxesPage /></Protected>} />
      <Route path="/treasury/cashboxes/new" element={<Protected><CashboxFormPage /></Protected>} />
      <Route path="/treasury/cashboxes/edit" element={<Protected><CashboxFormPage /></Protected>} />
      {/* Route Banks to the consolidated Manage Banks page (BankAccountsPage with tabs) */}
      <Route path="/treasury/banks" element={<Protected><BankAccountsPage /></Protected>} />
      <Route path="/treasury/banks/new" element={<Protected><BankFormPage /></Protected>} />
      <Route path="/treasury/banks/edit" element={<Protected><BankFormPage /></Protected>} />
      <Route path="/treasury/bank-accounts" element={<Protected><BankAccountsPage /></Protected>} />
      <Route path="/treasury/bank-accounts/new" element={<Protected><BankAccountFormPage /></Protected>} />
      <Route path="/treasury/bank-accounts/edit" element={<Protected><BankAccountFormPage /></Protected>} />
      <Route path="/treasury/bank-accounts/:id/checkbooks" element={<Protected><BankAccountCheckbooksPage /></Protected>} />
      <Route path="/treasury/bank-accounts/:id/card-readers" element={<Protected><BankAccountCardReadersPage /></Protected>} />
      <Route path="/treasury/checks" element={<Protected><ChecksPage /></Protected>} />
      <Route path="/treasury/receipts" element={<Protected><ReceiptsPage /></Protected>} />
      <Route path="/treasury/receipts/new" element={<Protected><ReceiptFormPage /></Protected>} />
      <Route path="/treasury/receipts/:id" element={<Protected><ReceiptFormPage /></Protected>} />
      <Route path="/treasury/payments" element={<Protected><TreasuryPaymentsPage /></Protected>} />
      <Route path="/treasury/payments/new" element={<Protected><PaymentFormPage /></Protected>} />
      <Route path="/treasury/payments/:id" element={<Protected><PaymentFormPage /></Protected>} />
      <Route path="/reports/accounts-review" element={<Protected><AccountsReviewReportPage /></Protected>} />
      <Route path="/reports/hierarchical-codes" element={<Protected><HierarchicalCodesReportPage /></Protected>} />
      <Route path="/reports/journal-builder" element={<Protected><JournalReportBuilderPage /></Protected>} />
      {/* Removed /reports route while rebuilding reports from scratch */}
      {/* <Route path="/reports" element={<Protected><ReportsPage /></Protected>} /> */}
      <Route path="/fiscal-years" element={<Protected><FiscalYearsPage /></Protected>} />
      <Route path="/documents" element={<Protected><DocumentsPage /></Protected>} />
      <Route path="/documents/new" element={<Protected><DocumentFormPage /></Protected>} />
      <Route path="/treasury/settings" element={<Protected><TreasurySettingsPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
