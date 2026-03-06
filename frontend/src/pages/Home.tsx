import { TerminalShell } from "../components/layout/TerminalShell";
import { MissionControlGrid } from "../components/home/MissionControlGrid";

export function HomePage() {
  return (
    <TerminalShell
      contentClassName="bg-terminal-bg"
      hideTickerLoader
      showMobileBottomNav
      showWorkspaceControls={false}
      statusBarTickerOverride="MISSION CONTROL"
    >
      <div className="border-b border-terminal-border px-3 py-2">
        <h1 className="ot-type-panel-title uppercase tracking-[0.16em] text-terminal-accent">Mission Control</h1>
        <p className="mt-1 text-xs text-terminal-muted">
          Live market pulse, launch matrix, and shell navigation controls.
        </p>
      </div>
      <MissionControlGrid />
    </TerminalShell>
  );
}
