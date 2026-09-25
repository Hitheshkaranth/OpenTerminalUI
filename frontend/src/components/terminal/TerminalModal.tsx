import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Read latest onClose/busy via refs so the open-effect (which moves focus to the first
  // focusable) runs only when the modal opens — not on every parent render that passes a
  // fresh inline onClose, which would yank focus out of inputs while typing.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) onCloseRef.current();
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = window.requestAnimationFrame(() => {
      const root = dialogRef.current;
      if (!root) return;
      const firstFocusable = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])',
      );
      (firstFocusable ?? root).focus();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.cancelAnimationFrame(raf);
    };
  }, [open]);

  if (!open) return null;

  // Portal to <body>: rendered in place, the overlay's z-50 is trapped inside the page
  // content's stacking context (z-0), so fixed shell chrome such as the mobile bottom nav
  // (z-40) paints over the dialog footer and swallows clicks on its buttons.
  //
  // The single grid column is minmax(0, 1fr): with the implicit `auto` column, a nowrap
  // (truncated) subtitle sizes the track to its full text width, so on phones the dialog
  // grows wider than the viewport and right-aligned actions end up off-screen.
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid grid-cols-[minmax(0,1fr)] place-items-center bg-black/55 p-3"
      onMouseDown={(event) => {
        if (!closeOnOverlayClick || busy) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={subtitle ? subtitleId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={`w-full ${
          size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl"
        } flex max-h-[calc(100dvh-1.5rem)] flex-col rounded-sm border border-terminal-border bg-terminal-panel shadow-2xl ${className}`.trim()}
      >
        {(title || subtitle) && (
          <header className="flex shrink-0 items-start justify-between gap-2 border-b border-terminal-border px-3 py-2">
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
        <div className={`min-h-0 flex-1 overflow-y-auto p-3 ${busy ? "cursor-wait" : ""}`.trim()}>{children}</div>
        {footer ? <footer className="shrink-0 border-t border-terminal-border px-3 py-2">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
