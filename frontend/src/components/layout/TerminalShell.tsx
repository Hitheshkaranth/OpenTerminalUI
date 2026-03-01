import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { ErrorBoundary } from "../common/ErrorBoundary";
import { InstallPromptBanner } from "./InstallPromptBanner";
import { MobileBottomNav } from "./MobileBottomNav";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { CommandBar } from "./CommandBar";
import { CommandPalette } from "./CommandPalette";
import { TickerTape } from "./TickerTape";
import { executeParsedCommand, parseCommand } from "./commanding";
import { useSettingsStore } from "../../store/settingsStore";
import { HudOverlay } from "./HudOverlay";
import { AlertToasts } from "./AlertToasts";
import type { ThemeVariant } from "../../store/settingsStore";
import { TerminalSelect } from "../terminal/TerminalSelect";

export type WorkspacePreset = "trader" | "quant" | "pm" | "risk" | "ops";

type TerminalShellContextValue = {
  preset: WorkspacePreset;
  setPreset: (preset: WorkspacePreset) => void;
  rightRailOpen: boolean;
  setRightRailOpen: (open: boolean) => void;
  toggleRightRail: () => void;
};

const TerminalShellContext = createContext<TerminalShellContextValue | null>(null);

const PRESET_OPTIONS: Array<{ id: WorkspacePreset; label: string }> = [
  { id: "trader", label: "Trader" },
  { id: "quant", label: "Quant" },
  { id: "pm", label: "PM" },
  { id: "risk", label: "Risk" },
  { id: "ops", label: "Ops" },
];

type RightRailSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type Props = {
  children: ReactNode;
  contentClassName?: string;
  hideTickerLoader?: boolean;
  statusBarTickerOverride?: string;
  showInstallPrompt?: boolean;
  showMobileBottomNav?: boolean;
  hideSidebarOnMobile?: boolean;
  workspacePresetStorageKey?: string;
  defaultPreset?: WorkspacePreset;
  showWorkspaceControls?: boolean;
  rightRailTitle?: string;
  rightRailSections?: RightRailSection[];
  rightRailContent?: ReactNode;
  defaultRightRailOpen?: boolean;
  rightRailStorageKey?: string;
};

function usePersistedState<T>(storageKey: string | undefined, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (!storageKey) return fallback;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // ignore storage failures
    }
  }, [storageKey, value]);

  return [value, setValue];
}

function DefaultRightRail({ title, sections }: { title: string; sections: RightRailSection[] }) {
  return (
    <aside className="hidden xl:flex h-full w-72 shrink-0 flex-col border-l border-terminal-border bg-terminal-panel">
      <div className="border-b border-terminal-border px-3 py-2">
        <div className="ot-type-panel-title text-terminal-accent">{title}</div>
        <div className="ot-type-panel-subtitle text-terminal-muted">Contextual tools and quick actions</div>
      </div>
      <div className="flex-1 space-y-2 overflow-auto p-2">
        {sections.map((section) => (
          <section key={section.id} className="rounded-sm border border-terminal-border bg-terminal-bg/40">
            <header className="border-b border-terminal-border px-2 py-1">
              <div className="ot-type-panel-title text-terminal-muted">{section.title}</div>
            </header>
            <div className="p-2 text-xs text-terminal-text">{section.content}</div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function WorkspaceControlBar({
  preset,
  setPreset,
  rightRailEnabled,
  rightRailOpen,
  toggleRightRail,
}: Pick<TerminalShellContextValue, "preset" | "setPreset" | "rightRailOpen" | "toggleRightRail"> & {
  rightRailEnabled: boolean;
}) {
  const themeVariant = useSettingsStore((s) => s.themeVariant);
  const setThemeVariant = useSettingsStore((s) => s.setThemeVariant);
  const customAccentColor = useSettingsStore((s) => s.customAccentColor);
  const setCustomAccentColor = useSettingsStore((s) => s.setCustomAccentColor);
  const hudOverlayEnabled = useSettingsStore((s) => s.hudOverlayEnabled);
  const setHudOverlayEnabled = useSettingsStore((s) => s.setHudOverlayEnabled);

  return (
    <div className="flex items-center justify-between gap-2 border-b border-terminal-border bg-terminal-panel/90 px-3 py-1.5 backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="ot-type-label text-terminal-muted">Workspace</span>
        <div className="flex flex-wrap items-center gap-1">
          {PRESET_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPreset(option.id)}
              className={`rounded-sm border px-2 py-1 ot-type-label ${
                preset === option.id
                  ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                  : "border-terminal-border text-terminal-muted hover:text-terminal-text"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1 text-[11px] text-terminal-muted">
          Theme
          <TerminalSelect
            size="sm"
            tone="ui"
            className="min-w-36"
            value={themeVariant}
            onChange={(e) => setThemeVariant(e.target.value as ThemeVariant)}
          >
            <option value="terminal-noir">Terminal Noir</option>
            <option value="classic-bloomberg">Classic Bloomberg</option>
            <option value="light-desk">Light Desk</option>
            <option value="custom">Custom</option>
          </TerminalSelect>
        </label>
        {themeVariant === "custom" ? (
          <input
            type="color"
            className="h-6 w-8 cursor-pointer rounded-sm border border-terminal-border bg-transparent p-0"
            aria-label="Custom accent color"
            value={customAccentColor}
            onChange={(e) => setCustomAccentColor(e.target.value)}
          />
        ) : null}
        <button
          type="button"
          onClick={() => setHudOverlayEnabled(!hudOverlayEnabled)}
          className={`rounded-sm border px-2 py-1 ot-type-label ${
            hudOverlayEnabled
              ? "border-terminal-accent text-terminal-accent"
              : "border-terminal-border text-terminal-muted hover:text-terminal-text"
          }`}
        >
          {hudOverlayEnabled ? "HUD On" : "HUD Off"}
        </button>
        {rightRailEnabled ? (
          <button
            type="button"
            onClick={toggleRightRail}
            className={`hidden xl:inline-flex rounded-sm border px-2 py-1 ot-type-label ${
              rightRailOpen
                ? "border-terminal-accent text-terminal-accent"
                : "border-terminal-border text-terminal-muted hover:text-terminal-text"
            }`}
          >
            {rightRailOpen ? "Hide Context Rail" : "Show Context Rail"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TerminalShell({
  children,
  contentClassName = "",
  hideTickerLoader = false,
  statusBarTickerOverride,
  showInstallPrompt = false,
  showMobileBottomNav = false,
  hideSidebarOnMobile = true,
  workspacePresetStorageKey,
  defaultPreset = "trader",
  showWorkspaceControls = true,
  rightRailTitle = "Context Rail",
  rightRailSections,
  rightRailContent,
  defaultRightRailOpen = false,
  rightRailStorageKey,
}: Props) {
  const navigate = useNavigate();
  const [preset, setPreset] = usePersistedState<WorkspacePreset>(
    workspacePresetStorageKey,
    defaultPreset,
  );
  const [rightRailOpen, setRightRailOpen] = usePersistedState<boolean>(
    rightRailStorageKey,
    defaultRightRailOpen,
  );

  const hasRightRail = Boolean(rightRailContent) || Boolean(rightRailSections?.length);

  const shellCtx = useMemo<TerminalShellContextValue>(
    () => ({
      preset,
      setPreset,
      rightRailOpen,
      setRightRailOpen,
      toggleRightRail: () => setRightRailOpen(!rightRailOpen),
    }),
    [preset, setPreset, rightRailOpen, setRightRailOpen],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "w") {
        event.preventDefault();
        navigate("/equity/watchlist");
      } else if (key === "n") {
        event.preventDefault();
        navigate("/equity/news");
      } else if (key === "9") {
        event.preventDefault();
        navigate("/equity/launchpad");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  return (
    <TerminalShellContext.Provider value={shellCtx}>
      <div className="flex h-screen overflow-hidden bg-terminal-bg text-terminal-text">
        <div className={hideSidebarOnMobile ? "hidden md:block" : ""}>
          <Sidebar />
        </div>

        <div className="relative z-10 flex min-w-0 flex-1 flex-col">
          <CommandBar
            onExecute={async (command) => {
              const parsed = parseCommand(command);
              return executeParsedCommand(parsed, navigate);
            }}
          />
          <TickerTape />
          <TopBar hideTickerLoader={hideTickerLoader} />
          {showWorkspaceControls ? (
            <WorkspaceControlBar
              preset={preset}
              setPreset={setPreset}
              rightRailEnabled={hasRightRail}
              rightRailOpen={rightRailOpen}
              toggleRightRail={() => setRightRailOpen(!rightRailOpen)}
            />
          ) : null}
          <div className="min-h-0 flex flex-1 overflow-hidden">
            <ErrorBoundary>
              <div className={`relative z-0 min-h-0 min-w-0 flex-1 overflow-auto ${contentClassName}`.trim()}>
                {children}
              </div>
            </ErrorBoundary>
            {hasRightRail && rightRailOpen
              ? rightRailContent ?? (
                  <DefaultRightRail title={rightRailTitle} sections={rightRailSections ?? []} />
                )
              : null}
          </div>
          <StatusBar tickerOverride={statusBarTickerOverride} />
        </div>

        {showInstallPrompt ? <InstallPromptBanner /> : null}
        {showMobileBottomNav ? <MobileBottomNav /> : null}
        <CommandPalette />
        <HudOverlay />
        <AlertToasts />
      </div>
    </TerminalShellContext.Provider>
  );
}

export function useTerminalShellWorkspace() {
  const ctx = useContext(TerminalShellContext);
  if (!ctx) {
    throw new Error("useTerminalShellWorkspace must be used within TerminalShell");
  }
  return ctx;
}
