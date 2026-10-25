import type { AgentEvent } from "./types";

const FRAME_SEP = "\n\n";

/**
 * Split an accumulating SSE text buffer into complete events.
 * Returns parsed events plus the unconsumed remainder (a partial frame).
 * Malformed JSON frames are skipped, not thrown.
 */
export function parseSSEBuffer(buffer: string): { events: AgentEvent[]; frames: Array<{ event: AgentEvent; id?: number }>; rest: string; lastEventId?: number } {
  const events: AgentEvent[] = [];
  const frames: Array<{ event: AgentEvent; id?: number }> = [];
  let rest = buffer.replace(/\r\n/g, "\n");
  let lastEventId: number | undefined;

  let sep = rest.indexOf(FRAME_SEP);
  while (sep !== -1) {
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + FRAME_SEP.length);

    const lines = frame.split("\n");
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
    if (data.length) {
      const payload = data.join("\n");
      try {
        const event = JSON.parse(payload) as AgentEvent;
        const rawId = lines.find((line) => line.startsWith("id:"))?.slice(3).trim();
        const id = rawId && /^\d+$/.test(rawId) && Number.isSafeInteger(Number(rawId)) ? Number(rawId) : undefined;
        events.push(event);
        frames.push({ event, ...(id !== undefined ? { id } : {}) });
        if (id !== undefined) lastEventId = id;
      } catch {
        // skip malformed frame
      }
    }
    sep = rest.indexOf(FRAME_SEP);
  }
  return { events, frames, rest, ...(lastEventId !== undefined ? { lastEventId } : {}) };
}
