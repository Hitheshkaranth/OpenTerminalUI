export const DRAWING_SCHEMA_VERSION = 3;
export const DRAWING_HANDLE_FALLBACK_X = 12;

export type DrawingToolType = "trendline" | "ray" | "hline" | "vline" | "rectangle";
export type DrawingToolFamily = "line" | "level" | "marker" | "range";
export type DrawingAnchorRole = "start" | "end" | "level" | "marker";
export type DrawingSource = "local" | "remote";
export type DrawingLineStyle = "solid" | "dashed";
export type DrawingLayerMove = "front" | "forward" | "backward" | "back";

export type DrawingPoint = {
  time: number;
  price: number;
};

export type DrawingAnchor = DrawingPoint & {
  key: string;
  role: DrawingAnchorRole;
};

export type DrawingStyle = {
  color: string;
  lineWidth: 1 | 2 | 3 | 4;
  lineStyle: DrawingLineStyle;
  fillColor: string | null;
  fillOpacity: number;
};

export type DrawingScope = {
  timeframe: string;
  workspaceId: string;
};

export type DrawingToolMeta = {
  type: DrawingToolType;
  family: DrawingToolFamily;
  label: string;
  minAnchors: number;
  maxAnchors: number;
  shape: "segment" | "ray" | "level" | "vertical" | "range";
};

export type NormalizedChartDrawing = {
  version: typeof DRAWING_SCHEMA_VERSION;
  id: string;
  tool: DrawingToolMeta;
  anchors: DrawingAnchor[];
  style: DrawingStyle;
  visible: boolean;
  locked: boolean;
  order: number;
  meta: DrawingScope & {
    createdAt?: string | null;
    source?: DrawingSource;
  };
  remoteId?: string;
};

export type DrawingRecordLike = {
  id: string;
  symbol?: string;
  tool_type: string;
  coordinates?: Record<string, unknown>;
  style?: Record<string, unknown>;
  created_at?: string;
};

export type DrawingRemotePayload = {
  tool_type: string;
  coordinates: Record<string, unknown>;
  style: Record<string, unknown>;
};

export type DrawingSyncPlan = {
  create: NormalizedChartDrawing[];
  update: Array<{ remoteId: string; drawing: NormalizedChartDrawing }>;
  delete: string[];
};

export type DrawingHandle = {
  id: string;
  anchorKey: string;
  left: number;
  top: number;
};

export type DrawingHit = {
  drawingId: string;
  target: "body" | "handle";
  anchorKey?: string;
  distance: number;
};

export type CandleSnapPoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

const DRAWING_TOOL_REGISTRY: Record<DrawingToolType, DrawingToolMeta> = {
  trendline: {
    type: "trendline",
    family: "line",
    label: "Trendline",
    minAnchors: 2,
    maxAnchors: 2,
    shape: "segment",
  },
  ray: {
    type: "ray",
    family: "line",
    label: "Ray",
    minAnchors: 2,
    maxAnchors: 2,
    shape: "ray",
  },
  hline: {
    type: "hline",
    family: "level",
    label: "Horizontal Line",
    minAnchors: 1,
    maxAnchors: 1,
    shape: "level",
  },
  vline: {
    type: "vline",
    family: "marker",
    label: "Vertical Line",
    minAnchors: 1,
    maxAnchors: 1,
    shape: "vertical",
  },
  rectangle: {
    type: "rectangle",
    family: "range",
    label: "Rectangle",
    minAnchors: 2,
    maxAnchors: 2,
    shape: "range",
  },
};

function normalizeScope(scope?: Partial<DrawingScope>): DrawingScope {
  return {
    timeframe: typeof scope?.timeframe === "string" && scope.timeframe.trim() ? scope.timeframe.trim() : "1D",
    workspaceId:
      typeof scope?.workspaceId === "string" && scope.workspaceId.trim()
        ? scope.workspaceId.trim()
        : "default-workspace",
  };
}

function getToolMeta(toolType: unknown): DrawingToolMeta | null {
  const normalized = typeof toolType === "string" ? toolType.trim().toLowerCase() : "";
  if (
    normalized === "trendline" ||
    normalized === "ray" ||
    normalized === "hline" ||
    normalized === "vline" ||
    normalized === "rectangle"
  ) {
    return DRAWING_TOOL_REGISTRY[normalized];
  }
  return null;
}

export function listDrawingTools(): DrawingToolMeta[] {
  return Object.values(DRAWING_TOOL_REGISTRY);
}

function clampLineWidth(lineWidth: unknown, fallback: 1 | 2 | 3 | 4): 1 | 2 | 3 | 4 {
  const value = Number(lineWidth);
  if (!Number.isFinite(value)) return fallback;
  if (value <= 1) return 1;
  if (value >= 4) return 4;
  if (value < 2) return 1;
  if (value < 3) return 2;
  if (value < 4) return 3;
  return 4;
}

function clampFillOpacity(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return 0;
  if (parsed >= 100) return 100;
  return Math.round(parsed);
}

function normalizeLineStyle(value: unknown, fallback: DrawingLineStyle): DrawingLineStyle {
  return value === "dashed" || value === "solid" ? value : fallback;
}

function defaultDrawingStyle(toolType: DrawingToolType): DrawingStyle {
  if (toolType === "hline") {
    return {
      color: "#4dd0e1",
      lineWidth: 1,
      lineStyle: "dashed",
      fillColor: null,
      fillOpacity: 0,
    };
  }
  if (toolType === "vline") {
    return {
      color: "#9b8cff",
      lineWidth: 1,
      lineStyle: "dashed",
      fillColor: null,
      fillOpacity: 0,
    };
  }
  if (toolType === "rectangle") {
    return {
      color: "#7bd389",
      lineWidth: 1,
      lineStyle: "solid",
      fillColor: "#7bd389",
      fillOpacity: 16,
    };
  }
  if (toolType === "ray") {
    return {
      color: "#ef8354",
      lineWidth: 2,
      lineStyle: "solid",
      fillColor: null,
      fillOpacity: 0,
    };
  }
  return {
    color: "#ffd166",
    lineWidth: 2,
    lineStyle: "solid",
    fillColor: null,
    fillOpacity: 0,
  };
}

function normalizeDrawingStyle(toolType: DrawingToolType, raw: unknown): DrawingStyle {
  const base = defaultDrawingStyle(toolType);
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const color = typeof input.color === "string" && input.color.trim() ? input.color.trim() : base.color;
  const fillColor =
    typeof input.fillColor === "string" && input.fillColor.trim()
      ? input.fillColor.trim()
      : base.fillColor;
  return {
    color,
    lineWidth: clampLineWidth(input.lineWidth, base.lineWidth),
    lineStyle: normalizeLineStyle(input.lineStyle, base.lineStyle),
    fillColor,
    fillOpacity: clampFillOpacity(input.fillOpacity, base.fillOpacity),
  };
}

function normalizeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function deterministicDrawingId(toolType: string, payload: unknown): string {
  const text = stableStringify(payload);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return `drawing-${toolType}-${hash.toString(16)}`;
}

function normalizeLayerOrder(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return 0;
  return Math.floor(parsed);
}

function resolveOrderedTwoPointAnchors(anchors: DrawingAnchor[], minTimeGap = 60): DrawingAnchor[] {
  const valid = anchors
    .slice(0, 2)
    .filter((anchor) => Number.isFinite(anchor.time) && Number.isFinite(anchor.price))
    .sort((left, right) => left.time - right.time);

  if (valid.length !== 2) return [];
  const [first, second] = valid;
  if (second.time === first.time) {
    return [
      { ...first, key: "start", role: "start" },
      { ...second, key: "end", role: "end", time: first.time + Math.max(1, minTimeGap) },
    ];
  }
  return [
    { ...first, key: "start", role: "start" },
    { ...second, key: "end", role: "end" },
  ];
}

function normalizeToolAnchors(toolType: DrawingToolType, anchors: DrawingAnchor[]): DrawingAnchor[] {
  if (toolType === "hline") {
    const anchor = anchors.find((item) => Number.isFinite(item.time) && Number.isFinite(item.price));
    if (!anchor) return [];
    return [{ ...anchor, key: "level", role: "level" }];
  }

  if (toolType === "vline") {
    const anchor = anchors.find((item) => Number.isFinite(item.time) && Number.isFinite(item.price));
    if (!anchor) return [];
    return [{ ...anchor, key: "marker", role: "marker" }];
  }

  return resolveOrderedTwoPointAnchors(anchors);
}

function buildLegacyAnchors(toolType: DrawingToolType, raw: Record<string, unknown>): DrawingAnchor[] {
  if (toolType === "hline") {
    const price = normalizeNumber(raw.price);
    if (price === null) return [];
    const time = normalizeNumber(raw.anchor_time) ?? normalizeNumber(raw.time) ?? 0;
    return [{ key: "level", role: "level", time, price }];
  }

  if (toolType === "vline") {
    const time = normalizeNumber(raw.time) ?? normalizeNumber(raw.anchor_time);
    if (time === null) return [];
    const price = normalizeNumber(raw.price) ?? normalizeNumber(raw.anchor_price) ?? 0;
    return [{ key: "marker", role: "marker", time, price }];
  }

  const p1 = raw.p1 && typeof raw.p1 === "object" ? (raw.p1 as Record<string, unknown>) : null;
  const p2 = raw.p2 && typeof raw.p2 === "object" ? (raw.p2 as Record<string, unknown>) : null;
  if (!p1 || !p2) return [];
  const start = {
    key: "start",
    role: "start" as const,
    time: normalizeNumber(p1.time) ?? NaN,
    price: normalizeNumber(p1.price) ?? NaN,
  };
  const end = {
    key: "end",
    role: "end" as const,
    time: normalizeNumber(p2.time) ?? NaN,
    price: normalizeNumber(p2.price) ?? NaN,
  };
  return resolveOrderedTwoPointAnchors([start, end]);
}

function normalizeAnchors(toolType: DrawingToolType, raw: Record<string, unknown>): DrawingAnchor[] {
  const candidateAnchors = Array.isArray(raw.anchors) ? raw.anchors : null;
  if (!candidateAnchors?.length) {
    return buildLegacyAnchors(toolType, raw);
  }

  const mapped: DrawingAnchor[] = [];
  for (const [index, item] of candidateAnchors.entries()) {
    if (!item || typeof item !== "object") continue;
    const anchor = item as Record<string, unknown>;
    const time = normalizeNumber(anchor.time);
    const price = normalizeNumber(anchor.price);
    if (time === null || price === null) continue;

    if (toolType === "hline") {
      mapped.push({ key: "level", role: "level", time, price });
      break;
    }
    if (toolType === "vline") {
      mapped.push({ key: "marker", role: "marker", time, price });
      break;
    }
    if (index > 1) continue;
    mapped.push({
      key: index === 0 ? "start" : "end",
      role: index === 0 ? "start" : "end",
      time,
      price,
    });
  }

  return normalizeToolAnchors(toolType, mapped);
}

function normalizeDrawingCollectionOrder(drawings: NormalizedChartDrawing[]): NormalizedChartDrawing[] {
  return drawings
    .slice()
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.id.localeCompare(right.id);
    })
    .map((drawing, index) => (drawing.order === index ? drawing : { ...drawing, order: index }));
}

function buildNormalizedDrawing(args: {
  id: string;
  toolType: DrawingToolType;
  anchors: DrawingAnchor[];
  style?: unknown;
  visible?: unknown;
  locked?: unknown;
  order?: unknown;
  meta?: Partial<NormalizedChartDrawing["meta"]>;
  remoteId?: string;
}): NormalizedChartDrawing | null {
  const tool = DRAWING_TOOL_REGISTRY[args.toolType];
  const scope = normalizeScope(args.meta);
  const normalizedAnchors = normalizeToolAnchors(args.toolType, args.anchors);

  if (normalizedAnchors.length !== tool.minAnchors) {
    return null;
  }

  return {
    version: DRAWING_SCHEMA_VERSION,
    id: args.id,
    tool,
    anchors: normalizedAnchors,
    style: normalizeDrawingStyle(args.toolType, args.style),
    visible: args.visible !== false,
    locked: Boolean(args.locked),
    order: normalizeLayerOrder(args.order, Date.now()),
    meta: {
      ...scope,
      createdAt: typeof args.meta?.createdAt === "string" ? args.meta.createdAt : null,
      source: args.meta?.source,
    },
    remoteId: args.remoteId,
  };
}

function normalizeUnknownDrawing(item: unknown, scope?: Partial<DrawingScope>): NormalizedChartDrawing | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const version = normalizeNumber(raw.version);

  if (version !== null && version >= 2 && raw.tool && typeof raw.tool === "object") {
    const tool = getToolMeta((raw.tool as Record<string, unknown>).type);
    if (!tool) return null;
    const meta = raw.meta && typeof raw.meta === "object" ? (raw.meta as Record<string, unknown>) : {};
    return buildNormalizedDrawing({
      id:
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id
          : deterministicDrawingId(tool.type, { tool: raw.tool, anchors: raw.anchors, style: raw.style, meta }),
      toolType: tool.type,
      anchors: normalizeAnchors(tool.type, raw),
      style: raw.style,
      visible: raw.visible,
      locked: raw.locked,
      order: raw.order ?? meta.order,
      meta: {
        timeframe: typeof meta.timeframe === "string" ? meta.timeframe : normalizeScope(scope).timeframe,
        workspaceId: typeof meta.workspaceId === "string" ? meta.workspaceId : normalizeScope(scope).workspaceId,
        createdAt: typeof meta.createdAt === "string" ? meta.createdAt : null,
        source: meta.source === "remote" || meta.source === "local" ? meta.source : "local",
      },
      remoteId: typeof raw.remoteId === "string" ? raw.remoteId : undefined,
    });
  }

  const tool = getToolMeta(raw.type);
  if (!tool) return null;
  return buildNormalizedDrawing({
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id
        : deterministicDrawingId(tool.type, { type: raw.type, p1: raw.p1, p2: raw.p2, price: raw.price, style: raw.style }),
    toolType: tool.type,
    anchors: buildLegacyAnchors(tool.type, raw),
    style: raw.style,
    order: raw.order,
    meta: {
      ...normalizeScope(scope),
      source: "local",
    },
  });
}

export function normalizeStoredDrawingCollection(
  input: unknown,
  scope?: Partial<DrawingScope>,
): NormalizedChartDrawing[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: NormalizedChartDrawing[] = [];
  for (const item of input) {
    const drawing = normalizeUnknownDrawing(item, scope);
    if (!drawing || seen.has(drawing.id)) continue;
    seen.add(drawing.id);
    out.push(drawing);
  }
  return normalizeDrawingCollectionOrder(out);
}

export function normalizeRemoteDrawingRecord(
  record: DrawingRecordLike,
  scope?: Partial<DrawingScope>,
): NormalizedChartDrawing | null {
  const tool = getToolMeta(record.tool_type);
  if (!tool) return null;
  const coordinates =
    record.coordinates && typeof record.coordinates === "object"
      ? (record.coordinates as Record<string, unknown>)
      : {};
  const localId =
    typeof coordinates.drawing_id === "string" && coordinates.drawing_id.trim()
      ? coordinates.drawing_id
      : `remote-${record.id}`;

  return buildNormalizedDrawing({
    id: localId,
    toolType: tool.type,
    anchors: normalizeAnchors(tool.type, coordinates),
    style: record.style,
    visible: coordinates.visible,
    locked: coordinates.locked,
    order: coordinates.layer_order ?? coordinates.z_index,
    meta: {
      timeframe:
        typeof coordinates.timeframe === "string" && coordinates.timeframe.trim()
          ? coordinates.timeframe
          : normalizeScope(scope).timeframe,
      workspaceId:
        typeof coordinates.workspace_id === "string" && coordinates.workspace_id.trim()
          ? coordinates.workspace_id
          : normalizeScope(scope).workspaceId,
      createdAt: typeof record.created_at === "string" ? record.created_at : null,
      source: "remote",
    },
    remoteId: record.id,
  });
}

function createInitialAnchors(toolType: DrawingToolType, points: DrawingPoint[]): DrawingAnchor[] {
  if (toolType === "hline") {
    return points.slice(0, 1).map((point) => ({ key: "level", role: "level" as const, ...point }));
  }
  if (toolType === "vline") {
    return points.slice(0, 1).map((point) => ({ key: "marker", role: "marker" as const, ...point }));
  }
  return points.slice(0, 2).map((point, index) => ({
    key: index === 0 ? "start" : "end",
    role: index === 0 ? ("start" as const) : ("end" as const),
    ...point,
  }));
}

export function createDrawing(
  toolType: DrawingToolType,
  points: DrawingPoint[],
  scope?: Partial<DrawingScope>,
  overrides?: Partial<Pick<NormalizedChartDrawing, "id" | "locked" | "visible" | "order">> & {
    style?: Partial<DrawingStyle>;
  },
): NormalizedChartDrawing | null {
  const tool = DRAWING_TOOL_REGISTRY[toolType];
  const drawing = buildNormalizedDrawing({
    id: typeof overrides?.id === "string" && overrides.id.trim() ? overrides.id : `${tool.type}-${Date.now()}`,
    toolType,
    anchors: createInitialAnchors(tool.type, points),
    style: {
      ...defaultDrawingStyle(tool.type),
      ...(overrides?.style || {}),
    },
    visible: overrides?.visible,
    locked: overrides?.locked,
    order: overrides?.order,
    meta: {
      ...normalizeScope(scope),
      source: "local",
    },
  });

  return drawing;
}

export function sortDrawingsByOrder(drawings: NormalizedChartDrawing[]): NormalizedChartDrawing[] {
  return normalizeDrawingCollectionOrder(drawings);
}

export function moveDrawingLayer(
  drawings: NormalizedChartDrawing[],
  drawingId: string,
  direction: DrawingLayerMove,
): NormalizedChartDrawing[] {
  const ordered = normalizeDrawingCollectionOrder(drawings);
  const index = ordered.findIndex((drawing) => drawing.id === drawingId);
  if (index < 0) return ordered;

  const next = ordered.slice();
  const [selected] = next.splice(index, 1);
  if (!selected) return ordered;

  if (direction === "front") {
    next.push(selected);
  } else if (direction === "back") {
    next.unshift(selected);
  } else if (direction === "forward") {
    const insertAt = Math.min(index + 1, next.length);
    next.splice(insertAt, 0, selected);
  } else {
    const insertAt = Math.max(index - 1, 0);
    next.splice(insertAt, 0, selected);
  }

  return next.map((drawing, order) => (drawing.order === order ? drawing : { ...drawing, order }));
}

export function serializeDrawingCollection(drawings: NormalizedChartDrawing[]): Array<Record<string, unknown>> {
  return normalizeDrawingCollectionOrder(drawings).map((drawing) => ({
    version: DRAWING_SCHEMA_VERSION,
    id: drawing.id,
    tool: drawing.tool,
    anchors: drawing.anchors.map((anchor) => ({
      key: anchor.key,
      role: anchor.role,
      time: anchor.time,
      price: anchor.price,
    })),
    style: { ...drawing.style },
    visible: drawing.visible,
    locked: drawing.locked,
    order: drawing.order,
    meta: {
      timeframe: drawing.meta.timeframe,
      workspaceId: drawing.meta.workspaceId,
      createdAt: drawing.meta.createdAt ?? null,
    },
  }));
}

export function buildRemoteDrawingPayload(drawing: NormalizedChartDrawing): DrawingRemotePayload {
  const coordinates: Record<string, unknown> = {
    schema_version: DRAWING_SCHEMA_VERSION,
    drawing_id: drawing.id,
    timeframe: drawing.meta.timeframe,
    workspace_id: drawing.meta.workspaceId,
    visible: drawing.visible,
    locked: drawing.locked,
    layer_order: drawing.order,
    tool: drawing.tool,
    anchors: drawing.anchors.map((anchor) => ({
      key: anchor.key,
      role: anchor.role,
      time: anchor.time,
      price: anchor.price,
    })),
  };

  if (drawing.tool.type === "hline") {
    const anchor = drawing.anchors[0];
    coordinates.price = anchor?.price ?? null;
    coordinates.anchor_time = anchor?.time ?? 0;
  } else if (drawing.tool.type === "vline") {
    const anchor = drawing.anchors[0];
    coordinates.time = anchor?.time ?? null;
    coordinates.anchor_price = anchor?.price ?? 0;
  } else {
    const [p1, p2] = resolveOrderedTwoPointAnchors(drawing.anchors);
    coordinates.p1 = p1 ? { time: p1.time, price: p1.price } : null;
    coordinates.p2 = p2 ? { time: p2.time, price: p2.price } : null;
  }

  return {
    tool_type: drawing.tool.type,
    coordinates,
    style: {
      color: drawing.style.color,
      lineWidth: drawing.style.lineWidth,
      lineStyle: drawing.style.lineStyle,
      fillColor: drawing.style.fillColor,
      fillOpacity: drawing.style.fillOpacity,
    },
  };
}

export function buildDrawingSyncPlan(
  localDrawings: NormalizedChartDrawing[],
  remoteRecords: DrawingRecordLike[],
  scope?: Partial<DrawingScope>,
): DrawingSyncPlan {
  const remoteByDrawingId = new Map<
    string,
    { normalized: NormalizedChartDrawing; rawPayload: DrawingRemotePayload }
  >();
  for (const record of remoteRecords) {
    const normalized = normalizeRemoteDrawingRecord(record, scope);
    if (!normalized) continue;
    remoteByDrawingId.set(normalized.id, {
      normalized,
      rawPayload: {
        tool_type: record.tool_type,
        coordinates:
          record.coordinates && typeof record.coordinates === "object"
            ? { ...(record.coordinates as Record<string, unknown>) }
            : {},
        style: record.style && typeof record.style === "object" ? { ...(record.style as Record<string, unknown>) } : {},
      },
    });
  }

  const create: NormalizedChartDrawing[] = [];
  const update: Array<{ remoteId: string; drawing: NormalizedChartDrawing }> = [];

  for (const drawing of normalizeDrawingCollectionOrder(localDrawings)) {
    const remoteMatch = remoteByDrawingId.get(drawing.id);
    if (!remoteMatch || !remoteMatch.normalized.remoteId) {
      create.push(drawing);
      continue;
    }

    const localPayload = stableStringify(buildRemoteDrawingPayload(drawing));
    const remotePayload = stableStringify(remoteMatch.rawPayload);
    if (localPayload !== remotePayload) {
      update.push({ remoteId: remoteMatch.normalized.remoteId, drawing });
    }
    remoteByDrawingId.delete(drawing.id);
  }

  return {
    create,
    update,
    delete: Array.from(remoteByDrawingId.values())
      .map((entry) => entry.normalized.remoteId)
      .filter((remoteId): remoteId is string => typeof remoteId === "string" && remoteId.length > 0),
  };
}

function findNearestSnapCandle(point: DrawingPoint, candles: CandleSnapPoint[]): CandleSnapPoint | null {
  if (!candles.length) return null;

  let best = candles[0];
  let bestDistance = Math.abs(point.time - candles[0].time);
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const distance = Math.abs(point.time - candle.time);
    if (distance < bestDistance) {
      best = candle;
      bestDistance = distance;
    }
  }
  return best;
}

export function snapDrawingPoint(
  point: DrawingPoint,
  candles: CandleSnapPoint[],
): DrawingPoint & { snappedTime: boolean; snappedPrice: boolean } {
  const nearest = findNearestSnapCandle(point, candles);
  if (!nearest) {
    return {
      ...point,
      snappedTime: false,
      snappedPrice: false,
    };
  }

  const candleRange = Math.abs(nearest.high - nearest.low);
  const priceTolerance = Math.max(0.25, Math.abs(point.price) * 0.005, candleRange);

  const findNearestCandidate = (candidates: number[]) => {
    let candidate = point.price;
    let distance = Number.POSITIVE_INFINITY;
    for (const value of candidates) {
      const nextDistance = Math.abs(point.price - value);
      if (nextDistance < distance) {
        candidate = value;
        distance = nextDistance;
      }
    }
    return { candidate, distance };
  };

  const nearestBody = findNearestCandidate([nearest.open, nearest.close]);
  const nearestWick = findNearestCandidate([nearest.high, nearest.low]);
  const useBodySnap = nearestBody.distance <= priceTolerance;
  const useWickSnap = !useBodySnap && nearestWick.distance <= priceTolerance;
  const shouldSnapPrice = useBodySnap || useWickSnap;
  const snappedPrice = useBodySnap ? nearestBody.candidate : useWickSnap ? nearestWick.candidate : point.price;

  return {
    time: nearest.time,
    price: shouldSnapPrice ? snappedPrice : point.price,
    snappedTime: true,
    snappedPrice: shouldSnapPrice,
  };
}

export function updateDrawingStyle(
  drawing: NormalizedChartDrawing,
  nextStyle: Partial<DrawingStyle>,
): NormalizedChartDrawing {
  if (drawing.locked) return drawing;
  return {
    ...drawing,
    style: normalizeDrawingStyle(drawing.tool.type, { ...drawing.style, ...nextStyle }),
  };
}

export function toggleDrawingVisibility(drawing: NormalizedChartDrawing): NormalizedChartDrawing {
  return {
    ...drawing,
    visible: !drawing.visible,
  };
}

export function toggleDrawingLocked(drawing: NormalizedChartDrawing): NormalizedChartDrawing {
  return {
    ...drawing,
    locked: !drawing.locked,
  };
}

export function getDrawingHandles(
  drawing: NormalizedChartDrawing,
  projector: {
    timeToX: (time: number) => number | null;
    priceToY: (price: number) => number | null;
    fallbackX?: number;
  },
): DrawingHandle[] {
  if (!drawing.visible || drawing.locked) return [];

  if (drawing.tool.type === "hline" || drawing.tool.type === "vline") {
    const anchor = drawing.anchors[0];
    const projectedLeft = anchor ? projector.timeToX(anchor.time) : null;
    const projectedTop = anchor ? projector.priceToY(anchor.price) : null;
    if (anchor && typeof projectedTop === "number" && Number.isFinite(projectedTop)) {
      return [
        {
          id: `${drawing.id}-${anchor.key}`,
          anchorKey: anchor.key,
          left:
            typeof projectedLeft === "number" && Number.isFinite(projectedLeft)
              ? projectedLeft
              : projector.fallbackX ?? DRAWING_HANDLE_FALLBACK_X,
          top: projectedTop,
        },
      ];
    }
    return [];
  }

  return drawing.anchors
    .map((anchor) => {
      const left = projector.timeToX(anchor.time);
      const top = projector.priceToY(anchor.price);
      if (
        typeof left !== "number" ||
        typeof top !== "number" ||
        !Number.isFinite(left) ||
        !Number.isFinite(top)
      ) {
        return null;
      }
      return {
        id: `${drawing.id}-${anchor.key}`,
        anchorKey: anchor.key,
        left,
        top,
      };
    })
    .filter((handle): handle is DrawingHandle => handle !== null);
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function distanceToRay(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy));
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function distanceToRectangleBody(
  point: { x: number; y: number },
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  const left = Math.min(first.x, second.x);
  const right = Math.max(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const bottom = Math.max(first.y, second.y);

  const insideX = point.x >= left && point.x <= right;
  const insideY = point.y >= top && point.y <= bottom;
  if (insideX && insideY) return 0;

  const dx = point.x < left ? left - point.x : point.x > right ? point.x - right : 0;
  const dy = point.y < top ? top - point.y : point.y > bottom ? point.y - bottom : 0;
  if (dx === 0 || dy === 0) {
    return dx + dy;
  }
  return Math.hypot(dx, dy);
}

export function findDrawingHit(
  drawings: NormalizedChartDrawing[],
  point: { x: number; y: number },
  projector: {
    timeToX: (time: number) => number | null;
    priceToY: (price: number) => number | null;
    fallbackX?: number;
  },
  thresholdPx = 8,
): DrawingHit | null {
  let bestHit: DrawingHit | null = null;
  const ordered = normalizeDrawingCollectionOrder(drawings);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const drawing = ordered[index];
    if (!drawing.visible) continue;

    const handles = getDrawingHandles({ ...drawing, locked: false }, projector);
    for (const handle of handles) {
      const distance = Math.hypot(point.x - handle.left, point.y - handle.top);
      if (distance > thresholdPx) continue;
      if (!bestHit || distance <= bestHit.distance) {
        bestHit = {
          drawingId: drawing.id,
          target: "handle",
          anchorKey: handle.anchorKey,
          distance,
        };
      }
    }

    if (drawing.tool.type === "hline") {
      const y = projector.priceToY(drawing.anchors[0]?.price ?? NaN);
      if (typeof y !== "number" || !Number.isFinite(y)) continue;
      const distance = Math.abs(point.y - y);
      if (distance > thresholdPx) continue;
      if (!bestHit || distance <= bestHit.distance) {
        bestHit = {
          drawingId: drawing.id,
          target: "body",
          distance,
        };
      }
      continue;
    }

    if (drawing.tool.type === "vline") {
      const x = projector.timeToX(drawing.anchors[0]?.time ?? NaN);
      if (typeof x !== "number" || !Number.isFinite(x)) continue;
      const distance = Math.abs(point.x - x);
      if (distance > thresholdPx) continue;
      if (!bestHit || distance <= bestHit.distance) {
        bestHit = {
          drawingId: drawing.id,
          target: "body",
          distance,
        };
      }
      continue;
    }

    const handlesForBody = getDrawingHandles({ ...drawing, locked: false }, projector);
    if (handlesForBody.length !== 2) continue;

    const distance =
      drawing.tool.type === "ray"
        ? distanceToRay(
            point,
            { x: handlesForBody[0].left, y: handlesForBody[0].top },
            { x: handlesForBody[1].left, y: handlesForBody[1].top },
          )
        : drawing.tool.type === "rectangle"
        ? distanceToRectangleBody(
            point,
            { x: handlesForBody[0].left, y: handlesForBody[0].top },
            { x: handlesForBody[1].left, y: handlesForBody[1].top },
          )
        : distanceToSegment(
            point,
            { x: handlesForBody[0].left, y: handlesForBody[0].top },
            { x: handlesForBody[1].left, y: handlesForBody[1].top },
          );

    if (distance > thresholdPx) continue;
    if (!bestHit || distance <= bestHit.distance) {
      bestHit = {
        drawingId: drawing.id,
        target: "body",
        distance,
      };
    }
  }

  return bestHit;
}

export function applyDrawingHandleDrag(
  drawing: NormalizedChartDrawing,
  anchorKey: string,
  nextPoint: DrawingPoint,
  candles: CandleSnapPoint[],
): NormalizedChartDrawing {
  if (drawing.locked || !drawing.visible) return drawing;
  const snapped = snapDrawingPoint(nextPoint, candles);

  if (drawing.tool.type === "hline") {
    return {
      ...drawing,
      anchors: [{ key: "level", role: "level", time: snapped.time, price: snapped.price }],
    };
  }

  if (drawing.tool.type === "vline") {
    return {
      ...drawing,
      anchors: [{ key: "marker", role: "marker", time: snapped.time, price: snapped.price }],
    };
  }

  const nextAnchors = drawing.anchors.map((anchor) =>
    anchor.key === anchorKey ? { ...anchor, time: snapped.time, price: snapped.price } : anchor,
  );

  return {
    ...drawing,
    anchors: normalizeToolAnchors(drawing.tool.type, nextAnchors),
  };
}
