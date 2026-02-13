export function StatusBar() {
  return (
    <div className="border-t border-terminal-border bg-terminal-panel px-3 py-1 text-[11px] uppercase tracking-wide text-terminal-muted">
      <span className="mr-4 text-terminal-accent">Live</span>
      <span className="mr-4">NSE Session 09:15 - 15:30 IST</span>
      <span className="mr-4">Data: Yahoo/NSE</span>
      <span>Phase 3 Active</span>
    </div>
  );
}
