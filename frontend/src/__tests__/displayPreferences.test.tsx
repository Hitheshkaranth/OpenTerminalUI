import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeRuntime } from "../components/layout/ThemeRuntime";
import { useSettingsStore } from "../store/settingsStore";

describe("Display preferences", () => {
  it("applies density, scaled data tokens, and optional terminal effects", () => {
    useSettingsStore.setState({ density: "comfortable", textScale: 1, terminalEffects: false });
    render(<ThemeRuntime />);
    expect(document.documentElement).toHaveAttribute("data-ot-effects", "false");
    act(() => { useSettingsStore.getState().setDensity("compact"); useSettingsStore.getState().setTextScale(1.25); useSettingsStore.getState().setTerminalEffects(true); });
    expect(document.documentElement).toHaveAttribute("data-ot-density", "compact");
    expect(document.documentElement).toHaveAttribute("data-ot-effects", "true");
    expect(document.documentElement.style.getPropertyValue("--ot-type-size-sm")).toBe("15px");
    expect(document.documentElement.style.fontSize).toBe("20px");
  });
  it("bounds invalid text scale inputs", () => {
    useSettingsStore.getState().setTextScale(Infinity);
    expect(useSettingsStore.getState().textScale).toBe(1);
    useSettingsStore.getState().setTextScale(5);
    expect(useSettingsStore.getState().textScale).toBe(1.4);
  });
});
