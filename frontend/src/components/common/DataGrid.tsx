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
}: Props<T>) {
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
      density={density}
      stickyHeader={stickyHeader}
      selectedIndex={selectedIndex}
      onRowSelect={onRowSelect}
      onRowOpen={onRowOpen}
      emptyText={emptyText}
      rowActions={rowActions}
    />
  );
}
