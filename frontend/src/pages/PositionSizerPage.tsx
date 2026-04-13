import { useMemo, useState, type ReactNode } from "react";

import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { useSettingsStore } from "../store/settingsStore";

type PositionSizingMethod = "fixed_fractional" | "kelly" | "atr" | "volatility";
type RiskMode = "percent" | "fixed";

type PositionSizerInputs = {
  accountSize: number;
  riskMode: RiskMode;
  riskValue: number;
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number | null;
  atrValue: number | null;
  method: PositionSizingMethod;
  winRatePct: number;
  avgWin: number;
  avgLoss: number;
  atrMultiplier: number;
  targetVolPct: number;
  stockAnnualVolPct: number;
};

type CalculationWarning = {
  id: string;
  message: string;
};

type CalculationResult = {
  errors: string[];
  warnings: CalculationWarning[];
  shares: number;
  effectiveStopLossPrice: number;
  riskCapital: number;
  riskPerShare: number;
  positionValue: number;
  positionSizePct: number;
  maxRisk: number;
  rewardPerShare: number | null;
  potentialProfit: number | null;
  riskRewardRatio: number | null;
  kellyFullPct: number | null;
  kellyHalfPct: number | null;
  kellyQuarterPct: number | null;
};

const METHOD_OPTIONS: Array<{ id: PositionSizingMethod; label: string; description: string }> = [
  { id: "fixed_fractional", label: "Fixed Fractional", description: "Risk a fixed portion of account equity." },
  { id: "kelly", label: "Kelly Criterion", description: "Position size from edge and payoff ratio." },
  { id: "atr", label: "ATR-Based", description: "Size by volatility-adjusted stop distance." },
  { id: "volatility", label: "Volatility Target", description: "Target portfolio volatility contribution." },
];

const DEFAULT_INPUTS: PositionSizerInputs = {
  accountSize: 1_000_000,
  riskMode: "percent",
  riskValue: 1,
  entryPrice: 2_500,
  stopLossPrice: 2_450,
  targetPrice: null,
  atrValue: null,
  method: "fixed_fractional",
  winRatePct: 55,
  avgWin: 100,
  avgLoss: 50,
  atrMultiplier: 2,
  targetVolPct: 15,
  stockAnnualVolPct: 25,
};

function normalizeNumberInput(value: string): number | null {
  if (!value.trim()) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export function getRiskCapital(accountSize: number, riskMode: RiskMode, riskValue: number): number {
  if (accountSize <= 0 || riskValue < 0) return 0;
  return riskMode === "percent" ? accountSize * (riskValue / 100) : riskValue;
}

export function calculateFixedFractionalShares(accountSize: number, riskPct: number, entryPrice: number, stopLossPrice: number): number {
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);
  if (accountSize <= 0 || riskPct < 0 || riskPerShare <= 0) return 0;
  return (accountSize * (riskPct / 100)) / riskPerShare;
}

export function calculateKellyPercentage(winRatePct: number, avgWin: number, avgLoss: number): number {
  if (winRatePct < 0 || avgWin <= 0 || avgLoss <= 0) return 0;
  const winRate = winRatePct / 100;
  return winRate - (1 - winRate) / (avgWin / avgLoss);
}

export function calculateAtrShares(accountSize: number, riskPct: number, atrMultiplier: number, atrValue: number): number {
  const denominator = atrMultiplier * atrValue;
  if (accountSize <= 0 || riskPct < 0 || denominator <= 0) return 0;
  return (accountSize * (riskPct / 100)) / denominator;
}

export function calculateVolatilityTargetShares(
  accountSize: number,
  targetVolPct: number,
  stockAnnualVolPct: number,
  price: number,
): number {
  const denominator = (stockAnnualVolPct / 100) * price;
  if (accountSize <= 0 || targetVolPct < 0 || denominator <= 0) return 0;
  return (accountSize * (targetVolPct / 100)) / denominator;
}

export function calculatePositionSizing(inputs: PositionSizerInputs): CalculationResult {
  const errors: string[] = [];
  const warnings: CalculationWarning[] = [];

  const fieldsToValidate: Array<{ label: string; value: number | null }> = [
    { label: "Account size", value: inputs.accountSize },
    { label: "Risk value", value: inputs.riskValue },
    { label: "Entry price", value: inputs.entryPrice },
    { label: "Stop loss price", value: inputs.stopLossPrice },
    { label: "Target price", value: inputs.targetPrice },
    { label: "ATR value", value: inputs.atrValue },
    { label: "Win rate", value: inputs.winRatePct },
    { label: "Average win", value: inputs.avgWin },
    { label: "Average loss", value: inputs.avgLoss },
    { label: "ATR multiplier", value: inputs.atrMultiplier },
    { label: "Target volatility", value: inputs.targetVolPct },
    { label: "Stock annual volatility", value: inputs.stockAnnualVolPct },
  ];

  for (const field of fieldsToValidate) {
    if (field.value != null && field.value < 0) {
      errors.push(`${field.label} cannot be negative.`);
    }
  }

  if (inputs.accountSize <= 0) errors.push("Account size must be greater than zero.");
  if (inputs.entryPrice <= 0) errors.push("Entry price must be greater than zero.");

  let effectiveStopLossPrice = inputs.stopLossPrice;
  if (inputs.method === "atr") {
    if (!inputs.atrValue || inputs.atrValue <= 0) {
      errors.push("ATR value must be greater than zero for ATR-based sizing.");
    }
    if (inputs.atrMultiplier <= 0) {
      errors.push("ATR multiplier must be greater than zero.");
    }
    if (inputs.atrValue && inputs.atrMultiplier > 0) {
      effectiveStopLossPrice = inputs.entryPrice - inputs.atrMultiplier * inputs.atrValue;
    }
  }

  if (effectiveStopLossPrice === inputs.entryPrice) {
    errors.push("Stop loss must differ from entry.");
  }
  if (effectiveStopLossPrice > inputs.entryPrice) {
    errors.push("Stop loss must be below entry for long positions.");
  }
  if (inputs.targetPrice != null && inputs.targetPrice <= inputs.entryPrice) {
    errors.push("Target price must be above entry for long positions.");
  }

  const riskCapital = getRiskCapital(inputs.accountSize, inputs.riskMode, inputs.riskValue);
  if (riskCapital <= 0) errors.push("Risk amount must be greater than zero.");
  if (inputs.riskMode === "percent" && inputs.riskValue > 100) {
    warnings.push({ id: "risk-over-100", message: "Risk per trade above 100% is unusually aggressive." });
  }

  const riskPerShare = Math.abs(inputs.entryPrice - effectiveStopLossPrice);

  let shares = 0;
  let kellyFullPct: number | null = null;
  let kellyHalfPct: number | null = null;
  let kellyQuarterPct: number | null = null;

  if (errors.length === 0) {
    if (inputs.method === "fixed_fractional") {
      shares = riskPerShare > 0 ? riskCapital / riskPerShare : 0;
    }

    if (inputs.method === "kelly") {
      if (inputs.avgWin <= 0 || inputs.avgLoss <= 0) {
        errors.push("Average win and average loss must be greater than zero.");
      } else {
        const rawKelly = calculateKellyPercentage(inputs.winRatePct, inputs.avgWin, inputs.avgLoss);
        const cappedKelly = Math.min(Math.max(rawKelly, 0), 1);
        if (rawKelly > 1) {
          warnings.push({ id: "kelly-cap", message: "Kelly percentage capped at 100%." });
        }
        if (rawKelly < 0) {
          warnings.push({ id: "kelly-negative", message: "Negative Kelly suggests skipping the trade." });
        }
        warnings.push({ id: "kelly-full", message: "Full Kelly is aggressive. Half Kelly is recommended." });
        kellyFullPct = cappedKelly * 100;
        kellyHalfPct = (cappedKelly * 100) / 2;
        kellyQuarterPct = (cappedKelly * 100) / 4;
        shares = riskPerShare > 0 ? (inputs.accountSize * cappedKelly) / riskPerShare : 0;
      }
    }

    if (inputs.method === "atr") {
      const atrDistance = inputs.atrMultiplier * (inputs.atrValue ?? 0);
      shares = atrDistance > 0 ? riskCapital / atrDistance : 0;
    }

    if (inputs.method === "volatility") {
      const denominator = (inputs.stockAnnualVolPct / 100) * inputs.entryPrice;
      if (inputs.stockAnnualVolPct <= 0) {
        errors.push("Stock annual volatility must be greater than zero.");
      } else {
        shares = denominator > 0 ? (inputs.accountSize * (inputs.targetVolPct / 100)) / denominator : 0;
      }
    }
  }

  if (errors.length > 0) {
    shares = 0;
  }

  const positionValue = shares * inputs.entryPrice;
  const positionSizePct = inputs.accountSize > 0 ? (positionValue / inputs.accountSize) * 100 : 0;
  const maxRisk = shares * riskPerShare;
  const rewardPerShare = inputs.targetPrice != null ? inputs.targetPrice - inputs.entryPrice : null;
  const potentialProfit = rewardPerShare != null ? shares * rewardPerShare : null;
  const riskRewardRatio = rewardPerShare != null && riskPerShare > 0 ? rewardPerShare / riskPerShare : null;

  return {
    errors,
    warnings,
    shares,
    effectiveStopLossPrice,
    riskCapital,
    riskPerShare,
    positionValue,
    positionSizePct,
    maxRisk,
    rewardPerShare,
    potentialProfit,
    riskRewardRatio,
    kellyFullPct,
    kellyHalfPct,
    kellyQuarterPct,
  };
}

function Field({
  label,
  children,
  helper,
}: {
  label: string;
  children: ReactNode;
  helper?: string;
}) {
  return (
    <label className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">{label}</div>
      {children}
      {helper ? <div className="text-[10px] text-terminal-muted">{helper}</div> : null}
    </label>
  );
}

function InfoCard({ label, value, accent = false, testId }: { label: string; value: string; accent?: boolean; testId?: string }) {
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-bg/60 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">{label}</div>
      <div data-testid={testId} className={`mt-2 font-mono text-lg font-semibold ${accent ? "text-terminal-accent" : "text-terminal-text"}`}>
        {value}
      </div>
    </div>
  );
}

export function PositionSizerPage() {
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const selectedCountry = useSettingsStore((state) => state.selectedCountry);
  const locale = selectedCountry === "IN" ? "en-IN" : "en-US";
  const currency = displayCurrency;

  const [inputs, setInputs] = useState<PositionSizerInputs>(DEFAULT_INPUTS);

  const formatCurrency = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value),
    [currency, locale],
  );

  const formatNumber = useMemo(
    () => (value: number, maximumFractionDigits = 2) =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits,
      }).format(value),
    [locale],
  );

  const formatPercent = useMemo(
    () => (value: number) =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value),
    [locale],
  );

  const result = useMemo(() => calculatePositionSizing(inputs), [inputs]);

  const rewardBar = useMemo(() => {
    const reward = Math.max(result.rewardPerShare ?? 0, 0);
    const risk = Math.max(result.riskPerShare, 0);
    const total = reward + risk;
    if (total <= 0) return { riskWidth: 50, rewardWidth: 50 };
    return {
      riskWidth: (risk / total) * 100,
      rewardWidth: (reward / total) * 100,
    };
  }, [result.rewardPerShare, result.riskPerShare]);

  const hasTarget = inputs.targetPrice != null && inputs.targetPrice > 0;

  function updateNumber<K extends keyof PositionSizerInputs>(key: K, value: string) {
    const parsed = normalizeNumberInput(value);
    setInputs((current) => ({
      ...current,
      [key]: parsed ?? (["targetPrice", "atrValue"].includes(String(key)) ? null : 0),
    }));
  }

  return (
    <div className="space-y-4 p-4 font-mono">
      <div className="rounded-sm border border-terminal-border bg-terminal-panel px-4 py-3">
        <div className="text-sm font-semibold uppercase tracking-[0.22em] text-terminal-accent">Position Sizer</div>
        <div className="mt-1 text-[11px] text-terminal-muted">
          Client-side trade sizing across fixed fractional, Kelly, ATR, and volatility targeting methods.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <TerminalPanel title="Inputs" subtitle="Account, trade, and method-specific sizing parameters">
          <div className="space-y-4">
            <Field label="Account Size" helper={`Formatted: ${formatCurrency(inputs.accountSize)}`}>
              <TerminalInput
                aria-label="Account Size"
                inputMode="decimal"
                type="number"
                min="0"
                step="any"
                value={String(inputs.accountSize)}
                onChange={(event) => updateNumber("accountSize", event.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
              <Field label="Risk Per Trade">
                <div className="flex rounded-sm border border-terminal-border bg-terminal-bg p-1">
                  <button
                    type="button"
                    className={`flex-1 rounded-sm px-3 py-2 text-[11px] ${inputs.riskMode === "percent" ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted"}`}
                    onClick={() => setInputs((current) => ({ ...current, riskMode: "percent" }))}
                  >
                    % of Account
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-sm px-3 py-2 text-[11px] ${inputs.riskMode === "fixed" ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted"}`}
                    onClick={() => setInputs((current) => ({ ...current, riskMode: "fixed" }))}
                  >
                    Fixed Amount
                  </button>
                </div>
              </Field>
              <Field
                label={inputs.riskMode === "percent" ? "Risk %" : "Risk Amount"}
                helper={inputs.riskMode === "percent" ? `${formatPercent(inputs.riskValue)}% of account` : formatCurrency(inputs.riskValue)}
              >
                <TerminalInput
                  aria-label={inputs.riskMode === "percent" ? "Risk Percentage" : "Risk Amount"}
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="any"
                  value={String(inputs.riskValue)}
                  onChange={(event) => updateNumber("riskValue", event.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Entry Price" helper={formatCurrency(inputs.entryPrice)}>
                <TerminalInput
                  aria-label="Entry Price"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="any"
                  value={String(inputs.entryPrice)}
                  onChange={(event) => updateNumber("entryPrice", event.target.value)}
                />
              </Field>
              <Field
                label={inputs.method === "atr" ? "Stop Loss Price (Auto)" : "Stop Loss Price"}
                helper={formatCurrency(result.effectiveStopLossPrice)}
              >
                <TerminalInput
                  aria-label="Stop Loss Price"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="any"
                  value={String(inputs.method === "atr" ? result.effectiveStopLossPrice : inputs.stopLossPrice)}
                  onChange={(event) => updateNumber("stopLossPrice", event.target.value)}
                  disabled={inputs.method === "atr"}
                />
              </Field>
              <Field label="Target Price" helper={hasTarget && inputs.targetPrice != null ? formatCurrency(inputs.targetPrice) : "Optional"}>
                <TerminalInput
                  aria-label="Target Price"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="any"
                  value={inputs.targetPrice == null ? "" : String(inputs.targetPrice)}
                  onChange={(event) => updateNumber("targetPrice", event.target.value)}
                />
              </Field>
              <Field label="Current ATR Value" helper={inputs.atrValue != null ? formatNumber(inputs.atrValue, 4) : "Optional"}>
                <TerminalInput
                  aria-label="Current ATR Value"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="any"
                  value={inputs.atrValue == null ? "" : String(inputs.atrValue)}
                  onChange={(event) => updateNumber("atrValue", event.target.value)}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Method</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {METHOD_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setInputs((current) => ({ ...current, method: option.id }))}
                    className={`rounded-sm border px-3 py-3 text-left transition-colors ${
                      inputs.method === option.id
                        ? "border-terminal-accent bg-terminal-accent/10 text-terminal-text"
                        : "border-terminal-border bg-terminal-bg/50 text-terminal-muted hover:text-terminal-text"
                    }`}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">{option.label}</div>
                    <div className="mt-1 text-[10px]">{option.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {inputs.method === "kelly" ? (
              <div className="grid grid-cols-1 gap-3 rounded-sm border border-terminal-border bg-terminal-bg/50 p-3 md:grid-cols-3">
                <Field label="Win Rate %" helper={`${formatPercent(inputs.winRatePct)}%`}>
                  <TerminalInput
                    aria-label="Win Rate Percentage"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={String(inputs.winRatePct)}
                    onChange={(event) => updateNumber("winRatePct", event.target.value)}
                  />
                </Field>
                <Field label="Average Win" helper={formatCurrency(inputs.avgWin)}>
                  <TerminalInput
                    aria-label="Average Win"
                    type="number"
                    min="0"
                    step="any"
                    value={String(inputs.avgWin)}
                    onChange={(event) => updateNumber("avgWin", event.target.value)}
                  />
                </Field>
                <Field label="Average Loss" helper={formatCurrency(inputs.avgLoss)}>
                  <TerminalInput
                    aria-label="Average Loss"
                    type="number"
                    min="0"
                    step="any"
                    value={String(inputs.avgLoss)}
                    onChange={(event) => updateNumber("avgLoss", event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {inputs.method === "atr" ? (
              <div className="grid grid-cols-1 gap-3 rounded-sm border border-terminal-border bg-terminal-bg/50 p-3 md:grid-cols-2">
                <Field label="ATR Multiplier" helper={`${formatNumber(inputs.atrMultiplier, 2)}x`}>
                  <TerminalInput
                    aria-label="ATR Multiplier"
                    type="number"
                    min="0"
                    step="any"
                    value={String(inputs.atrMultiplier)}
                    onChange={(event) => updateNumber("atrMultiplier", event.target.value)}
                  />
                </Field>
                <Field label="ATR Value" helper={inputs.atrValue != null ? formatNumber(inputs.atrValue, 4) : "Required for ATR sizing"}>
                  <TerminalInput
                    aria-label="ATR Value"
                    type="number"
                    min="0"
                    step="any"
                    value={inputs.atrValue == null ? "" : String(inputs.atrValue)}
                    onChange={(event) => updateNumber("atrValue", event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {inputs.method === "volatility" ? (
              <div className="grid grid-cols-1 gap-3 rounded-sm border border-terminal-border bg-terminal-bg/50 p-3 md:grid-cols-2">
                <Field label="Target Portfolio Volatility %" helper={`${formatPercent(inputs.targetVolPct)}%`}>
                  <TerminalInput
                    aria-label="Target Portfolio Volatility Percentage"
                    type="number"
                    min="0"
                    step="any"
                    value={String(inputs.targetVolPct)}
                    onChange={(event) => updateNumber("targetVolPct", event.target.value)}
                  />
                </Field>
                <Field label="Stock Annual Volatility %" helper={`${formatPercent(inputs.stockAnnualVolPct)}%`}>
                  <TerminalInput
                    aria-label="Stock Annual Volatility Percentage"
                    type="number"
                    min="0"
                    step="any"
                    value={String(inputs.stockAnnualVolPct)}
                    onChange={(event) => updateNumber("stockAnnualVolPct", event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {result.errors.length > 0 ? (
              <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">
                {result.errors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            ) : null}

            {result.warnings.length > 0 ? (
              <div className="rounded-sm border border-orange-500/60 bg-orange-500/10 p-3 text-xs text-orange-300">
                {result.warnings.map((warning) => (
                  <div key={warning.id}>{warning.message}</div>
                ))}
              </div>
            ) : null}
          </div>
        </TerminalPanel>

        <div className="space-y-4">
          <TerminalPanel title="Primary Output" subtitle="Position size, notional value, and account exposure">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <InfoCard label="Shares to Buy/Sell" value={formatNumber(result.shares, 2)} accent testId="position-sizer-shares" />
              <InfoCard label="Total Position Value" value={formatCurrency(result.positionValue)} testId="position-sizer-position-value" />
              <InfoCard label="Position Size % of Account" value={`${formatPercent(result.positionSizePct)}%`} testId="position-sizer-position-pct" />
            </div>
          </TerminalPanel>

          <TerminalPanel title="Risk Metrics" subtitle="Capital at risk and reward profile">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <InfoCard label="Max Risk" value={formatCurrency(result.maxRisk)} testId="position-sizer-max-risk" />
              <InfoCard label="Risk % of Account" value={`${formatPercent(inputs.accountSize > 0 ? (result.maxRisk / inputs.accountSize) * 100 : 0)}%`} />
              <InfoCard
                label="Risk:Reward Ratio"
                value={result.riskRewardRatio != null ? `1 : ${result.riskRewardRatio.toFixed(2)}` : "N/A"}
                testId="position-sizer-rr"
              />
              <InfoCard
                label="Potential Profit at Target"
                value={result.potentialProfit != null ? formatCurrency(result.potentialProfit) : "N/A"}
                testId="position-sizer-profit"
              />
            </div>

            {inputs.method === "kelly" ? (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <InfoCard label="Full Kelly %" value={result.kellyFullPct != null ? `${formatPercent(result.kellyFullPct)}%` : "N/A"} testId="position-sizer-kelly-full" />
                <InfoCard label="Half Kelly %" value={result.kellyHalfPct != null ? `${formatPercent(result.kellyHalfPct)}%` : "N/A"} />
                <InfoCard label="Quarter Kelly %" value={result.kellyQuarterPct != null ? `${formatPercent(result.kellyQuarterPct)}%` : "N/A"} />
              </div>
            ) : null}
          </TerminalPanel>

          <TerminalPanel title="Risk / Reward" subtitle="Entry centered with downside risk and upside reward">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-terminal-muted">
                <span>Risk</span>
                <div className="relative h-5 flex-1 overflow-hidden rounded-full border border-terminal-border bg-terminal-bg">
                  <div className="absolute inset-y-0 left-0 bg-terminal-neg/80" style={{ width: `${rewardBar.riskWidth}%` }} />
                  <div className="absolute inset-y-0 right-0 bg-terminal-pos/80" style={{ width: `${rewardBar.rewardWidth}%` }} />
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-terminal-text" />
                </div>
                <span>Reward</span>
              </div>
              <div className="grid grid-cols-3 text-[11px] text-terminal-muted">
                <div>{formatCurrency(result.effectiveStopLossPrice)}</div>
                <div className="text-center text-terminal-text">Entry {formatCurrency(inputs.entryPrice)}</div>
                <div className="text-right">{hasTarget && inputs.targetPrice != null ? formatCurrency(inputs.targetPrice) : "No target"}</div>
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel title="Position Summary" subtitle="Trade-level snapshot">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-terminal-border text-terminal-muted">
                    <th className="px-2 py-2 font-medium">Metric</th>
                    <th className="px-2 py-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Shares", formatNumber(result.shares, 2)],
                    ["Entry", formatCurrency(inputs.entryPrice)],
                    ["Stop Loss", formatCurrency(result.effectiveStopLossPrice)],
                    ["Target", hasTarget && inputs.targetPrice != null ? formatCurrency(inputs.targetPrice) : "N/A"],
                    ["Position Value", formatCurrency(result.positionValue)],
                    ["Max Risk", formatCurrency(result.maxRisk)],
                    ["Potential Profit", result.potentialProfit != null ? formatCurrency(result.potentialProfit) : "N/A"],
                    ["R:R Ratio", result.riskRewardRatio != null ? `1:${result.riskRewardRatio.toFixed(2)}` : "N/A"],
                  ].map(([metric, value]) => (
                    <tr key={metric} className="border-b border-terminal-border/40">
                      <td className="px-2 py-2 text-terminal-muted">{metric}</td>
                      <td className="px-2 py-2 text-terminal-text">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TerminalPanel>
        </div>
      </div>
    </div>
  );
}
