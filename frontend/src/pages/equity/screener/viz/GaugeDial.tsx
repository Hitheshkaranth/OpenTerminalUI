type GaugeDialProps = {
  value: number;
  min?: number;
  max?: number;
};

export function GaugeDial({ value, min = 0, max = 100 }: GaugeDialProps) {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const angle = -90 + pct * 180;
  const rad = (angle * Math.PI) / 180;
  const x = 100 + 70 * Math.cos(rad);
  const y = 100 + 70 * Math.sin(rad);

  return (
    <svg width={220} height={130} viewBox="0 0 220 130">
      <path d="M30 100 A70 70 0 0 1 170 100" stroke="#2a2f3e" strokeWidth="10" fill="none" />
      <line x1="100" y1="100" x2={x} y2={y} stroke="#18ffff" strokeWidth="4" />
      <text x="100" y="120" textAnchor="middle" fill="#e0e0e0" fontSize="12">{value.toFixed(2)}</text>
    </svg>
  );
}
