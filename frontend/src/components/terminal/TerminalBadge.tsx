import type { ReactNode } from "react";

type Variant = "neutral" | "live" | "mock" | "warn" | "success" | "danger" | "info" | "accent";
type Size = "sm" | "md";

type Props = {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
};

const variants: Record<Variant, string> = {
  neutral: "border-terminal-border text-terminal-muted",
  live: "border-terminal-pos text-terminal-pos bg-terminal-pos/10",
  mock: "border-terminal-warn text-terminal-warn bg-terminal-warn/10",
  warn: "border-terminal-neg text-terminal-neg bg-terminal-neg/10",
  success: "border-terminal-pos text-terminal-pos bg-terminal-pos/10",
  danger: "border-terminal-neg text-terminal-neg bg-terminal-neg/10",
  info: "border-terminal-border text-terminal-text bg-terminal-bg/50",
  accent: "border-terminal-accent text-terminal-accent bg-terminal-accent/10",
};

const sizes: Record<Size, string> = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-[11px]",
};

export function TerminalBadge({ children, variant = "neutral", size = "sm", className = "" }: Props) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-sm border ot-type-badge",
        sizes[size],
        variants[variant],
        className,
      ]
        .join(" ")
        .trim()}
    >
      {children}
    </span>
  );
}
