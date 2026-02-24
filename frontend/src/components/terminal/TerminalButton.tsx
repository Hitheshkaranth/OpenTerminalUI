import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "accent" | "danger" | "success" | "ghost";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

const variants: Record<Variant, string> = {
  default:
    "border-terminal-border text-terminal-muted hover:border-terminal-border hover:text-terminal-text focus-visible:border-terminal-accent",
  accent:
    "border-terminal-accent bg-terminal-accent/20 text-terminal-accent hover:bg-terminal-accent/30 focus-visible:border-terminal-accent",
  danger:
    "border-terminal-neg bg-terminal-neg/10 text-terminal-neg hover:bg-terminal-neg/20 focus-visible:border-terminal-neg",
  success:
    "border-terminal-pos bg-terminal-pos/10 text-terminal-pos hover:bg-terminal-pos/20 focus-visible:border-terminal-pos",
  ghost:
    "border-transparent text-terminal-muted hover:border-terminal-border hover:bg-terminal-bg hover:text-terminal-text focus-visible:border-terminal-accent",
};

const sizes: Record<Size, string> = {
  sm: "min-h-8 px-2 py-1 text-[10px]",
  md: "min-h-10 px-2.5 py-1.5 text-[11px]",
  lg: "min-h-11 px-3 py-2 text-xs",
};

export function TerminalButton({
  variant = "default",
  size = "lg",
  className = "",
  loading = false,
  disabled,
  leftIcon,
  rightIcon,
  children,
  ...props
}: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded-sm border uppercase tracking-wide",
        "ot-type-label transition-colors outline-none focus-visible:ring-1 focus-visible:ring-terminal-accent/40",
        "disabled:cursor-not-allowed disabled:opacity-60",
        sizes[size],
        variants[variant],
        className,
      ]
        .join(" ")
        .trim()}
    >
      {loading ? <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-sm bg-current opacity-80" aria-hidden="true" /> : leftIcon}
      <span>{children}</span>
      {rightIcon}
    </button>
  );
}
