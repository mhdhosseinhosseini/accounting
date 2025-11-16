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
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { CacheProvider } from '@emotion/react';
import { getMuiTheme, createEmotionCache } from './theme/muiTheme';
import { ThemeProvider as AppThemeProvider } from './theme';
import { applyDir, getInitialLang } from './i18n';

/**
 * Bootstraps and mounts the React application.
 * Ensures RTL/LTR is set before first render.
 */
function mountApp(): void {
  // Set initial direction and lang to match i18n default (Farsi-first)
  const lang = getInitialLang();
  applyDir(lang);

  const container = document.getElementById('root')!;
  const root = createRoot(container);

  // Create MUI theme and Emotion cache that respect RTL/LTR
  const muiTheme = getMuiTheme(lang);
  const emotionCache = createEmotionCache(muiTheme.direction);

  root.render(
    <BrowserRouter>
      <CacheProvider value={emotionCache}>
        <MuiThemeProvider theme={muiTheme}>
          <CssBaseline />
          <AppThemeProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </AppThemeProvider>
        </MuiThemeProvider>
      </CacheProvider>
    </BrowserRouter>
  );
}

mountApp();