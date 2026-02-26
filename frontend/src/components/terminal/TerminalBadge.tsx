import type { ReactNode } from "react";

type Variant = "neutral" | "live" | "mock" | "warn" | "success" | "danger" | "info" | "accent";
type Size = "sm" | "md";

type Props = {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
  dot?: boolean;
};

const variants: Record<Variant, string> = {
  neutral: "border-terminal-border text-terminal-muted",
  live: "border-terminal-pos text-terminal-pos bg-terminal-pos/10",
  mock: "border-terminal-warn text-terminal-warn bg-terminal-warn/10",
  warn: "border-terminal-warn text-terminal-warn bg-terminal-warn/10",
  success: "border-terminal-pos text-terminal-pos bg-terminal-pos/10",
  danger: "border-terminal-neg text-terminal-neg bg-terminal-neg/10",
  info: "border-terminal-border text-terminal-text bg-terminal-bg/50",
  accent: "border-terminal-accent text-terminal-accent bg-terminal-accent/10",
};

const sizes: Record<Size, string> = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-[11px]",
};

export function TerminalBadge({ children, variant = "neutral", size = "sm", className = "", dot = false }: Props) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-sm border ot-type-badge",
        dot ? "gap-1" : "",
        sizes[size],
        variants[variant],
        className,
      ]
        .join(" ")
        .trim()}
    >
      {dot ? <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-[1px] bg-current opacity-90" /> : null}
      {children}
    </span>
  );
}
