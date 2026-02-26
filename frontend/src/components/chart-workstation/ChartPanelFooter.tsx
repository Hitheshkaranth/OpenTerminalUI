import type { ChartPoint } from "../../types";
import "./ChartWorkstation.css";

interface Props {
  ticker: string | null;
  lastBar?: ChartPoint | null;
  liveLtp?: number | null;
  liveChangePct?: number | null;
}

export function ChartPanelFooter({ ticker, lastBar, liveLtp = null, liveChangePct = null }: Props) {
  if (!ticker || !lastBar) return null;
  const pct = lastBar.o > 0 ? (((lastBar.c - lastBar.o) / lastBar.o) * 100).toFixed(2) : null;
  const isUp = lastBar.c >= lastBar.o;
  return (
    <div className="chart-panel-footer" data-testid="chart-panel-footer">
      <span className="text-terminal-muted">O</span>
      <span>{lastBar.o.toFixed(2)}</span>
      <span className="text-terminal-muted">H</span>
      <span>{lastBar.h.toFixed(2)}</span>
      <span className="text-terminal-muted">L</span>
      <span>{lastBar.l.toFixed(2)}</span>
      <span className="text-terminal-muted">C</span>
      <span className={isUp ? "text-terminal-pos" : "text-terminal-neg"}>{lastBar.c.toFixed(2)}</span>
      {pct !== null && (
        <span className={`ml-1 ${isUp ? "text-terminal-pos" : "text-terminal-neg"}`}>
          {isUp ? "+" : ""}{pct}%
        </span>
      )}
      {liveLtp !== null && Number.isFinite(liveLtp) ? (
        <>
          <span className="ml-auto text-terminal-muted">RT</span>
          <span className={liveChangePct !== null && liveChangePct < 0 ? "text-terminal-neg" : "text-terminal-pos"}>
            {liveLtp.toFixed(2)}
          </span>
        </>
      ) : null}
    </div>
  );
}
