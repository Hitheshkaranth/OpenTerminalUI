/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PaperPortfolio, Watchlist } from "../types";
import type { AlertAction } from "../api/alertActions";
import { AlertActionsEditor } from "../components/Alerts/AlertActionsEditor";

const MOCK_PORTFOLIOS: PaperPortfolio[] = [
  { id: "p1", name: "Test Portfolio", initial_capital: 100000, current_cash: 80000 },
];

const MOCK_WATCHLISTS: Watchlist[] = [
  { id: "w1", name: "My Watchlist", symbols: ["AAPL"], column_config: {}, created_at: "2024-01-01" },
];

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
}

function TestWrapper({ children, providedQueryClient }: { children: React.ReactNode; providedQueryClient?: ReturnType<typeof createQueryClient> }) {
  const queryClient = providedQueryClient ?? createQueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function StatefulEditor({
  initialActions = [],
  onChange,
  alertId = null,
  queryClient: providedQueryClient,
}: {
  initialActions?: AlertAction[];
  onChange?: (actions: AlertAction[]) => void;
  alertId?: string | null;
  queryClient?: ReturnType<typeof createQueryClient>;
}) {
  const [actions, setActions] = useState<AlertAction[]>(initialActions);
  const effectiveOnChange = onChange || vi.fn();
  return (
    <TestWrapper providedQueryClient={providedQueryClient}>
      <AlertActionsEditor value={actions} onChange={(next) => { setActions(next); effectiveOnChange(next); }} alertId={alertId} />
    </TestWrapper>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AlertActionsEditor", () => {
  // Helper to find the "Add action..." dropdown among potentially many select elements
  function getAddActionSelect() {
    const allSelects = Array.from(document.querySelectorAll("select"));
    // The add-action dropdown has an option with "Add action..." text
    for (const select of allSelects) {
      const options = Array.from(select.querySelectorAll("option"));
      if (options.some((o) => o.textContent?.includes("Add action"))) {
        return select;
      }
    }
    throw new Error("Add action select not found");
  }

  it("renders with no actions", () => {
    render(<StatefulEditor />);
    expect(screen.getByText("Actions on trigger")).toBeInTheDocument();
    expect(screen.getByText("0/5")).toBeInTheDocument();
  });

  it("renders with initial actions", () => {
    const onChange = vi.fn();
    const initialActions: AlertAction[] = [
      { type: "paper_order", portfolio_id: "p1", side: "buy", quantity: 10, order_type: "market" },
    ];
    render(<StatefulEditor initialActions={initialActions} onChange={onChange} />);
    expect(screen.getByText("1/5")).toBeInTheDocument();
  });

  it("add a paper action → onChange called with a paper_order action", async () => {
    const onChange = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(["paper", "portfolios"], MOCK_PORTFOLIOS);
    render(<StatefulEditor onChange={onChange} queryClient={queryClient} />);

    // Click "Add action" button
    const addBtn = screen.getByRole("button", { name: /add action/i });
    fireEvent.click(addBtn);

    // Select "Paper order" from the dropdown
    const select = getAddActionSelect();
    fireEvent.change(select, { target: { value: "paper_order" } });

    // onChange should have been called once with a new paper_order action
    expect(onChange).toHaveBeenCalledTimes(1);
    const nextActions = onChange.mock.calls[0][0] as AlertAction[];
    expect(nextActions).toHaveLength(1);
    expect(nextActions[0].type).toBe("paper_order");
    expect(nextActions[0]).toHaveProperty("portfolio_id");
    expect(nextActions[0]).toHaveProperty("side", "buy");
    expect(nextActions[0]).toHaveProperty("quantity", 1);
  });

  it("row shows the portfolio name when a portfolio is selected", async () => {
    const onChange = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(["paper", "portfolios"], MOCK_PORTFOLIOS);
    render(
      <StatefulEditor
        initialActions={[{ type: "paper_order", portfolio_id: "p1", side: "buy", quantity: 1, order_type: "market" }]}
        onChange={onChange}
        queryClient={queryClient}
      />,
    );

    // Wait for select to show portfolio name
    expect(await screen.findByText("Test Portfolio")).toBeInTheDocument();
  });

  it("add 5 then the Add control is disabled", async () => {
    const onChange = vi.fn();
    const queryClient = createQueryClient();
    queryClient.setQueryData(["paper", "portfolios"], MOCK_PORTFOLIOS);
    render(<StatefulEditor onChange={onChange} queryClient={queryClient} />);

    // Add 5 paper actions
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /add action/i }));
      });
      // Wait for the add-action dropdown to appear
      const select = await vi.waitFor(() => {
        const selects = Array.from(document.querySelectorAll("select"));
        for (const sel of selects) {
          const options = Array.from(sel.querySelectorAll("option"));
          if (options.some((o) => o.textContent?.includes("Add action"))) {
            return sel;
          }
        }
        throw new Error("Not found");
      });
      await act(async () => {
        fireEvent.change(select, { target: { value: "paper_order" } });
      });
    }

    expect(onChange).toHaveBeenCalledTimes(5);
    // Final value should be an array of 5 paper_order actions
    const finalActions = onChange.mock.calls[4][0] as AlertAction[];
    expect(finalActions).toHaveLength(5);
    expect(finalActions.every((a) => a.type === "paper_order")).toBe(true);
    // Add button should be gone (counter shows 5/5)
    expect(screen.queryByRole("button", { name: /add action/i })).not.toBeInTheDocument();
  });

  it("remove works", async () => {
    const onChange = vi.fn();
    render(
      <StatefulEditor
        initialActions={[{ type: "paper_order", portfolio_id: "p1", side: "buy", quantity: 1, order_type: "market" }]}
        onChange={onChange}
      />,
    );

    // Find and click the remove (X) button
    const removeBtn = screen.getAllByRole("button", { name: /x/i })[0];
    fireEvent.click(removeBtn);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(0);
  });
});