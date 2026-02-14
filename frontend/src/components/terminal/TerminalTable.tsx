import type { ReactNode } from "react";

type Column<T> = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  widthClassName?: string;
  render: (row: T, index: number) => ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  selectedIndex?: number;
  onRowSelect?: (index: number) => void;
  className?: string;
  emptyText?: string;
};

function alignClass(align?: "left" | "right" | "center"): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

export function TerminalTable<T>({
  columns,
  rows,
  rowKey,
  selectedIndex,
  onRowSelect,
  className = "",
  emptyText = "No rows",
}: Props<T>) {
  return (
    <div className={`overflow-auto ${className}`.trim()}>
      <table className="min-w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-terminal-panel">
          <tr className="border-b border-terminal-border text-[10px] uppercase tracking-wide text-terminal-muted">
            {columns.map((column) => (
              <th key={column.key} className={`px-2 py-1 ${alignClass(column.align)} ${column.widthClassName ?? ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="border-b border-terminal-border/40">
              <td className="px-2 py-3 text-center text-terminal-muted" colSpan={columns.length}>
                {emptyText}
              </td>
            </tr>
          )}
          {rows.map((row, index) => {
            const selected = selectedIndex === index;
            return (
              <tr
                key={rowKey(row, index)}
                onClick={() => onRowSelect?.(index)}
                className={`border-b border-terminal-border/40 ${selected ? "bg-terminal-accent/10" : "hover:bg-terminal-bg/70"}`}
              >
                {columns.map((column) => (
                  <td key={column.key} className={`px-2 py-1 tabular-nums ${alignClass(column.align)} ${column.widthClassName ?? ""}`}>
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
