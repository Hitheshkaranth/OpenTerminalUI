import type { ReactNode } from "react";

type Variant = "info" | "success" | "warning" | "danger";

type ToastProps = {
  title?: string;
  message: ReactNode;
  variant?: Variant;
  action?: ReactNode;
  className?: string;
};

const variantClass: Record<Variant, string> = {
  info: "border-terminal-border",
  success: "border-terminal-pos",
  warning: "border-terminal-warn",
  danger: "border-terminal-neg",
};

export function TerminalToast({ title, message, variant = "info", action, className = "" }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-sm border bg-terminal-panel px-3 py-2 shadow-lg ${variantClass[variant]} ${className}`.trim()}
    >
      {title ? <div className="ot-type-panel-title mb-1 text-terminal-accent">{title}</div> : null}
      <div className="ot-type-ui text-xs text-terminal-text">{message}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

type ViewportProps = {
  children: ReactNode;
  className?: string;
};

export function TerminalToastViewport({ children, className = "" }: ViewportProps) {
  return (
    <div className={`fixed right-3 top-3 z-50 flex w-[min(420px,calc(100vw-24px))] flex-col gap-2 ${className}`.trim()}>
      {children}
    </div>
  );
}
