import { useSearchParams } from "react-router-dom";

import { SectorRotationMap } from "../components/analysis/SectorRotationMap";
import { ThemesBoard } from "../components/themes/ThemesBoard";

export function SectorRotationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "themes" ? "themes" : "sectors";

  return (
    <div className="h-full w-full flex flex-col overflow-hidden p-4">
      <div className="mb-3 inline-flex items-center gap-1 rounded-sm border border-terminal-border bg-terminal-panel p-1 self-start">
        <button
          type="button"
          aria-pressed={view === "sectors"}
          className={`rounded px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] ${
            view === "sectors" ? "border border-terminal-accent bg-terminal-accent/20 text-terminal-accent" : "border-transparent text-terminal-muted hover:text-terminal-text"
          }`}
          onClick={() => setSearchParams({})}
        >
          Sectors
        </button>
        <button
          type="button"
          aria-pressed={view === "themes"}
          className={`rounded px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] ${
            view === "themes" ? "border border-terminal-accent bg-terminal-accent/20 text-terminal-accent" : "border-transparent text-terminal-muted hover:text-terminal-text"
          }`}
          onClick={() => setSearchParams({ view: "themes" })}
        >
          Themes
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {view === "themes" ? (
          <ThemesBoard />
        ) : (
          <div className="flex min-h-0 flex-1">
            <SectorRotationMap width="100%" height="100%" defaultBenchmark="SPY" />
          </div>
        )}
      </div>
    </div>
  );
}

export default SectorRotationPage;