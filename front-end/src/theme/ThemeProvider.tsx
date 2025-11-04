import React, { createContext, useContext, useEffect } from 'react';
import { applyDir, type Lang, i18n } from '../i18n';

// Theme configuration matching admin project
export const themeConfig = {
  colors: {
    primary: {
      main: '#4CAF50',
      dark: '#388E3C',
      light: '#81C784',
    },
    secondary: {
      main: '#FF5722',
      dark: '#D84315',
      light: '#FF8A65',
    },
    'gb-green': '#4CAF50',
    'gb-green-dark': '#388E3C',
    'gb-orange': '#FF5722',
    'gb-pink': 'rgb(236, 72, 153)',
  },
  fonts: {
    rtl: '"Vazirmatn", "Tahoma", "Arial", sans-serif',
    ltr: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
  borderRadius: {
    small: '8px',
    medium: '12px',
    large: '16px',
  },
  buttons: {
    primary: {
      backgroundColor: '#388E3C',
      color: '#ffffff',
      hoverBackgroundColor: '#4CAF50',
      fontSize: '16px',
      fontWeight: '500',
    },
    secondary: {
      backgroundColor: '#D84315',
      color: '#ffffff',
      hoverBackgroundColor: '#FF5722',
      fontSize: '16px',
      fontWeight: '500',
    },
    default: {
      backgroundColor: '#388E3C',
      color: '#ffffff',
      hoverBackgroundColor: '#4CAF50',
      fontSize: '16px',
      fontWeight: '500',
    },
  },
};

interface ThemeContextType {
  isRtl: boolean;
  currentLang: Lang;
  theme: typeof themeConfig;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * ThemeProvider component that provides consistent theming across all projects
 * Uses Tailwind CSS classes and provides theme context for RTL/LTR support
 * Integrated with the existing i18n system for proper language detection
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [currentLang, setCurrentLang] = React.useState<Lang>(() => i18n.language as Lang);
  const isRtl = currentLang === 'fa';

  useEffect(() => {
    // Apply direction and language to document
    applyDir(currentLang);
    
    // Apply font family based on direction
    const fontFamily = isRtl ? themeConfig.fonts.rtl : themeConfig.fonts.ltr;
    document.documentElement.style.fontFamily = fontFamily;

    // Inject CSS custom properties for centralized color management
    const root = document.documentElement;
    root.style.setProperty('--gb-primary-main', themeConfig.colors.primary.main);
    root.style.setProperty('--gb-primary-dark', themeConfig.colors.primary.dark);
    root.style.setProperty('--gb-primary-light', themeConfig.colors.primary.light);
    root.style.setProperty('--gb-secondary-main', themeConfig.colors.secondary.main);
    root.style.setProperty('--gb-secondary-dark', themeConfig.colors.secondary.dark);
    root.style.setProperty('--gb-secondary-light', themeConfig.colors.secondary.light);
    root.style.setProperty('--gb-green', themeConfig.colors['gb-green']);
    root.style.setProperty('--gb-green-dark', themeConfig.colors['gb-green-dark']);
    root.style.setProperty('--gb-orange', themeConfig.colors['gb-orange']);
    root.style.setProperty('--gb-pink', themeConfig.colors['gb-pink']);
    
    // Button colors
    root.style.setProperty('--gb-button-primary-bg', themeConfig.buttons.primary.backgroundColor);
    root.style.setProperty('--gb-button-primary-hover', themeConfig.buttons.primary.hoverBackgroundColor);
    root.style.setProperty('--gb-button-primary-color', themeConfig.buttons.primary.color);

    // Listen for language changes
    const handleStorageChange = () => {
      const newLang = i18n.language as Lang;
      if (newLang !== currentLang) {
        setCurrentLang(newLang);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also check for manual changes to document attributes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && 
            (mutation.attributeName === 'lang' || mutation.attributeName === 'dir')) {
          const newLang = i18n.language as Lang;
          if (newLang !== currentLang) {
            setCurrentLang(newLang);
          }
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['lang', 'dir']
    });

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      observer.disconnect();
    };
  }, [currentLang, isRtl]);

  const contextValue: ThemeContextType = {
    isRtl,
    currentLang,
    theme: themeConfig,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

/**
 * Hook to use theme context
 */
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};