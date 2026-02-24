import { useEffect, useRef, useState } from "react";

type DropdownItem = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
};

type Props = {
  label: string;
  items: DropdownItem[];
  onSelect: (id: string) => void;
  className?: string;
  align?: "left" | "right";
};

export function TerminalDropdown({ label, items, onSelect, className = "", align = "left" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`.trim()}>
      <button
        type="button"
        className="inline-flex min-h-9 items-center rounded-sm border border-terminal-border px-2 ot-type-label text-terminal-muted hover:text-terminal-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-terminal-accent/40"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute top-[calc(100%+4px)] z-30 min-w-44 rounded-sm border border-terminal-border bg-terminal-panel p-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left ${
                item.danger ? "text-terminal-neg" : "text-terminal-text"
              } ot-type-ui text-xs hover:bg-terminal-bg disabled:cursor-not-allowed disabled:opacity-50`}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                onSelect(item.id);
              }}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
