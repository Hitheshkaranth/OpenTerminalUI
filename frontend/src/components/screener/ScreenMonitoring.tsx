import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listScreenSchedules, patchScreenSchedule, previewScreenSchedule, runScreenSchedule, saveScreenSchedule } from "../../api/screenMonitoring";
import type { ScreenCoverage, ScreenPreview, ScreenSchedule, ScheduleInput } from "../../api/screenMonitoring";
import { createDossier, emptyDossier } from "../../api/researchDossiers";
import { extractApiErrorMessage } from "../../api/base";
import { ScreenCoverageChart, ScreenChangesChart, ScreenMetricChangeChart } from "./ScreenMonitoringCharts";
import { screenMetricComparisons, screenMetricMeta, screenMetricValue } from "./screenChartData";
import "./ScreenMonitoring.css";

const number = (value: number | undefined) => value == null ? "Unavailable" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleString();
function Coverage({ value }: { value: ScreenCoverage }) {
  return <div className="screen-monitor-coverage"><ScreenCoverageChart coverage={value} /><p>Checked {value.evaluated} of {value.requested} companies · {value.missing.length} missing · {value.stale.length} stale · {value.unknown.length} incomplete</p>
    {(value.missing.length + value.stale.length + value.unknown.length > 0) && <details><summary>Review coverage gaps</summary>
      {([['Missing', value.missing], ['Stale', value.stale], ['Incomplete measurements or date', value.unknown]] as const).map(([label, items]) => items.length ? <p key={label}><strong>{label}:</strong> {items.join(", ")}</p> : null)}
      <p>Unavailable data never counts as a company leaving your screen.</p></details>}</div>;
}

export function ScreenMonitoring({ screen, universe, onRestoreUniverse }: { screen: { id: string; name: string; query: string }; universe: string; onRestoreUniverse?: (universe: string) => void }) {
  const [tab, setTab] = useState<"matches" | "changes" | "schedule">(new URLSearchParams(window.location.search).has("screen") ? "changes" : "matches");
  const [schedule, setSchedule] = useState<ScreenSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
  const [maxAge, setMaxAge] = useState(168);
  const [preview, setPreview] = useState<ScreenPreview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createdDossierId, setCreatedDossierId] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setError(""); setNotice(""); setSchedule(null); setPreview(null);
    listScreenSchedules().then((items) => {
      if (generation.current !== request) return;
      const found = items.find((item) => item.screen_id === screen.id) ?? null;
      setSchedule(found); if (found) onRestoreUniverse?.(found.universe); setFrequency(found?.frequency ?? "daily"); setMaxAge(found?.max_age_hours ?? 168);
    }).catch((e) => { if (generation.current === request) setError(extractApiErrorMessage(e, "Could not load screen monitoring.")); })
      .finally(() => { if (generation.current === request) setLoading(false); });
    return () => { generation.current++; };
  }, [screen.id, onRestoreUniverse]);
  useEffect(() => { setPreview(null); }, [screen.query, universe, frequency, maxAge]);
  const input: ScheduleInput = { screen_id: screen.id, universe, market: ["sp_500", "nasdaq_100", "us_all"].includes(universe) ? "US" : "IN", frequency, enabled: true, max_age_hours: maxAge };
  const previewKey = useRef("");
  previewKey.current = JSON.stringify({ ...input, query: screen.query });
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError(extractApiErrorMessage(e, "The action could not be completed. Try again.")); } finally { setBusy(false); }
  }
  async function dossier(symbol: string) {
    const saved = await createDossier({ ...emptyDossier(), title: `${symbol}: ${screen.name}`, symbol, market: input.market, thesis: `Research candidate from ${screen.name}. Screening is a starting point; review the evidence before forming a thesis.` });
    setCreatedDossierId(saved.id);
    setNotice(`Research dossier created for ${symbol}.`);
    return saved;
  }
  return <section className="screen-monitor" aria-label={`Monitoring ${screen.name}`}>
    <div className="screen-monitor-heading"><div><h2>Follow this screen</h2><p>{screen.name}{schedule ? ` · ${schedule.universe}` : ""}{schedule?.last_run_at ? ` · Last checked ${date(schedule.last_run_at)}` : " · No completed checks yet"}</p></div>
      {schedule && <button type="button" disabled={busy || loading} onClick={() => void action(async () => { setSchedule(await runScreenSchedule(schedule.id)); setNotice("Screen check completed."); })}>{busy ? "Working…" : "Check now"}</button>}</div>
    <nav aria-label="Saved screen monitoring views">{([['matches', 'Current matches'], ['changes', 'Changes'], ['schedule', 'Schedule']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {loading && <p role="status">Loading saved checks…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice} {notice.startsWith("Research dossier") && <Link to={`/equity/research-dossiers?id=${encodeURIComponent(createdDossierId)}`}>Open research dossier</Link>}</p>}
    {schedule?.error && <p role="alert">{schedule.error}</p>}
    {!loading && tab !== "schedule" && <>
      {schedule?.coverage && <Coverage value={schedule.coverage} />}{schedule?.refresh && <p>Provider refresh: {schedule.refresh.refreshed} of {schedule.refresh.attempted} attempted companies. Larger universes refresh in rotating batches.</p>}
      {!schedule ? <div className="screen-monitor-empty"><p>Follow changes to this saved screen over time.</p><button type="button" onClick={() => setTab("schedule")}>Preview a schedule</button></div> : !schedule.last_run_at ? <p>Run the first check to establish a baseline. Later checks will explain entries and exits.</p> : tab === "matches" ? <>
        {!schedule.matches.length ? <p>{schedule.coverage?.evaluated ? "No matches among the companies checked." : "No companies could be evaluated. Review data coverage before drawing conclusions."}</p> : <div className="screen-monitor-table screen-monitor-matches"><table aria-label="Monitored screen matches"><thead><tr><th>Company</th><th>Observed measurements</th><th>Observed at</th><th>Research</th></tr></thead><tbody>{schedule.matches.map((match) => <tr key={match.symbol}><th scope="row">{match.symbol}</th><td data-label="Measurements">{Object.entries(match.values).map(([key, value]) => <span className="screen-monitor-value" key={key}>{key.replace(/_/g, " ")}: <strong>{number(value)}</strong></span>)}</td><td data-label="Observed at">{date(match.observed_at)}<small className="screen-monitor-source">{match.source}</small></td><td data-label="Research"><button type="button" disabled={busy} onClick={() => void action(async () => { await dossier(match.symbol); })}>Create dossier</button></td></tr>)}</tbody></table></div>}
      </> : <>
        <ScreenChangesChart changes={schedule.changes} />{!schedule.changes.length ? <p>{schedule.baseline ? "Baseline established. Future checks will identify companies entering or leaving this screen." : "No membership changes were found in the companies checked."}</p> : <div className="screen-monitor-changes">{schedule.changes.map((change) => <article key={change.id}><div className="screen-monitor-heading"><h3>{change.symbol} <span>{change.kind === "entered" ? "entered" : "exited"} this screen</span></h3><time dateTime={change.observed_at}>{date(change.observed_at)}</time></div><p>Conditions: {change.rules.join("; ")}</p><ScreenMetricChangeChart change={change} /><div className="screen-monitor-table"><table aria-label={`Measurements for ${change.symbol}`}><thead><tr><th>Metric</th><th>Previous</th><th>Current</th></tr></thead><tbody>{screenMetricComparisons(change).map(({metric, before, after}) => <tr key={metric}><th scope="row">{screenMetricMeta(metric).label}</th><td>{screenMetricValue(before, metric)}</td><td>{screenMetricValue(after, metric)}</td></tr>)}</tbody></table></div><p>{change.source} · Observed {date(change.data_observed_at)}</p><button type="button" disabled={busy} onClick={() => void action(async () => { await dossier(change.symbol); })}>Create dossier</button></article>)}</div>}
      </>}
    </>}
    {tab === "schedule" && <div className="screen-monitor-schedule"><p>Check your saved conditions against available provider snapshots. Changes appear in your research inbox. The app must be running for scheduled checks.</p>
      <p><strong>Saved query:</strong> {screen.query}</p><p><strong>Universe:</strong> {universe}</p>
      <div className="screen-monitor-fields"><label>Check frequency<select disabled={busy || loading} value={frequency} onChange={(e) => setFrequency(e.target.value as "daily" | "weekly")}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label><label>Maximum observation age<select disabled={busy || loading} value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))}><option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option></select></label></div>
      <p>Numerical comparisons joined by AND/OR are supported. Display sorting and LIMIT do not restrict membership. Unsupported or unavailable metrics are explained in the preview.</p>
      <div className="screen-monitor-actions"><button type="button" disabled={busy || loading} onClick={() => void action(async () => { const key = previewKey.current; const result = await previewScreenSchedule(input); if (key === previewKey.current) setPreview(result); })}>Preview coverage</button>
      {schedule && <button type="button" disabled={busy || loading} onClick={() => void action(async () => { setSchedule(await patchScreenSchedule(schedule.id, { enabled: !schedule.enabled })); setNotice(schedule.enabled ? "Schedule paused." : "Schedule resumed."); })}>{schedule.enabled ? "Pause schedule" : "Resume schedule"}</button>}</div>
      {preview && <div className="screen-monitor-preview"><h3>Schedule preview</h3><Coverage value={preview.coverage} /><p>{preview.matches.length} current matches · {frequency} · {preview.delivery}</p><p>{preview.data_policy}</p><button type="button" disabled={busy} onClick={() => void action(async () => { setSchedule(await saveScreenSchedule(input)); setPreview(null); setNotice("Schedule enabled. The first check establishes your baseline."); })}>Enable {frequency} checks</button></div>}
      {schedule && <p>{schedule.enabled ? `Next check: ${date(schedule.next_run_at)}` : "Schedule paused. You can still check manually."}</p>}
    </div>}
  </section>;
}
