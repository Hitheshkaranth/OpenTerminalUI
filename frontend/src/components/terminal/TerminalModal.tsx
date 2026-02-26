import { useEffect, useId, type ReactNode } from "react";
import { TerminalButton } from "./TerminalButton";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  closeOnOverlayClick?: boolean;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  closeLabel?: string;
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
  size = "md",
  busy = false,
  closeLabel = "Close",
}: Props) {
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
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
        if (!closeOnOverlayClick || busy) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-busy={busy || undefined}
        className={`w-full ${
          size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl"
        } rounded-sm border border-terminal-border bg-terminal-panel shadow-2xl ${className}`.trim()}
      >
        {(title || subtitle) && (
          <header className="flex items-start justify-between gap-2 border-b border-terminal-border px-3 py-2">
            <div className="min-w-0">
              {title ? <div id={titleId} className="ot-type-panel-title text-terminal-accent">{title}</div> : null}
              {subtitle ? <div id={subtitleId} className="ot-type-panel-subtitle truncate text-terminal-muted">{subtitle}</div> : null}
            </div>
            <TerminalButton
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
              aria-label="Close modal"
            >
              {closeLabel}
            </TerminalButton>
          </header>
        )}
        <div className={`p-3 ${busy ? "cursor-wait" : ""}`.trim()}>{children}</div>
        {footer ? <footer className="border-t border-terminal-border px-3 py-2">{footer}</footer> : null}
      </div>
    </div>
  );
}
