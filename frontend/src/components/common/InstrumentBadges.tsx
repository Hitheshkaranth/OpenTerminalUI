type InstrumentBadgesProps = {
  hasFutures?: boolean;
  hasOptions?: boolean;
  exchange?: string | null;
};

export function InstrumentBadges({ hasFutures, hasOptions, exchange }: InstrumentBadgesProps) {
  const hasAny = Boolean(hasFutures) || Boolean(hasOptions) || Boolean(exchange);
  if (!hasAny) {
    return <span className="text-[11px] text-terminal-muted">-</span>;
  }
  return (
    <div className="inline-flex items-center gap-1 text-[11px]">
      {hasFutures ? (
        <span className="rounded border border-cyan-500/60 bg-cyan-500/15 px-1.5 py-0.5 font-semibold text-cyan-300">F</span>
      ) : null}
      {hasOptions ? (
        <span className="rounded border border-amber-500/60 bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-300">O</span>
      ) : null}
      {exchange ? <span className="text-terminal-muted">{exchange}</span> : null}
    </div>
  );
}
