import type { ReactNode } from "react";

type MissionControlPanelProps = {
  title: string;
  accent?: "neutral" | "pos" | "neg";
  children: ReactNode;
  actions?: ReactNode;
};

export function MissionControlPanel({ title, accent = "neutral", children, actions }: MissionControlPanelProps) {
  const accentClass =
    accent === "pos"
      ? "text-terminal-pos"
      : accent === "neg"
        ? "text-terminal-neg"
        : "text-terminal-accent";

  return (
    <section className="rounded-sm border border-terminal-border bg-terminal-panel/80 p-3">
      <header className="mb-3 flex items-center justify-between gap-2 border-b border-terminal-border pb-2">
        <h2 className={`ot-type-panel-title uppercase tracking-[0.12em] ${accentClass}`}>{title}</h2>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}
