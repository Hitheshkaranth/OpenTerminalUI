import { api, getAccessToken } from "../api/base";
import { parseSSEBuffer } from "./sse";
import type { AgentEvent, RunRequest } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || "/api";

/** Create a run and return its id. Uses the shared axios client (auth handled by interceptor). */
export async function createRun(req: RunRequest): Promise<string> {
  const { data } = await api.post<{ run_id: string }>("/agent/runs", req);
  return data.run_id;
}

export async function cancelRun(runId: string): Promise<void> {
  await api.post(`/agent/runs/${encodeURIComponent(runId)}/cancel`);
}

export async function resumeRun(runId: string): Promise<void> {
  await api.post(`/agent/runs/${encodeURIComponent(runId)}/resume`);
}

export async function exportRun(runId: string): Promise<unknown> {
  return (await api.get(`/agent/runs/${encodeURIComponent(runId)}/export`)).data;
}

export interface StoredAgentRun {
  run_id: string;
  thread_id: string | null;
  prompt: string;
  final: string | null;
  status: "pending" | "running" | "done" | "error" | "cancelled" | "interrupted";
}

export async function getRun(runId: string): Promise<StoredAgentRun> {
  return (await api.get(`/agent/runs/${encodeURIComponent(runId)}`)).data;
}

/** Follow/replay a run. Transport failures are separate from persisted model errors.
 * The optional error callback preserves compatibility with older stream consumers.
 */
export async function streamRun(
  runId: string,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
  after = 0,
  onCursor?: (id: number) => void,
  onTransportError?: (message: string) => void,
): Promise<void> {
  const token = getAccessToken();
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const report = (message: string) => {
    if (signal?.aborted) return;
    if (onTransportError) onTransportError(message);
    else onEvent({ type: "error", message });
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const abortRead = () => { void reader?.cancel().catch(() => undefined); };
  try {
    const resp = await fetch(`${API_BASE}/agent/runs/${encodeURIComponent(runId)}/stream${after ? `?after=${after}` : ""}`, { headers, signal });
    if (signal?.aborted) return;
    if (!resp.ok || !resp.body) {
      report(`Connection failed (HTTP ${resp.status}). Reconnect to recover this run.`);
      return;
    }
    reader = resp.body.getReader();
    signal?.addEventListener("abort", abortRead, { once: true });
    const decoder = new TextDecoder();
    let buffer = "";
    let cursor = after;
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) report("Connection ended during an event. Reconnect to recover this run.");
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSSEBuffer(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        if (signal?.aborted) return;
        // A replayed duplicate must not append a second token, role or artifact.
        if (frame.id !== undefined && frame.id <= cursor) continue;
        onEvent(frame.event);
        if (frame.id !== undefined) {
          cursor = frame.id;
          onCursor?.(cursor);
        }
      }
    }
  } catch (err) {
    report(`${(err as Error).message || "Connection lost"}. Reconnect to recover this run.`);
  } finally {
    signal?.removeEventListener("abort", abortRead);
    if (reader) {
      try { await reader.cancel(); } catch { /* response already closed */ }
      reader.releaseLock();
    }
  }
}
