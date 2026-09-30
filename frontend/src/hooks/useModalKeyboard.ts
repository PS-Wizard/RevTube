import { useEffect } from 'react';

/**
 * Calls `onClose` when the Escape key is pressed while a modal is open.
 * Pass `isOpen` so the listener is only active when the modal is visible.
 */
export function useModalKeyboard(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
}
