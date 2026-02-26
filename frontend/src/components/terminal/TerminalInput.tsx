import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type SharedProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  tone?: "data" | "ui";
  loading?: boolean;
};

type InputProps = SharedProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
    as?: "input";
  };

type SelectProps = SharedProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
    as: "select";
    children: ReactNode;
  };

type TextareaProps = SharedProps &
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    as: "textarea";
  };

type Props = InputProps | SelectProps | TextareaProps;

const baseClass = "w-full rounded-sm border bg-terminal-bg outline-none transition-colors";
const sizeClass = {
  sm: "min-h-8 px-2 py-1 text-[11px]",
  md: "min-h-10 px-2.5 py-1.5 text-[11px]",
  lg: "min-h-11 px-2.5 py-1.5 text-xs",
} as const;

function buildInputClass(
  size: "sm" | "md" | "lg",
  invalid: boolean,
  tone: "data" | "ui",
  loading: boolean,
  className: string,
) {
  return [
    baseClass,
    tone === "data" ? "ot-type-data" : "ot-type-ui",
    invalid ? "border-terminal-neg focus:border-terminal-neg" : "border-terminal-border focus:border-terminal-accent",
    "focus-visible:ring-1 focus-visible:ring-terminal-accent/40",
    loading ? "cursor-wait" : "",
    "disabled:cursor-not-allowed disabled:opacity-60",
    sizeClass[size],
    className,
  ]
    .join(" ")
    .trim();
}

export function TerminalInput(props: Props) {
  const size = props.size ?? "lg";
  const invalid = Boolean(props.invalid);
  const tone = props.tone ?? "data";
  const loading = Boolean(props.loading);
  if (props.as === "select") {
    const {
      as: _as,
      className = "",
      children,
      size: _size,
      invalid: _invalid,
      tone: _tone,
      loading: _loading,
      ...rest
    } = props;
    return (
      <select {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={buildInputClass(size, invalid, tone, loading, className)}>
        {children}
      </select>
    );
  }
  if (props.as === "textarea") {
    const {
      as: _as,
      className = "",
      size: _size,
      invalid: _invalid,
      tone: _tone,
      loading: _loading,
      rows = 4,
      ...rest
    } = props;
    return (
      <textarea
        {...rest}
        disabled={rest.disabled || loading}
        aria-busy={loading || undefined}
        rows={rows}
        className={buildInputClass(size, invalid, tone, loading, `py-2 align-top ${className}`.trim())}
      />
    );
  }
  const { as: _as, className = "", size: _size, invalid: _invalid, tone: _tone, loading: _loading, ...rest } = props;
  return <input {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={buildInputClass(size, invalid, tone, loading, className)} />;
}
