import type { AgentArtifact } from "../agent/types";
export type PinnedArtifact = { artifact: AgentArtifact; savedAt: string };
const KEY = "ot:pending-artifacts:v1";
export function queuePinnedArtifact(item: PinnedArtifact): void {
  const items = readPendingArtifacts();
  sessionStorage.setItem(KEY, JSON.stringify([...items.filter((entry) => entry.artifact.id !== item.artifact.id), item].slice(-24)));
  window.dispatchEvent(new CustomEvent("ot:pin-artifact"));
}
export function readPendingArtifacts(): PinnedArtifact[] {
  try { const value = JSON.parse(sessionStorage.getItem(KEY) || "[]"); return Array.isArray(value) ? value.filter((entry) => entry?.artifact && typeof entry.artifact.id === "string" && typeof entry.artifact.kind === "string" && typeof entry.savedAt === "string") : []; } catch { return []; }
}
export function clearPendingArtifacts(): void { sessionStorage.removeItem(KEY); }
