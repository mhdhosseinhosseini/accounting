import React from 'react';
import { useTranslation } from 'react-i18next';

export interface AlertDialogProps {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
  type?: 'error' | 'warning' | 'info' | 'success';
  /** When true, shows a dim backdrop; when false, backdrop is transparent. */
  dimBackground?: boolean;
  /** Optional override for backdrop class names (Tailwind). */
  backdropClassName?: string;
}

/**
 * AlertDialog component (shared)
 *
 * Renders a modal alert dialog used to surface errors, warnings, and messages.
 * - High z-index so it appears above other dialogs
 * - RTL/LTR support based on current i18n language
 * - Contextual icon and color scheme based on the alert type
 * - Single OK action to dismiss the dialog
 * - Configurable backdrop via `dimBackground` (default true) or `backdropClassName`
 */
const AlertDialog: React.FC<AlertDialogProps> = ({
  open,
  title,
  message,
  onClose,
  type = 'info',
  dimBackground = true,
  backdropClassName,
}) => {
  const { t, i18n } = useTranslation();
  const dir = i18n.language === 'fa' ? 'rtl' : 'ltr';
  const isRTL = i18n.language === 'fa';

  if (!open) return null;

  // Compute styles based on type
  const getTypeStyles = () => {
    switch (type) {
      case 'error':
        return {
          icon: '❌',
          iconBg: 'bg-red-100',
          iconColor: 'text-red-600',
          titleColor: 'text-red-900',
          button: 'bg-red-600 hover:bg-red-700 text-white',
        };
      case 'warning':
        return {
          icon: '⚠️',
          iconBg: 'bg-yellow-100',
          iconColor: 'text-yellow-600',
          titleColor: 'text-yellow-900',
          button: 'bg-yellow-600 hover:bg-yellow-700 text-white',
        };
      case 'success':
        return {
          icon: '✅',
          iconBg: 'bg-green-100',
          iconColor: 'text-green-600',
          titleColor: 'text-green-900',
          button: 'bg-green-600 hover:bg-green-700 text-white',
        };
      default:
        return {
          icon: 'ℹ️',
          iconBg: 'bg-blue-100',
          iconColor: 'text-blue-600',
          titleColor: 'text-blue-900',
          button: 'bg-blue-600 hover:bg-blue-700 text-white',
        };
    }
  };

  const styles = getTypeStyles();
  const displayTitle =
    title ||
    (type === 'error'
      ? t('common.error', 'Error')
      : type === 'warning'
      ? t('common.warning', 'Warning')
      : type === 'success'
      ? t('common.success', 'Success')
      : t('common.info', 'Information'));

  return (
    // Modal root at a high z-index to sit above other overlays
    <div className="fixed inset-0 z-[1600] overflow-y-auto" dir={dir}>
      {/* Backdrop */}
      <div
        className={backdropClassName ?? (dimBackground ? 'fixed inset-0 bg-black bg-opacity-50 transition-opacity' : 'fixed inset-0 bg-transparent')}
        onClick={onClose}
      ></div>

      {/* Dialog container */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative transform overflow-hidden rounded-lg bg-white shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-md">
          <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start">
              {/* Icon */}
              <div className={`mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${styles.iconBg} sm:mx-0 sm:h-10 sm:w-10`}>
                <span className={`text-xl ${styles.iconColor}`}>{styles.icon}</span>
              </div>

              {/* Content */}
              <div className={`mt-3 text-center ${isRTL ? 'sm:mr-4' : 'sm:ml-4'} sm:mt-0 ${isRTL ? 'sm:text-right' : 'sm:text-left'} flex-1`}>
                <h3 className={`text-base font-semibold leading-6 ${styles.titleColor}`}>{displayTitle}</h3>
                <div className="mt-2">
                  <p className="text-gray-500">{message}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              className={`inline-flex w-full justify-center rounded-md px-3 py-2 font-semibold shadow-sm sm:w-auto transition-colors ${styles.button}`}
              onClick={onClose}
            >
              {t('actions.ok', 'OK')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertDialog;