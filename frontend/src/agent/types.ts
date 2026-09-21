export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown; is_error: boolean }
  | { type: "artifact"; kind: string; name: string; data: unknown }
  | { type: "model"; name: string; phase: string }
  | { type: "status"; text: string }
  | { type: "phase"; key: string; label: string }
  | { type: "role_message"; role: string; content: string }
  | { type: "final"; content: string }
  | { type: "error"; message: string };

export interface RunContext {
  route?: string;
  symbol?: string;
  market?: string;
}

export interface RunRequest {
  prompt: string;
  context?: RunContext;
  provider?: string;
  model?: string;
  mode?: "standard" | "deep" | "debate" | "strategy" | "screener" | "ensemble";
  thread_id?: string;
  ticker?: string;
}

export interface AgentPhase {
  key: string;
  label: string;
}

export interface AgentRoleNote {
  role: string;
  content: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: { id: string; name: string; isError: boolean; result?: unknown }[];
  phases: AgentPhase[];
  roles: AgentRoleNote[];
  pending: boolean;
  model?: string;
  /** Transient live progress note for the active turn (e.g. "Contacting llama…",
   * "rate-limited; retrying in 15s…"). Not part of the persisted answer. */
  status?: string;
}

export interface AgentArtifact {
  id: string;
  kind: string;
  name: string;
  data: unknown;
}

export interface SignalTableData {
  as_of: string;
  basket: string[];
  personas: { id: string; label: string; weight: number }[];
  signals: { symbol: string; persona: string; signal: string; confidence: number; reason: string }[];
  consensus: { symbol: string; score: number; verdict: "BUY" | "SELL" | "HOLD"; bullish: number; bearish: number; neutral: number }[];
}
