import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import type { ScreenerView } from "./ScreenerContext";
import { useScreenerContext } from "./ScreenerContext";

const views: Array<{ id: ScreenerView; label: string }> = [
  { id: "table", label: "Table" },
  { id: "charts", label: "Charts" },
  { id: "treemap", label: "Treemap" },
  { id: "scatter", label: "Scatter" },
  { id: "scorecard", label: "Scorecard" },
  { id: "split", label: "Split" },
];

export function ViewToggle() {
  const { view, setView } = useScreenerContext();
  return (
    <TerminalPanel title="View" subtitle="Workspace Mode">
      <div className="flex flex-wrap gap-1">
        {views.map((item) => (
          <TerminalButton key={item.id} variant={view === item.id ? "accent" : "default"} onClick={() => setView(item.id)}>
            {item.label}
          </TerminalButton>
        ))}
      </div>
    </TerminalPanel>
  );
}
