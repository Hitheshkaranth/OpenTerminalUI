type Props = {
  show: boolean;
  onInstall: () => void;
  onDismiss: () => void;
};

export function InstallPrompt({ show, onInstall, onDismiss }: Props) {
  if (!show) return null;

  return (
    <div className="fixed bottom-16 left-2 right-2 z-50 rounded border border-terminal-accent bg-terminal-panel p-3 text-xs md:bottom-3 md:left-auto md:right-3 md:w-96 md:max-w-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="mb-1 text-terminal-text font-medium">Install OpenTerminalUI</div>
          <div className="text-terminal-muted">Get app-like experience with offline access and home screen shortcut.</div>
        </div>
        <button
          className="shrink-0 rounded-sm border border-terminal-border p-1 text-terminal-muted hover:text-terminal-text"
          onClick={onDismiss}
          aria-label="Dismiss install prompt"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          className="rounded border border-terminal-accent px-3 py-1.5 text-terminal-accent hover:bg-terminal-accent/10"
          onClick={onInstall}
        >
          Install
        </button>
        <button
          className="rounded border border-terminal-border px-3 py-1.5 text-terminal-muted hover:text-terminal-text"
          onClick={onDismiss}
        >
          Later
        </button>
      </div>
    </div>
  );
}