import { useEffect, useMemo, useState } from "react";

import { createAlert, deleteAlert, fetchAlerts } from "../api/client";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTable } from "../components/terminal/TerminalTable";
import { useSettingsStore } from "../store/settingsStore";
import { COUNTRY_MARKETS } from "../types";
import type { AlertRule, CountryCode, MarketCode } from "../types";

export function SettingsPage() {
  const selectedCountry = useSettingsStore((s) => s.selectedCountry);
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const realtimeMode = useSettingsStore((s) => s.realtimeMode);
  const newsAutoRefresh = useSettingsStore((s) => s.newsAutoRefresh);
  const newsRefreshSec = useSettingsStore((s) => s.newsRefreshSec);
  const setSelectedCountry = useSettingsStore((s) => s.setSelectedCountry);
  const setSelectedMarket = useSettingsStore((s) => s.setSelectedMarket);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);
  const setRealtimeMode = useSettingsStore((s) => s.setRealtimeMode);
  const setNewsAutoRefresh = useSettingsStore((s) => s.setNewsAutoRefresh);
  const setNewsRefreshSec = useSettingsStore((s) => s.setNewsRefreshSec);

  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [ticker, setTicker] = useState("RELIANCE");
  const [alertType, setAlertType] = useState("price");
  const [condition, setCondition] = useState("above");
  const [threshold, setThreshold] = useState(3000);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const marketOptions = useMemo(() => COUNTRY_MARKETS[selectedCountry], [selectedCountry]);

  const load = async () => {
    try {
      setError(null);
      setAlerts(await fetchAlerts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-3 p-3">
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
          <TerminalInput as="select" value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value as "INR" | "USD")} title="Display currency (format only)">
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

      <TerminalPanel title={`Alert Rules (${alerts.length})`}>
        <TerminalTable
          rows={alerts}
          rowKey={(row) => String(row.id)}
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
    </div>
  );
}
