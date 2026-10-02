import type { ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { BotAvatar } from "bot-avatars";
import { ThinkingOrb } from "thinking-orbs";

import { useSettingsStore } from "../../store/settingsStore";

/**
 * App wrappers for the Libraries.dev effects (thinking-orbs, border-beam, bot-avatars).
 *
 * The libraries' theme="auto" reads a `data-theme` attribute / `dark` class or the OS scheme; this app
 * switches themes through `data-ot-theme` (with a light "light-desk" variant), so the theme comes from
 * the settings store instead. Every AI wait in the app goes through these, so they look the same everywhere.
 */
function useLibTheme(): "dark" | "light" {
  const variant = useSettingsStore((s) => s.themeVariant);
  return variant === "light-desk" ? "light" : "dark";
}

/** What the model is doing; each maps to a distinct orb animation. */
export type AiActivity =
  | "thinking" // general reasoning, agent tool loop
  | "reading" // retrieving / scanning filings
  | "analyzing" // scoring drivers, risk, backtests
  | "writing" // composing a briefing / summary / answer
  | "linking" // building value chains, peer maps
  | "extracting"; // pulling KPIs / numbers out of documents

const ORB_STATE = {
  thinking: "working",
  reading: "searching",
  analyzing: "solving",
  writing: "composing",
  linking: "connecting",
  extracting: "weaving",
} as const;

type AiThinkingProps = {
  activity?: AiActivity;
  /** Visible status text, e.g. "Analysing 21 drivers…". Also the orb's accessible name. */
  label?: ReactNode;
  /** Secondary line, e.g. "Usually 30–90 s on a local model." */
  hint?: ReactNode;
  /** `inline` sits in a line of text (20 px orb); `block` fills an empty panel (64 px orb). */
  variant?: "inline" | "block";
  className?: string;
};

/** Loading state for any wait on an LLM. Replaces spinners / pulse skeletons on AI calls. */
export function AiThinking({ activity = "thinking", label, hint, variant = "inline", className = "" }: AiThinkingProps) {
  const theme = useLibTheme();
  const ariaLabel = typeof label === "string" ? label : "AI is working";
  if (variant === "block") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-col items-center justify-center gap-2 py-6 text-center ${className}`}
      >
        <ThinkingOrb state={ORB_STATE[activity]} size={64} theme={theme} aria-label={ariaLabel} />
        {label ? <div className="text-xs text-terminal-text">{label}</div> : null}
        {hint ? <div className="max-w-[40ch] text-[11px] text-terminal-muted">{hint}</div> : null}
      </div>
    );
  }
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 align-middle ${className}`}>
      <ThinkingOrb state={ORB_STATE[activity]} size={20} theme={theme} aria-label={ariaLabel} />
      {label ? <span className="text-xs text-terminal-muted">{label}</span> : null}
    </span>
  );
}

type AiWorkingBeamProps = {
  /** Beam runs while true and fades out when the model finishes. */
  active: boolean;
  /** `line` = travelling glow along the bottom edge (inputs); `card` = full-border beam (panels). */
  shape?: "line" | "card";
  className?: string;
  children: ReactNode;
};

/** Marks the element the model is working on (composer, AI panel) while a request is in flight. */
export function AiWorkingBeam({ active, shape = "line", className, children }: AiWorkingBeamProps) {
  const theme = useLibTheme();
  return (
    <BorderBeam
      active={active}
      size={shape === "line" ? "line" : "md"}
      // "sunset" (orange to red) stays inside the terminal's orange-accent palette; the default rainbow doesn't.
      colorVariant="sunset"
      theme={theme}
      strength={shape === "line" ? 0.8 : 0.55}
      className={className}
    >
      {children}
    </BorderBeam>
  );
}

type AgentAvatarProps = {
  busy?: boolean;
  /** Freeze on the resting pose: for past messages, so a long thread isn't full of moving faces. */
  still?: boolean;
  size?: number;
  className?: string;
};

/** The AI agent's identity in chat: idle between turns, hopping while a run is in flight. */
export function AgentAvatar({ busy = false, still = false, size = 28, className }: AgentAvatarProps) {
  const theme = useLibTheme();
  return (
    <BotAvatar
      type="mech"
      shading="plastic"
      state={busy ? "working" : "default"}
      size={size}
      theme={theme}
      interactive={false}
      paused={still && !busy}
      className={className}
      aria-label={busy ? "Agent, working" : "Agent"}
    />
  );
}
