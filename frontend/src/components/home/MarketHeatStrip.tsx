export type MarketHeatStripItem = {
  id: string;
  label: string;
  value: number | string | null;
  changePct?: number | null;
  changeLabel?: string | null;
  flash?: "up" | "down" | null;
  onSelect?: () => void;
};

export type MarketHeatStripProps = {
  items: readonly MarketHeatStripItem[];
  selectedItemId?: string | null;
  formatValue?: (value: number | string | null) => string;
  onSelect?: (item: MarketHeatStripItem) => void;
  className?: string;
  ariaLabel?: string;
};

function formatDefaultValue(value: number | string | null): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "--";
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return value ?? "--";
}

function toneForChange(changePct: number | null | undefined): "up" | "down" | "neutral" {
  if (typeof changePct !== "number" || !Number.isFinite(changePct) || changePct === 0) return "neutral";
  return changePct > 0 ? "up" : "down";
}

export function MarketHeatStrip({
  items,
  selectedItemId = null,
  formatValue = formatDefaultValue,
  onSelect,
  className = "",
  ariaLabel = "Market heat strip",
}: MarketHeatStripProps) {
  return (
    <div className={["ot-home-widget-strip", className].filter(Boolean).join(" ")} role="list" aria-label={ariaLabel}>
      {items.map((item) => {
        const tone = toneForChange(item.changePct);
        const isSelected = selectedItemId === item.id;
        const content = (
          <>
            <span className="ot-home-widget-strip-label">{item.label}</span>
            <span className="ot-home-widget-strip-value">{formatValue(item.value)}</span>
            <span className="ot-home-widget-strip-change" data-tone={tone}>
              {item.changeLabel ??
                (typeof item.changePct === "number" && Number.isFinite(item.changePct)
                  ? `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%`
                  : "--")}
            </span>
          </>
        );
        const handleSelect = () => {
          item.onSelect?.();
          onSelect?.(item);
        };

        return (
          <div key={item.id} role="listitem">
            {item.onSelect || onSelect ? (
              <button
                type="button"
                className={`ot-home-widget-strip-chip ${item.flash ? `ot-flash-${item.flash}` : ""}`.trim()}
                data-tone={tone}
                data-selected={isSelected ? "true" : "false"}
                aria-pressed={isSelected}
                aria-label={`${item.label} ${formatValue(item.value)} ${typeof item.changePct === "number" ? `${item.changePct.toFixed(2)} percent` : ""}`.trim()}
                onClick={handleSelect}
              >
                {content}
              </button>
            ) : (
              <div
                className={`ot-home-widget-strip-chip ${item.flash ? `ot-flash-${item.flash}` : ""}`.trim()}
                data-tone={tone}
                data-selected={isSelected ? "true" : "false"}
                aria-label={`${item.label} ${formatValue(item.value)} ${typeof item.changePct === "number" ? `${item.changePct.toFixed(2)} percent` : ""}`.trim()}
              >
                {content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
