/**
 * MUI theme and Emotion cache utilities.
 * - Exposes getMuiTheme(lang) to create an RTL/LTR-aware Material UI theme.
 * - Exposes createEmotionCache(direction) to enable proper RTL styles via stylis-plugin-rtl.
 */
import { createTheme, Theme } from '@mui/material/styles';
import type { Lang } from '../i18n';
import createCache from '@emotion/cache';
import type { EmotionCache } from '@emotion/cache';
import rtlPlugin from 'stylis-plugin-rtl';

/**
 * Create a MUI theme bound to the current language direction.
 * @param lang - Current application language (e.g., 'fa' for Farsi, 'en' for English)
 * @returns Configured MUI Theme with palette and typography matching project branding
 */
export function getMuiTheme(lang: Lang): Theme {
  const isRtl = lang === 'fa';
  const direction: 'ltr' | 'rtl' = isRtl ? 'rtl' : 'ltr';

  return createTheme({
    direction,
    palette: {
      primary: { main: '#4CAF50', dark: '#388E3C', light: '#81C784' },
      secondary: { main: '#FF5722', dark: '#D84315', light: '#FF8A65' },
      error: { main: '#dc2626' },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: isRtl ? '"Vazirmatn", "Tahoma", "Arial", sans-serif' : '"Roboto", "Helvetica", "Arial", sans-serif',
    },
  });
}

/**
 * Create Emotion cache for MUI with RTL/LTR support.
 * For RTL, we attach the stylis RTL plugin to flip styles.
 * @param direction - Layout direction ('ltr' or 'rtl')
 * @returns Emotion cache instance configured appropriately
 */
/**
 * Create Emotion cache for MUI with RTL/LTR support.
 * We set `prepend: true` so MUI styles are inserted at the start of <head>,
 * ensuring application and Tailwind styles loaded later take precedence.
 */
export function createEmotionCache(direction: 'ltr' | 'rtl'): EmotionCache {
  if (direction === 'rtl') {
    return createCache({ key: 'muirtl', stylisPlugins: [rtlPlugin], prepend: true });
  }
  return createCache({ key: 'mui', prepend: true });
}