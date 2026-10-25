import { ArtifactView } from "./artifacts";
import type { AgentArtifact } from "../types";
import { queuePinnedArtifact } from "../../workspace/pinnedArtifacts";
import { useState } from "react";

export function ArtifactCanvas({ artifacts }: { artifacts: AgentArtifact[] }) {
  const [pinned, setPinned] = useState<string[]>([]);
  const [error, setError] = useState("");
  if (!artifacts.length) {
    return (
      <div style={{ color: "var(--ot-color-text-muted)", fontFamily: "var(--ot-font-ui)", fontSize: 12, padding: "var(--ot-space-3)" }}>
        Tool outputs will appear here.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ot-space-2)", padding: "var(--ot-space-2)" }}>
      {error && <p role="alert">{error}</p>}
      {artifacts.map((a) => (
        <section key={a.id}>
          <ArtifactView artifact={a} />
          <button type="button" className="my-2 rounded border border-terminal-border px-3 py-1 text-xs" disabled={pinned.includes(a.id)} onClick={() => {
            try { queuePinnedArtifact({ artifact: a, savedAt: new Date().toISOString() }); setPinned((ids) => [...ids, a.id]); }
            catch { setError("Unable to save this artifact. Browser storage may be full."); }
          }}>{pinned.includes(a.id) ? "Pinned to workspace" : "Pin to workspace"}</button>
          {pinned.includes(a.id) && <a className="ml-3 text-xs text-terminal-accent underline" href="/equity/launchpad">Open workspace</a>}
        </section>
      ))}
    </div>
  );
}
