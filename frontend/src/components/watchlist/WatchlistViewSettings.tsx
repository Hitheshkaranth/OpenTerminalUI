import { useId } from "react";
import type { WatchlistView, WatchlistViewUpdate } from "../../store/watchlistViewStore";

type Props = {
  view: WatchlistView;
  onChange: (patch: WatchlistViewUpdate) => void;
  storageError?: string | null;
};

const controlClass = "min-h-8 rounded-sm border border-terminal-border bg-terminal-bg px-2 text-xs text-terminal-text focus-visible:outline focus-visible:outline-terminal-accent";

export function WatchlistViewSettings({ view, onChange, storageError }: Props) {
  const id = useId();
  return (
    <><details className="rounded-sm border border-terminal-border bg-terminal-panel text-xs text-terminal-text">
      <summary className="cursor-pointer px-3 py-2 font-medium focus-visible:outline focus-visible:outline-terminal-accent">Table settings <span className="font-normal text-terminal-muted">· {view.preset === "price" ? "Price focus" : view.preset === "liquidity" ? "Price and volume" : "Custom columns"}</span></summary>
      <div className="space-y-3 border-t border-terminal-border px-3 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor={`${id}-preset`} className="flex flex-col gap-1">Column preset
            <select aria-label="Column preset" id={`${id}-preset`} value={view.preset} onChange={(event) => onChange({ preset: event.target.value as WatchlistView["preset"] })} className={controlClass}>
              <option value="liquidity">Price and volume</option>
              <option value="price">Price focus</option>
              {view.preset === "custom" && <option value="custom">Custom columns</option>}
            </select>
          </label>
          <label htmlFor={`${id}-density`} className="flex flex-col gap-1">Row spacing
            <select aria-label="Row spacing" id={`${id}-density`} value={view.density} onChange={(event) => onChange({ density: event.target.value as WatchlistView["density"] })} className={controlClass}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
            </select>
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
          <legend className="mb-2 text-terminal-muted">Visible columns</legend>
          {([["last", "Last price"], ["change", "Change %"], ["volume", "Volume"]] as const).map(([key, label]) => (
            <label key={key} className="inline-flex min-h-8 items-center gap-2"><input type="checkbox" checked={view.columns[key]} onChange={(event) => onChange({ columns: { [key]: event.target.checked } })} className="accent-terminal-accent" />{label}</label>
          ))}
        </fieldset>
        <p className="text-terminal-muted">Symbol and actions stay visible. Signed-in users save these preferences in this browser, without cross-device sync.</p>
      </div>
    </details>{storageError && <p role="status" className="mt-2 text-xs text-terminal-warn">{storageError}</p>}</>
  );
}
