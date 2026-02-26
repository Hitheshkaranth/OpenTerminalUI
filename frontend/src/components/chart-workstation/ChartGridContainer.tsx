import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GridTemplate } from "../../store/chartWorkstationStore";
import "./ChartWorkstation.css";

interface Props {
  slotCount: number;
  template: GridTemplate;
  children: ReactNode;
}

function computeGridCSS(count: number, template: GridTemplate): CSSProperties {
  if (template.arrangement === "custom" && template.customAreas) {
    return {
      gridTemplateAreas: template.customAreas,
      gridTemplateColumns: `repeat(${template.cols}, 1fr)`,
      gridTemplateRows: `repeat(${template.rows}, 1fr)`,
    };
  }

  // Use explicit template if set (user picked from LayoutSelector)
  if (template.cols > 0 && template.rows > 0) {
    return {
      gridTemplateColumns: `repeat(${template.cols}, 1fr)`,
      gridTemplateRows: `repeat(${template.rows}, 1fr)`,
    };
  }

  // Auto-compute from slot count
  const auto: Record<number, { c: number; r: number }> = {
    1: { c: 1, r: 1 },
    2: { c: 2, r: 1 },
    3: { c: 2, r: 2 },
    4: { c: 2, r: 2 },
    5: { c: 3, r: 2 },
    6: { c: 3, r: 2 },
  };
  const { c, r } = auto[Math.min(count, 6)] ?? { c: 3, r: 2 };
  return {
    gridTemplateColumns: `repeat(${c}, 1fr)`,
    gridTemplateRows: `repeat(${r}, 1fr)`,
  };
}

export function ChartGridContainer({ slotCount, template, children }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const effectiveTemplate = useMemo(() => {
    if (template.arrangement === "custom") return template;
    const isSixPaneMatrix = template.cols * template.rows === 6 && slotCount >= 5;
    if (!isSixPaneMatrix || size.width <= 0 || size.height <= 0) return template;
    return size.width >= size.height ? { ...template, cols: 3, rows: 2 } : { ...template, cols: 2, rows: 3 };
  }, [size.height, size.width, slotCount, template]);

  const gridCss = useMemo(() => computeGridCSS(slotCount, effectiveTemplate), [effectiveTemplate, slotCount]);

  return (
    <div
      ref={containerRef}
      className="chart-grid"
      style={gridCss}
      data-slot-count={slotCount}
      data-grid-cols={effectiveTemplate.cols}
      data-grid-rows={effectiveTemplate.rows}
      data-testid="chart-grid"
    >
      {children}
    </div>
  );
}
