import { useState } from "react";

import { deleteSavedScreenV3, publishScreenV3, updateSavedScreenV3 } from "../../../api/client";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function SavedScreens() {
  const {
    savedScreens,
    setQuery,
    run,
    query,
    refreshScreens,
    activeSavedScreenId,
    setActiveSavedScreenId,
    loadSavedScreen,
  } = useScreenerContext();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <TerminalPanel title="Saved Screens" subtitle={`Count: ${savedScreens.length}`}>
      {error ? <div className="mb-2 rounded-sm border border-terminal-neg bg-terminal-neg/10 px-2 py-1 text-xs text-terminal-neg">{error}</div> : null}
      <div className="space-y-1 text-xs">
        {savedScreens.map((screen) => (
          <div key={screen.id} className={`rounded-sm border px-2 py-2 ${activeSavedScreenId === screen.id ? "border-terminal-accent bg-terminal-accent/10" : "border-terminal-border bg-terminal-bg"}`}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <button
                type="button"
                className="text-left text-terminal-text hover:text-terminal-accent"
                onClick={() => {
                  loadSavedScreen(screen);
                  void run({ query: screen.query, preset_id: null });
                }}
              >
                {screen.name}
              </button>
              {screen.is_public ? <span className="text-[10px] uppercase tracking-wide text-terminal-accent">Public</span> : null}
            </div>
            {screen.description ? <div className="mb-2 text-[11px] text-terminal-muted">{screen.description}</div> : null}
            <div className="flex flex-wrap gap-1">
              <TerminalButton
                size="sm"
                variant="default"
                onClick={() => {
                  setActiveSavedScreenId(screen.id);
                  setQuery(screen.query);
                }}
              >
                Load
              </TerminalButton>
              <TerminalButton
                size="sm"
                variant="accent"
                loading={loadingId === `update-${screen.id}`}
                onClick={async () => {
                  setError(null);
                  setLoadingId(`update-${screen.id}`);
                  try {
                    await updateSavedScreenV3(screen.id, {
                      name: screen.name,
                      description: screen.description,
                      query,
                      columns_config: screen.columns_config || [],
                      viz_config: screen.viz_config || {},
                      is_public: screen.is_public,
                    });
                    setActiveSavedScreenId(screen.id);
                    await refreshScreens();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to update saved screen");
                  } finally {
                    setLoadingId(null);
                  }
                }}
              >
                Save Current Query
              </TerminalButton>
              <TerminalButton
                size="sm"
                variant="default"
                loading={loadingId === `publish-${screen.id}`}
                disabled={screen.is_public}
                onClick={async () => {
                  setError(null);
                  setLoadingId(`publish-${screen.id}`);
                  try {
                    await publishScreenV3(screen.id);
                    await refreshScreens();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to publish screen");
                  } finally {
                    setLoadingId(null);
                  }
                }}
              >
                Publish
              </TerminalButton>
              <TerminalButton
                size="sm"
                variant="danger"
                loading={loadingId === `delete-${screen.id}`}
                onClick={async () => {
                  setError(null);
                  setLoadingId(`delete-${screen.id}`);
                  try {
                    await deleteSavedScreenV3(screen.id);
                    if (activeSavedScreenId === screen.id) {
                      setActiveSavedScreenId(null);
                    }
                    await refreshScreens();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to delete screen");
                  } finally {
                    setLoadingId(null);
                  }
                }}
              >
                Delete
              </TerminalButton>
            </div>
          </div>
        ))}
      </div>
    </TerminalPanel>
  );
}
