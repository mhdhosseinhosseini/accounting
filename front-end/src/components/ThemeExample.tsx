import React from 'react';
import { useTheme } from '../theme';

/**
 * Example component demonstrating how to use the theme system
 * This shows how to access theme colors, RTL/LTR state, and current language
 */
export const ThemeExample: React.FC = () => {
  const { isRtl, currentLang, theme } = useTheme();

  return (
    <div className="p-6 max-w-md mx-auto">
      <div 
        className="rounded-lg p-4 mb-4 shadow-lg"
        style={{ 
          backgroundColor: theme.colors.primary.main,
          borderRadius: theme.borderRadius.medium 
        }}
      >
        <h2 className="text-white text-xl font-bold mb-2">
          {isRtl ? 'نمونه تم' : 'Theme Example'}
        </h2>
        <p className="text-white opacity-90">
          {isRtl ? 'زبان فعلی: فارسی' : `Current Language: ${currentLang}`}
        </p>
        <p className="text-white opacity-90">
          {isRtl ? 'جهت: راست به چپ' : `Direction: ${isRtl ? 'RTL' : 'LTR'}`}
        </p>
      </div>

      <div 
        className="rounded-lg p-4 mb-4 shadow-lg"
        style={{ 
          backgroundColor: theme.colors.secondary.main,
          borderRadius: theme.borderRadius.medium 
        }}
      >
        <h3 className="text-white text-lg font-semibold mb-2">
          {isRtl ? 'رنگ‌های تم' : 'Theme Colors'}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div 
            className="p-2 rounded text-white text-sm"
            style={{ backgroundColor: theme.colors['gb-green'] }}
          >
            GB Green
          </div>
          <div 
            className="p-2 rounded text-white text-sm"
            style={{ backgroundColor: theme.colors['gb-orange'] }}
          >
            GB Orange
          </div>
          <div 
            className="p-2 rounded text-white text-sm"
            style={{ backgroundColor: theme.colors['gb-pink'] }}
          >
            GB Pink
          </div>
          <div 
            className="p-2 rounded text-white text-sm"
            style={{ backgroundColor: theme.colors.primary.dark }}
          >
            Primary Dark
          </div>
        </div>
      </div>

      <div className="text-sm text-gray-600">
        <p className={isRtl ? 'text-right' : 'text-left'}>
          {isRtl 
            ? 'این نمونه نشان می‌دهد که چگونه از سیستم تم استفاده کنید'
            : 'This example shows how to use the theme system'
          }
        </p>
      </div>
    </div>
  );
};