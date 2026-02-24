import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type SharedProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
};

type InputProps = SharedProps &
  InputHTMLAttributes<HTMLInputElement> & {
    as?: "input";
  };

type SelectProps = SharedProps &
  SelectHTMLAttributes<HTMLSelectElement> & {
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

function buildInputClass(size: "sm" | "md" | "lg", invalid: boolean, className: string) {
  return [
    baseClass,
    "ot-type-data",
    invalid ? "border-terminal-neg focus:border-terminal-neg" : "border-terminal-border focus:border-terminal-accent",
    "focus-visible:ring-1 focus-visible:ring-terminal-accent/40",
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
  if (props.as === "select") {
    const { as: _as, className = "", children, size: _size, invalid: _invalid, ...rest } = props;
    return (
      <select {...rest} className={buildInputClass(size, invalid, className)}>
        {children}
      </select>
    );
  }
  if (props.as === "textarea") {
    const { as: _as, className = "", size: _size, invalid: _invalid, rows = 4, ...rest } = props;
    return (
      <textarea
        {...rest}
        rows={rows}
        className={buildInputClass(size, invalid, `py-2 align-top ${className}`.trim())}
      />
    );
  }
  const { as: _as, className = "", size: _size, invalid: _invalid, ...rest } = props;
  return <input {...rest} className={buildInputClass(size, invalid, className)} />;
}
