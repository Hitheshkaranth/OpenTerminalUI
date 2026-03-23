import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { CrossRatesMatrix } from "../components/forex/CrossRatesMatrix";
import { CentralBankMonitor, type CentralBankEntry } from "../components/forex/CentralBankMonitor";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

type PairCandle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type PairResponse = {
  pair: string;
  current_rate: number;
  candles: PairCandle[];
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "") || "/api";
const FALLBACK_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "INR"];
const USD_QUOTE_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.9231,
  GBP: 0.7852,
  JPY: 151.32,
  CHF: 0.8844,
  AUD: 1.5281,
  CAD: 1.3574,
  INR: 83.14,
};
const FALLBACK_BANKS: CentralBankEntry[] = [
  { currency: "USD", bank: "Federal Reserve", policy_rate: 5.25, last_decision_date: "2026-02-18", next_decision_date: "2026-03-31", last_action: "Hold", last_change_bps: 0, days_since_last_decision: 31, days_until_next_decision: 11, decision_cycle: "6 weeks" },
  { currency: "EUR", bank: "European Central Bank", policy_rate: 3.0, last_decision_date: "2026-03-05", next_decision_date: "2026-04-16", last_action: "Cut", last_change_bps: -25, days_since_last_decision: 14, days_until_next_decision: 27, decision_cycle: "6 weeks" },
  { currency: "GBP", bank: "Bank of England", policy_rate: 4.5, last_decision_date: "2026-02-06", next_decision_date: "2026-03-20", last_action: "Hold", last_change_bps: 0, days_since_last_decision: 42, days_until_next_decision: 0, decision_cycle: "6 weeks" },
  { currency: "JPY", bank: "Bank of Japan", policy_rate: 0.25, last_decision_date: "2026-01-23", next_decision_date: "2026-03-21", last_action: "Hike", last_change_bps: 10, days_since_last_decision: 57, days_until_next_decision: 1, decision_cycle: "2 months" },
  { currency: "CHF", bank: "Swiss National Bank", policy_rate: 1.25, last_decision_date: "2026-03-14", next_decision_date: "2026-06-13", last_action: "Hold", last_change_bps: 0, days_since_last_decision: 5, days_until_next_decision: 86, decision_cycle: "Quarterly" },
  { currency: "AUD", bank: "Reserve Bank of Australia", policy_rate: 4.1, last_decision_date: "2026-03-03", next_decision_date: "2026-04-07", last_action: "Hold", last_change_bps: 0, days_since_last_decision: 16, days_until_next_decision: 18, decision_cycle: "Monthly" },
  { currency: "CAD", bank: "Bank of Canada", policy_rate: 4.0, last_decision_date: "2026-03-12", next_decision_date: "2026-04-23", last_action: "Cut", last_change_bps: -25, days_since_last_decision: 7, days_until_next_decision: 34, decision_cycle: "6 weeks" },
  { currency: "INR", bank: "Reserve Bank of India", policy_rate: 6.5, last_decision_date: "2026-02-07", next_decision_date: "2026-04-05", last_action: "Hold", last_change_bps: 0, days_since_last_decision: 41, days_until_next_decision: 16, decision_cycle: "Bi-monthly" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePair(raw: string | null): string {
  const value = String(raw || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  return value.length >= 6 ? value.slice(0, 6) : "EURUSD";
}

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path.startsWith("/") ? path : `/${path}`}`);
  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    throw new Error((payload && typeof payload.detail === "string" && payload.detail) || response.statusText || "Request failed");
  }
  return payload as T;
}

function buildFallbackMatrix(currencies: string[]): number[][] {
  return currencies.map((base) =>
    currencies.map((quote) => {
      const baseRate = USD_QUOTE_RATES[base] || 1;
      const quoteRate = USD_QUOTE_RATES[quote] || 1;
      return Number((quoteRate / baseRate).toFixed(6));
    }),
  );
}

function normalizeCrossRates(payload: unknown): { currencies: string[]; matrix: number[][] } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { currencies: FALLBACK_CURRENCIES, matrix: buildFallbackMatrix(FALLBACK_CURRENCIES) };
  }
  const raw = payload as Record<string, unknown>;
  const currencies = Array.isArray(raw.currencies)
    ? raw.currencies.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean)
    : FALLBACK_CURRENCIES;
  const matrix = Array.isArray(raw.matrix)
    ? raw.matrix.map((row) =>
        Array.isArray(row)
          ? row.map((value) => {
              const numeric = Number(value);
              return Number.isFinite(numeric) ? numeric : 0;
            })
          : [],
      )
    : buildFallbackMatrix(currencies);
  return {
    currencies: currencies.length ? currencies : FALLBACK_CURRENCIES,
    matrix: matrix.length ? matrix : buildFallbackMatrix(currencies.length ? currencies : FALLBACK_CURRENCIES),
  };
}

function buildFallbackPair(pair: string, currencies: string[], matrix: number[][]): PairResponse {
  const base = pair.slice(0, 3);
  const quote = pair.slice(3, 6);
  const baseIndex = currencies.indexOf(base);
  const quoteIndex = currencies.indexOf(quote);
  const currentRate = Number(matrix[baseIndex]?.[quoteIndex] ?? 1.08);
  const candles = Array.from({ length: 48 }, (_, index) => {
    const drift = Math.sin(index / 5.5) * currentRate * 0.003 + (index - 24) * currentRate * 0.00012;
    const close = Number((currentRate + drift).toFixed(5));
    const open = Number((close - currentRate * 0.0008).toFixed(5));
    const high = Number((Math.max(open, close) + currentRate * 0.0015).toFixed(5));
    const low = Number((Math.min(open, close) - currentRate * 0.0012).toFixed(5));
    return {
      t: Math.floor(Date.now() / 1000) - (47 - index) * 3600,
      o: open,
      h: high,
      l: low,
      c: close,
      v: 1000 + index * 37,
    };
  });
  return { pair, current_rate: currentRate, candles };
}

function normalizePairResponse(payload: unknown, pair: string, currencies: string[], matrix: number[][]): PairResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return buildFallbackPair(pair, currencies, matrix);
  }
  const raw = payload as Record<string, unknown>;
  const candles = Array.isArray(raw.candles)
    ? raw.candles
        .map((candle) => {
          if (!candle || typeof candle !== "object" || Array.isArray(candle)) return null;
          const row = candle as Record<string, unknown>;
          return {
            t: Number(row.t),
            o: Number(row.o),
            h: Number(row.h),
            l: Number(row.l),
            c: Number(row.c),
            v: Number(row.v || 0),
          };
        })
        .filter((candle): candle is PairCandle => candle !== null && Number.isFinite(candle.t))
    : [];
  return {
    pair: String(raw.pair || pair).toUpperCase(),
    current_rate: Number(raw.current_rate ?? raw.currentRate ?? candles[candles.length - 1]?.c ?? 0),
    candles: candles.length ? candles : buildFallbackPair(pair, currencies, matrix).candles,
  };
}

function normalizeBanks(payload: unknown): CentralBankEntry[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return FALLBACK_BANKS;
  }
  const raw = payload as Record<string, unknown>;
  const banks = Array.isArray(raw.banks)
    ? raw.banks
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const row = entry as Record<string, unknown>;
          return {
            currency: String(row.currency || ""),
            bank: String(row.bank || ""),
            policy_rate: Number(row.policy_rate),
            last_decision_date: String(row.last_decision_date || ""),
            next_decision_date: String(row.next_decision_date || ""),
            last_action: String(row.last_action || ""),
            last_change_bps: Number(row.last_change_bps || 0),
            days_since_last_decision: Number(row.days_since_last_decision || 0),
            days_until_next_decision: Number(row.days_until_next_decision || 0),
            decision_cycle: String(row.decision_cycle || ""),
          };
        })
        .filter((entry): entry is CentralBankEntry => entry !== null && Boolean(entry.currency) && Boolean(entry.bank))
    : [];
  return banks.length ? banks : FALLBACK_BANKS;
}

function currencyStrengthRows(currencies: string[], matrix: number[][]) {
  const usdIndex = currencies.indexOf("USD");
  const values = currencies.map((currency, index) => {
    const usdValue = usdIndex >= 0 ? Number(matrix[index]?.[usdIndex] ?? 1) : 1;
    const safeValue = usdValue > 0 ? usdValue : 1;
    return { currency, usdValue: safeValue, logValue: Math.log(safeValue) };
  });
  const mean = values.reduce((sum, row) => sum + row.logValue, 0) / Math.max(values.length, 1);
  const variance = values.reduce((sum, row) => sum + (row.logValue - mean) ** 2, 0) / Math.max(values.length, 1);
  const deviation = Math.sqrt(variance) || 1;
  return values
    .map((row) => ({
      ...row,
      score: (row.logValue - mean) / deviation,
    }))
    .sort((left, right) => right.score - left.score);
}

function strengthTone(score: number): string {
  const opacity = 10 + Math.round(clamp(Math.abs(score), 0, 2) * 14);
  if (score >= 0) return `bg-emerald-500/${opacity} text-emerald-200`;
  return `bg-rose-500/${opacity} text-rose-200`;
}

export function ForexPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [crossRates, setCrossRates] = useState<{ currencies: string[]; matrix: number[][] }>({
    currencies: FALLBACK_CURRENCIES,
    matrix: buildFallbackMatrix(FALLBACK_CURRENCIES),
  });
  const [banks, setBanks] = useState<CentralBankEntry[]>(FALLBACK_BANKS);
  const [pairData, setPairData] = useState<PairResponse>(buildFallbackPair("EURUSD", FALLBACK_CURRENCIES, buildFallbackMatrix(FALLBACK_CURRENCIES)));
  const [ratesLoading, setRatesLoading] = useState(true);
  const [pairLoading, setPairLoading] = useState(false);
  const [fallbackMode, setFallbackMode] = useState(false);
  const selectedPair = normalizePair(searchParams.get("pair"));

  useEffect(() => {
    let cancelled = false;
    setRatesLoading(true);
    void (async () => {
      const [ratesResult, banksResult] = await Promise.allSettled([
        requestJson<unknown>("/forex/cross-rates"),
        requestJson<unknown>("/forex/central-banks"),
      ]);
      if (cancelled) return;
      const nextCrossRates = ratesResult.status === "fulfilled"
        ? normalizeCrossRates(ratesResult.value)
        : { currencies: FALLBACK_CURRENCIES, matrix: buildFallbackMatrix(FALLBACK_CURRENCIES) };
      setCrossRates(nextCrossRates);
      setBanks(banksResult.status === "fulfilled" ? normalizeBanks(banksResult.value) : FALLBACK_BANKS);
      setFallbackMode(!(ratesResult.status === "fulfilled" && banksResult.status === "fulfilled"));
      setRatesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (next.get("pair") !== selectedPair) {
      next.set("pair", selectedPair);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, selectedPair, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setPairLoading(true);
    void (async () => {
      try {
        const payload = await requestJson<unknown>(`/forex/pairs/${encodeURIComponent(selectedPair)}`);
        if (cancelled) return;
        setPairData(normalizePairResponse(payload, selectedPair, crossRates.currencies, crossRates.matrix));
      } catch {
        if (cancelled) return;
        setPairData(buildFallbackPair(selectedPair, crossRates.currencies, crossRates.matrix));
        setFallbackMode(true);
      } finally {
        if (!cancelled) setPairLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [crossRates.currencies, crossRates.matrix, selectedPair]);

  const chartRows = useMemo(
    () =>
      pairData.candles.map((row) => ({
        time: new Date(row.t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        close: row.c,
        high: row.h,
        low: row.l,
        volume: row.v,
      })),
    [pairData.candles],
  );
  const lastCandle = pairData.candles[pairData.candles.length - 1];
  const firstCandle = pairData.candles[0];
  const pairChangePct = firstCandle && lastCandle && firstCandle.c !== 0 ? ((lastCandle.c - firstCandle.c) / firstCandle.c) * 100 : 0;
  const strengthRows = useMemo(() => currencyStrengthRows(crossRates.currencies, crossRates.matrix), [crossRates.currencies, crossRates.matrix]);

  return (
    <div className="space-y-4 px-3 py-3">
      <TerminalPanel
        title="Forex Terminal"
        subtitle="Cross rates, pair detail, central banks, and major-currency relative strength"
        actions={
          <div className="flex items-center gap-2">
            <TerminalBadge variant={fallbackMode ? "warn" : "live"} dot>
              {fallbackMode ? "Seeded fallback" : "Backend live"}
            </TerminalBadge>
            <TerminalBadge variant="accent">FX</TerminalBadge>
          </div>
        }
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="rounded border border-terminal-border bg-terminal-panel/50">
            <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Cross Rates</div>
                <div className="mt-1 text-[11px] text-terminal-muted">Click a cell to open pair detail and rate context</div>
              </div>
              {ratesLoading ? <TerminalBadge variant="info" dot>Refreshing</TerminalBadge> : null}
            </div>
            <div className="p-2">
              <CrossRatesMatrix
                currencies={crossRates.currencies}
                matrix={crossRates.matrix}
                selectedPair={selectedPair}
                onSelectPair={(pair) => setSearchParams(new URLSearchParams({ pair }), { replace: true })}
              />
            </div>
          </div>

          <div className="grid gap-4">
            <TerminalPanel
              title={`${selectedPair.slice(0, 3)}/${selectedPair.slice(3, 6)} Detail`}
              subtitle="Spot trend and intraday range"
              actions={
                <Link
                  to={`/equity/chart-workstation?ticker=${encodeURIComponent(selectedPair)}&symbol=${encodeURIComponent(selectedPair)}`}
                  className="rounded border border-terminal-border px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-terminal-muted hover:text-terminal-text"
                >
                  Open Chart
                </Link>
              }
              bodyClassName="h-[280px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartRows} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fx-pair-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--ot-color-accent-primary)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--ot-color-accent-primary)" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                  <XAxis dataKey="time" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} minTickGap={24} />
                  <YAxis stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={10} domain={["dataMin", "dataMax"]} />
                  <Tooltip contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", fontSize: "11px" }} />
                  <Area type="monotone" dataKey="close" stroke="var(--ot-color-accent-primary)" fill="url(#fx-pair-fill)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </TerminalPanel>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded border border-terminal-border bg-terminal-panel/50 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.16em] text-terminal-muted">Spot</div>
                <div className="mt-1 ot-type-data text-lg text-terminal-text">{pairData.current_rate.toFixed(4)}</div>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-panel/50 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.16em] text-terminal-muted">Window Change</div>
                <div className={`mt-1 ot-type-data text-lg ${pairChangePct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                  {pairChangePct >= 0 ? "+" : ""}{pairChangePct.toFixed(2)}%
                </div>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-panel/50 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.16em] text-terminal-muted">Range</div>
                <div className="mt-1 ot-type-data text-lg text-terminal-text">
                  {pairData.candles.length
                    ? `${Math.min(...pairData.candles.map((row) => row.l)).toFixed(4)} - ${Math.max(...pairData.candles.map((row) => row.h)).toFixed(4)}`
                    : "--"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </TerminalPanel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <TerminalPanel title="Majors Heatmap" subtitle="Relative strength vs USD basket proxy">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {strengthRows.map((row) => (
              <div key={row.currency} className={`rounded border border-terminal-border px-3 py-3 ${strengthTone(row.score)}`}>
                <div className="text-[10px] uppercase tracking-[0.16em]">{row.currency}</div>
                <div className="mt-1 ot-type-data text-lg">{row.usdValue.toFixed(4)}</div>
                <div className="mt-1 text-[11px]">
                  Score {row.score >= 0 ? "+" : ""}{row.score.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </TerminalPanel>

        <TerminalPanel
          title="Central Bank Monitor"
          subtitle="Policy rates, recent decisions, and upcoming meetings"
          actions={pairLoading ? <TerminalBadge variant="info" dot>Pair updating</TerminalBadge> : null}
        >
          <CentralBankMonitor banks={banks} loading={ratesLoading} />
        </TerminalPanel>
      </div>

      {fallbackMode ? (
        <div className="rounded border border-terminal-warn/40 bg-terminal-warn/10 px-3 py-2 text-xs text-terminal-warn">
          Forex backend routes are implemented in the workspace, but global router registration is still outside this packet scope, so the page can fall back to seeded data.
        </div>
      ) : null}
    </div>
  );
}
