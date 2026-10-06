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
  | ({ type: "grounding"; target: "final" | "role"; role_index?: number } & GroundingReport)
  | { type: "error"; message: string };

/** A tool result the run collected, cited as the ground truth for figures in the answer. */
export interface GroundingSource {
  id: string;
  tool: string;
  call_id: string | null;
  args: Record<string, unknown>;
  provider: string;
  quality: string;
  as_of: string | null;
  note: string | null;
}

export interface GroundingClaim {
  text: string;
  value: number;
  metric: string | null;
  status: "verified" | "mismatch" | "unsourced";
  approx: boolean;
  in_code: boolean;
  source_id: string | null;
  path: string | null;
  source_value: number | null;
  subject: string | null;
  expected?: string;
  warning?: string;
}

export interface GroundingReport {
  claims: GroundingClaim[];
  sources: GroundingSource[];
  summary: { total: number; verified: number; mismatch: number; unsourced: number; low_quality: number };
  /** The text with a ⟦status:source⟧ marker after each figure. */
  annotated: string;
}

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
  grounding?: GroundingReport;
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
  grounding?: GroundingReport;
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
