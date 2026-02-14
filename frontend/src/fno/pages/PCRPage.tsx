import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, CartesianGrid } from "recharts";

import { fetchPCR, fetchPCRByStrike, fetchPCRHistory } from "../api/fnoApi";
import { useFnoContext } from "../FnoLayout";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function PCRPage() {
  const { symbol, expiry } = useFnoContext();
  const currentQuery = useQuery({
    queryKey: ["fno-pcr-current", symbol, expiry],
    queryFn: () => fetchPCR(symbol, expiry || undefined),
    enabled: Boolean(symbol),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
  const historyQuery = useQuery({
    queryKey: ["fno-pcr-history", symbol],
    queryFn: () => fetchPCRHistory(symbol, 30),
    enabled: Boolean(symbol),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const byStrikeQuery = useQuery({
    queryKey: ["fno-pcr-strike", symbol, expiry],
    queryFn: () => fetchPCRByStrike(symbol, expiry || undefined),
    enabled: Boolean(symbol),
    staleTime: 45_000,
    refetchInterval: 90_000,
    refetchOnWindowFocus: false,
  });

  const pcr = Number(currentQuery.data?.pcr_oi);
  const pcrVol = Number(currentQuery.data?.pcr_vol);
  const safePcr = Number.isFinite(pcr) ? pcr : 0;
  const gaugeValue = Number.isFinite(pcr) ? pcr : 1;
  const gaugePct = clamp((gaugeValue / 2) * 100, 0, 100);
  const historyData = (historyQuery.data ?? [])
    .map((row) => ({
      date: String(row.date || ""),
      pcr_oi: Number(row.pcr_oi),
      pcr_vol: Number(row.pcr_vol),
    }))
    .filter((row) => row.date && Number.isFinite(row.pcr_oi));
  const byStrikeData = (byStrikeQuery.data ?? [])
    .map((row) => ({
      strike: Number(row.strike),
      pcr_oi: Number(row.pcr_oi),
      pcr_vol: Number(row.pcr_vol),
      weight: Number(row.ce_oi) + Number(row.pe_oi),
    }))
    .filter((row) => Number.isFinite(row.strike) && Number.isFinite(row.pcr_oi))
    .sort((a, b) => a.strike - b.strike);
  const compactByStrike = byStrikeData.length > 50
    ? byStrikeData.filter((_, idx) => idx % Math.ceil(byStrikeData.length / 50) === 0)
    : byStrikeData;
  const isLoading = currentQuery.isLoading || historyQuery.isLoading || byStrikeQuery.isLoading;
  const hasError = currentQuery.isError || historyQuery.isError || byStrikeQuery.isError;
  const errorMessage =
    (currentQuery.error as Error | undefined)?.message ||
    (historyQuery.error as Error | undefined)?.message ||
    (byStrikeQuery.error as Error | undefined)?.message ||
    "Failed to load PCR data";

  const onRetry = () => {
    void currentQuery.refetch();
    void historyQuery.refetch();
    void byStrikeQuery.refetch();
  };

  const gaugeAngle = -90 + (gaugePct / 100) * 180;
  const needleX = 100 + 78 * Math.cos((gaugeAngle * Math.PI) / 180);
  const needleY = 100 + 78 * Math.sin((gaugeAngle * Math.PI) / 180);

  return (
    <div className="space-y-3">
      {isLoading && (
        <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-xs text-terminal-muted">
          Loading PCR data for {symbol}...
        </div>
      )}
      {hasError && (
        <div className="rounded border border-terminal-neg bg-terminal-neg/10 px-3 py-2 text-xs text-terminal-neg">
          <div className="font-semibold">PCR feed error</div>
          <div className="mt-1 break-all">{errorMessage}</div>
          <button className="mt-2 rounded border border-terminal-neg px-2 py-1 text-[11px]" onClick={onRetry}>Retry</button>
        </div>
      )}

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-terminal-accent">Current PCR</div>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]">
          <svg viewBox="0 0 200 120" className="h-28 w-full">
            <path d="M20 100 A80 80 0 0 1 65 31" fill="none" stroke="#ff4d4f" strokeWidth="12" />
            <path d="M65 31 A80 80 0 0 1 100 20" fill="none" stroke="#ffb74d" strokeWidth="12" />
            <path d="M100 20 A80 80 0 0 1 145 31" fill="none" stroke="#00c176" strokeWidth="12" />
            <path d="M145 31 A80 80 0 0 1 180 100" fill="none" stroke="#007a4b" strokeWidth="12" />
            <line x1="100" y1="100" x2={needleX} y2={needleY} stroke="#ff9f1a" strokeWidth="3" />
            <circle cx="100" cy="100" r="4" fill="#ff9f1a" />
            <text x="100" y="116" textAnchor="middle" fill="#d8dde7" fontSize="13">{Number.isFinite(pcr) ? pcr.toFixed(2) : "--"}</text>
          </svg>
          <div className="text-sm">
            <div>PCR (OI): <span className="font-semibold">{Number.isFinite(pcr) ? pcr.toFixed(2) : "--"}</span></div>
            <div>PCR (Vol): <span className="font-semibold">{Number.isFinite(pcrVol) ? pcrVol.toFixed(2) : "--"}</span></div>
            <div>Signal: <span className="font-semibold">{currentQuery.data?.signal || "Neutral"}</span></div>
            <div className="mt-2 h-4 w-full overflow-hidden rounded border border-terminal-border bg-terminal-bg">
              <div className="h-full" style={{ width: `${gaugePct}%`, background: `linear-gradient(90deg,#ff4d4f 0%,#ffb74d 35%,#00c176 70%,#007a4b 100%)` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">PCR Trend (30D)</div>
        <div className="h-64 w-full">
          {historyData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                <XAxis dataKey="date" tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, "auto"]} />
                <Tooltip contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }} />
                <ReferenceLine y={0.7} stroke="#ff4d4f" strokeDasharray="3 3" />
                <ReferenceLine y={1.0} stroke="#ffb74d" strokeDasharray="3 3" />
                <ReferenceLine y={1.3} stroke="#00c176" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="pcr_oi" stroke="#ff9f1a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-terminal-muted">No PCR trend data available</div>
          )}
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">PCR By Strike</div>
        <div className="h-64 w-full">
          {compactByStrike.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={compactByStrike}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                <XAxis dataKey="strike" tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }} />
                <Bar dataKey="pcr_oi" fill={safePcr >= 1 ? "#00c176" : "#ff4d4f"} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-terminal-muted">No by-strike PCR data available</div>
          )}
        </div>
      </div>
    </div>
  );
}
