export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown; is_error: boolean }
  | { type: "artifact"; kind: string; name: string; data: unknown }
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
  mode?: "standard" | "debate";
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
  steps: { id: string; name: string; isError: boolean }[];
  phases: AgentPhase[];
  roles: AgentRoleNote[];
  pending: boolean;
}

export interface AgentArtifact {
  id: string;
  kind: string;
  name: string;
  data: unknown;
}
