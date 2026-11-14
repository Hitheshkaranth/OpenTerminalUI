export function normalizeNewsSentiment(item: Record<string, unknown>): { label: string; score?: number; confidence?: number } | null {
  const nested = item.sentiment && typeof item.sentiment === "object" ? item.sentiment as Record<string, unknown> : {};
  const rawLabel = item.sentiment_label ?? nested.label ?? (typeof item.sentiment === "string" ? item.sentiment : null);
  if (typeof rawLabel !== "string" || !rawLabel.trim()) return null;
  const numeric = (value: unknown) => value != null && typeof value !== "boolean" && Number.isFinite(Number(value)) ? Number(value) : undefined;
  return { label: rawLabel, score: numeric(item.sentiment_score ?? nested.score), confidence: numeric(item.sentiment_confidence ?? nested.confidence) };
}
