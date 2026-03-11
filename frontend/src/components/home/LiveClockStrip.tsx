import { useEffect, useMemo, useState } from "react";

export type LiveClockZone = {
  id: string;
  label: string;
  timeZone: string;
};

export type LiveClockStripProps = {
  zones?: readonly LiveClockZone[];
  now?: Date;
  updateIntervalMs?: number;
  className?: string;
  ariaLabel?: string;
};

const DEFAULT_ZONES: readonly LiveClockZone[] = [
  { id: "ist", label: "IST", timeZone: "Asia/Kolkata" },
  { id: "est", label: "EST", timeZone: "America/New_York" },
  { id: "utc", label: "UTC", timeZone: "UTC" },
];

function formatClock(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  }).format(now);
}

export function LiveClockStrip({
  zones = DEFAULT_ZONES,
  now,
  updateIntervalMs = 1000,
  className = "",
  ariaLabel = "Live timezone clocks",
}: LiveClockStripProps) {
  const [currentTime, setCurrentTime] = useState<Date>(() => now ?? new Date());

  useEffect(() => {
    if (now) {
      setCurrentTime(now);
      return;
    }
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, updateIntervalMs);
    return () => clearInterval(timer);
  }, [now, updateIntervalMs]);

  const entries = useMemo(
    () =>
      zones.map((zone) => ({
        ...zone,
        value: formatClock(currentTime, zone.timeZone),
      })),
    [currentTime, zones],
  );

  return (
    <div className={["ot-home-widget-clock-strip", className].filter(Boolean).join(" ")} role="list" aria-label={ariaLabel}>
      {entries.map((entry) => (
        <div key={entry.id} className="ot-home-widget-clock-chip" role="listitem">
          <span className="ot-home-widget-clock-label">{entry.label}</span>
          <time className="ot-home-widget-clock-value" dateTime={currentTime.toISOString()}>
            {entry.value}
          </time>
        </div>
      ))}
    </div>
  );
}
