import React from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: 'danger' | 'warning' | 'info' | 'success';
  children?: React.ReactNode;
  /** When true, shows a dim backdrop; when false, backdrop is transparent. */
  dimBackground?: boolean;
  /** Optional override for backdrop class names (Tailwind). */
  backdropClassName?: string;
  /** Optional extra classes for the dialog panel to customize shadow and look. */
  panelClassName?: string;
  /** Optional override for the confirm button colors (Tailwind utility classes). */
  confirmButtonClassName?: string;
  /** Optional override for the cancel button colors (Tailwind utility classes). */
  cancelButtonClassName?: string;
  /** When true, hides the bottom action buttons entirely. */
  hideActions?: boolean;
  /** Optional width class for the dialog panel (e.g., 'max-w-xl'). */
  widthClassName?: string;
}

/**
 * ConfirmDialog component
 * Provides a modal confirmation with a transparent backdrop by default.
 * - Transparent background matches system alert feel on macOS
 * - Use `dimBackground` to enable a dimmed backdrop when desired
 * - Use `panelClassName` to increase or customize shadow on the dialog panel
 * - Use `confirmButtonClassName` and `cancelButtonClassName` to customize button colors per usage
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  type = 'info',
  children,
  dimBackground = false,
  backdropClassName,
  panelClassName,
  confirmButtonClassName,
  cancelButtonClassName,
  hideActions = false,
  widthClassName,
}) => {
  const { t, i18n } = useTranslation();
  const dir = i18n.language === 'fa' ? 'rtl' : 'ltr';
  const isRTL = i18n.language === 'fa';

  if (!open) return null;

  /**
   * getTypeStyles
   * Determines base icon and default confirm button colors based on `type`.
   */
  const getTypeStyles = () => {
    switch (type) {
      case 'danger':
        return {
          icon: '⚠️',
          iconBg: 'bg-red-100',
          iconColor: 'text-red-600',
          confirmBtn: 'bg-red-600 hover:bg-red-700 text-white',
          titleColor: 'text-red-900'
        };
      case 'warning':
        return {
          icon: '⚠️',
          iconBg: 'bg-yellow-100',
          iconColor: 'text-yellow-600',
          confirmBtn: 'bg-yellow-600 hover:bg-yellow-700 text-white',
          titleColor: 'text-yellow-900'
        };
      case 'success':
        return {
          icon: '✓',
          iconBg: 'bg-green-100',
          iconColor: 'text-green-600',
          confirmBtn: 'bg-green-600 hover:bg-green-700 text-white',
          titleColor: 'text-green-900'
        };
      default:
        return {
          icon: 'ℹ️',
          iconBg: 'bg-blue-100',
          iconColor: 'text-blue-600',
          confirmBtn: 'bg-blue-600 hover:bg-blue-700 text-white',
          titleColor: 'text-blue-900'
        };
    }
  };

  const styles = getTypeStyles();

  /**
   * handleConfirmClick
   * Immediately closes the dialog by invoking onCancel, then executes onConfirm.
   * Ensures any subsequent alerts/messages are fully visible and not obscured.
   */
  function handleConfirmClick() {
    onCancel();
    setTimeout(() => {
      onConfirm();
    }, 0);
  }

  /**
   * stopPropagation
   * Prevent clicks inside the dialog panel from bubbling to the container,
   * so that outside clicks can close while inside clicks do not.
   */
  function stopPropagation(e: React.MouseEvent) {
    e.stopPropagation();
  }

  // Compute button color classes, allowing per-usage overrides
  const confirmBtnColors = confirmButtonClassName ?? styles.confirmBtn;
  const cancelBtnColors = cancelButtonClassName ?? 'bg-white text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50';
  const widthClass = widthClassName ?? 'max-w-lg';

  return (
    // Ensure the modal root itself is transparent to avoid any inherited dim
    <div className="fixed inset-0 z-[1700] flex items-center justify-center p-4 bg-transparent" dir={dir} onClick={onCancel}>
      {/* Backdrop: only render when dimming is explicitly requested */}
      {dimBackground && (
        <div
          className={backdropClassName ?? 'inset-0 bg-black bg-opacity-50 transition-opacity'}
        ></div>
      )}

      {/* Dialog */}
      <div
        className={`relative z-10 w-full ${widthClass} transform overflow-hidden rounded-lg bg-white ring-1 ring-black/10 transition-all ${panelClassName ?? 'shadow-2xl'}`}
        onClick={stopPropagation}
      >
        <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
          <div className="sm:flex sm:items-start">
            {/* Icon */}
            <div
              className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${styles.iconBg} sm:mx-0 sm:h-10 sm:w-10`}
            >
              <span className={`text-xl ${styles.iconColor}`}>{styles.icon}</span>
            </div>

            {/* Content */}
            <div
              className={`mt-3 text-center ${isRTL ? 'sm:mr-4' : 'sm:ml-4'} sm:mt-0 ${isRTL ? 'sm:text-right' : 'sm:text-left'} flex-1`}
            >
              <h3 className={`text-base font-semibold leading-6 ${styles.titleColor}`}>{title}</h3>
              <div className="mt-2">
                <p className="text-gray-500">{message}</p>
                {children && <div className="mt-4">{children}</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        {!hideActions && (
          <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6 gap-3">
            <button
              type="button"
              className={`inline-flex w-full justify-center rounded-md px-3 py-2 font-semibold shadow-sm sm:ml-3 sm:w-auto transition-colors ${confirmBtnColors}`}
              onClick={handleConfirmClick}
            >
              {confirmText || t('actions.confirm', 'Confirm')}
            </button>
            <button
              type="button"
              className={`mt-3 inline-flex w-full justify-center rounded-md px-3 py-2 font-semibold shadow-sm sm:mt-0 sm:w-auto transition-colors ${cancelBtnColors}`}
              onClick={onCancel}
            >
              {cancelText || t('actions.cancel', 'Cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfirmDialog;