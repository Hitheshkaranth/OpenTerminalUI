import { TerminalBadge } from "../../../components/terminal/TerminalBadge";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function StatusBar() {
  const { result, universe } = useScreenerContext();
  return (
    <TerminalPanel title="Status" subtitle="Result Snapshot">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-terminal-muted">{result?.total_results ?? 0} results | Universe: {universe} | Updated: now</div>
        <div className="flex flex-wrap gap-1">
          <TerminalBadge variant="neutral">Export CSV</TerminalBadge>
          <TerminalBadge variant="neutral">Export XLSX</TerminalBadge>
          <TerminalBadge variant="neutral">Export PDF</TerminalBadge>
        </div>
      </div>
    </TerminalPanel>
  );
}
