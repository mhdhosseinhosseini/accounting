/**
 * ActionsBar
 * Renders Save and Cancel actions for the receipt form.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';

export interface ActionsBarProps {
  disabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Simple actions toolbar.
 * - Save uses primary theme color.
 * - Cancel uses secondary theme color.
 */
export const ActionsBar: React.FC<ActionsBarProps> = ({ disabled, onSave, onCancel }) => {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2 justify-end mt-4">
      <Button onClick={onCancel} variant="secondary">{t('actions.cancel', 'Cancel')}</Button>
      <Button onClick={onSave} disabled={disabled} variant="primary">{t('actions.save', 'Save')}</Button>
    </div>
  );
};

export default ActionsBar;