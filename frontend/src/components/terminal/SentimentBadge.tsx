type Props = {
  score?: number | null;
  label?: string | null;
  confidence?: number | null;
};

function labelFromScore(score: number) {
  if (score > 0.1) return "Bullish";
  if (score < -0.1) return "Bearish";
  return "Neutral";
}

export function SentimentBadge({ score = 0, label, confidence }: Props) {
  const resolvedScore = Number(score) || 0;
  const resolvedLabel = (label || labelFromScore(resolvedScore)).toString();
  const resolvedConfidence = Number(confidence);
  const color =
    resolvedLabel.toLowerCase().includes("bull")
      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
      : resolvedLabel.toLowerCase().includes("bear")
      ? "border-rose-500/50 bg-rose-500/15 text-rose-300"
      : "border-slate-500/50 bg-slate-500/15 text-slate-300";

  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>
      {resolvedLabel} {Number.isFinite(resolvedConfidence) ? resolvedConfidence.toFixed(2) : Math.abs(resolvedScore).toFixed(2)}
    </span>
  );
}
