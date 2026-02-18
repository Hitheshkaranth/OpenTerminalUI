import { useEffect, useMemo, useState } from "react";

type StatusBarProps = {
  left: string;
  center: string;
  centerDotColor?: "green" | "cyan" | "amber";
};

function formatClock(date: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(date);

  const day = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);

  return `${time} IST | ${day.toUpperCase()}`;
}

export function StatusBar({ left, center, centerDotColor }: StatusBarProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clockText = useMemo(() => formatClock(now), [now]);

  return (
    <div className="ot-status-bar ot-slide-down">
      <div className="ot-status-bar-left">{left}</div>
      <div className="ot-status-bar-center">
        {centerDotColor ? <span className={`ot-live-dot ot-live-dot-${centerDotColor}`} /> : null}
        <span>{center}</span>
      </div>
      <div className="ot-status-bar-right">{clockText}</div>
    </div>
  );
}
