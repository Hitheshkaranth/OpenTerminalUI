import { useMemo, useState } from "react";

import { listIndicators } from "./IndicatorManager";
import type { IndicatorConfig } from "./types";
import { terminalColors } from "../../theme/terminal";

type Props = {
  config: IndicatorConfig;
  onClose: () => void;
  onSave: (next: IndicatorConfig) => void;
};

export function IndicatorParamEditor({ config, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<IndicatorConfig>(config);
  const info = useMemo(() => listIndicators().find((x) => x.id === config.id), [config.id]);

  const entries = Object.entries(draft.params || {});

  return (
    <div className="absolute right-2 top-10 z-40 w-72 rounded border border-terminal-border bg-terminal-panel p-3 shadow-xl">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">{info?.name || config.id}</div>
      <div className="space-y-2">
        {entries.map(([key, value]) => (
          <label key={key} className="block text-[11px] text-terminal-muted">
            <span className="mb-1 block">{key}</span>
            <input
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
              value={String(value)}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const asNum = Number(raw);
                setDraft((prev) => ({
                  ...prev,
                  params: {
                    ...prev.params,
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
        <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={onClose}>
          Cancel
        </button>
        <button
          className="rounded border border-terminal-accent bg-terminal-accent/20 px-2 py-1 text-xs text-terminal-accent"
          onClick={() => onSave(draft)}
        >
          Save
        </button>
      </div>
    </div>
  );
}
