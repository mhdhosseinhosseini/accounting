import React from 'react';
import { useTheme } from '../theme';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Button variant - determines the styling
   */
  variant?: 'primary' | 'secondary' | 'outline' | 'text';
  /**
   * Button size
   */
  size?: 'small' | 'medium' | 'large';
  /**
   * Whether the button is in a loading state
   */
  loading?: boolean;
  /**
   * Full width button
   */
  fullWidth?: boolean;
  /**
   * Button content
   */
  children: React.ReactNode;
}

/**
 * Reusable Button component that follows the theme system
 * Provides consistent styling and behavior across the application
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className = '',
  style = {},
  ...props
}) => {
  const { theme } = useTheme();

  // Size configurations
  const sizeClasses = {
    small: 'px-3 py-1.5 text-sm',
    medium: 'px-4 py-3 text-base',
    large: 'px-6 py-4 text-lg'
  };

  // Base classes
  const baseClasses = `
    font-medium rounded-lg transition-all duration-200 
    focus:outline-none focus:ring-2 focus:ring-offset-2
    ${fullWidth ? 'w-full' : ''}
    ${sizeClasses[size]}
    ${loading || disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
    ${className}
  `.trim().replace(/\s+/g, ' ');

  // Variant styles
  const getVariantStyles = () => {
    const isDisabled = disabled || loading;
    
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: isDisabled ? '#9CA3AF' : theme.colors.primary.main,
          color: '#ffffff',
          border: 'none',
          borderRadius: theme.borderRadius.medium,
          opacity: loading ? 0.7 : 1,
          '--tw-ring-color': theme.colors.primary.main
        };
      
      case 'secondary':
        return {
          backgroundColor: isDisabled ? '#9CA3AF' : theme.colors.secondary.main,
          color: '#ffffff',
          border: 'none',
          borderRadius: theme.borderRadius.medium,
          opacity: loading ? 0.7 : 1,
          '--tw-ring-color': theme.colors.secondary.main
        };
      
      case 'outline':
        return {
          backgroundColor: 'transparent',
          color: isDisabled ? '#9CA3AF' : theme.colors.primary.main,
          border: `1px solid ${isDisabled ? '#9CA3AF' : theme.colors.primary.main}`,
          borderRadius: theme.borderRadius.medium,
          opacity: loading ? 0.7 : 1,
          '--tw-ring-color': theme.colors.primary.main
        };
      
      case 'text':
        return {
          backgroundColor: 'transparent',
          color: isDisabled ? '#9CA3AF' : theme.colors.primary.main,
          border: 'none',
          borderRadius: theme.borderRadius.medium,
          opacity: loading ? 0.7 : 1,
          '--tw-ring-color': theme.colors.primary.main
        };
      
      default:
        return {};
    }
  };

  // Hover effects
  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading) return;
    
    switch (variant) {
      case 'primary':
        e.currentTarget.style.backgroundColor = theme.colors.primary.dark;
        break;
      case 'secondary':
        e.currentTarget.style.backgroundColor = theme.colors.secondary.dark;
        break;
      case 'outline':
        e.currentTarget.style.backgroundColor = theme.colors.primary.light;
        e.currentTarget.style.color = '#ffffff';
        break;
      case 'text':
        e.currentTarget.style.backgroundColor = `${theme.colors.primary.main}10`;
        break;
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading) return;
    
    const styles = getVariantStyles();
    Object.assign(e.currentTarget.style, styles);
  };

  return (
    <button
      className={baseClasses}
      style={{ ...getVariantStyles(), ...style }}
      disabled={disabled || loading}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          {children}
        </div>
      ) : (
        children
      )}
    </button>
  );
};