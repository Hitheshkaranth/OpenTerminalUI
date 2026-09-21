import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { createAlert, createScheduledReport, deleteAlert, deleteScheduledReport, downloadExport, fetchAlerts, fetchScheduledReports } from "../api/client";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTable } from "../components/terminal/TerminalTable";
import { DataManager } from "../components/settings/DataManager";
import { APIKeyManager } from "../components/settings/APIKeyManager";
import { DataProvidersPanel } from "../components/settings/DataProvidersPanel";
import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { useSettingsStore } from "../store/settingsStore";
import { COUNTRY_MARKETS } from "../types";
import type { AlertRule, CountryCode, MarketCode } from "../types";
import type { ThemeVariant } from "../store/settingsStore";
import type { ScheduledReport } from "../types";

export function SettingsPage() {
  const selectedCountry = useSettingsStore((s) => s.selectedCountry);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const realtimeMode = useSettingsStore((s) => s.realtimeMode);
  const newsAutoRefresh = useSettingsStore((s) => s.newsAutoRefresh);
  const newsRefreshSec = useSettingsStore((s) => s.newsRefreshSec);
  const themeVariant = useSettingsStore((s) => s.themeVariant);
  const customAccentColor = useSettingsStore((s) => s.customAccentColor);
  const setCustomAccentColor = useSettingsStore((s) => s.setCustomAccentColor);
  const hudOverlayEnabled = useSettingsStore((s) => s.hudOverlayEnabled);
  const setHudOverlayEnabled = useSettingsStore((s) => s.setHudOverlayEnabled);
  const tickerTapeVisible = useSettingsStore((s) => s.tickerTapeVisible);
  const setTickerTapeVisible = useSettingsStore((s) => s.setTickerTapeVisible);
  const setSelectedCountry = useSettingsStore((s) => s.setSelectedCountry);
  const setSelectedMarket = useSettingsStore((s) => s.setSelectedMarket);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);
  const setRealtimeMode = useSettingsStore((s) => s.setRealtimeMode);
  const setNewsAutoRefresh = useSettingsStore((s) => s.setNewsAutoRefresh);
  const setNewsRefreshSec = useSettingsStore((s) => s.setNewsRefreshSec);
  const setThemeVariant = useSettingsStore((s) => s.setThemeVariant);

  const [searchParams] = useSearchParams();
  const providersRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (searchParams.get("section") === "providers" && providersRef.current) {
      providersRef.current.scrollIntoView({ block: "start" });
    }
  }, [searchParams]);

  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [ticker, setTicker] = useState("RELIANCE");
  const [alertType, setAlertType] = useState("price");
  const [condition, setCondition] = useState("above");
  const [threshold, setThreshold] = useState(3000);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledReport[]>([]);
  const [reportType, setReportType] = useState("portfolio_summary");
  const [frequency, setFrequency] = useState("daily");
  const [email, setEmail] = useState("");
  const [dataType, setDataType] = useState("positions");

  const marketOptions = useMemo(() => COUNTRY_MARKETS[selectedCountry], [selectedCountry]);

  const load = async () => {
    try {
      setError(null);
      const [alertsRes, reportsRes] = await Promise.all([fetchAlerts(), fetchScheduledReports()]);
      setAlerts(alertsRes || []);
      setScheduled(reportsRes || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-3 p-3">
      <div ref={providersRef}>
        <TerminalPanel title="Data Providers" subtitle="What is live, what is missing, and what a key unlocks">
          <DataProvidersPanel />
        </TerminalPanel>
      </div>

      <TerminalPanel title="UI Settings" subtitle="Dense terminal defaults">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-6">
          <TerminalInput as="select" value={selectedCountry} onChange={(e) => setSelectedCountry(e.target.value as CountryCode)}>
            <option value="IN">IN</option>
            <option value="US">US</option>
          </TerminalInput>
          <TerminalInput as="select" value={selectedMarket} onChange={(e) => setSelectedMarket(e.target.value as MarketCode)}>
            {marketOptions.map((market) => (
              <option key={market} value={market}>
                {market}
              </option>
            ))}
          </TerminalInput>
          <TerminalInput as="select" value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value as "INR" | "USD")} title="Display currency">
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </TerminalInput>
          <TerminalInput as="select" value={realtimeMode} onChange={(e) => setRealtimeMode(e.target.value as "polling" | "ws")}>
            <option value="polling">polling</option>
            <option value="ws">ws</option>
          </TerminalInput>
          <TerminalInput as="select" value={newsAutoRefresh ? "on" : "off"} onChange={(e) => setNewsAutoRefresh(e.target.value === "on")}>
            <option value="on">news auto on</option>
            <option value="off">news auto off</option>
          </TerminalInput>
          <TerminalInput
            type="number"
            min={5}
            value={newsRefreshSec}
            onChange={(e) => setNewsRefreshSec(Math.max(5, Number(e.target.value) || 60))}
            placeholder="news refresh sec"
          />
        </div>
      </TerminalPanel>

      <TerminalPanel title="Theme">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <TerminalInput as="select" value={themeVariant} onChange={(e) => setThemeVariant(e.target.value as ThemeVariant)}>
            <option value="terminal-noir">Terminal Noir</option>
            <option value="classic-bloomberg">Classic Bloomberg</option>
            <option value="light-desk">Light Desk</option>
            <option value="custom">Custom</option>
          </TerminalInput>
          {themeVariant === "custom" ? (
            <input
              type="color"
              className="h-8 w-12 cursor-pointer rounded border border-terminal-border bg-transparent p-0"
              aria-label="Custom accent color"
              value={customAccentColor}
              onChange={(e) => setCustomAccentColor(e.target.value)}
            />
          ) : null}
          <div className="flex items-center gap-2 rounded border border-terminal-border bg-terminal-bg px-2 py-1.5">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={hudOverlayEnabled}
                onChange={(e) => setHudOverlayEnabled(e.target.checked)}
              />
              <span className="text-terminal-muted">HUD overlay</span>
            </label>
          </div>
          <div className="flex items-center gap-2 rounded border border-terminal-border bg-terminal-bg px-2 py-1.5">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={tickerTapeVisible}
                onChange={(e) => setTickerTapeVisible(e.target.checked)}
              />
              <span className="text-terminal-muted">Show ticker tape</span>
            </label>
          </div>
        </div>
      </TerminalPanel>

      <TerminalPanel title="Create Alert">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-6">
          <TerminalInput value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
          <TerminalInput as="select" value={alertType} onChange={(e) => setAlertType(e.target.value)}>
            <option value="price">price</option>
            <option value="technical">technical</option>
            <option value="fundamental">fundamental</option>
            <option value="composite">composite</option>
          </TerminalInput>
          <TerminalInput as="select" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="above">above</option>
            <option value="below">below</option>
            <option value="crosses">crosses</option>
          </TerminalInput>
          <TerminalInput type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <TerminalInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" />
          <TerminalButton
            variant="accent"
            onClick={async () => {
              try {
                await createAlert({ ticker, alert_type: alertType, condition, threshold, note });
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to create alert");
              }
            }}
          >
            Add Alert
          </TerminalButton>
        </div>
      </TerminalPanel>

      {error && <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}

      <TerminalPanel title={`Alert Rules (${(alerts || []).length})`}>
        <TerminalTable
          rows={alerts || []}
          rowKey={(row) => String(row?.id || Math.random())}
          emptyText="No alert rules configured"
          columns={[
            { key: "ticker", label: "Ticker", render: (row) => row.ticker },
            { key: "type", label: "Type", render: (row) => row.alert_type },
            { key: "condition", label: "Condition", render: (row) => row.condition },
            { key: "threshold", label: "Threshold", align: "right", render: (row) => row.threshold },
            { key: "note", label: "Note", render: (row) => row.note || "-" },
            {
              key: "action",
              label: "Action",
              align: "right",
              render: (row) => (
                <TerminalButton
                  variant="danger"
                  onClick={async () => {
                    try {
                      await deleteAlert(row.id);
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Failed to delete alert");
                    }
                  }}
                >
                  Delete
                </TerminalButton>
              ),
            },
          ]}
        />
      </TerminalPanel>

      <TerminalPanel title="Scheduled Reports">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-5">
          <TerminalInput value={reportType} onChange={(e) => setReportType(e.target.value)} placeholder="report type" />
          <TerminalInput as="select" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
          </TerminalInput>
          <TerminalInput value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <TerminalInput as="select" value={dataType} onChange={(e) => setDataType(e.target.value)}>
            <option value="positions">positions</option>
            <option value="watchlist">watchlist</option>
            <option value="trades">trades</option>
            <option value="screening_results">screening_results</option>
            <option value="backtest_trades">backtest_trades</option>
          </TerminalInput>
          <TerminalButton
            variant="accent"
            onClick={async () => {
              try {
                await createScheduledReport({ report_type: reportType, frequency, email, data_type: dataType });
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed to save schedule");
              }
            }}
          >
            Save
          </TerminalButton>
        </div>
        <div className="mt-3 space-y-2 text-xs">
          {scheduled.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded border border-terminal-border bg-terminal-bg px-2 py-1">
              <span className="text-terminal-muted">{row.report_type} | {row.frequency} | {row.email} | {row.data_type}</span>
              <TerminalButton
                variant="danger"
                onClick={async () => {
                  await deleteScheduledReport(row.id);
                  await load();
                }}
              >
                Delete
              </TerminalButton>
            </div>
          ))}
          {!scheduled.length ? <div className="text-terminal-muted">No schedules configured.</div> : null}
        </div>
      </TerminalPanel>

      <TerminalPanel title="Data Export">
        <div className="flex flex-wrap gap-2">
          {["watchlist", "positions", "trades", "screening_results", "backtest_trades"].map((kind) => (
            <div key={kind} className="flex items-center gap-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1">
              <span className="text-xs text-terminal-muted">{kind}</span>
              {(["csv", "xlsx", "pdf"] as const).map((fmt) => (
                <TerminalButton
                  key={`${kind}-${fmt}`}
                  onClick={async () => {
                    const blob = await downloadExport(kind, fmt);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${kind}.${fmt}`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  {fmt}
                </TerminalButton>
              ))}
            </div>
          ))}
        </div>
      </TerminalPanel>

      <TerminalPanel title="Backtest Data">
        <ErrorBoundary>
          <DataManager />
        </ErrorBoundary>
      </TerminalPanel>

      <ErrorBoundary>
        <APIKeyManager />
      </ErrorBoundary>
    </div>
  );
}
