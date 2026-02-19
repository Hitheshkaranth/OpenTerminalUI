import { TerminalPanel } from "../../terminal/TerminalPanel";

export type PanelId =
  | "equity"
  | "drawdown"
  | "monthly"
  | "distribution"
  | "rolling"
  | "trades"
  | "chart"
  | "compare"
  | "surface3d"
  | "terrain3d"
  | "regime3d";

export type PanelRendererMap = Record<PanelId, () => JSX.Element>;

export const PANEL_LABELS: Record<PanelId, string> = {
  equity: "Equity Curve",
  drawdown: "Drawdown",
  monthly: "Monthly Heatmap",
  distribution: "Return Distribution",
  rolling: "Rolling Metrics",
  trades: "Trade Analysis",
  chart: "Price Chart",
  compare: "Strategy Compare",
  surface3d: "3D Surface",
  terrain3d: "3D Drawdown Terrain",
  regime3d: "3D Regime Efficacy",
};

export function renderPanel(id: PanelId, renderers: PanelRendererMap): JSX.Element {
  return (
    <TerminalPanel title={PANEL_LABELS[id]} subtitle="Pro Workspace Panel">
      {renderers[id]()}
    </TerminalPanel>
  );
}
