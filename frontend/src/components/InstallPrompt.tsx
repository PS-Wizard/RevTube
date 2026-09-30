import { useEffect, useState } from 'react';
import { Button } from './ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed';

/**
 * Small banner offering to install the app (PWA) when the browser fires
 * `beforeinstallprompt`. Hidden on already-installed (standalone) sessions
 * and after the user dismissed it. Shared `ui` primitives + Tailwind only:
 * bottom-sheet card with 44px targets on phones, centered pill on desktop.
 */
export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!installEvent) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setInstallEvent(null);
  };

  const install = async () => {
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  return (
    <div
      role="dialog"
      aria-label="Install app"
      className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-[1200] flex flex-col gap-3 rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-4 shadow-xs sm:bottom-6 sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:flex-row sm:items-center sm:gap-4 sm:p-3 sm:pr-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-[var(--rt-color-text)]">
        <strong>Install TubeKeter</strong>
        <span className="text-[var(--rt-color-text-secondary)]">
          Add the app to your home screen for a full-screen experience.
        </span>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:items-center">
        <Button
          size="sm"
          variant="primary"
          type="button"
          onClick={install}
          className="min-h-[44px] flex-1 text-sm sm:min-h-0 sm:flex-none sm:text-xs"
        >
          Install
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="min-h-[44px] flex-1 text-sm sm:min-h-0 sm:flex-none sm:text-xs"
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
