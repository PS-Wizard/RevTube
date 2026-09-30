import { useCallback } from 'react';
import { useDialogContext } from '../contexts/DialogContext';

export type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export const useConfirm = () => {
  let dialogContext: ReturnType<typeof useDialogContext> | null = null;
  try {
    // Attempt to use global dialog context
    dialogContext = useDialogContext();
  } catch {
    // Fallback if rendered outside DialogProvider
  }

  const confirm = useCallback(
    (msg: string, opts?: ConfirmOptions) => {
      if (dialogContext) {
        return dialogContext.confirm({
          message: msg,
          title: opts?.title,
          confirmLabel: opts?.confirmLabel,
          cancelLabel: opts?.cancelLabel,
        });
      }
      // Basic browser confirm fallback if context not available
      return Promise.resolve(window.confirm(msg));
    },
    [dialogContext]
  );

  // Return empty fragment for ConfirmationModal for backwards compatibility
  const ConfirmationModal = () => null;

  return { confirm, ConfirmationModal };
};
