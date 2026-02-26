import { useId, useState, type ReactNode } from "react";

type Props = {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom";
};

export function TerminalTooltip({ content, children, className = "", side = "top" }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span
      className={`relative inline-flex ${className}`.trim()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-40 w-max max-w-60 -translate-x-1/2 rounded-sm border border-terminal-border bg-terminal-panel px-2 py-1 ot-type-ui text-[11px] text-terminal-text shadow-lg ${
            side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
          }`}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
