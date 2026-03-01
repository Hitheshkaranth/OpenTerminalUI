export const terminalThemeTokens = {
  surface: {
    canvas: "#0D1117",
    canvasAlt: "#0F141B",
    panel: "#161B22",
    panelAlt: "#1A212B",
    overlay: "#0F141B",
  },
  border: {
    subtle: "#212A36",
    default: "#2D3745",
    strong: "#3A4658",
  },
  text: {
    primary: "#d7dde7",
    secondary: "#adb7c6",
    muted: "#7f8b9d",
    inverse: "#0D1117",
  },
  accent: {
    primary: "#FF6B00",
    primaryAlt: "#FF8B3D",
    warning: "#ffb74d",
    info: "#4ea1ff",
    cyan: "#4dd0e1",
  },
  market: {
    up: "#00c176",
    down: "#ff4d4f",
    neutral: "#8e98a8",
    candleUp: "#26a69a",
    candleDown: "#ef5350",
  },
  risk: {
    low: "#00c176",
    medium: "#ffb74d",
    high: "#ff4d4f",
    critical: "#ff4d4f",
  },
  system: {
    ok: "#00c176",
    stale: "#ffb74d",
    warning: "#ffb74d",
    critical: "#ff4d4f",
    offline: "#8e98a8",
  },
  feedback: {
    success: "#00c176",
    info: "#4ea1ff",
    warning: "#ffb74d",
    error: "#ff4d4f",
    successSoft: "#00c1761f",
    infoSoft: "#4ea1ff24",
    warningSoft: "#ffb74d24",
    errorSoft: "#ff4d4f24",
  },
  alert: {
    info: "#4ea1ff",
    warning: "#ffb74d",
    critical: "#ff4d4f",
    muted: "#8e98a8",
    infoSoft: "#4ea1ff24",
    warningSoft: "#ffb74d24",
    criticalSoft: "#ff4d4f24",
  },
  ops: {
    running: "#00c176",
    degraded: "#ffb74d",
    blocked: "#ff4d4f",
    maintenance: "#4ea1ff",
    queued: "#8e98a8",
  },
  interaction: {
    focusRing: "#ff9f1a73",
    hoverBorder: "#5d4a2d",
    selectedBorder: "#ff9f1a",
    disabledSurface: "#090b10",
    disabledText: "#677080",
  },
  workstation: {
    panelActiveBorder: "#ff9f1a",
    panelActiveGlow: "#ff9f1a2e",
    panelDropTargetBorder: "#4ea1ff",
    panelDropTargetFill: "#4ea1ff1a",
    panelErrorBorder: "#ff4d4f",
    panelSyncIndicator: "#4dd0e1",
    panelSyncMuted: "#76a8b0",
  },
  chart: {
    drawingTrend: "#ffd166",
    drawingHLine: "#4dd0e1",
    indicatorOverlay: "#4ea1ff",
    indicatorPane: "#ffb74d",
    accentAreaTop: "#ff9f1a55",
    accentAreaBottom: "#ff9f1a12",
    infoAreaTop: "#5aa9ff55",
    infoAreaBottom: "#5aa9ff12",
    candleUpFillStrong: "#26a69a44",
    candleUpFillSoft: "#26a69a11",
    candleDownFillStrong: "#ef535044",
    candleDownFillSoft: "#ef535011",
    candleUpAlpha80: "#26a69a80",
    candleDownAlpha80: "#ef535080",
    candleUpAlpha88: "#26a69a88",
    candleDownAlpha88: "#ef535088",
  },
} as const;

export const terminalSemanticColorRoles = {
  surface: {
    canvas: terminalThemeTokens.surface.canvas,
    shell: terminalThemeTokens.surface.canvasAlt,
    panel: terminalThemeTokens.surface.panel,
    panelElevated: terminalThemeTokens.surface.panelAlt,
    overlay: terminalThemeTokens.surface.overlay,
  },
  shell: {
    background: terminalThemeTokens.surface.canvasAlt,
    panel: terminalThemeTokens.surface.panel,
    border: terminalThemeTokens.border.default,
  },
  feedback: {
    success: terminalThemeTokens.feedback.success,
    info: terminalThemeTokens.feedback.info,
    warning: terminalThemeTokens.feedback.warning,
    error: terminalThemeTokens.feedback.error,
    successSoft: terminalThemeTokens.feedback.successSoft,
    infoSoft: terminalThemeTokens.feedback.infoSoft,
    warningSoft: terminalThemeTokens.feedback.warningSoft,
    errorSoft: terminalThemeTokens.feedback.errorSoft,
  },
  alert: {
    info: terminalThemeTokens.alert.info,
    warning: terminalThemeTokens.alert.warning,
    critical: terminalThemeTokens.alert.critical,
    muted: terminalThemeTokens.alert.muted,
    infoSoft: terminalThemeTokens.alert.infoSoft,
    warningSoft: terminalThemeTokens.alert.warningSoft,
    criticalSoft: terminalThemeTokens.alert.criticalSoft,
  },
  status: {
    ok: terminalThemeTokens.system.ok,
    stale: terminalThemeTokens.system.stale,
    warning: terminalThemeTokens.system.warning,
    critical: terminalThemeTokens.system.critical,
    offline: terminalThemeTokens.system.offline,
  },
  market: {
    up: terminalThemeTokens.market.up,
    down: terminalThemeTokens.market.down,
    neutral: terminalThemeTokens.market.neutral,
  },
  risk: {
    low: terminalThemeTokens.risk.low,
    medium: terminalThemeTokens.risk.medium,
    high: terminalThemeTokens.risk.high,
    critical: terminalThemeTokens.risk.critical,
  },
  ops: {
    running: terminalThemeTokens.ops.running,
    degraded: terminalThemeTokens.ops.degraded,
    blocked: terminalThemeTokens.ops.blocked,
    maintenance: terminalThemeTokens.ops.maintenance,
    queued: terminalThemeTokens.ops.queued,
  },
  interaction: {
    focusRing: terminalThemeTokens.interaction.focusRing,
    hoverBorder: terminalThemeTokens.interaction.hoverBorder,
    selectedBorder: terminalThemeTokens.interaction.selectedBorder,
    disabledSurface: terminalThemeTokens.interaction.disabledSurface,
    disabledText: terminalThemeTokens.interaction.disabledText,
  },
  workstation: {
    panelActiveBorder: terminalThemeTokens.workstation.panelActiveBorder,
    panelActiveGlow: terminalThemeTokens.workstation.panelActiveGlow,
    panelDropTargetBorder: terminalThemeTokens.workstation.panelDropTargetBorder,
    panelDropTargetFill: terminalThemeTokens.workstation.panelDropTargetFill,
    panelErrorBorder: terminalThemeTokens.workstation.panelErrorBorder,
    panelSyncIndicator: terminalThemeTokens.workstation.panelSyncIndicator,
    panelSyncMuted: terminalThemeTokens.workstation.panelSyncMuted,
  },
} as const;

export type TerminalThemeTokens = typeof terminalThemeTokens;
export type TerminalSemanticColorRoles = typeof terminalSemanticColorRoles;

export const terminalSemanticCssVars = {
  market: {
    up: "--ot-color-market-up",
    down: "--ot-color-market-down",
    neutral: "--ot-color-market-neutral",
  },
  risk: {
    low: "--ot-color-risk-low",
    medium: "--ot-color-risk-medium",
    high: "--ot-color-risk-high",
    critical: "--ot-color-risk-critical",
  },
  system: {
    ok: "--ot-color-system-ok",
    stale: "--ot-color-system-stale",
    warning: "--ot-color-system-warning",
    critical: "--ot-color-system-critical",
    offline: "--ot-color-system-offline",
  },
  feedback: {
    success: "--ot-color-feedback-success",
    info: "--ot-color-feedback-info",
    warning: "--ot-color-feedback-warning",
    error: "--ot-color-feedback-error",
    successSoft: "--ot-color-feedback-success-soft",
    infoSoft: "--ot-color-feedback-info-soft",
    warningSoft: "--ot-color-feedback-warning-soft",
    errorSoft: "--ot-color-feedback-error-soft",
  },
  ops: {
    running: "--ot-color-ops-running",
    degraded: "--ot-color-ops-degraded",
    blocked: "--ot-color-ops-blocked",
    maintenance: "--ot-color-ops-maintenance",
    queued: "--ot-color-ops-queued",
  },
  alert: {
    info: "--ot-color-alert-info",
    warning: "--ot-color-alert-warning",
    critical: "--ot-color-alert-critical",
    muted: "--ot-color-alert-muted",
    infoSoft: "--ot-color-alert-info-soft",
    warningSoft: "--ot-color-alert-warning-soft",
    criticalSoft: "--ot-color-alert-critical-soft",
  },
  interaction: {
    focusRing: "--ot-color-interaction-focus-ring",
    hoverBorder: "--ot-color-interaction-hover-border",
    selectedBorder: "--ot-color-interaction-selected-border",
    disabledSurface: "--ot-color-interaction-disabled-surface",
    disabledText: "--ot-color-interaction-disabled-text",
  },
  workstation: {
    panelActiveBorder: "--ot-color-workstation-panel-active-border",
    panelActiveGlow: "--ot-color-workstation-panel-active-glow",
    panelDropTargetBorder: "--ot-color-workstation-panel-drag-target-border",
    panelDropTargetFill: "--ot-color-workstation-panel-drag-target-fill",
    panelErrorBorder: "--ot-color-workstation-panel-error-border",
    panelSyncIndicator: "--ot-color-workstation-panel-sync-indicator",
    panelSyncMuted: "--ot-color-workstation-panel-sync-muted",
  },
} as const;

interface NestedStringRecord {
  [key: string]: string | NestedStringRecord;
}

function flattenThemeRoles(
  root: NestedStringRecord,
  path: string[] = [],
  out: Record<string, string> = {},
) {
  Object.entries(root).forEach(([key, value]) => {
    const nextPath = [...path, key];
    if (typeof value === "string") {
      out[nextPath.join(".")] = value;
      return;
    }
    flattenThemeRoles(value, nextPath, out);
  });
  return out;
}

export const terminalSemanticRoleMap = flattenThemeRoles(
  terminalSemanticColorRoles as unknown as NestedStringRecord,
);

export type TerminalSemanticRole = keyof typeof terminalSemanticRoleMap;

export function getTerminalRoleColor(role: TerminalSemanticRole): string {
  return terminalSemanticRoleMap[role];
}

// Compatibility export for existing chart/table components.
export const terminalColors = {
  bg: terminalThemeTokens.surface.canvas,
  panel: terminalThemeTokens.surface.panel,
  border: terminalThemeTokens.border.default,
  borderStrong: terminalThemeTokens.border.strong,
  text: terminalThemeTokens.text.primary,
  muted: terminalThemeTokens.text.muted,
  accent: terminalThemeTokens.accent.primary,
  accentAlt: terminalThemeTokens.accent.primaryAlt,
  positive: terminalThemeTokens.market.up,
  negative: terminalThemeTokens.market.down,
  warning: terminalThemeTokens.accent.warning,
  info: terminalThemeTokens.accent.info,
  feedbackInfoSoft: terminalThemeTokens.feedback.infoSoft,
  feedbackWarnSoft: terminalThemeTokens.feedback.warningSoft,
  feedbackErrorSoft: terminalThemeTokens.feedback.errorSoft,
  candleUp: terminalThemeTokens.market.candleUp,
  candleDown: terminalThemeTokens.market.candleDown,
  focusRing: terminalThemeTokens.interaction.focusRing,
  hoverBorder: terminalThemeTokens.interaction.hoverBorder,
  selectedBorder: terminalThemeTokens.interaction.selectedBorder,
  wsPanelActiveBorder: terminalThemeTokens.workstation.panelActiveBorder,
  wsPanelActiveGlow: terminalThemeTokens.workstation.panelActiveGlow,
  wsPanelDropTargetBorder: terminalThemeTokens.workstation.panelDropTargetBorder,
  wsPanelDropTargetFill: terminalThemeTokens.workstation.panelDropTargetFill,
  wsPanelErrorBorder: terminalThemeTokens.workstation.panelErrorBorder,
  wsPanelSyncIndicator: terminalThemeTokens.workstation.panelSyncIndicator,
  drawingTrend: terminalThemeTokens.chart.drawingTrend,
  drawingHLine: terminalThemeTokens.chart.drawingHLine,
  indicatorOverlay: terminalThemeTokens.chart.indicatorOverlay,
  indicatorPane: terminalThemeTokens.chart.indicatorPane,
  accentAreaTop: terminalThemeTokens.chart.accentAreaTop,
  accentAreaBottom: terminalThemeTokens.chart.accentAreaBottom,
  candleUpFillStrong: terminalThemeTokens.chart.candleUpFillStrong,
  candleUpFillSoft: terminalThemeTokens.chart.candleUpFillSoft,
  candleDownFillStrong: terminalThemeTokens.chart.candleDownFillStrong,
  candleDownFillSoft: terminalThemeTokens.chart.candleDownFillSoft,
  candleUpAlpha80: terminalThemeTokens.chart.candleUpAlpha80,
  candleDownAlpha80: terminalThemeTokens.chart.candleDownAlpha80,
  candleUpAlpha88: terminalThemeTokens.chart.candleUpAlpha88,
  candleDownAlpha88: terminalThemeTokens.chart.candleDownAlpha88,
  infoAreaTop: terminalThemeTokens.chart.infoAreaTop,
  infoAreaBottom: terminalThemeTokens.chart.infoAreaBottom,
} as const;

export const terminalOverlayPalette = [
  terminalThemeTokens.accent.primary,
  terminalThemeTokens.accent.cyan,
  "#66bb6a",
  terminalThemeTokens.chart.drawingTrend,
  terminalThemeTokens.text.muted,
  terminalThemeTokens.accent.warning,
] as const;
