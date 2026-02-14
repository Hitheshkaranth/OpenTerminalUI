import type { ReactNode } from "react";

type Variant = "neutral" | "live" | "mock" | "warn";

type Props = {
  children: ReactNode;
  variant?: Variant;
  className?: string;
};

const variants: Record<Variant, string> = {
  neutral: "border-terminal-border text-terminal-muted",
  live: "border-terminal-pos text-terminal-pos bg-terminal-pos/10",
  mock: "border-terminal-warn text-terminal-warn bg-terminal-warn/10",
  warn: "border-terminal-neg text-terminal-neg bg-terminal-neg/10",
};

export function TerminalBadge({ children, variant = "neutral", className = "" }: Props) {
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wide ${variants[variant]} ${className}`.trim()}>
      {children}
    </span>
  );
}
