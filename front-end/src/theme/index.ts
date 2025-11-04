/**
 * Theme module for consistent styling across all Green Bunch projects
 * Provides Tailwind-based theming with RTL/LTR support
 * Integrated with i18n system for proper language detection
 */

export { ThemeProvider, useTheme, themeConfig } from './ThemeProvider';
export type { Lang } from '../i18n';

// Export theme utilities for easy access
export const colors = {
  primary: '#4CAF50',
  'primary-dark': '#388E3C',
  'primary-light': '#81C784',
  secondary: '#FF5722',
  'secondary-dark': '#D84315',
  'secondary-light': '#FF8A65',
  'gb-green': '#4CAF50',
  'gb-green-dark': '#388E3C',
  'gb-orange': '#FF5722',
  'gb-pink': 'rgb(236, 72, 153)',
};

export const fonts = {
  rtl: '"Vazirmatn", "Tahoma", "Arial", sans-serif',
  ltr: '"Roboto", "Helvetica", "Arial", sans-serif',
};

export const borderRadius = {
  small: '8px',
  medium: '12px',
  large: '16px',
};