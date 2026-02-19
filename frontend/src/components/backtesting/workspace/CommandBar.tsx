import { useEffect, useMemo, useState } from "react";

type CommandBarProps = {
  onSelectCommand: (command: string) => void;
};

const COMMANDS = ["/bt run", "/chart equity", "/chart drawdown", "/chart monthly", "/risk summary"];

export function CommandBar({ onSelectCommand }: CommandBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setOpen((v) => !v);
      }
      if (ev.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const items = useMemo(
    () => COMMANDS.filter((cmd) => cmd.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24">
      <div className="w-full max-w-xl rounded border border-terminal-border bg-terminal-bg shadow-xl">
        <input
          autoFocus
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          placeholder="Type /bt, /chart, /risk..."
          className="w-full border-b border-terminal-border bg-terminal-bg px-3 py-2 text-sm outline-none"
        />
        <div className="max-h-64 overflow-auto p-2">
          {items.map((item) => (
            <button
              key={item}
              className="block w-full rounded px-2 py-1 text-left text-sm text-terminal-text hover:bg-terminal-accent/15 hover:text-terminal-accent"
              onClick={() => {
                onSelectCommand(item);
                setOpen(false);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
