import { useState } from "react";

import { createSavedScreenV3, publishScreenV3 } from "../../../api/client";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function SaveScreenDialog() {
  const { query, refreshScreens } = useScreenerContext();
  const [name, setName] = useState("My Screen");
  const [description, setDescription] = useState("");
  const [publicMode, setPublicMode] = useState(false);

  return (
    <TerminalPanel title="Save Screen" subtitle="Persist Current Query" bodyClassName="space-y-2">
      <TerminalInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
      <TerminalInput value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" />
      <label className="flex items-center gap-2 text-xs text-terminal-muted">
        <input type="checkbox" checked={publicMode} onChange={(event) => setPublicMode(event.target.checked)} />
        Publish after save
      </label>
      <TerminalButton
        variant="accent"
        onClick={async () => {
          const created = await createSavedScreenV3({
            name,
            description,
            query,
            columns_config: [],
            viz_config: {},
            is_public: false,
          });
          if (publicMode) {
            await publishScreenV3(created.id);
          }
          await refreshScreens();
        }}
      >
        Save
      </TerminalButton>
    </TerminalPanel>
  );
}
