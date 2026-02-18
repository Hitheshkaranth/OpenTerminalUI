import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "accent" | "danger";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const variants: Record<Variant, string> = {
  default: "border-terminal-border text-terminal-muted hover:text-terminal-text",
  accent: "border-terminal-accent bg-terminal-accent/20 text-terminal-accent hover:bg-terminal-accent/30",
  danger: "border-terminal-neg bg-terminal-neg/10 text-terminal-neg hover:bg-terminal-neg/20",
};

export function TerminalButton({ variant = "default", className = "", ...props }: Props) {
  return (
    <button
      {...props}
      className={`min-h-11 rounded-sm border px-2 py-1 text-[11px] uppercase tracking-wide ${variants[variant]} ${className}`.trim()}
    />
  );
}
