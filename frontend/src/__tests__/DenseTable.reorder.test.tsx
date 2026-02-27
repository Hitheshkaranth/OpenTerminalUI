import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { DenseTable, type DenseTableColumn } from "../components/terminal/DenseTable";

type Row = { symbol: string; price: number; change: number };

const rows: Row[] = [{ symbol: "AAPL", price: 200.12, change: 1.2 }];
const columns: DenseTableColumn<Row>[] = [
  { key: "symbol", title: "Symbol", type: "text", sortable: true, getValue: (r) => r.symbol },
  { key: "price", title: "Price", type: "number", align: "right", sortable: true, getValue: (r) => r.price },
  { key: "change", title: "Change", type: "percent", align: "right", sortable: true, getValue: (r) => r.change },
];

describe("DenseTable column reorder persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists drag-drop header reorder to localStorage", async () => {
    render(
      <DenseTable<Row>
        id="dense-reorder-test"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.symbol}
        height={220}
      />,
    );

    const symbolHeader = screen.getByTitle("Symbol").closest("div[draggable='true']");
    const changeHeader = screen.getByTitle("Change").closest("div[draggable='true']");
    expect(symbolHeader).toBeTruthy();
    expect(changeHeader).toBeTruthy();

    const dataTransfer = {
      effectAllowed: "move",
      setData: () => undefined,
      getData: () => "change",
    } as unknown as DataTransfer;

    fireEvent.dragStart(changeHeader as Element, { dataTransfer });
    fireEvent.dragOver(symbolHeader as Element);
    fireEvent.drop(symbolHeader as Element, { dataTransfer });

    await waitFor(() => {
      const raw = localStorage.getItem("dense-table:dense-reorder-test:columns:v1");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw ?? "{}") as { order?: string[] };
      expect(parsed.order?.[0]).toBe("change");
    });
  });
});
