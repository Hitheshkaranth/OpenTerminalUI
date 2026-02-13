import { TIMEFRAMES } from "../../utils/constants";

type Props = {
  interval: string;
  onChange: (interval: string, range: string) => void;
};

export function TimeframeSelector({ interval, onChange }: Props) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {TIMEFRAMES.map((item) => (
        <button
          key={`${item.interval}:${item.range}`}
          className={`rounded border px-2 py-1 text-xs ${
            interval === item.interval
              ? "border-terminal-accent bg-terminal-accent text-white"
              : "border-terminal-border bg-terminal-panel text-terminal-text"
          }`}
          onClick={() => onChange(item.interval, item.range)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
