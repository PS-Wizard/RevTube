import React, { createContext, useContext, useState, useCallback } from 'react';
import { AlertTriangle, Info, CheckCircle2, HelpCircle } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'ghost' | 'secondary' | 'cta';
  icon?: React.ReactNode;
}

export interface AlertOptions {
  title?: string;
  message: string;
  buttonLabel?: string;
  variant?: 'info' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
}

interface DialogContextType {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alert: (options: AlertOptions | string) => Promise<void>;
}

const DialogContext = createContext<DialogContextType | null>(null);

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const [alertState, setAlertState] = useState<{
    open: boolean;
    options: AlertOptions;
    resolve: () => void;
  } | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const opts: ConfirmOptions =
      typeof options === 'string' ? { message: options } : options;

    return new Promise<boolean>((resolve) => {
      setConfirmState({
        open: true,
        options: opts,
        resolve,
      });
    });
  }, []);

  const alert = useCallback((options: AlertOptions | string) => {
    const opts: AlertOptions =
      typeof options === 'string' ? { message: options } : options;

    return new Promise<void>((resolve) => {
      setAlertState({
        open: true,
        options: opts,
        resolve,
      });
    });
  }, []);

  const handleConfirmClose = (result: boolean) => {
    if (confirmState) {
      confirmState.resolve(result);
      setConfirmState(null);
    }
  };

  const handleAlertClose = () => {
    if (alertState) {
      alertState.resolve();
      setAlertState(null);
    }
  };

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}

      {/* Global Confirm Modal */}
      {confirmState && (
        <Modal
          open={confirmState.open}
          onClose={() => handleConfirmClose(false)}
          title={confirmState.options.title || 'Please confirm'}
          icon={
            confirmState.options.icon ||
            (confirmState.options.variant === 'danger' ? (
              <AlertTriangle size={20} style={{ color: 'var(--rt-color-danger)' }} />
            ) : (
              <HelpCircle size={20} style={{ color: 'var(--rt-color-accent)' }} />
            ))
          }
          maxWidth="xs"
          footer={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleConfirmClose(false)}
              >
                {confirmState.options.cancelLabel || 'Cancel'}
              </Button>
              <Button
                type="button"
                variant={confirmState.options.variant || 'danger'}
                size="sm"
                onClick={() => handleConfirmClose(true)}
              >
                {confirmState.options.confirmLabel || 'Confirm'}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-sm)', lineHeight: 1.5 }}>
            {confirmState.options.message}
          </p>
        </Modal>
      )}

      {/* Global Alert Modal */}
      {alertState && (
        <Modal
          open={alertState.open}
          onClose={handleAlertClose}
          title={alertState.options.title || 'Notification'}
          icon={
            alertState.options.icon ||
            (alertState.options.variant === 'danger' ? (
              <AlertTriangle size={20} style={{ color: 'var(--rt-color-danger)' }} />
            ) : alertState.options.variant === 'success' ? (
              <CheckCircle2 size={20} style={{ color: 'var(--rt-color-success)' }} />
            ) : (
              <Info size={20} style={{ color: 'var(--rt-color-accent)' }} />
            ))
          }
          maxWidth="xs"
          footer={
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleAlertClose}
            >
              {alertState.options.buttonLabel || 'OK'}
            </Button>
          }
        >
          <p style={{ margin: 0, color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-sm)', lineHeight: 1.5 }}>
            {alertState.options.message}
          </p>
        </Modal>
      )}
    </DialogContext.Provider>
  );
};

export const useDialogContext = () => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialogContext must be used within a DialogProvider');
  }
  return context;
};
