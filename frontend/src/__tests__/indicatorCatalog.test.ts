import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteIndicatorTemplate,
  getIndicatorEditableParams,
  normalizeStoredIndicatorTemplates,
  readIndicatorFavorites,
  readIndicatorTemplates,
  replaceIndicatorEditableParams,
  resolveIndicatorPaneKey,
  toggleStoredIndicatorFavorite,
  upsertIndicatorRouting,
  upsertIndicatorTemplate,
  writeIndicatorFavorites,
  writeIndicatorTemplates,
} from "../shared/chart/indicatorCatalog";
import type { IndicatorConfig } from "../shared/chart/types";

describe("indicatorCatalog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores pane and scale routing outside editable params", () => {
    const base: IndicatorConfig = {
      id: "rsi",
      instanceId: "instance-rsi-1",
      params: { length: 14 },
      visible: true,
    };

    const routed = upsertIndicatorRouting(
      base,
      { paneTarget: "new", scaleBehavior: "separate" },
      false,
    );
    const resolved = resolveIndicatorPaneKey(routed, false);

    expect(getIndicatorEditableParams(routed)).toEqual({ length: 14 });
    expect(resolved.overlay).toBe(false);
    expect(resolved.scaleBehavior).toBe("separate");
    expect(resolved.paneKey).toMatch(/^pane:rsi:/);

    const replaced = replaceIndicatorEditableParams(routed, { length: 21 });
    expect(getIndicatorEditableParams(replaced)).toEqual({ length: 21 });
    expect(resolveIndicatorPaneKey(replaced, false).paneKey).toBe(resolved.paneKey);
  });

  it("persists favorites in normalized storage", () => {
    expect(writeIndicatorFavorites(["SMA", " sma ", "RSI"])).toEqual(["rsi", "sma"]);
    expect(readIndicatorFavorites()).toEqual(["rsi", "sma"]);

    expect(toggleStoredIndicatorFavorite("sma")).toEqual(["rsi"]);
    expect(readIndicatorFavorites()).toEqual(["rsi"]);
  });

  it("migrates legacy template maps and round-trips new templates", () => {
    const config = upsertIndicatorRouting(
      {
        id: "macd",
        instanceId: "instance-macd-1",
        params: { fast: 12, slow: 26, signal: 9 },
        visible: true,
      },
      { paneTarget: "existing", paneId: "auto:rsi", scaleBehavior: "shared" },
      false,
    );

    const migrated = normalizeStoredIndicatorTemplates({
      Swing: [config],
    });
    expect(migrated).toHaveLength(1);
    expect(migrated[0].name).toBe("Swing");
    expect(resolveIndicatorPaneKey(migrated[0].indicators[0], false).paneKey).toBe("auto:rsi");

    const saved = writeIndicatorTemplates(
      "equity",
      upsertIndicatorTemplate(migrated, "Momentum Stack", [config]),
    );
    expect(saved).toHaveLength(2);
    expect(readIndicatorTemplates("equity").map((template) => template.name)).toEqual([
      "Momentum Stack",
      "Swing",
    ]);

    const withoutNewest = deleteIndicatorTemplate(saved, saved[0].id);
    writeIndicatorTemplates("equity", withoutNewest);
    expect(readIndicatorTemplates("equity")).toHaveLength(1);
    expect(readIndicatorTemplates("equity")[0].name).toBe("Swing");
  });
});
