import type { ReactNode } from "react";

type Variant = "info" | "success" | "warning" | "danger";

type ToastProps = {
  title?: string;
  message: ReactNode;
  variant?: Variant;
  size?: "sm" | "md";
  action?: ReactNode;
  className?: string;
};

const variantClass: Record<Variant, string> = {
  info: "border-terminal-border bg-terminal-panel",
  success: "border-terminal-pos bg-terminal-pos/10",
  warning: "border-terminal-warn bg-terminal-warn/10",
  danger: "border-terminal-neg bg-terminal-neg/10",
};

const sizeClass = {
  sm: "px-2.5 py-2",
  md: "px-3 py-2.5",
} as const;

export function TerminalToast({ title, message, variant = "info", size = "md", action, className = "" }: ToastProps) {
  const liveMode = variant === "danger" ? "assertive" : "polite";
  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      aria-live={liveMode}
      className={`rounded-sm border shadow-lg ${sizeClass[size]} ${variantClass[variant]} ${className}`.trim()}
    >
      {title ? (
        <div className={`ot-type-panel-title mb-1 ${variant === "danger" ? "text-terminal-neg" : variant === "warning" ? "text-terminal-warn" : "text-terminal-accent"}`}>
          {title}
        </div>
      ) : null}
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
