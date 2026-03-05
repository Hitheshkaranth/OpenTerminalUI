import type { ReactNode } from "react";

import {
  TerminalTable,
  type TerminalTableAlign,
  type TerminalTableColumn,
  type TerminalTableDensity,
} from "../terminal/TerminalTable";

export type DataGridColumn<T> = {
  key: string;
  header: string;
  align?: TerminalTableAlign;
  widthClassName?: string;
  sortable?: boolean;
  sortValue?: (row: T, index: number) => string | number | null | undefined;
  cellClassName?: string;
  headerClassName?: string;
  renderCell: (row: T, index: number) => ReactNode;
};

export type DataGridPreset = "default" | "watchlist" | "blotter" | "screener" | "option-chain";

type DataGridPresetConfig = {
  density: TerminalTableDensity;
  stickyHeader: boolean;
  keyboardNavigation: boolean;
};

export const DATA_GRID_PRESETS: Record<DataGridPreset, DataGridPresetConfig> = {
  default: { density: "normal", stickyHeader: true, keyboardNavigation: true },
  watchlist: { density: "dense", stickyHeader: true, keyboardNavigation: true },
  blotter: { density: "compact", stickyHeader: true, keyboardNavigation: true },
  screener: { density: "compact", stickyHeader: true, keyboardNavigation: true },
  "option-chain": { density: "dense", stickyHeader: true, keyboardNavigation: true },
};

type Props<T> = {
  columns: DataGridColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  className?: string;
  tableClassName?: string;
  density?: TerminalTableDensity;
  stickyHeader?: boolean;
  selectedIndex?: number;
  onRowSelect?: (index: number) => void;
  onRowOpen?: (index: number) => void;
  emptyText?: string;
  rowActions?: (row: T, index: number) => ReactNode;
  preset?: DataGridPreset;
  keyboardNavigation?: boolean;
};

export function DataGrid<T>({
  columns,
  rows,
  rowKey,
  className,
  tableClassName,
  density = "normal",
  stickyHeader = true,
  selectedIndex,
  onRowSelect,
  onRowOpen,
  emptyText,
  rowActions,
  preset = "default",
  keyboardNavigation,
}: Props<T>) {
  const presetConfig = DATA_GRID_PRESETS[preset];
  const effectiveDensity = density ?? presetConfig.density;
  const effectiveStickyHeader = stickyHeader ?? presetConfig.stickyHeader;
  const effectiveKeyboardNavigation = keyboardNavigation ?? presetConfig.keyboardNavigation;

  const tableColumns: TerminalTableColumn<T>[] = columns.map((column) => ({
    key: column.key,
    label: column.header,
    align: column.align,
    widthClassName: column.widthClassName,
    sortable: column.sortable,
    sortValue: column.sortValue,
    cellClassName: column.cellClassName,
    headerClassName: column.headerClassName,
    render: column.renderCell,
  }));

  return (
    <TerminalTable
      columns={tableColumns}
      rows={rows}
      rowKey={rowKey}
      className={className}
      tableClassName={tableClassName}
      density={effectiveDensity}
      stickyHeader={effectiveStickyHeader}
      keyboardNavigation={effectiveKeyboardNavigation}
      selectedIndex={selectedIndex}
      onRowSelect={onRowSelect}
      onRowOpen={onRowOpen}
      emptyText={emptyText}
      rowActions={rowActions}
    />
  );
}
