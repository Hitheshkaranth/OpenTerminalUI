import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function QueryBar() {
  const { query, setQuery, run, loading } = useScreenerContext();
  return (
    <TerminalPanel
      title="Query"
      subtitle="Screener DSL"
      actions={
        <TerminalButton variant="accent" onClick={() => void run({ query, preset_id: null })} disabled={loading}>
          {loading ? "Running" : "Run"}
        </TerminalButton>
      }
    >
      <textarea
        className="min-h-24 w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[11px] outline-none focus:border-terminal-accent"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </TerminalPanel>
  );
}
