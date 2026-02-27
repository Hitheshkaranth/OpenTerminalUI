import type { HTMLAttributes, ReactNode } from "react";

type PanelFrameProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "article";
  children: ReactNode;
};

export function PanelFrame({ as = "section", children, className = "", ...rest }: PanelFrameProps) {
  const Tag = as;
  return (
    <Tag
      {...rest}
      className={`rounded-sm border border-terminal-border bg-terminal-panel ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}

type PanelHeaderProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
};

export function PanelHeader({
  title,
  subtitle,
  actions,
  toolbar,
  className = "",
  ...rest
}: PanelHeaderProps) {
  if (!title && !subtitle && !actions && !toolbar) return null;

  return (
    <header {...rest} className={`border-b border-terminal-border ${className}`.trim()}>
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <div className="min-w-0">
          {title ? <div className="ot-type-panel-title text-terminal-accent">{title}</div> : null}
          {subtitle ? <div className="ot-type-panel-subtitle truncate text-terminal-muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="ml-2 shrink-0">{actions}</div> : null}
      </div>
      {toolbar ? <div className="border-t border-terminal-border/60 px-2 py-1">{toolbar}</div> : null}
    </header>
  );
}

type PanelBodyProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function PanelBody({ children, className = "", ...rest }: PanelBodyProps) {
  return (
    <div {...rest} className={`p-2 ${className}`.trim()}>
      {children}
    </div>
  );
}

type PanelFooterProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function PanelFooter({ children, className = "", ...rest }: PanelFooterProps) {
  return (
    <footer {...rest} className={`border-t border-terminal-border px-2 py-1 ${className}`.trim()}>
      {children}
    </footer>
  );
}
