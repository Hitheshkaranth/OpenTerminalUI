import { useEffect, useState } from "react";
import { useShortcutStore } from "../../store/shortcutStore";
import { TerminalPanel } from "../terminal/TerminalPanel";

export function ShortcutOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const { shortcuts } = useShortcutStore();

  useEffect(() => {
    const handleAction = (e: any) => {
      if (e.detail === "show-shortcuts") {
        setIsOpen(true);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("otui-action", handleAction);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("otui-action", handleAction);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl">
        <TerminalPanel title="Keyboard Shortcuts" actions={
          <button onClick={() => setIsOpen(false)} className="text-terminal-muted hover:text-terminal-text">Close (Esc)</button>
        }>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 p-4">
            {["navigation", "trading", "general"].map((cat) => (
              <div key={cat} className="space-y-2">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-terminal-accent/70 border-b border-terminal-border pb-1">
                  {cat}
                </h4>
                {shortcuts.filter(s => s.category === cat).map(s => (
                  <div key={s.id} className="flex items-center justify-between text-xs">
                    <span className="text-terminal-text">{s.label}</span>
                    <kbd className="rounded border border-terminal-border bg-terminal-bg px-1.5 py-0.5 font-mono text-[10px] text-terminal-accent shadow-sm">
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </TerminalPanel>
      </div>
    </div>
  );
}
