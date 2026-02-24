import { useEffect, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeOnOverlayClick?: boolean;
};

export function TerminalModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className = "",
  closeOnOverlayClick = true,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3"
      onMouseDown={(event) => {
        if (!closeOnOverlayClick) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full max-w-xl rounded-sm border border-terminal-border bg-terminal-panel shadow-2xl ${className}`.trim()}
      >
        {(title || subtitle) && (
          <header className="flex items-start justify-between gap-2 border-b border-terminal-border px-3 py-2">
            <div className="min-w-0">
              {title ? <div className="ot-type-panel-title text-terminal-accent">{title}</div> : null}
              {subtitle ? <div className="ot-type-panel-subtitle truncate text-terminal-muted">{subtitle}</div> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-terminal-border px-2 py-1 ot-type-label text-terminal-muted hover:text-terminal-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-terminal-accent/40"
              aria-label="Close modal"
            >
              Close
            </button>
          </header>
        )}
        <div className="p-3">{children}</div>
        {footer ? <footer className="border-t border-terminal-border px-3 py-2">{footer}</footer> : null}
      </div>
    </div>
  );
}
