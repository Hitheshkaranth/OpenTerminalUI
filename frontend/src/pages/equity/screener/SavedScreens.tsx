import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function SavedScreens() {
  const { savedScreens, setQuery, run } = useScreenerContext();

  return (
    <TerminalPanel title="Saved Screens" subtitle={`Count: ${savedScreens.length}`}>
      <div className="space-y-1 text-xs">
        {savedScreens.map((screen) => (
          <TerminalButton
            key={screen.id}
            className="w-full justify-start text-left normal-case tracking-normal"
            onClick={() => {
              setQuery(screen.query);
              void run({ query: screen.query, preset_id: null });
            }}
          >
            {screen.name}
          </TerminalButton>
        ))}
      </div>
    </TerminalPanel>
  );
}
