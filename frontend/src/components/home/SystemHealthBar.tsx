export type SystemHealthTone =
  | "ok"
  | "warning"
  | "critical"
  | "offline"
  | "stale"
  | "info"
  | "neutral";

export type SystemHealthItem = {
  id: string;
  label: string;
  value: string;
  tone: SystemHealthTone;
};

export type SystemHealthBarProps = {
  items: readonly SystemHealthItem[];
  className?: string;
  ariaLabel?: string;
};

export function SystemHealthBar({
  items,
  className = "",
  ariaLabel = "System health indicators",
}: SystemHealthBarProps) {
  return (
    <section className={["ot-home-widget-status-bar", className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      <ul className="ot-home-widget-status-list">
        {items.map((item) => (
          <li key={item.id} className="ot-home-widget-status-item" data-tone={item.tone}>
            <span className="ot-home-widget-status-dot" aria-hidden="true" />
            <span className="ot-home-widget-status-copy">
              <span className="ot-home-widget-status-label">{item.label}</span>
              <span className="ot-home-widget-status-value">{item.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
