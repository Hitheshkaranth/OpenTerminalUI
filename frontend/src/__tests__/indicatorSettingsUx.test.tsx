import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IndicatorPanel } from "../shared/chart/IndicatorPanel";
import { IndicatorParamEditor } from "../shared/chart/IndicatorParamEditor";
import type { IndicatorConfig } from "../shared/chart/types";

vi.mock("../shared/chart/IndicatorManager", () => ({
  CUSTOM_JS_INDICATORS_UPDATED_EVENT: "chart:custom-js-indicators:updated",
  listIndicators: vi.fn(() => [
    { id: "sma", name: "SMA", category: "trend", overlay: true, defaultInputs: { period: 14 } },
    { id: "rsi", name: "RSI", category: "momentum", overlay: false, defaultInputs: { length: 14 } },
  ]),
  getIndicatorDefaults: vi.fn((id: string) => {
    if (id === "sma") return { params: { period: 14 }, overlay: true };
    if (id === "rsi") return { params: { length: 14 }, overlay: false };
    return { params: {}, overlay: true };
  }),
  upsertCustomJsIndicator: vi.fn((input: any) => ({ ...input, id: "custom-js:test" })),
  removeCustomJsIndicator: vi.fn(),
}));

describe("indicator settings UX", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("supports rapid visibility toggle and params reset from panel controls", () => {
    const onChange = vi.fn();
    const active: IndicatorConfig[] = [
      { id: "sma", instanceId: "instance-sma-1", params: { period: 30 }, visible: true },
      { id: "rsi", instanceId: "instance-rsi-1", params: { length: 21 }, visible: true },
    ];
    render(<IndicatorPanel symbol="AAPL" activeIndicators={active} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("indicator-visibility-sma"));
    expect(onChange).toHaveBeenCalledWith([
      { id: "sma", instanceId: "instance-sma-1", params: { period: 30 }, visible: false },
      { id: "rsi", instanceId: "instance-rsi-1", params: { length: 21 }, visible: true },
    ]);

    fireEvent.click(screen.getByTestId("indicator-reset-all"));
    expect(onChange).toHaveBeenCalledWith([
      { id: "sma", instanceId: "instance-sma-1", params: { period: 14 }, visible: true },
      { id: "rsi", instanceId: "instance-rsi-1", params: { length: 14 }, visible: true },
    ]);
  });

  it("exposes an alert action for active indicators", () => {
    const onCreateAlert = vi.fn();
    const active: IndicatorConfig[] = [{ id: "sma", instanceId: "instance-sma-1", params: { period: 30 }, visible: true }];

    render(<IndicatorPanel symbol="AAPL" activeIndicators={active} onChange={vi.fn()} onCreateAlert={onCreateAlert} />);

    fireEvent.click(screen.getByTestId("indicator-alert-sma"));
    expect(onCreateAlert).toHaveBeenCalledWith({ id: "sma", instanceId: "instance-sma-1", params: { period: 30 }, visible: true });
  });

  it("resets params to defaults in editor before save", () => {
    const onSave = vi.fn();
    render(
      <IndicatorParamEditor
        config={{ id: "sma", instanceId: "instance-sma-1", params: { period: 30 }, visible: true }}
        defaultOverlay={true}
        paneOptions={[]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByTestId("indicator-editor-reset-params"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      id: "sma",
      instanceId: "instance-sma-1",
      color: undefined,
      lineWidth: undefined,
      params: {
        period: 14,
        __otui_indicator: {
          paneTarget: "auto",
          paneId: null,
          scaleBehavior: "shared",
        },
      },
      visible: true,
    });
  });

  it("saves pane and scale routing from the editor", () => {
    const onChange = vi.fn();
    const active: IndicatorConfig[] = [{ id: "rsi", instanceId: "instance-rsi-1", params: { length: 21 }, visible: true }];

    render(
      <IndicatorPanel
        symbol="AAPL"
        activeIndicators={active}
        onChange={onChange}
        templateScope="fno"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "cfg" }));
    fireEvent.change(screen.getByTestId("indicator-editor-pane-target"), { target: { value: "new" } });
    fireEvent.change(screen.getByTestId("indicator-editor-scale-behavior"), { target: { value: "separate" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" }).at(-1)!);

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "rsi",
        instanceId: "instance-rsi-1",
        visible: true,
        params: expect.objectContaining({
          length: 21,
          __otui_indicator: expect.objectContaining({
            paneTarget: "new",
            paneId: expect.stringMatching(/^pane:rsi:/),
            scaleBehavior: "separate",
          }),
        }),
      }),
    ]);
  });

  it("supports favorites filtering plus scoped template save, load, and delete", () => {
    const onChange = vi.fn();
    const active: IndicatorConfig[] = [{ id: "sma", instanceId: "instance-sma-1", params: { period: 30 }, visible: true }];

    const { unmount } = render(
      <IndicatorPanel
        symbol="AAPL"
        activeIndicators={active}
        onChange={onChange}
        templateScope="fno"
      />,
    );

    fireEvent.click(screen.getByTestId("indicator-favorite-sma"));
    fireEvent.click(screen.getByTestId("indicator-category-favorites"));
    expect(screen.getByText("[x] SMA")).toBeInTheDocument();
    expect(screen.queryByText("[ ] RSI")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Template name"), { target: { value: "Swing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const raw = window.localStorage.getItem("chart:indicator-templates:fno");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw || "[]");
    expect(parsed).toEqual([
      expect.objectContaining({
        name: "Swing",
        indicators: [{ id: "sma", instanceId: "instance-sma-1", params: { period: 30 }, visible: true }],
      }),
    ]);
    unmount();

    render(
      <IndicatorPanel
        symbol="AAPL"
        activeIndicators={[]}
        onChange={onChange}
        templateScope="fno"
      />,
    );
    fireEvent.change(screen.getByTestId("indicator-template-select"), { target: { value: parsed[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "sma", params: { period: 30 }, visible: true, instanceId: expect.any(String) }),
    ]);

    fireEvent.click(screen.getByTestId("indicator-template-delete"));
    expect(JSON.parse(window.localStorage.getItem("chart:indicator-templates:fno") || "[]")).toEqual([]);
  });

  it("allows duplicate study instances to coexist with isolated actions", () => {
    const onChange = vi.fn();
    const active: IndicatorConfig[] = [
      { id: "sma", instanceId: "instance-sma-1", params: { period: 20 }, visible: true },
      { id: "sma", instanceId: "instance-sma-2", params: { period: 50 }, visible: true },
    ];

    render(<IndicatorPanel symbol="AAPL" activeIndicators={active} onChange={onChange} />);

    expect(screen.getByText("[x2] SMA")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("indicator-visibility-sma-instance-sma-2"));
    expect(onChange).toHaveBeenCalledWith([
      { id: "sma", instanceId: "instance-sma-1", params: { period: 20 }, visible: true },
      { id: "sma", instanceId: "instance-sma-2", params: { period: 50 }, visible: false },
    ]);
  });
});
