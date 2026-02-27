import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import type { LaunchpadPanelConfig } from "./LaunchpadContext";

type LaunchpadGridProps = {
  panels: LaunchpadPanelConfig[];
  renderPanel: (panel: LaunchpadPanelConfig) => ReactNode;
  onLayoutChange?: (panels: Array<Pick<LaunchpadPanelConfig, "id" | "x" | "y" | "w" | "h">>) => void;
};

export function LaunchpadGrid({ panels, renderPanel, onLayoutChange }: LaunchpadGridProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  const lastLayoutKeyRef = useRef<string>("");

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const apply = () => setWidth(Math.max(320, Math.floor(node.clientWidth || 1200)));
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo<Layout>(
    () =>
      panels.map((panel) => ({
        i: panel.id,
        x: panel.x,
        y: panel.y,
        w: panel.w,
        h: panel.h,
        minW: 2,
        minH: 2,
      })),
    [panels],
  );

  return (
    <div ref={hostRef} className="min-w-0">
      <GridLayout
        className="launchpad-grid"
        width={width}
        gridConfig={{ cols: 12, rowHeight: 42, margin: [8, 8], containerPadding: [0, 0], maxRows: Infinity }}
        dragConfig={{ enabled: true, bounded: false, handle: ".launchpad-drag-handle", threshold: 3 }}
        resizeConfig={{ enabled: true, handles: ["se"] }}
        layout={layout}
        onLayoutChange={(next: Layout) => {
          const packed = next.map((item) => ({
            id: item.i,
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
          }));
          const key = JSON.stringify(packed);
          if (key === lastLayoutKeyRef.current) return;
          lastLayoutKeyRef.current = key;
          onLayoutChange?.(packed);
        }}
      >
        {panels.map((panel) => (
          <div key={panel.id} className="min-h-0 min-w-0">
            {renderPanel(panel)}
          </div>
        ))}
      </GridLayout>
    </div>
  );
}
