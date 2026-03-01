import { useEffect, useMemo, useState } from "react";

import { createSavedScreenV3, publishScreenV3, updateSavedScreenV3 } from "../../../api/client";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function SaveScreenDialog() {
  const { query, refreshScreens, savedScreens, activeSavedScreenId, setActiveSavedScreenId } = useScreenerContext();
  const [name, setName] = useState("My Screen");
  const [description, setDescription] = useState("");
  const [publicMode, setPublicMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeScreen = useMemo(
    () => savedScreens.find((screen) => screen.id === activeSavedScreenId) || null,
    [savedScreens, activeSavedScreenId],
  );

  useEffect(() => {
    if (!activeScreen) return;
    setName(activeScreen.name || "My Screen");
    setDescription(activeScreen.description || "");
    setPublicMode(Boolean(activeScreen.is_public));
  }, [activeScreen]);

  return (
    <TerminalPanel title="Save Screen" subtitle="Persist Current Query" bodyClassName="space-y-2">
      {error ? <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 px-2 py-1 text-xs text-terminal-neg">{error}</div> : null}
      <TerminalInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
      <TerminalInput value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
      <label className="flex items-center gap-2 text-xs text-terminal-muted">
        <input type="checkbox" checked={publicMode} onChange={(event) => setPublicMode(event.target.checked)} />
        Publish after save
      </label>
      <div className="flex flex-wrap gap-2">
        <TerminalButton
          variant="accent"
          loading={loading}
          onClick={async () => {
            const safeName = name.trim();
            if (!safeName) {
              setError("Screen name is required");
              return;
            }
            setError(null);
            setLoading(true);
            try {
              const created = await createSavedScreenV3({
                name: safeName,
                description: description.trim(),
                query,
                columns_config: [],
                viz_config: {},
                is_public: false,
              });
              if (publicMode) {
                await publishScreenV3(created.id);
              }
              setActiveSavedScreenId(created.id);
              await refreshScreens();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to save screen");
            } finally {
              setLoading(false);
            }
          }}
        >
          Save New
        </TerminalButton>
        <TerminalButton
          variant="default"
          loading={loading}
          disabled={!activeScreen}
          onClick={async () => {
            if (!activeScreen) return;
            const safeName = name.trim();
            if (!safeName) {
              setError("Screen name is required");
              return;
            }
            setError(null);
            setLoading(true);
            try {
              const updated = await updateSavedScreenV3(activeScreen.id, {
                name: safeName,
                description: description.trim(),
                query,
                columns_config: activeScreen.columns_config || [],
                viz_config: activeScreen.viz_config || {},
                is_public: activeScreen.is_public,
              });
              if (publicMode && !updated.is_public) {
                await publishScreenV3(updated.id);
              }
              await refreshScreens();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to update screen");
            } finally {
              setLoading(false);
            }
          }}
        >
          Update Current
        </TerminalButton>
      </div>
    </TerminalPanel>
  );
}
