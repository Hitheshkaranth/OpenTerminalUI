import { useEffect, useState } from "react";
import { getAgentRiskPolicy, saveAgentRiskPolicy, type AgentRiskPolicy } from "../../api/agentExtras";
import { extractApiErrorMessage } from "../../api/base";

export function PaperRiskPanel() {
  const [policy, setPolicy] = useState<AgentRiskPolicy | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    getAgentRiskPolicy().then((value) => { if (active) setPolicy(value); })
      .catch((e) => { if (active) setError(extractApiErrorMessage(e, "Unable to load paper risk limits.")); });
    return () => { active = false; };
  }, [retry]);
  function edit<K extends keyof AgentRiskPolicy>(key: K, value: AgentRiskPolicy[K]) {
    setPolicy((current) => current ? { ...current, [key]: value } : current);
    setSaved(false);
    setError("");
  }
  const fields = [
    ["max_position_pct", "Maximum position (%)", 100, 0.1],
    ["risk_budget_pct", "New stop-risk budget (%)", 5, 0.1],
    ["max_quote_drift_pct", "Maximum quote change (%)", 10, 0.1],
    ["max_quote_age_seconds", "Maximum quote age (seconds)", 86400, 1],
  ] as const;
  return <section id="agent-paper-risk" aria-labelledby="paper-risk-title" className="border-b border-terminal-border p-3 text-sm text-terminal-text">
    <h2 id="paper-risk-title" className="font-semibold">Paper risk limits</h2>
    <p className="my-2 text-xs">Apply saved limits to agent and manual paper orders. Checks repeat at confirmation and delayed fills. Limits start off until you enable and save them.</p>
    {error && <p role="alert" className="my-2 text-terminal-neg">{error}</p>}
    {!policy ? error ? <button type="button" className="rounded border border-terminal-border px-3 py-2" onClick={() => setRetry((value) => value + 1)}>Retry loading limits</button>
      : <div role="status" aria-busy="true" className="h-8 bg-terminal-bg p-2 text-xs">Loading saved limits…</div>
      : <form onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError(""); setSaved(false);
        try { setPolicy(await saveAgentRiskPolicy(policy)); setSaved(true); }
        catch (e) { setError(extractApiErrorMessage(e, "Unable to save paper risk limits.")); }
        finally { setBusy(false); }
      }}>
        <fieldset disabled={busy} className="space-y-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={policy.enabled} onChange={(e) => edit("enabled", e.target.checked)} />Enforce paper risk limits</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map(([key, label, max, step]) => <label key={key} className="block text-xs">{label}
              <input type="number" required min={step} max={max} step="any" value={policy[key]}
                onChange={(e) => edit(key, Number(e.target.value))}
                className="mt-1 w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-terminal-accent" />
            </label>)}
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={policy.require_stop} onChange={(e) => edit("require_stop", e.target.checked)} />Require a hypothetical stop for buys</label>
          <p className="text-xs">Pending orders and proposals reserve capacity. Limit and stop-trigger orders repeat checks before filling; price gaps beyond the reviewed collar are rejected. Rebalances require all buy stops when configured and cannot overlap pending orders or proposals. Foreign quotes are converted into the portfolio base currency. A hypothetical stop is not placed and cannot limit gap losses.</p>
          <button type="submit" className="rounded border border-terminal-accent px-3 py-2 text-terminal-accent disabled:opacity-50">{busy ? "Saving limits…" : "Save paper risk limits"}</button>
        </fieldset>
        {saved && <p role="status" className="mt-2 text-xs">{policy.enabled ? "Paper risk limits saved and enforced." : "Paper risk limits saved and disabled."}</p>}
      </form>}
  </section>;
}
