/**
 * Application bootstrap for Accounting front-end.
 * Wraps Router, AuthProvider, and ThemeProvider, mounts the app, and initializes base styles.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './theme';
import { applyDir, getInitialLang } from './i18n';

/**
 * Bootstraps and mounts the React application.
 * Ensures RTL/LTR is set before first render.
 */
function mountApp(): void {
  // Set initial direction and lang to match i18n default (Farsi-first)
  applyDir(getInitialLang());

  const container = document.getElementById('root')!;
  const root = createRoot(container);
  root.render(
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

mountApp();