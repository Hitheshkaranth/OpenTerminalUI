import type { ScannerResult } from "../../types";
import { BreakoutRecommendationCard } from "./BreakoutRecommendationCard";

type Props = {
  rows: ScannerResult[];
  onCreateAlert: (row: ScannerResult) => void;
};

export function BreakoutRecommendations({ rows, onCreateAlert }: Props) {
  return (
    <section className="space-y-2 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-terminal-accent">Recommendations</div>
        <div className="text-xs text-terminal-muted">{rows.length} candidates</div>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-terminal-muted">Run the scanner to populate breakout recommendations.</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {rows.map((row) => (
            <BreakoutRecommendationCard key={`${row.run_id}-${row.symbol}-${row.setup_type}`} row={row} onCreateAlert={onCreateAlert} />
          ))}
        </div>
      )}
    </section>
  );
}
