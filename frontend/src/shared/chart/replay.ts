export const REPLAY_SPEEDS = ["0.5x", "1x", "2x", "4x"] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export type ReplayCommandType =
  | "toggle"
  | "playPause"
  | "stepBack"
  | "stepForward"
  | "reset"
  | "prevSession"
  | "nextSession"
  | "goToDate";

export interface ReplayCommand {
  type: ReplayCommandType;
  revision: number;
  date?: string;
}

export interface ReplayNavigablePoint {
  time: number;
  session?: string | null;
  isExtended?: boolean;
}

export interface ReplayExtendedHoursLike {
  enabled?: boolean;
  showPreMarket?: boolean;
  showAfterHours?: boolean;
}

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

export function shiftReplayIndex(current: number, length: number, step: number = 1): number {
  if (length <= 0) return 0;
  const delta = Number.isFinite(step) ? Math.trunc(step) : 0;
  if (delta === 0) return clampReplayIndex(current, length);
  return clampReplayIndex(current + delta, length);
}

export function nextReplayIndex(current: number, length: number, step: number = 1): number {
  const delta = Number.isFinite(step) ? Math.max(1, Math.floor(step)) : 1;
  return shiftReplayIndex(current, length, delta);
}

export function previousReplayIndex(current: number, length: number, step: number = 1): number {
  const delta = Number.isFinite(step) ? Math.max(1, Math.floor(step)) : 1;
  return shiftReplayIndex(current, length, -delta);
}

export function replaySlice<T>(rows: T[], enabled: boolean, index: number): T[] {
  if (!enabled) return rows;
  if (!rows.length) return rows;
  const end = clampReplayIndex(index, rows.length) + 1;
  return rows.slice(0, end);
}

function normalizeReplaySession(session: string | null | undefined): "pre" | "post" | "rth" {
  if (session === "pre" || session === "pre_open") return "pre";
  if (session === "post" || session === "closing") return "post";
  return "rth";
}

function padDate(value: number): string {
  return String(value).padStart(2, "0");
}

export function replayDateKey(time: number): string {
  const date = new Date(time * 1000);
  return `${date.getUTCFullYear()}-${padDate(date.getUTCMonth() + 1)}-${padDate(date.getUTCDate())}`;
}

export function replayDateInputValue(time: number | null | undefined): string {
  if (typeof time !== "number" || !Number.isFinite(time)) return "";
  return replayDateKey(time);
}

export function isReplayBarVisible(
  point: ReplayNavigablePoint,
  extendedHours?: ReplayExtendedHoursLike,
): boolean {
  if (!point.isExtended) return true;
  const session = normalizeReplaySession(point.session);
  if (!extendedHours?.enabled) {
    return session === "rth";
  }
  if (session === "pre") return extendedHours.showPreMarket !== false;
  if (session === "post") return extendedHours.showAfterHours !== false;
  return true;
}

export function findReplayIndexForDate(
  rows: ReplayNavigablePoint[],
  date: string,
  options?: {
    extendedHours?: ReplayExtendedHoursLike;
    prefer?: "first" | "last";
  },
): number {
  if (!rows.length || !date) return -1;
  const matches: number[] = [];
  const visibleMatches: number[] = [];
  rows.forEach((row, index) => {
    if (replayDateKey(row.time) !== date) return;
    matches.push(index);
    if (isReplayBarVisible(row, options?.extendedHours)) {
      visibleMatches.push(index);
    }
  });
  const inDate = visibleMatches.length ? visibleMatches : matches;
  if (inDate.length) {
    return options?.prefer === "first" ? inDate[0] : inDate[inDate.length - 1];
  }

  const targetTime = Number.parseInt(`${date.replace(/-/g, "")}`, 10);
  if (!Number.isFinite(targetTime)) return -1;

  let fallback = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!isReplayBarVisible(row, options?.extendedHours)) continue;
    const rowDate = Number.parseInt(replayDateKey(row.time).replace(/-/g, ""), 10);
    if (!Number.isFinite(rowDate)) continue;
    if (rowDate <= targetTime) {
      fallback = index;
      continue;
    }
    return fallback >= 0 ? fallback : index;
  }
  return fallback;
}

export function findReplaySessionIndex(
  rows: ReplayNavigablePoint[],
  currentIndex: number,
  direction: -1 | 1,
  options?: {
    extendedHours?: ReplayExtendedHoursLike;
  },
): number {
  if (!rows.length) return -1;
  const visibleIndices = rows
    .map((row, index) => (isReplayBarVisible(row, options?.extendedHours) ? index : -1))
    .filter((index) => index >= 0);
  if (!visibleIndices.length) return clampReplayIndex(currentIndex, rows.length);

  const safeCurrent = clampReplayIndex(currentIndex, rows.length);
  const currentDate = replayDateKey(rows[safeCurrent].time);

  if (direction > 0) {
    for (const index of visibleIndices) {
      if (index <= safeCurrent) continue;
      if (replayDateKey(rows[index].time) !== currentDate) return index;
    }
    return visibleIndices[visibleIndices.length - 1];
  }

  for (let i = visibleIndices.length - 1; i >= 0; i -= 1) {
    const index = visibleIndices[i];
    if (index >= safeCurrent) continue;
    const sessionDate = replayDateKey(rows[index].time);
    if (sessionDate === currentDate) continue;
    let firstIndexForDate = index;
    while (i > 0) {
      const previousIndex = visibleIndices[i - 1];
      if (replayDateKey(rows[previousIndex].time) !== sessionDate) break;
      firstIndexForDate = previousIndex;
      i -= 1;
    }
    return firstIndexForDate;
  }

  return visibleIndices[0];
}
