import { useEffect, useMemo, useState } from "react";

import { getIndicatorDefaults, listIndicators } from "./IndicatorManager";
import {
  getIndicatorEditableParams,
  makeIndicatorPaneId,
  replaceIndicatorEditableParams,
  resolveIndicatorRouting,
  upsertIndicatorRouting,
} from "./indicatorCatalog";
import type { IndicatorConfig } from "./types";
import { terminalColors } from "../../theme/terminal";

type PaneOption = {
  id: string;
  label: string;
};

type Props = {
  config: IndicatorConfig;
  defaultOverlay: boolean;
  paneOptions: PaneOption[];
  onClose: () => void;
  onSave: (next: IndicatorConfig) => void;
};

export function IndicatorParamEditor({ config, defaultOverlay, paneOptions, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<IndicatorConfig>(config);
  const info = useMemo(() => listIndicators().find((x) => x.id === config.id), [config.id]);
  const defaultParams = useMemo(() => ({ ...(getIndicatorDefaults(config.id).params || {}) }), [config.id]);
  const initialRouting = useMemo(() => resolveIndicatorRouting(config, defaultOverlay), [config, defaultOverlay]);
  const [paneTarget, setPaneTarget] = useState(initialRouting.paneTarget);
  const [paneId, setPaneId] = useState(initialRouting.paneId ?? "");
  const [scaleBehavior, setScaleBehavior] = useState(initialRouting.scaleBehavior);

  const entries = Object.entries(getIndicatorEditableParams(draft));

  useEffect(() => {
    setDraft(config);
  }, [config]);

  useEffect(() => {
    const routing = resolveIndicatorRouting(config, defaultOverlay);
    setPaneTarget(routing.paneTarget);
    setPaneId(routing.paneId ?? "");
    setScaleBehavior(routing.scaleBehavior);
  }, [config, defaultOverlay]);

  const canUseExistingPane = paneOptions.length > 0;
  const saveDraft = () => {
    let next = replaceIndicatorEditableParams(draft, getIndicatorEditableParams(draft));
    next = {
      ...next,
      color: draft.color,
      lineWidth: draft.lineWidth,
    };
    next = upsertIndicatorRouting(
      next,
      {
        paneTarget,
        paneId:
          paneTarget === "existing"
            ? (paneId || paneOptions[0]?.id || makeIndicatorPaneId(config.id))
            : paneTarget === "new"
              ? (paneId || makeIndicatorPaneId(config.id))
              : null,
        scaleBehavior,
      },
      defaultOverlay,
    );
    onSave(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter") {
        event.preventDefault();
        saveDraft();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, onClose, saveDraft]);

  return (
    <div className="absolute right-2 top-10 z-40 w-80 rounded border border-terminal-border bg-terminal-panel p-3 shadow-xl">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">{info?.name || config.id}</div>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-terminal-muted">
            <span className="mb-1 block">Pane</span>
            <select
              value={paneTarget}
              onChange={(event) => {
                const nextPaneTarget = event.target.value as typeof paneTarget;
                setPaneTarget(nextPaneTarget);
                if (nextPaneTarget === "new" && !paneId) {
                  setPaneId(makeIndicatorPaneId(config.id));
                }
                if (nextPaneTarget === "existing" && !paneId && paneOptions[0]?.id) {
                  setPaneId(paneOptions[0].id);
                }
                if (nextPaneTarget === "overlay" || nextPaneTarget === "auto") {
                  setPaneId("");
                }
              }}
              className="h-8 w-full rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-terminal-text"
              data-testid="indicator-editor-pane-target"
            >
              <option value="auto">{defaultOverlay ? "Auto overlay" : "Auto pane"}</option>
              <option value="overlay">Price overlay</option>
              <option value="new">New pane</option>
              <option value="existing" disabled={!canUseExistingPane}>Existing pane</option>
            </select>
          </label>
          <label className="text-[11px] text-terminal-muted">
            <span className="mb-1 block">Scale</span>
            <select
              value={scaleBehavior}
              onChange={(event) => setScaleBehavior(event.target.value as typeof scaleBehavior)}
              className="h-8 w-full rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-terminal-text"
              data-testid="indicator-editor-scale-behavior"
            >
              <option value="shared">Shared scale</option>
              <option value="separate">Separate scale</option>
            </select>
          </label>
        </div>
        {paneTarget === "existing" ? (
          <label className="block text-[11px] text-terminal-muted">
            <span className="mb-1 block">Join pane</span>
            <select
              value={paneId}
              onChange={(event) => setPaneId(event.target.value)}
              className="h-8 w-full rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-terminal-text"
              data-testid="indicator-editor-pane-id"
            >
              {paneOptions.length ? (
                paneOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))
              ) : (
                <option value="">No panes available</option>
              )}
            </select>
          </label>
        ) : null}
        {entries.map(([key, value]) => (
          <label key={key} className="block text-[11px] text-terminal-muted">
            <span className="mb-1 block">{key}</span>
            <input
              type={typeof value === "number" ? "number" : "text"}
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
              value={String(value)}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const asNum = Number(raw);
                setDraft((prev) => ({
                  ...prev,
                  params: {
                    ...getIndicatorEditableParams(prev),
                    [key]: Number.isFinite(asNum) && raw !== "" ? asNum : raw,
                  },
                }));
              }}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-terminal-muted">
          <span className="mb-1 block">Color</span>
          <input
            type="color"
            className="h-8 w-full rounded border border-terminal-border bg-terminal-bg"
            value={draft.color || terminalColors.accent}
            onChange={(e) => setDraft((prev) => ({ ...prev, color: e.target.value }))}
          />
        </label>
        <label className="text-[11px] text-terminal-muted">
          <span className="mb-1 block">Line Width</span>
          <input
            type="number"
            min={1}
            max={4}
            className="h-8 w-full rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-terminal-text"
            value={draft.lineWidth ?? 2}
            onChange={(e) => setDraft((prev) => ({ ...prev, lineWidth: Number(e.target.value || 2) }))}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted"
          onClick={() => setDraft((prev) => replaceIndicatorEditableParams(prev, { ...defaultParams }))}
          data-testid="indicator-editor-reset-params"
        >
          Reset params
        </button>
        <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={onClose}>
          Cancel
        </button>
        <button
          className="rounded border border-terminal-accent bg-terminal-accent/20 px-2 py-1 text-xs text-terminal-accent"
          onClick={saveDraft}
        >
          Save
        </button>
      </div>
    </div>
  );
}
