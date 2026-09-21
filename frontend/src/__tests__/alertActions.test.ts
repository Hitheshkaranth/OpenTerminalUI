/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readActions, validateActions } from "../api/alertActions";
import type { AlertAction } from "../api/alertActions";

afterEach(() => {
  vi.restoreAllMocks();
});

// Use vi.hoisted to create mock functions before vi.mock runs
const mocks = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockGet: vi.fn(),
}));

vi.mock("../api/base", () => ({
  api: {
    post: mocks.mockPost,
    get: mocks.mockGet,
  },
}));

describe("readActions", () => {
  it("returns empty array for null/undefined/non-object", () => {
    expect(readActions(null)).toEqual([]);
    expect(readActions(undefined)).toEqual([]);
    expect(readActions(42)).toEqual([]);
  });

  it("returns empty array when no actions key", () => {
    expect(readActions({})).toEqual([]);
    expect(readActions({ foo: "bar" })).toEqual([]);
  });

  it("returns empty array when actions is not an array", () => {
    expect(readActions({ actions: "string" })).toEqual([]);
    expect(readActions({ actions: 42 })).toEqual([]);
    expect(readActions({ actions: {} })).toEqual([]);
  });

  it("keeps valid entries and drops malformed ones", () => {
    const config = {
      actions: [
        { type: "paper_order", portfolio_id: "p1", side: "buy", quantity: 10, order_type: "market" },
        { type: "add_to_watchlist", watchlist_id: "w1" },
        { type: "webhook", url: "https://example.com/hook" },
        // Malformed entries
        { type: "paper_order", portfolio_id: "", side: "buy", quantity: 0, order_type: "market" },
        { type: "add_to_watchlist", watchlist_id: "" },
        { type: "webhook" }, // missing url
        null,
        "string",
        { type: "unknown_type", foo: "bar" },
      ],
    };
    const result = readActions(config);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ type: "paper_order", portfolio_id: "p1", side: "buy", quantity: 10, order_type: "market" });
    expect(result[1]).toEqual({ type: "add_to_watchlist", watchlist_id: "w1" });
    expect(result[2]).toEqual({ type: "webhook", url: "https://example.com/hook", payload: undefined });
    expect(result[3]).toEqual({ type: "add_to_watchlist", watchlist_id: "" });
  });

  it("handles webhook with payload", () => {
    const config = { actions: [{ type: "webhook", url: "https://example.com/hook", payload: { foo: "bar" } }] };
    const result = readActions(config);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "webhook", url: "https://example.com/hook", payload: { foo: "bar" } });
  });

  it("handles webhook with null payload", () => {
    const config = { actions: [{ type: "webhook", url: "https://example.com/hook", payload: null }] };
    const result = readActions(config);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "webhook", url: "https://example.com/hook", payload: null });
  });
});

describe("validateActions", () => {
  it("returns null for empty array", () => {
    expect(validateActions([])).toBeNull();
  });

  it("returns null for valid actions", () => {
    const actions: AlertAction[] = [
      { type: "paper_order", portfolio_id: "p1", side: "buy", quantity: 10, order_type: "market" },
      { type: "add_to_watchlist", watchlist_id: "w1" },
      { type: "webhook", url: "https://example.com/hook" },
    ];
    expect(validateActions(actions)).toBeNull();
  });

  it("returns error for >5 actions", () => {
    const actions: AlertAction[] = [
      { type: "paper_order", portfolio_id: "p1", side: "buy", quantity: 1, order_type: "market" },
      { type: "paper_order", portfolio_id: "p2", side: "buy", quantity: 1, order_type: "market" },
      { type: "paper_order", portfolio_id: "p3", side: "buy", quantity: 1, order_type: "market" },
      { type: "paper_order", portfolio_id: "p4", side: "buy", quantity: 1, order_type: "market" },
      { type: "paper_order", portfolio_id: "p5", side: "buy", quantity: 1, order_type: "market" },
      { type: "paper_order", portfolio_id: "p6", side: "buy", quantity: 1, order_type: "market" },
    ];
    const err = validateActions(actions);
    expect(err).toContain("Maximum");
  });

  it("returns error for qty 0 in paper_order", () => {
    const actions: AlertAction[] = [
      { type: "paper_order", portfolio_id: "p1", side: "buy", quantity: 0, order_type: "market" },
    ];
    expect(validateActions(actions)).toBe("Paper order quantity must be greater than 0");
  });

  it("returns error for missing portfolio_id", () => {
    const actions: AlertAction[] = [
      { type: "paper_order", portfolio_id: "", side: "buy", quantity: 5, order_type: "market" },
    ];
    expect(validateActions(actions)).toBe("Paper order requires a portfolio_id");
  });

  it("returns error for ftp:// url in webhook", () => {
    const actions: AlertAction[] = [
      { type: "webhook", url: "ftp://example.com/hook" },
    ];
    expect(validateActions(actions)).toBe("Webhook URL must start with http:// or https://");
  });

  it("returns null for empty webhook url", () => {
    const actions: AlertAction[] = [
      { type: "webhook", url: "" },
    ];
    expect(validateActions(actions)).toBeNull();
  });

  it("returns error for missing watchlist_id", () => {
    const actions: AlertAction[] = [
      { type: "add_to_watchlist", watchlist_id: "" },
    ];
    expect(validateActions(actions)).toBe("Add to watchlist requires a watchlist_id");
  });

  it("accepts https url", () => {
    const actions: AlertAction[] = [
      { type: "webhook", url: "https://example.com/hook" },
    ];
    expect(validateActions(actions)).toBeNull();
  });

  it("accepts http url", () => {
    const actions: AlertAction[] = [
      { type: "webhook", url: "http://localhost:3000/hook" },
    ];
    expect(validateActions(actions)).toBeNull();
  });
});

describe("dryRunAlertActions", () => {
  it("posts to the right path", async () => {
    const expectedData = { alert_id: "a1", actions: [{ type: "paper_order", ok: true, detail: "OK" }] };
    mocks.mockPost.mockResolvedValue({ data: expectedData });

    const { dryRunAlertActions: dryRun } = await import("../api/alertActions");
    const result = await dryRun("a1");
    expect(result).toEqual(expectedData);
  });
});