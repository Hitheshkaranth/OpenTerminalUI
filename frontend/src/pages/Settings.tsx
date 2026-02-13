import { useEffect, useState } from "react";

import { createAlert, deleteAlert, fetchAlerts } from "../api/client";
import type { AlertRule } from "../types";

export function SettingsPage() {
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [ticker, setTicker] = useState("RELIANCE");
  const [alertType, setAlertType] = useState("price");
  const [condition, setCondition] = useState("above");
  const [threshold, setThreshold] = useState(3000);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold">Create Alert</div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
          <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={alertType} onChange={(e) => setAlertType(e.target.value)}>
            <option value="price">price</option>
            <option value="technical">technical</option>
            <option value="fundamental">fundamental</option>
            <option value="composite">composite</option>
          </select>
          <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="above">above</option>
            <option value="below">below</option>
            <option value="crosses">crosses</option>
          </select>
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" />
          <button
            className="rounded bg-terminal-accent px-3 py-1 text-xs text-white"
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
          </button>
        </div>
      </div>
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold">Alert Rules ({alerts.length})</div>
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-terminal-muted">
                <th className="px-2 py-1 text-left">Ticker</th>
                <th className="px-2 py-1 text-left">Type</th>
                <th className="px-2 py-1 text-left">Condition</th>
                <th className="px-2 py-1 text-right">Threshold</th>
                <th className="px-2 py-1 text-left">Note</th>
                <th className="px-2 py-1 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-b border-terminal-border/50">
                  <td className="px-2 py-1">{a.ticker}</td>
                  <td className="px-2 py-1">{a.alert_type}</td>
                  <td className="px-2 py-1">{a.condition}</td>
                  <td className="px-2 py-1 text-right">{a.threshold}</td>
                  <td className="px-2 py-1">{a.note}</td>
                  <td className="px-2 py-1 text-right">
                    <button
                      className="rounded border border-terminal-border px-2 py-1"
                      onClick={async () => {
                        try {
                          await deleteAlert(a.id);
                          await load();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Failed to delete alert");
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
