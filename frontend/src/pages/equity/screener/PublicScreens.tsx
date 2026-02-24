import { forkPublicScreenV3 } from "../../../api/client";
import { TerminalBadge } from "../../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function PublicScreens() {
  const { publicScreens, refreshScreens } = useScreenerContext();

  return (
    <TerminalPanel title="Public Screens" subtitle={`Count: ${publicScreens.length}`}>
      <div className="space-y-1 text-xs">
        {publicScreens.map((screen) => (
          <div key={screen.id} className="flex items-center justify-between rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1">
            <div>
              <div>{screen.name}</div>
              <TerminalBadge variant="neutral">{screen.upvotes} upvotes</TerminalBadge>
            </div>
            <TerminalButton
              variant="accent"
              onClick={async () => {
                await forkPublicScreenV3(screen.id);
                await refreshScreens();
              }}
            >
              Fork
            </TerminalButton>
          </div>
        ))}
      </div>
    </TerminalPanel>
  );
}
