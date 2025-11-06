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

function Protected({ children }: { children: React.ReactElement }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const lang = getInitialLang();

  useEffect(() => {
    applyDir(lang);
    axios.defaults.headers.common['Accept-Language'] = lang;
    try { localStorage.setItem('lang', lang); } catch { /* noop */ }
  }, [lang]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}