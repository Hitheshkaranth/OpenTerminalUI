import { useEffect, useMemo, useRef, useState } from "react";

export type QuickNavItem = {
  id: string;
  label: string;
  shortcut: string;
  description?: string;
  disabled?: boolean;
  onSelect?: () => void;
};

export type QuickNavSection = {
  id: string;
  title: string;
  items: readonly QuickNavItem[];
};

export type QuickNavGridProps = {
  sections: readonly QuickNavSection[];
  selectedItemId?: string | null;
  columnCount?: number;
  className?: string;
  ariaLabel?: string;
  onSelect?: (item: QuickNavItem) => void;
};

export function QuickNavGrid({
  sections,
  selectedItemId = null,
  columnCount = 4,
  className = "",
  ariaLabel = "Quick navigation grid",
  onSelect,
}: QuickNavGridProps) {
  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const nextIndex = flatItems.findIndex((item) => !item.disabled);
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [flatItems]);

  const focusItem = (nextIndex: number) => {
    if (flatItems.length === 0) return;
    const clampedIndex = Math.min(Math.max(nextIndex, 0), flatItems.length - 1);
    const nextItem = flatItems[clampedIndex];
    if (!nextItem || nextItem.disabled) return;
    setActiveIndex(clampedIndex);
    itemRefs.current[clampedIndex]?.focus();
  };

  let runningIndex = 0;

  return (
    <div className={["ot-home-widget-nav", className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      {sections.map((section) => {
        const sectionStartIndex = runningIndex;
        runningIndex += section.items.length;

        return (
          <section key={section.id} className="ot-home-widget-nav-section" aria-labelledby={`quick-nav-${section.id}`}>
            <header className="ot-home-widget-nav-section-header">
              <h3 id={`quick-nav-${section.id}`} className="ot-home-widget-nav-section-title">
                {section.title}
              </h3>
            </header>
            <div
              className="ot-home-widget-nav-grid"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, columnCount)}, minmax(0, 1fr))` }}
            >
              {section.items.map((item, itemIndex) => {
                const globalIndex = sectionStartIndex + itemIndex;
                const isSelected = item.id === selectedItemId;
                const isTabStop = globalIndex === activeIndex;

                return (
                  <button
                    key={item.id}
                    ref={(element) => {
                      itemRefs.current[globalIndex] = element;
                    }}
                    type="button"
                    className="ot-home-widget-nav-tile"
                    data-selected={isSelected ? "true" : "false"}
                    disabled={item.disabled}
                    aria-keyshortcuts={item.shortcut}
                    aria-label={item.description ? `${item.label}. ${item.description}` : item.label}
                    tabIndex={isTabStop ? 0 : -1}
                    onClick={() => {
                      if (item.disabled) return;
                      setActiveIndex(globalIndex);
                      item.onSelect?.();
                      onSelect?.(item);
                    }}
                    onFocus={() => setActiveIndex(globalIndex)}
                    onKeyDown={(event) => {
                      if (flatItems.length === 0) return;

                      if (event.key === "ArrowRight") {
                        event.preventDefault();
                        focusItem(globalIndex + 1);
                      }
                      if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        focusItem(globalIndex - 1);
                      }
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        focusItem(globalIndex + Math.max(1, columnCount));
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        focusItem(globalIndex - Math.max(1, columnCount));
                      }
                      if (event.key === "Home") {
                        event.preventDefault();
                        focusItem(0);
                      }
                      if (event.key === "End") {
                        event.preventDefault();
                        focusItem(flatItems.length - 1);
                      }
                      if ((event.key === "Enter" || event.key === " ") && !item.disabled) {
                        event.preventDefault();
                        item.onSelect?.();
                        onSelect?.(item);
                      }
                    }}
                  >
                    <span className="ot-home-widget-nav-label">{item.label}</span>
                    <span className="ot-home-widget-shortcut">{item.shortcut}</span>
                    {item.description ? <span className="ot-home-widget-nav-description">{item.description}</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
