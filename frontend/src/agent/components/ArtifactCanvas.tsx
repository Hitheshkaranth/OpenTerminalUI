import { ArtifactView } from "./artifacts";
import type { AgentArtifact } from "../types";

export function ArtifactCanvas({ artifacts }: { artifacts: AgentArtifact[] }) {
  if (!artifacts.length) {
    return (
      <div style={{ color: "var(--ot-color-text-muted)", fontFamily: "var(--ot-font-ui)", fontSize: 12, padding: "var(--ot-space-3)" }}>
        Tool outputs will appear here.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--ot-space-2)", padding: "var(--ot-space-2)" }}>
      {artifacts.map((a) => (
        <ArtifactView key={a.id} artifact={a} />
      ))}
    </div>
  );
}
