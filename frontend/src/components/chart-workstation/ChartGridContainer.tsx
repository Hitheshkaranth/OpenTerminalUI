import type { CSSProperties, ReactNode } from "react";
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
  return (
    <div
      className="chart-grid"
      style={computeGridCSS(slotCount, template)}
      data-testid="chart-grid"
    >
      {children}
    </div>
  );
}
