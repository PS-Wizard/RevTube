import React from 'react';
import { Modal } from './ui/Modal';
import { Box, Typography } from './ui';
import { AlertTriangle } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Dialog title (default: Please confirm) */
  title?: string;
  /** Primary action label (default: Confirm) */
  confirmLabel?: string;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  message,
  onConfirm,
  onCancel,
  title = 'Please confirm',
  confirmLabel = 'Confirm',
}) => {
  return (
    <Modal
      open={isOpen}
      onClose={onCancel}
      title={title}
      icon={<AlertTriangle size={20} style={{ color: 'var(--rt-color-danger)' }} />}
      maxWidth="sm"
      primaryAction={{
        label: confirmLabel,
        onClick: onConfirm,
        variant: 'danger',
      }}
      secondaryAction={{
        label: 'Cancel',
        onClick: onCancel,
        variant: 'ghost',
      }}
    >
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" style={{ lineHeight: 1.6 }}>{message}</Typography>
      </Box>
    </Modal>
  );
};

export default ConfirmModal;
