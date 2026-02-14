import type { ReactNode } from "react";

type Props = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function TerminalPanel({ title, subtitle, actions, children, className = "", bodyClassName = "" }: Props) {
  return (
    <section className={`rounded-sm border border-terminal-border bg-terminal-panel ${className}`.trim()}>
      {(title || subtitle || actions) && (
        <header className="flex items-center justify-between border-b border-terminal-border px-2 py-1">
          <div className="min-w-0">
            {title && <div className="text-[11px] font-semibold uppercase tracking-wide text-terminal-accent">{title}</div>}
            {subtitle && <div className="truncate text-[10px] uppercase tracking-wide text-terminal-muted">{subtitle}</div>}
          </div>
          {actions && <div className="ml-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={`p-2 ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}
