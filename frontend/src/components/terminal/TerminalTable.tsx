import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type TerminalTableAlign = "left" | "right" | "center";
export type TerminalTableDensity = "compact" | "normal" | "comfortable";
export type TerminalTableSortDirection = "asc" | "desc";

export type TerminalTableColumn<T> = {
  key: string;
  label: string;
  align?: TerminalTableAlign;
  widthClassName?: string;
  headerClassName?: string;
  cellClassName?: string;
  sortable?: boolean;
  sortValue?: (row: T, index: number) => string | number | null | undefined;
  render: (row: T, index: number) => ReactNode;
};

type TerminalTableSortState = {
  key: string;
  direction: TerminalTableSortDirection;
};

type Props<T> = {
  columns: TerminalTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  selectedIndex?: number;
  onRowSelect?: (index: number) => void;
  onRowOpen?: (index: number) => void;
  className?: string;
  tableClassName?: string;
  emptyText?: string;
  density?: TerminalTableDensity;
  stickyHeader?: boolean;
  keyboardNavigation?: boolean;
  rowActions?: (row: T, index: number) => ReactNode;
  getRowAriaLabel?: (row: T, index: number) => string;
  initialSort?: TerminalTableSortState;
};

function alignClass(align?: TerminalTableAlign): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

function rowDensityClass(density: TerminalTableDensity): string {
  if (density === "compact") return "h-6";
  if (density === "comfortable") return "h-8";
  return "h-7";
}

function cellPaddingClass(density: TerminalTableDensity): string {
  if (density === "compact") return "px-2 py-0.5";
  if (density === "comfortable") return "px-2.5 py-1.5";
  return "px-2 py-1";
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function TerminalTable<T>({
  columns,
  rows,
  rowKey,
  selectedIndex,
  onRowSelect,
  onRowOpen,
  className = "",
  tableClassName = "",
  emptyText = "No rows",
  density = "normal",
  stickyHeader = true,
  keyboardNavigation = true,
  rowActions,
  getRowAriaLabel,
  initialSort,
}: Props<T>) {
  const [internalSelectedIndex, setInternalSelectedIndex] = useState<number>(selectedIndex ?? 0);
  const [sort, setSort] = useState<TerminalTableSortState | undefined>(initialSort);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedIndex !== undefined) setInternalSelectedIndex(selectedIndex);
  }, [selectedIndex]);

  const effectiveSelectedIndex = selectedIndex ?? internalSelectedIndex;

  const sortedRows = useMemo(() => {
    if (!sort) return rows.map((row, index) => ({ row, originalIndex: index }));
    const column = columns.find((c) => c.key === sort.key);
    if (!column || !column.sortable) return rows.map((row, index) => ({ row, originalIndex: index }));
    const getSortValue =
      column.sortValue ??
      ((row: T, index: number) => {
        const rendered = column.render(row, index);
        return typeof rendered === "string" || typeof rendered === "number" ? rendered : null;
      });
    const next = rows.map((row, index) => ({
      row,
      originalIndex: index,
      sortValue: getSortValue(row, index),
    }));
    next.sort((a, b) => {
      const cmp = compareValues(a.sortValue, b.sortValue);
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return next.map(({ row, originalIndex }) => ({ row, originalIndex }));
  }, [rows, sort, columns]);

  const selectedSortedIndex = useMemo(() => {
    const idx = sortedRows.findIndex((entry) => entry.originalIndex === effectiveSelectedIndex);
    return idx >= 0 ? idx : 0;
  }, [effectiveSelectedIndex, sortedRows]);

  const setSelection = (index: number) => {
    onRowSelect?.(index);
    if (selectedIndex === undefined) setInternalSelectedIndex(index);
  };

  const headerPadding = cellPaddingClass(density);
  const rowHeight = rowDensityClass(density);
  const dataCellPadding = cellPaddingClass(density);

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`.trim()}
      tabIndex={keyboardNavigation ? 0 : -1}
      onKeyDown={
        keyboardNavigation
          ? (event) => {
              if (!rows.length) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                const nextSorted = Math.min(selectedSortedIndex + 1, sortedRows.length - 1);
                const next = sortedRows[nextSorted];
                if (next) setSelection(next.originalIndex);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                const nextSorted = Math.max(selectedSortedIndex - 1, 0);
                const next = sortedRows[nextSorted];
                if (next) setSelection(next.originalIndex);
              } else if (event.key === "Home") {
                event.preventDefault();
                if (sortedRows[0]) setSelection(sortedRows[0].originalIndex);
              } else if (event.key === "End") {
                event.preventDefault();
                if (sortedRows[sortedRows.length - 1]) setSelection(sortedRows[sortedRows.length - 1].originalIndex);
              } else if (event.key === "Enter" && onRowOpen) {
                event.preventDefault();
                if (effectiveSelectedIndex >= 0 && effectiveSelectedIndex < rows.length) onRowOpen(effectiveSelectedIndex);
              }
            }
          : undefined
      }
      role="region"
      aria-label="Data table"
    >
      <table className={`min-w-full border-collapse ${tableClassName}`.trim()}>
        <thead className={`${stickyHeader ? "sticky top-0 z-10" : ""} bg-terminal-panel`}>
          <tr className="border-b border-terminal-border ot-type-table-header text-terminal-muted">
            {columns.map((column) => {
              const sortable = Boolean(column.sortable);
              const isSorted = sort?.key === column.key;
              const sortDir = isSorted ? sort.direction : undefined;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sortable ? (isSorted ? (sortDir === "asc" ? "ascending" : "descending") : "none") : undefined
                  }
                  className={`${headerPadding} ${alignClass(column.align)} ${column.widthClassName ?? ""} ${column.headerClassName ?? ""}`.trim()}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className={`inline-flex w-full items-center gap-1 ot-type-table-header ${alignClass(column.align)} text-terminal-muted hover:text-terminal-text`}
                      onClick={() =>
                        setSort((prev) => {
                          if (!prev || prev.key !== column.key) return { key: column.key, direction: "asc" };
                          return { key: column.key, direction: prev.direction === "asc" ? "desc" : "asc" };
                        })
                      }
                    >
                      <span className={column.align === "right" ? "ml-auto" : ""}>{column.label}</span>
                      <span aria-hidden="true" className="text-[9px]">
                        {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
            {rowActions ? (
              <th scope="col" className={`${headerPadding} text-right ot-type-table-header text-terminal-muted`}>
                Actions
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-b border-terminal-border/40">
              <td className="px-2 py-3 text-center text-terminal-muted ot-type-ui text-xs" colSpan={columns.length + (rowActions ? 1 : 0)}>
                {emptyText}
              </td>
            </tr>
          ) : (
            sortedRows.map(({ row, originalIndex }, sortedIndex) => {
              const selected = effectiveSelectedIndex === originalIndex;
              return (
                <tr
                  key={rowKey(row, originalIndex)}
                  role="row"
                  aria-selected={selected || undefined}
                  aria-label={getRowAriaLabel?.(row, originalIndex)}
                  onClick={() => setSelection(originalIndex)}
                  onDoubleClick={() => onRowOpen?.(originalIndex)}
                  className={`border-b border-terminal-border/40 ${rowHeight} ${
                    selected ? "bg-terminal-accent/10 ring-1 ring-inset ring-terminal-accent/20" : "hover:bg-terminal-bg/70"
                  } ${sortedIndex % 2 === 1 ? "bg-terminal-bg/20" : ""}`}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`${dataCellPadding} ${alignClass(column.align)} ${column.widthClassName ?? ""} ${column.cellClassName ?? ""}`.trim()}
                    >
                      <div className={`flex min-w-0 ${column.align === "right" ? "justify-end" : column.align === "center" ? "justify-center" : ""} ot-type-table-cell tabular-nums`}>
                        {column.render(row, originalIndex)}
                      </div>
                    </td>
                  ))}
                  {rowActions ? (
                    <td className={`${dataCellPadding} text-right`}>
                      <div className="flex justify-end">{rowActions(row, originalIndex)}</div>
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
