import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type SharedProps = {
  className?: string;
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

type Props = InputProps | SelectProps;

const baseClass =
  "rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 text-[11px] outline-none focus:border-terminal-accent";

export function TerminalInput(props: Props) {
  if (props.as === "select") {
    const { as: _as, className = "", children, ...rest } = props;
    return (
      <select {...rest} className={`${baseClass} ${className}`.trim()}>
        {children}
      </select>
    );
  }
  const { as: _as, className = "", ...rest } = props;
  return <input {...rest} className={`${baseClass} ${className}`.trim()} />;
}
