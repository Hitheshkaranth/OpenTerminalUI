export type PatternAnchorPoint = {
  bar_index: number;
  price: number;
  type: string;
  date?: string;
};

export type PatternTrendline = {
  start: { idx: number; price: number };
  end: { idx: number; price: number };
  role?: string;
};

export type PatternDetection = {
  pattern_type: string;
  direction: "bullish" | "bearish";
  confidence: number;
  anchor_points: PatternAnchorPoint[];
  trendlines: PatternTrendline[];
  target_price: number | null;
  description: string;
  start_bar: number;
  end_bar: number;
};

export type PatternApiResponse = {
  symbol: string;
  timeframe: string;
  patterns: PatternDetection[];
  scan_bars: number;
};

export type PatternOverlayLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  dashed: boolean;
  role: string;
};

export type PatternOverlayBadge = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  background: string;
  pattern_type: string;
  confidence: number;
  description: string;
  target_price: number | null;
};

export type PatternOverlayModel = {
  lines: PatternOverlayLine[];
  badges: PatternOverlayBadge[];
};

function normalizePatterns(payload: unknown): PatternDetection[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { patterns?: unknown[] }).patterns;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const src = row as Partial<PatternDetection>;
      const patternType = String(src.pattern_type || "").trim().toLowerCase();
      const direction = String(src.direction || "").trim().toLowerCase() === "bearish" ? "bearish" : "bullish";
      const confidence = Number(src.confidence);
      const startBar = Number(src.start_bar);
      const endBar = Number(src.end_bar);
      if (!patternType || !Number.isFinite(confidence) || !Number.isFinite(startBar) || !Number.isFinite(endBar)) return null;
      return {
        pattern_type: patternType,
        direction,
        confidence: Math.max(0, Math.min(1, confidence)),
        anchor_points: Array.isArray(src.anchor_points) ? src.anchor_points : [],
        trendlines: Array.isArray(src.trendlines) ? src.trendlines : [],
        target_price: Number.isFinite(Number(src.target_price)) ? Number(src.target_price) : null,
        description: String(src.description || ""),
        start_bar: startBar,
        end_bar: endBar,
      } as PatternDetection;
    })
    .filter((row): row is PatternDetection => Boolean(row));
}

function mapX(idx: number, width: number, maxBars: number): number {
  const denom = Math.max(1, maxBars - 1);
  return Math.max(0, Math.min(width, (idx / denom) * width));
}

function mapY(price: number, height: number, minPrice: number, maxPrice: number): number {
  const span = Math.max(1e-9, maxPrice - minPrice);
  const ratio = (price - minPrice) / span;
  return Math.max(0, Math.min(height, height - ratio * height));
}

export function buildPatternOverlayModel(
  patterns: PatternDetection[],
  options: { width: number; height: number; maxBars: number; minPrice: number; maxPrice: number },
): PatternOverlayModel {
  const width = Math.max(1, Number(options.width));
  const height = Math.max(1, Number(options.height));
  const maxBars = Math.max(2, Number(options.maxBars));
  const minPrice = Number(options.minPrice);
  const maxPrice = Number(options.maxPrice);
  const safeMin = Number.isFinite(minPrice) ? minPrice : 0;
  const safeMax = Number.isFinite(maxPrice) && maxPrice > safeMin ? maxPrice : safeMin + 1;

  const lines: PatternOverlayLine[] = [];
  const badges: PatternOverlayBadge[] = [];

  for (const pattern of patterns) {
    const tone = pattern.direction === "bearish" ? "#ef4444" : "#22c55e";
    const bg = pattern.direction === "bearish" ? "rgba(127,29,29,0.85)" : "rgba(20,83,45,0.85)";
    const linePrefix = `${pattern.pattern_type}:${pattern.start_bar}:${pattern.end_bar}`;

    for (let index = 0; index < pattern.trendlines.length; index += 1) {
      const trend = pattern.trendlines[index];
      const x1 = mapX(Number(trend.start?.idx ?? 0), width, maxBars);
      const y1 = mapY(Number(trend.start?.price ?? safeMin), height, safeMin, safeMax);
      const x2 = mapX(Number(trend.end?.idx ?? 0), width, maxBars);
      const y2 = mapY(Number(trend.end?.price ?? safeMin), height, safeMin, safeMax);
      lines.push({
        id: `${linePrefix}:line:${index}`,
        x1,
        y1,
        x2,
        y2,
        color: tone,
        dashed: true,
        role: String(trend.role || "trendline"),
      });
    }

    const anchorX = mapX(Math.round((pattern.start_bar + pattern.end_bar) / 2), width, maxBars);
    const anchorPrice =
      pattern.anchor_points.length > 0
        ? Number(pattern.anchor_points.reduce((acc, row) => acc + Number(row.price || 0), 0) / pattern.anchor_points.length)
        : safeMin;
    const anchorY = mapY(anchorPrice, height, safeMin, safeMax);
    badges.push({
      id: `${linePrefix}:badge`,
      x: anchorX,
      y: Math.max(12, anchorY - 12),
      text: `${pattern.pattern_type.split("_").join(" ").toUpperCase()} ${(pattern.confidence * 100).toFixed(0)}%`,
      color: tone,
      background: bg,
      pattern_type: pattern.pattern_type,
      confidence: pattern.confidence,
      description: pattern.description,
      target_price: pattern.target_price,
    });
  }

  return { lines, badges };
}

export function hitTestPatternBadge(
  badges: PatternOverlayBadge[],
  point: { x: number; y: number },
  radius = 14,
): PatternOverlayBadge | null {
  const px = Number(point.x);
  const py = Number(point.y);
  const threshold = Math.max(4, Number(radius));
  for (const badge of badges) {
    const dx = badge.x - px;
    const dy = badge.y - py;
    if (Math.sqrt(dx * dx + dy * dy) <= threshold) return badge;
  }
  return null;
}

export async function fetchPatternDetections(
  symbol: string,
  options: {
    timeframe?: string;
    minConfidence?: number;
    lookback?: number;
    market?: string;
    signal?: AbortSignal;
  } = {},
): Promise<PatternApiResponse> {
  const base = String(import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/+$/, "") || "/api";
  const params = new URLSearchParams();
  params.set("timeframe", options.timeframe || "1D");
  params.set("min_confidence", String(options.minConfidence ?? 0.6));
  params.set("lookback", String(options.lookback ?? 200));
  params.set("market", options.market || "NSE");

  const response = await fetch(`${base}/charts/${encodeURIComponent(symbol)}/patterns?${params.toString()}`, {
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Pattern fetch failed (${response.status})`);
  }
  const payload = (await response.json()) as Partial<PatternApiResponse>;
  return {
    symbol: String(payload.symbol || symbol).toUpperCase(),
    timeframe: String(payload.timeframe || options.timeframe || "1D"),
    patterns: normalizePatterns(payload),
    scan_bars: Number.isFinite(Number(payload.scan_bars)) ? Number(payload.scan_bars) : 0,
  };
}
