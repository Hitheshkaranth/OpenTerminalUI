import { useEffect, useState } from "react";

export function InstallPromptBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || hidden) return null;

  return (
    <div className="fixed bottom-16 left-2 right-2 z-50 rounded border border-terminal-accent bg-terminal-panel p-2 text-xs md:bottom-3 md:left-auto md:right-3 md:w-80">
      <div className="mb-1 text-terminal-text">Install OpenTerminalUI for app-like experience.</div>
      <div className="flex gap-2">
        <button
          className="rounded border border-terminal-accent px-2 py-1 text-terminal-accent"
          onClick={async () => {
            await deferredPrompt.prompt();
            setDeferredPrompt(null);
          }}
        >
          Install
        </button>
        <button className="rounded border border-terminal-border px-2 py-1 text-terminal-muted" onClick={() => setHidden(true)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
