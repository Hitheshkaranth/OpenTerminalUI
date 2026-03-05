export const REPLAY_SPEEDS = ["0.5x", "1x", "2x", "4x"] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

const SPEED_TO_MS: Record<ReplaySpeed, number> = {
  "0.5x": 800,
  "1x": 450,
  "2x": 220,
  "4x": 110,
};

export function replaySpeedToMs(speed: ReplaySpeed): number {
  return SPEED_TO_MS[speed] ?? SPEED_TO_MS["1x"];
}

export function clampReplayIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  const max = length - 1;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(max, Math.floor(index)));
}

export function nextReplayIndex(current: number, length: number, step: number = 1): number {
  if (length <= 0) return 0;
  const delta = Number.isFinite(step) ? Math.max(1, Math.floor(step)) : 1;
  return clampReplayIndex(current + delta, length);
}

export function replaySlice<T>(rows: T[], enabled: boolean, index: number): T[] {
  if (!enabled) return rows;
  if (!rows.length) return rows;
  const end = clampReplayIndex(index, rows.length) + 1;
  return rows.slice(0, end);
}
