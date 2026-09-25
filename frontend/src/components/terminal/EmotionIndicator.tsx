import { useMemo, useState } from "react";

import type { StockEmotion } from "../../api/client";
import { terminalColors } from "../../theme/terminal";

type Props = {
  ticker: string;
  data?: StockEmotion;
  isLoading?: boolean;
  isError?: boolean;
};

const EMOTION_META: Record<string, { emoji: string; color: string }> = {
  euphoria: { emoji: "🚀", color: "#00e676" },
  optimism: { emoji: "😀", color: "#00c176" },
  confidence: { emoji: "🙂", color: "#7cb342" },
  neutral: { emoji: "😐", color: "#8e98a8" },
  uncertainty: { emoji: "🤔", color: "#ffd54f" },
  caution: { emoji: "😬", color: "#ffb74d" },
  anxiety: { emoji: "😟", color: "#ff8a65" },
  fear: { emoji: "😨", color: "#ff5252" },
  panic: { emoji: "😱", color: "#d50000" },
};

function emotionMeta(emotion: string) {
  return EMOTION_META[emotion?.toLowerCase()] ?? EMOTION_META.neutral;
}

function indexColor(index: number): string {
  if (index >= 80) return "#00e676";
  if (index >= 60) return "#7cb342";
  if (index > 40) return "#8e98a8";
  if (index > 20) return "#ffb74d";
  return "#ff5252";
}

function clamp01to100(v: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(v) ? v : 50));
}

function sentimentColor(label: string): string {
  if (label === "Bullish") return terminalColors.positive;
  if (label === "Bearish") return terminalColors.negative;
  return terminalColors.muted;
}

// Semicircle gauge geometry: index 0 -> 180deg (left), index 100 -> 0deg (right).
const GAUGE = { cx: 110, cy: 116, r: 88, width: 220, height: 132 };

function pointAt(index: number, radius: number): { x: number; y: number } {
  const angle = ((180 - (index / 100) * 180) * Math.PI) / 180;
  return {
    x: GAUGE.cx + radius * Math.cos(angle),
    y: GAUGE.cy - radius * Math.sin(angle),
  };
}

function arcPath(startIndex: number, endIndex: number, radius: number): string {
  const start = pointAt(startIndex, radius);
  const end = pointAt(endIndex, radius);
  // The gauge spans at most 180deg, so this is never the SVG "large" (>180deg) arc.
  // Flagging it large for index > 50 made the fill swing round the mirrored centre.
  const largeArc = 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function EmotionGauge({ index, label }: { index: number; label: string }) {
  const value = clamp01to100(index);
  const needle = pointAt(value, GAUGE.r - 14);
  const color = indexColor(value);
  return (
    <svg width={GAUGE.width} height={GAUGE.height} viewBox={`0 0 ${GAUGE.width} ${GAUGE.height}`}>
      <path d={arcPath(0, 100, GAUGE.r)} fill="none" stroke={terminalColors.border} strokeWidth={14} strokeLinecap="round" />
      <path d={arcPath(0, value, GAUGE.r)} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />
      <line x1={GAUGE.cx} y1={GAUGE.cy} x2={needle.x} y2={needle.y} stroke={color} strokeWidth={3} strokeLinecap="round" />
      <circle cx={GAUGE.cx} cy={GAUGE.cy} r={6} fill={color} />
      <text x={GAUGE.cx} y={GAUGE.cy - 30} textAnchor="middle" fontSize={28} fontWeight={700} fill={terminalColors.text}>
        {value.toFixed(0)}
      </text>
      <text x={GAUGE.cx} y={GAUGE.cy - 12} textAnchor="middle" fontSize={11} fill={color} fontWeight={600}>
        {label.toUpperCase()}
      </text>
      <text x={12} y={GAUGE.cy + 14} textAnchor="start" fontSize={9} fill={terminalColors.muted}>
        FEAR
      </text>
      <text x={GAUGE.width - 12} y={GAUGE.cy + 14} textAnchor="end" fontSize={9} fill={terminalColors.muted}>
        GREED
      </text>
    </svg>
  );
}

export function EmotionIndicator({ ticker, data, isLoading, isError }: Props) {
  const [showArticles, setShowArticles] = useState(false);

  const distribution = useMemo(() => {
    if (!data?.emotion_distribution?.length) return [];
    return [...data.emotion_distribution].sort((a, b) => b.count - a.count);
  }, [data?.emotion_distribution]);

  if (isLoading) {
    return (
      <section className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="text-sm font-semibold">Emotion Indicator</div>
        <div className="mt-1 text-[11px] text-terminal-muted">
          Analyzing {ticker} news with the local Gemma model — this can take a minute…
        </div>
        <div className="mt-2 h-28 animate-pulse rounded bg-terminal-bg" />
      </section>
    );
  }
  if (isError || !data) {
    return (
      <section className="rounded border border-terminal-border bg-terminal-panel p-3 text-[11px] text-terminal-muted">
        Emotion analysis unavailable for {ticker}.
      </section>
    );
  }

  const dominant = emotionMeta(data.dominant_emotion);
  const engineLabel = data.engine === "lmstudio" ? `Gemma · ${data.model}` : "Lexical fallback";
  const articles = data.articles ?? [];

  return (
    <section className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Emotion Indicator</div>
          <div className="text-[10px] text-terminal-muted">
            {ticker} · {data.articles_analyzed} articles · {data.period_days}d
          </div>
        </div>
        <span
          className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            borderColor: data.engine === "lmstudio" ? terminalColors.accent : terminalColors.border,
            color: data.engine === "lmstudio" ? terminalColors.accent : terminalColors.muted,
          }}
          title={engineLabel}
        >
          {engineLabel}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="shrink-0">
          <EmotionGauge index={data.emotion_index ?? 0} label={data.emotion_index_label ?? "Neutral"} />
        </div>
        <div className="min-w-[150px] flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>
              {dominant.emoji}
            </span>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Dominant emotion</div>
              <div className="text-sm font-semibold capitalize" style={{ color: dominant.color }}>
                {data.dominant_emotion}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="rounded border border-terminal-border px-2 py-1">
              <div className="text-terminal-muted">Sentiment</div>
              <div className="font-semibold" style={{ color: sentimentColor(data.sentiment_label ?? "neutral") }}>
                {data.sentiment_label ?? "Neutral"} ({ (data.sentiment_score ?? 0) >= 0 ? "+" : ""}
                {(data.sentiment_score ?? 0).toFixed(2)})
              </div>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
              <div className="w-16 text-terminal-muted">Confidence:</div>
              <div className="font-semibold">{((data.confidence ?? 0) * 100).toFixed(0)}%</div>

            </div>
          </div>
        </div>
      </div>

      {distribution.length > 0 && (
        <div className="mt-3 space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Emotion mix</div>
          {distribution.map((row) => {
            const meta = emotionMeta(row.emotion);
            return (
              <div key={row.emotion} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 shrink-0 capitalize text-terminal-muted">
                  {meta.emoji} {row.emotion}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-terminal-bg">
                  <div style={{ width: `${Math.round(row.share * 100)}%`, background: meta.color, height: "100%" }} />
                </div>
                <span className="w-10 shrink-0 text-right text-terminal-muted">{Math.round(row.share * 100)}%</span>
              </div>
            );
          })}
        </div>
      )}

      {data.narrative && (
        <p className="mt-3 rounded border border-terminal-border bg-terminal-bg p-2 text-xs text-terminal-text">
          {data.narrative}
        </p>
      )}

      {articles.length > 0 && (
        <div className="mt-2">
          <button
            className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted"
            onClick={() => setShowArticles((v) => !v)}
          >
            {showArticles ? "Hide" : "Show"} per-article breakdown ({articles.length})
          </button>
          {showArticles && (
            <div className="mt-2 space-y-1">
              {articles.map((article, idx) => {
                const meta = emotionMeta(article.emotion);
                return (
                  <div key={`${article.url}-${idx}`} className="rounded border border-terminal-border bg-terminal-bg p-2 text-[11px]">
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={article.url || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-terminal-accent hover:underline"
                      >
                        {article.title}
                      </a>
                      <div className="flex shrink-0 items-center gap-1">
                        <span
                          className="rounded px-1 py-0.5 text-[9px] font-bold text-black"
                          style={{ backgroundColor: sentimentColor(article.sentiment_label) }}
                        >
                          {article.sentiment_label.toUpperCase()} {article.sentiment_score >= 0 ? "+" : ""}
                          {article.sentiment_score.toFixed(2)}
                        </span>
                        <span
                          className="capitalize"
                          style={{ color: meta.color }}
                          title={`intensity ${(article.emotion_intensity * 100).toFixed(0)}%`}
                        >
                          {meta.emoji} {article.emotion}
                        </span>
                      </div>
                    </div>
                    {article.rationale && <div className="mt-0.5 text-terminal-muted">{article.rationale}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
