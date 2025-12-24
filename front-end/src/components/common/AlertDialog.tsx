import React from 'react';
import { useTranslation } from 'react-i18next';

interface AlertDialogProps {
  open: boolean;
  /** Optional title text; when omitted, the header is not rendered. */
  title?: string;
  message: string;
  confirmText?: string;
  onClose: () => void;
  /** When true, shows a dim backdrop; when false, backdrop is transparent. */
  dimBackground?: boolean;
  /** Optional override for backdrop class names (Tailwind). */
  backdropClassName?: string;
  /** Optional alert type for future styling: error, info, success, warning. */
  type?: 'error' | 'info' | 'success' | 'warning';
}

/**
 * AlertDialog component
 * Renders a modal alert dialog used to surface errors, warnings, and messages.
 * - Transparent backdrop by default with no blur
 * - Use `dimBackground` to enable a dimmed backdrop when desired
 */
const AlertDialog: React.FC<AlertDialogProps> = ({
  open,
  title,
  message,
  confirmText,
  onClose,
  dimBackground = false,
  backdropClassName,
}) => {
  const { t, i18n } = useTranslation();
  /**
   * Language-aware layout:
   * - `isFa`: whether current language is Farsi
   * - `dir`: sets document direction for RTL/LTR
   * - `textAlignClass`: aligns content right for Farsi, left otherwise
   */
  const isFa = i18n.language === 'fa';
  const dir = isFa ? 'rtl' : 'ltr';
  const textAlignClass = isFa ? 'text-right' : 'text-left';

  if (!open) return null;

  /**
   * handleContainerClick
   * Closes the alert when clicking outside the dialog panel.
   */
  function handleContainerClick() {
    onClose();
  }

  /**
   * stopPropagation
   * Prevent clicks inside the dialog panel from closing the alert.
   */
  function stopPropagation(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    // Modal root at a high z-index to sit above other overlays
    <div className="fixed inset-0 z-[1600] overflow-y-auto bg-transparent" dir={dir} onClick={handleContainerClick}>
      {/* Backdrop: only when dimBackground is requested */}
      {dimBackground && (
        <div
          className={backdropClassName ?? 'absolute inset-0 bg-black bg-opacity-50 transition-opacity'}
        ></div>
      )}

      {/* Panel */}
      <div className="flex min-h-full items-center justify-center p-4 text-center relative z-10" onClick={stopPropagation}>
        <div className={`w-full max-w-md transform overflow-hidden rounded-lg bg-white p-6 ${textAlignClass} align-middle shadow-2xl ring-1 ring-black/10 transition-all`}>
          {title ? (
            <h3 className={`text-lg font-medium leading-6 text-gray-900 ${textAlignClass}`}>{title}</h3>
          ) : null}
          <div className="mt-2">
            <p className={`text-sm text-gray-500 ${textAlignClass}`}>{message}</p>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="inline-flex justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={onClose}
            >
              {confirmText ?? t('actions.ok', 'OK')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AlertDialog;
