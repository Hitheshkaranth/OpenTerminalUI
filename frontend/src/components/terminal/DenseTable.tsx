import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
} from "react";
import { Download, GripVertical, MoreHorizontal } from "lucide-react";

export type DenseTableColumnType = "text" | "number" | "currency" | "percent" | "volume" | "large-number" | "sparkline";
export type DenseTableSortDirection = "asc" | "desc" | "none";

export type DenseTableColumn<T> = {
  key: string;
  title: string;
  width?: number;
  minWidth?: number;
  align?: "left" | "right" | "center";
  type?: DenseTableColumnType;
  sortable?: boolean;
  frozen?: boolean;
  hidden?: boolean;
  getValue?: (row: T, index: number) => unknown;
  render?: (row: T, index: number) => ReactNode;
};

function MiniSparkline({ values }: { values: number[] }) {
  if (!values.length) return <span className="text-terminal-muted">-</span>;
  const nums = values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const width = 60;
  const height = 18;
  const span = Math.max(1, max - min);
  const points = nums
    .map((v, idx) => {
      const x = (idx / Math.max(1, nums.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline fill="none" stroke="#FF6B00" strokeWidth="1.2" points={points} />
    </svg>
  );
}

type SortState = { key: string; direction: DenseTableSortDirection };

type ContextMenuState<T> = {
  row: T;
  index: number;
  x: number;
  y: number;
} | null;

type Props<T> = {
  id: string;
  rows: T[];
  columns: DenseTableColumn<T>[];
  rowKey: (row: T, index: number) => string;
  height?: number;
  rowHeight?: number;
  headerHeight?: number;
  className?: string;
  onRowClick?: (row: T, index: number) => void;
  onRowOpenInChart?: (row: T, index: number) => void;
  onAddToWatchlist?: (row: T, index: number) => void;
  onAddToPortfolio?: (row: T, index: number) => void;
  onViewDetails?: (row: T, index: number) => void;
  csvFileName?: string;
  bufferRows?: number;
};

type PersistedColumnState = {
  order: string[];
  widths: Record<string, number>;
  hidden: string[];
};

const DEFAULT_ROW_HEIGHT = 26;
const DEFAULT_HEADER_HEIGHT = 28;

function formatNumber(value: unknown, type: DenseTableColumnType = "number") {
  const n = Number(value);
  if (!Number.isFinite(n)) return value == null ? "-" : String(value);
  if (type === "currency") {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (type === "percent") {
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  }
  if (type === "volume") {
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  if (type === "large-number") {
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
    if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function rowSelectionRange(anchor: number, current: number) {
  const [start, end] = anchor <= current ? [anchor, current] : [current, anchor];
  const out = new Set<number>();
  for (let i = start; i <= end; i += 1) out.add(i);
  return out;
}

export function DenseTable<T>({
  id,
  rows,
  columns,
  rowKey,
  height = 420,
  rowHeight = DEFAULT_ROW_HEIGHT,
  headerHeight = DEFAULT_HEADER_HEIGHT,
  className = "",
  onRowClick,
  onRowOpenInChart,
  onAddToWatchlist,
  onAddToPortfolio,
  onViewDetails,
  csvFileName = "dense-table-export.csv",
  bufferRows = 20,
}: Props<T>) {
  const storageKey = `dense-table:${id}:columns:v1`;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState<T>>(null);
  const [columnMenuKey, setColumnMenuKey] = useState<string | null>(null);
  const [draggedColumnKey, setDraggedColumnKey] = useState<string | null>(null);
  const [columnState, setColumnState] = useState<PersistedColumnState>(() => {
    if (typeof window === "undefined") return { order: [], widths: {}, hidden: [] };
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { order: [], widths: {}, hidden: [] };
      const parsed = JSON.parse(raw) as PersistedColumnState;
      return {
        order: Array.isArray(parsed.order) ? parsed.order : [],
        widths: parsed.widths && typeof parsed.widths === "object" ? parsed.widths : {},
        hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      };
    } catch {
      return { order: [], widths: {}, hidden: [] };
    }
  });
  const [flashCells, setFlashCells] = useState<Record<string, "up" | "down">>({});
  const prevValuesRef = useRef<Record<string, unknown>>({});

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(columnState));
    } catch {
      // ignore
    }
  }, [columnState, storageKey]);

  useEffect(() => {
    const nextFlash: Record<string, "up" | "down"> = {};
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      columns.forEach((col) => {
        const type = col.type ?? "text";
        if (!["number", "currency", "percent", "volume", "large-number"].includes(type)) return;
        const value = col.getValue ? col.getValue(row, rowIndex) : null;
        const key = `${rowKey(row, rowIndex)}::${col.key}`;
        const prev = prevValuesRef.current[key];
        const nv = Number(value);
        const pv = Number(prev);
        if (Number.isFinite(nv) && Number.isFinite(pv) && nv !== pv) {
          nextFlash[key] = nv > pv ? "up" : "down";
        }
        prevValuesRef.current[key] = value;
      });
    }
    if (!Object.keys(nextFlash).length) return;
    setFlashCells((prev) => ({ ...prev, ...nextFlash }));
    const timer = setTimeout(() => {
      setFlashCells((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(nextFlash)) delete next[key];
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [columns, rowKey, rows]);

  const orderedColumns = useMemo(() => {
    const base = [...columns];
    const order = columnState.order;
    const rank = new Map(order.map((key, idx) => [key, idx]));
    base.sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
    return base
      .map((col) => ({
        ...col,
        width: columnState.widths[col.key] ?? col.width ?? (col.type === "sparkline" ? 90 : 140),
        hidden: columnState.hidden.includes(col.key) || col.hidden,
        minWidth: col.minWidth ?? 72,
      }))
      .filter((col) => !col.hidden);
  }, [columnState.hidden, columnState.order, columnState.widths, columns]);

  const sortedRows = useMemo(() => {
    if (!sort || sort.direction === "none") return rows.map((row, index) => ({ row, index }));
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows.map((row, index) => ({ row, index }));
    const getValue = col.getValue ?? ((row: T) => (row as Record<string, unknown>)[col.key]);
    const arr = rows.map((row, index) => ({ row, index, v: getValue(row, index) }));
    arr.sort((a, b) => {
      const c = compareValues(a.v, b.v);
      return sort.direction === "asc" ? c : -c;
    });
    return arr.map(({ row, index }) => ({ row, index }));
  }, [columns, rows, sort]);

  const viewportHeight = Math.max(100, height - headerHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows);
  const endIndex = Math.min(sortedRows.length, startIndex + visibleCount + bufferRows * 2);
  const visibleRows = sortedRows.slice(startIndex, endIndex);
  const topPad = startIndex * rowHeight;
  const bottomPad = Math.max(0, (sortedRows.length - endIndex) * rowHeight);

  const frozenColumns = orderedColumns.filter((c) => c.frozen);
  const normalColumns = orderedColumns.filter((c) => !c.frozen);

  const totalWidth = orderedColumns.reduce((sum, c) => sum + (c.width ?? 120), 0);

  const toggleSort = (col: DenseTableColumn<T>) => {
    if (!col.sortable) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, direction: "asc" };
      if (prev.direction === "asc") return { key: col.key, direction: "desc" };
      if (prev.direction === "desc") return { key: col.key, direction: "none" };
      return { key: col.key, direction: "asc" };
    });
  };

  const beginResize = (key: string, startWidth: number, clientX: number) => {
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(60, startWidth + (ev.clientX - clientX));
      setColumnState((prev) => ({
        ...prev,
        widths: { ...prev.widths, [key]: next },
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const moveColumn = (key: string, dir: -1 | 1) => {
    setColumnState((prev) => {
      const order = prev.order.length ? [...prev.order] : columns.map((c) => c.key);
      const idx = order.indexOf(key);
      if (idx < 0) return prev;
      const nextIdx = Math.max(0, Math.min(order.length - 1, idx + dir));
      if (nextIdx === idx) return prev;
      const tmp = order[idx];
      order[idx] = order[nextIdx];
      order[nextIdx] = tmp;
      return { ...prev, order };
    });
  };

  const reorderColumn = (sourceKey: string, targetKey: string) => {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    setColumnState((prev) => {
      const order = prev.order.length ? [...prev.order] : columns.map((c) => c.key);
      const from = order.indexOf(sourceKey);
      const to = order.indexOf(targetKey);
      if (from < 0 || to < 0 || from === to) return prev;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      return { ...prev, order };
    });
  };

  const exportCsv = () => {
    const cols = orderedColumns;
    const lines = [
      cols.map((c) => `"${c.title.replace(/"/g, '""')}"`).join(","),
      ...sortedRows.map(({ row, index }) =>
        cols
          .map((c) => {
            const v = c.getValue ? c.getValue(row, index) : (row as Record<string, unknown>)[c.key];
            return `"${String(v ?? "").replace(/"/g, '""')}"`;
          })
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderCell = (col: DenseTableColumn<T>, row: T, originalIndex: number) => {
    if (col.render) return col.render(row, originalIndex);
    const raw = col.getValue ? col.getValue(row, originalIndex) : (row as Record<string, unknown>)[col.key];
    if (col.type === "sparkline" && Array.isArray(raw)) {
      return <MiniSparkline values={raw.map((v) => Number(v) || 0)} />;
    }
    return formatNumber(raw, col.type ?? "text");
  };

  const cellAlignClass = (col: DenseTableColumn<T>) =>
    col.align === "center" ? "justify-center text-center" : col.align === "right" ? "justify-end text-right" : "justify-start text-left";

  const cellTypographyClass = (col: DenseTableColumn<T>) =>
    col.type === "text" ? "font-[Inter,var(--ot-font-ui)] text-[12px]" : "ot-type-data text-[11px]";

  useEffect(() => {
    const onGlobal = () => {
      setColumnMenuKey(null);
      setContextMenu(null);
    };
    window.addEventListener("click", onGlobal);
    return () => window.removeEventListener("click", onGlobal);
  }, []);

  const headerCells = (cols: DenseTableColumn<T>[]) =>
    cols.map((col) => {
      const width = (col as DenseTableColumn<T> & { width?: number }).width ?? 120;
      const isSorted = sort?.key === col.key ? sort.direction : "none";
      return (
        <div
          key={col.key}
          className="group relative flex h-7 shrink-0 items-center border-r border-[#242d3a] bg-[#1A2332]"
          style={{ width }}
          draggable
          onDragStart={(e) => {
            setDraggedColumnKey(col.key);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", col.key);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const source = draggedColumnKey || e.dataTransfer.getData("text/plain");
            if (source) reorderColumn(source, col.key);
            setDraggedColumnKey(null);
          }}
          onDragEnd={() => setDraggedColumnKey(null)}
        >
          <button
            type="button"
            className={`flex min-w-0 flex-1 items-center gap-1 px-2 ot-type-table-header uppercase ${col.align === "right" ? "justify-end text-right" : "text-left"} text-[#8B949E] hover:text-terminal-text`}
            onClick={() => toggleSort(col)}
            onContextMenu={(e) => {
              e.preventDefault();
              setColumnMenuKey((prev) => (prev === col.key ? null : col.key));
            }}
            title={col.title}
          >
            <span className="truncate">{col.title}</span>
            {col.sortable ? (
              <span className="text-[10px]">
                {isSorted === "asc" ? "ASC" : isSorted === "desc" ? "DESC" : "SORT"}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className="mr-1 rounded p-0.5 text-terminal-muted hover:text-terminal-text"
            onClick={(e) => {
              e.stopPropagation();
              setColumnMenuKey((prev) => (prev === col.key ? null : col.key));
            }}
            aria-label={`Column menu for ${col.title}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="absolute right-0 top-0 h-full w-1 cursor-col-resize opacity-0 group-hover:opacity-100"
            onPointerDown={(e) => {
              e.preventDefault();
              beginResize(col.key, width, e.clientX);
            }}
            aria-label={`Resize column ${col.title}`}
          />
          {columnMenuKey === col.key ? (
            <div className="absolute right-1 top-7 z-30 w-44 rounded-sm border border-terminal-border bg-[#0F141B] p-1 shadow-xl">
              <button type="button" className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel" onClick={() => moveColumn(col.key, -1)}>
                <GripVertical className="h-3.5 w-3.5" /> Move Left
              </button>
              <button type="button" className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel" onClick={() => moveColumn(col.key, 1)}>
                <GripVertical className="h-3.5 w-3.5" /> Move Right
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel"
                onClick={() => {
                  setColumnState((prev) => ({ ...prev, hidden: [...new Set([...prev.hidden, col.key])] }));
                  setColumnMenuKey(null);
                }}
              >
                Hide Column
              </button>
            </div>
          ) : null}
        </div>
      );
    });

  return (
    <div className={`relative rounded-sm border border-terminal-border bg-[#0D1117] ${className}`.trim()}>
      <div className="flex items-center justify-between border-b border-terminal-border bg-terminal-panel px-2 py-1">
        <div className="inline-flex flex-wrap items-center gap-2 text-[11px] text-terminal-muted">
          <span className="ot-type-label text-terminal-accent">Dense Table</span>
          <span>{rows.length.toLocaleString()} rows</span>
          {columnState.hidden.length ? (
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5 hover:text-terminal-text"
              onClick={() => setColumnState((prev) => ({ ...prev, hidden: [] }))}
            >
              Show Hidden ({columnState.hidden.length})
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-1 rounded-sm border border-terminal-border px-2 py-1 text-[11px] hover:border-terminal-accent hover:text-terminal-accent"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </div>

      <div className="relative" style={{ height }}>
        <div className="absolute inset-0 overflow-auto" onScroll={(e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop)} ref={hostRef}>
          <div style={{ minWidth: totalWidth }}>
            <div className="sticky top-0 z-20 flex border-b border-terminal-border">
              {frozenColumns.length ? (
                <div className="sticky left-0 z-30 flex bg-[#1A2332] shadow-[2px_0_0_0_rgba(0,0,0,0.18)]">{headerCells(frozenColumns)}</div>
              ) : null}
              <div className="flex">{headerCells(normalColumns)}</div>
            </div>

            {topPad > 0 ? <div style={{ height: topPad }} /> : null}

            {visibleRows.map(({ row, index: originalIndex }, visibleIdx) => {
              const key = rowKey(row, originalIndex);
              const selected = selectedRows.has(originalIndex);
              const bgClass = selected
                ? "bg-[#0D2137] border-l-[#FF6B00]"
                : (startIndex + visibleIdx) % 2 === 0
                  ? "bg-[#0D1117]"
                  : "bg-[#0F1319]";
              const rowCls = `${bgClass} hover:bg-[#1A2332] border-l-2 border-l-transparent`;
              const renderRowCells = (cols: DenseTableColumn<T>[]) =>
                cols.map((col) => {
                  const width = (col as DenseTableColumn<T> & { width?: number }).width ?? 120;
                  const cellKey = `${key}::${col.key}`;
                  const flash = flashCells[cellKey];
                  return (
                    <div
                      key={`${key}:${col.key}`}
                      className={`flex h-[26px] shrink-0 items-center border-r border-[#1b2230] px-2 ${cellAlignClass(col)} ${cellTypographyClass(col)} ${
                        flash === "up" ? "bg-emerald-500/10" : flash === "down" ? "bg-rose-500/10" : ""
                      }`}
                      style={{ width }}
                    >
                      <div className="min-w-0 truncate">{renderCell(col, row, originalIndex)}</div>
                    </div>
                  );
                });

              return (
                <div
                  key={key}
                  role="row"
                  className={`relative flex h-[26px] border-b border-[#141b25] ${rowCls}`}
                  onClick={(e) => {
                    if (e.shiftKey && selectionAnchor != null) {
                      setSelectedRows(rowSelectionRange(selectionAnchor, originalIndex));
                    } else if (e.ctrlKey || e.metaKey) {
                      setSelectedRows((prev) => {
                        const next = new Set(prev);
                        if (next.has(originalIndex)) next.delete(originalIndex);
                        else next.add(originalIndex);
                        return next;
                      });
                      setSelectionAnchor(originalIndex);
                    } else {
                      setSelectedRows(new Set([originalIndex]));
                      setSelectionAnchor(originalIndex);
                    }
                    onRowClick?.(row, originalIndex);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ row, index: originalIndex, x: e.clientX, y: e.clientY });
                  }}
                >
                  {frozenColumns.length ? (
                    <div className={`sticky left-0 z-10 flex ${rowCls} shadow-[2px_0_0_0_rgba(0,0,0,0.18)]`}>{renderRowCells(frozenColumns)}</div>
                  ) : null}
                  <div className="flex">{renderRowCells(normalColumns)}</div>
                </div>
              );
            })}

            {bottomPad > 0 ? <div style={{ height: bottomPad }} /> : null}
          </div>
        </div>
      </div>

      {contextMenu ? (
        <div
          className="fixed z-[120] w-48 rounded-sm border border-terminal-border bg-[#0F141B] p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y } as CSSProperties}
        >
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel"
            onClick={() => {
              onRowOpenInChart?.(contextMenu.row, contextMenu.index);
              setContextMenu(null);
            }}
          >
            Load in Chart
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel"
            onClick={() => {
              onAddToWatchlist?.(contextMenu.row, contextMenu.index);
              setContextMenu(null);
            }}
          >
            Add to Watchlist
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel"
            onClick={() => {
              onAddToPortfolio?.(contextMenu.row, contextMenu.index);
              setContextMenu(null);
            }}
          >
            Add to Portfolio
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel"
            onClick={() => {
              onViewDetails?.(contextMenu.row, contextMenu.index);
              setContextMenu(null);
            }}
          >
            View Details
          </button>
        </div>
      ) : null}
    </div>
  );
}
