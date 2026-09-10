export type RiskSummaryData = {
  ewma_vol: number;
  beta: number;
  alpha?: number;
  sharpe?: number;
  sortino?: number;
  max_drawdown?: number;
  marginal_contribution?: Record<string, number>;
  [key: string]: unknown;
};

export type RiskExposureData = {
  exposures?: Record<string, { exposure: number; confidence: number; t_stat: number }>;
  pca_factors?: Array<{ factor: string; variance_explained: number }>;
  [key: string]: unknown;
};

export type RiskCorrelationData = {
  assets?: string[];
  matrix?: number[][];
  [key: string]: unknown;
};

export type SectorConcentrationData = {
  sectors?: Record<string, number>;
  industries?: Record<string, number>;
  [key: string]: unknown;
};

export type FactorExposureData = {
  exposures?: Record<string, { exposure: number; confidence: number; t_stat: number }>;
  [key: string]: unknown;
};

export type FactorAttributionData = {
  total_return?: number;
  alpha?: number;
  r_squared?: number;
  factor_contributions?: Record<string, number>;
  [key: string]: unknown;
};

export type FactorHistorySeries = {
  date: string;
  exposure: number;
};

export type FactorHistoryData = {
  series?: Record<string, FactorHistorySeries[]>;
  [key: string]: unknown;
};

export type FactorReturnsData = {
  factors?: Record<string, Array<{ return: number; date: string }>>;
  [key: string]: unknown;
};

export type StressTestScenario = {
  scenario: string;
  pnl: number;
  portfolio_value_after: number;
  loss_pct: number;
};

export type StressTestData = {
  scenarios?: StressTestScenario[];
  portfolio_value?: number;
  confidence_level?: number;
  [key: string]: unknown;
};

export type VaRData = {
  confidence: number;
  var_1d: number;
  var_nt: number;
  historical_var?: number;
  parametric_var?: number;
  [key: string]: unknown;
};

export type RiskInsightResult = {
  summary: string;
  details?: Array<{ title: string; content: string; severity: "high" | "medium" | "low" }>;
  [key: string]: unknown;
};