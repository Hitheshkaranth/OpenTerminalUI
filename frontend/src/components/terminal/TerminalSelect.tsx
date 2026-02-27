import type { ReactNode, SelectHTMLAttributes } from "react";

type TerminalSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  tone?: "data" | "ui";
  loading?: boolean;
  children: ReactNode;
};

const sizeClass = {
  sm: "min-h-8 px-2 py-1 text-[11px]",
  md: "min-h-10 px-2.5 py-1.5 text-[11px]",
  lg: "min-h-11 px-2.5 py-1.5 text-xs",
} as const;

export function TerminalSelect({
  size = "lg",
  invalid = false,
  tone = "ui",
  loading = false,
  disabled,
  className = "",
  children,
  ...props
}: TerminalSelectProps) {
  return (
    <span className="relative inline-flex w-full">
      <select
        {...props}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={[
          "w-full appearance-none rounded-sm border bg-terminal-bg pr-7 outline-none transition-colors",
          tone === "data" ? "ot-type-data" : "ot-type-ui",
          invalid ? "border-terminal-neg focus:border-terminal-neg" : "border-terminal-border focus:border-terminal-accent",
          "focus-visible:ring-1 focus-visible:ring-terminal-accent/40",
          "disabled:cursor-not-allowed disabled:opacity-60",
          loading ? "cursor-wait" : "",
          sizeClass[size],
          className,
        ]
          .join(" ")
          .trim()}
      >
        {children}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2 inline-flex items-center text-[9px] text-terminal-muted">
        v
      </span>
    </span>
  );
}
