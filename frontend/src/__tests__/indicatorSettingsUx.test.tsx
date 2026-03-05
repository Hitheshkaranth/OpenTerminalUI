import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  it("supports rapid visibility toggle and params reset from panel controls", () => {
    const onChange = vi.fn();
    const active: IndicatorConfig[] = [
      { id: "sma", params: { period: 30 }, visible: true },
      { id: "rsi", params: { length: 21 }, visible: true },
    ];
    render(<IndicatorPanel symbol="AAPL" activeIndicators={active} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("indicator-visibility-sma"));
    expect(onChange).toHaveBeenCalledWith([
      { id: "sma", params: { period: 30 }, visible: false },
      { id: "rsi", params: { length: 21 }, visible: true },
    ]);

    fireEvent.click(screen.getByTestId("indicator-reset-all"));
    expect(onChange).toHaveBeenCalledWith([
      { id: "sma", params: { period: 14 }, visible: true },
      { id: "rsi", params: { length: 14 }, visible: true },
    ]);
  });

  it("resets params to defaults in editor before save", () => {
    const onSave = vi.fn();
    render(
      <IndicatorParamEditor
        config={{ id: "sma", params: { period: 30 }, visible: true }}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByTestId("indicator-editor-reset-params"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      id: "sma",
      params: { period: 14 },
      visible: true,
    });
  });
});
