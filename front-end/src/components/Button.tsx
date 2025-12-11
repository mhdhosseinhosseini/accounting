import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Button variant - determines the styling
   */
  variant?: 'primary' | 'secondary' | 'outline' | 'text' | 'info';
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
 * Reusable Button component styled with Tailwind classes and theme CSS variables.
 * - Removes inline styles and mouse handlers; relies on hover/active classes.
 * - Uses CSS variables injected by ThemeProvider for colors and hover states.
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
  /**
   * Map size to Tailwind padding and font-size classes.
   */
  const sizeClasses = {
    small: 'px-3 py-1.5 text-sm',
    medium: 'px-4 py-3 text-base',
    large: 'px-6 py-4 text-lg'
  };

  /**
   * getVariantClassNames
   * Returns Tailwind classes for the given variant.
   * Uses CSS variables for primary/secondary, and semantic colors for info.
   */
  function getVariantClassNames(v: NonNullable<ButtonProps['variant']>): string {
    switch (v) {
      case 'primary':
        return 'bg-[var(--gb-primary-main)] hover:bg-[var(--gb-primary-dark)] text-white focus:ring-[var(--gb-primary-main)]';
      case 'secondary':
        return 'bg-[var(--gb-secondary-main)] hover:bg-[var(--gb-secondary-dark)] text-white focus:ring-[var(--gb-secondary-main)]';
      case 'info':
        // Info: use blue semantic color to match ConfirmDialog type="info"
        return 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-600';
      case 'outline':
        return 'bg-transparent text-[var(--gb-primary-main)] hover:bg-[var(--gb-primary-light)] hover:text-white border border-[var(--gb-primary-main)] focus:ring-[var(--gb-primary-main)]';
      case 'text':
        return 'bg-transparent text-[var(--gb-primary-main)] hover:bg-[var(--gb-primary-alpha-10)] focus:ring-[var(--gb-primary-main)]';
      default:
        return '';
    }
  }

  const baseClasses = [
    'font-medium rounded-lg transition-all duration-200',
    'focus:outline-none focus:ring-2',
    fullWidth ? 'w-full' : '',
    sizeClasses[size],
    loading || disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
    getVariantClassNames(variant),
    className
  ].filter(Boolean).join(' ');

  /**
   * Disabled overrides for primary/secondary variants.
   * Outline/text rely on text/border gray when disabled.
   */
  const disabledClasses = disabled || loading
    ? (variant === 'primary' || variant === 'secondary'
        ? 'bg-[#9CA3AF] text-white'
        : 'text-gray-400 border-gray-400')
    : '';

  return (
    <button
      className={[baseClasses, disabledClasses].filter(Boolean).join(' ')}
      style={style}
      disabled={disabled || loading}
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