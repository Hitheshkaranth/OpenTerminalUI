import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, extractApiErrorMessage } from "../../api/base";
import { downloadJson } from "../../lib/downloadJson";

type Experiment = { id: string; title: string; symbol: string; sha256: string; created_at: string };
type FrozenBar = { date: string; available_at: string; open: number; high: number; low: number; close: number; volume: number };
type PeriodResult = { total_return?: number; max_drawdown?: number; trades?: unknown[]; bars?: number };
type Results = { training?: PeriodResult; validation?: PeriodResult };
type ExperimentSnapshot = {
  id: string; sha256: string; data_sha256: string; created_at: string;
  request: { title: string; symbol: string; provider: string; data_version: string; adjustment_policy: string;
    as_of: string; train_end: string; validation_start: string; short_window: number; long_window: number;
    fee_bps: number; slippage_bps: number; bars: FrozenBar[] };
  results: Results; limitations?: string[];
};
type Replay = { id: string; matches: boolean; results: Results; provider_requests: number };
const percent = (value?: number) => typeof value === "number" && Number.isFinite(value)
  ? new Intl.NumberFormat(undefined, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  : "Not recorded";
const timestamp = (value?: string) => value ? value.replace("T", " ").replace(/(?:\.000)?(?:Z|\+00:00)$/, " UTC") : "Not recorded";

function ResultTable({ results, caption }: { results: Results; caption: string }) {
  return <div className="mt-3 overflow-x-auto rounded border border-terminal-border">
    <table className="w-full text-sm">
      <caption className="px-3 py-3 text-left font-semibold">{caption}</caption>
      <thead className="border-y border-terminal-border bg-terminal-panel"><tr>
        <th scope="col" className="px-3 py-2 text-left font-medium">Period</th>
        {["Total return", "Maximum drawdown", "Executed trades", "Price bars"].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">{label}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-terminal-border">{(["training", "validation"] as const).map((period) => {
        const result = results[period];
        return <tr key={period}><th scope="row" className="px-3 py-3 text-left font-medium">{period === "training" ? "Training" : "Validation"}</th>
          <td className="px-3 py-3 text-right tabular-nums">{percent(result?.total_return)}</td>
          <td className="px-3 py-3 text-right tabular-nums">{percent(result?.max_drawdown)}</td>
          <td className="px-3 py-3 text-right tabular-nums">{result?.trades?.length ?? "Not recorded"}</td>
          <td className="px-3 py-3 text-right tabular-nums">{result?.bars ?? "Not recorded"}</td></tr>;
      })}</tbody>
    </table>
  </div>;
}

function SavedResults({ snapshot, replay }: { snapshot: ExperimentSnapshot; replay?: Replay }) {
  const request = snapshot.request;
  const first = request.bars?.[0]?.date;
  const last = request.bars?.[request.bars.length - 1]?.date;
  return <div className="mt-4 border-t border-terminal-border pt-4">
    <h4 className="text-base font-semibold">{request.title}</h4>
    <p className="mt-1 text-sm text-terminal-muted">{request.symbol} · Moving-average crossover ({request.short_window} / {request.long_window})</p>
    <ResultTable results={snapshot.results} caption="Saved training and validation results" />
    <p className="mt-2 max-w-prose text-xs text-terminal-muted">Returns include the saved fees and slippage. Executed trades count individual buys and sells, not completed round trips. Validation uses fixed parameters and a separate starting portfolio.</p>
    {replay && <p role="status" className="mt-3 text-sm">{replay.matches ? "Replay matched the saved results." : "Replay differs from the saved results. Compare the recomputed values below."} Provider requests: {replay.provider_requests}.</p>}
    {replay && !replay.matches && <ResultTable results={replay.results} caption="Recomputed replay results" />}
    <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {[
        ["Data source", request.provider], ["Source version", request.data_version],
        ["Data known by", timestamp(request.as_of)], ["Price adjustment", request.adjustment_policy.replace(/_/g, " ")],
        ["Frozen data range", `${timestamp(first)} to ${timestamp(last)}`],
        ["Training ends", timestamp(request.train_end)], ["Validation starts", timestamp(request.validation_start)],
        ["Simulation costs", `${request.fee_bps} bps fees + ${request.slippage_bps} bps slippage`],
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-terminal-muted">{label}</dt><dd className="mt-1 break-words">{value || "Not recorded"}</dd></div>)}
    </dl>
    <details className="mt-4 text-sm"><summary className="cursor-pointer rounded py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-accent">Snapshot provenance and limitations</summary>
      <dl className="space-y-2 py-2 text-xs"><div><dt>Experiment SHA-256</dt><dd className="break-all">{snapshot.sha256}</dd></div><div><dt>Price data SHA-256</dt><dd className="break-all">{snapshot.data_sha256}</dd></div></dl>
      <ul className="list-disc space-y-1 pl-5 text-sm">{snapshot.limitations?.map((text) => <li key={text}>{text}</li>)}</ul>
    </details>
  </div>;
}

export function experimentError(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (!Array.isArray(detail)) return extractApiErrorMessage(error, "Experiment failed.");
  const rows = new Set<number>();
  const messages = new Set<string>();
  for (const entry of detail) {
    if (!entry || typeof entry !== "object") continue;
    const issue = entry as { loc?: unknown[]; msg?: string };
    const barIndex = Array.isArray(issue.loc) ? issue.loc.indexOf("bars") : -1;
    const row = barIndex >= 0 ? issue.loc?.[barIndex + 1] : undefined;
    if (typeof row === "number") rows.add(row);
    if (typeof issue.msg === "string") messages.add(issue.msg.replace(/^Value error, /, "").slice(0, 200));
  }
  const summary = Array.from(messages).slice(0, 3).join("; ");
  const availability = Array.from(messages).some((message) => message.includes("not available at its decision timestamp"));
  return `${rows.size ? `${rows.size} price-bar ${rows.size === 1 ? "row needs" : "rows need"} attention. ` : "Check experiment inputs. "}${summary || "Some fields are invalid."}${messages.size > 3 ? ` (${messages.size - 3} more validation issues.)` : ""}${availability ? " Each available_at must be at or before date, the completed bar’s decision time. Verify both timestamps with your source; do not guess missing publication times." : ""}`;
}

export function parseFrozenBars(csv: string): FrozenBar[] {
  const rows = csv.trim().split(/\r?\n/).filter((line) => line.trim());
  const headers = rows.shift()?.split(",").map((s) => s.trim().toLowerCase()) || [];
  const required = ["date", "available_at", "open", "high", "low", "close", "volume"];
  if (!required.every((h) => headers.includes(h))) throw new Error(`CSV columns required: ${required.join(", ")}`);
  if (rows.length < 10 || rows.length > 20000) throw new Error("Provide between 10 and 20,000 price bars.");
  return rows.map((line, index) => {
    const values = line.split(",").map((s) => s.trim());
    const row = Object.fromEntries(required.map((key) => [key, values[headers.indexOf(key)]]));
    if (!row.date || !row.available_at || !/[zZ]|[+-]\d{2}:\d{2}$/.test(row.date) || !/[zZ]|[+-]\d{2}:\d{2}$/.test(row.available_at)) throw new Error(`Row ${index + 2}: timestamps must include a timezone.`);
    const numbers = Object.fromEntries(required.slice(2).map((key) => [key, row[key] === "" || row[key] === undefined ? NaN : Number(row[key])]));
    if (Object.values(numbers).some((n) => !Number.isFinite(n))) throw new Error(`Row ${index + 2}: price or volume is missing or invalid.`);
    return { date: row.date, available_at: row.available_at, ...numbers } as FrozenBar;
  });
}

export function ResearchExperiments({ dossierId, symbol }: { dossierId: string; symbol: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["research-experiments", dossierId], queryFn: async () => (await api.get<{ items: Experiment[] }>("/research/experiments", { params: { dossier_id: dossierId } })).data.items });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replay, setReplay] = useState<Replay>();
  const snapshot = useQuery({ queryKey: ["research-experiment", dossierId, selectedId], enabled: Boolean(selectedId), staleTime: Infinity,
    queryFn: async () => (await api.get<ExperimentSnapshot>(`/research/experiments/${encodeURIComponent(selectedId!)}`)).data });
  const selectSnapshot = (data: ExperimentSnapshot) => {
    client.setQueryData(["research-experiment", dossierId, data.id], data);
    setSelectedId(data.id);
  };
  const [bars, setBars] = useState<FrozenBar[]>([]);
  const [form, setForm] = useState({ title: `${symbol} moving-average experiment`, provider: "", data_version: "", adjustment_policy: "raw", as_of: "", train_end: "", validation_start: "", short_window: 20, long_window: 50, fee_bps: 5, slippage_bps: 5 });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const act = async (fn: () => Promise<void>) => { setBusy(true); setNotice(""); try { await fn(); } catch (e) { setNotice(experimentError(e)); } finally { setBusy(false); } };
  const input = "block w-full rounded border border-terminal-border bg-terminal-bg p-2 text-sm";
  const utcEnd = (date: string) => `${date}T23:59:59Z`;
  return <section className="mt-6 border-t border-terminal-border pt-5" style={{ fontFamily: "var(--ot-font-ui)" }}><h3 className="font-semibold">Reproducible experiments</h3><p className="mt-1 text-sm text-terminal-muted">Freeze price bars and costs, test a fixed moving-average strategy, then replay without fetching new data.</p>
    {notice && <p role="status" className="my-3 text-sm">{notice}</p>}
    {query.isError && <p role="alert" className="text-sm">Unable to load experiments.</p>}
    {query.isPending && <p role="status" className="py-3 text-sm text-terminal-muted">Loading saved experiments…</p>}
    {query.data?.length === 0 && <p className="py-3 text-sm text-terminal-muted">Create an experiment to compare training and validation on frozen price data.</p>}
    <ul className="divide-y divide-terminal-border">{query.data?.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><strong>{item.title}</strong><p className="text-xs text-terminal-muted">Saved {new Date(item.created_at).toLocaleDateString()}</p></div><div className="flex flex-wrap gap-2">
      <button disabled={busy} aria-label={`View results for ${item.title}`} aria-pressed={selectedId === item.id} className="rounded border border-terminal-border p-2 hover:bg-terminal-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-accent" onClick={() => { setSelectedId(item.id); setReplay(undefined); }}>View results</button>
      <button disabled={busy} className="rounded border border-terminal-border p-2" onClick={() => void act(async () => { setSelectedId(item.id); setReplay(undefined); const { data } = await api.post<Replay>(`/research/experiments/${item.id}/replay`); const saved = (await api.get<ExperimentSnapshot>(`/research/experiments/${item.id}`)).data; selectSnapshot(saved); setReplay(data); })}>Replay experiment</button>
      <button disabled={busy} className="rounded border border-terminal-border p-2" onClick={() => void act(async () => downloadJson((await api.get(`/research/experiments/${item.id}`)).data, `${symbol}-experiment.json`))}>Export experiment</button>
    </div></li>)}</ul>
    {selectedId && snapshot.isPending && <div role="status" className="mt-4 border-t border-terminal-border py-4 text-sm">Loading saved results and source details…</div>}
    {selectedId && snapshot.isError && <div role="alert" className="mt-4 py-3 text-sm"><p>Unable to load this experiment’s saved results.</p><button className="mt-2 rounded border border-terminal-border px-3 py-2" onClick={() => void snapshot.refetch()}>Retry results</button></div>}
    {snapshot.data && <SavedResults snapshot={snapshot.data} replay={replay?.id === snapshot.data.id ? replay : undefined} />}
    <details className="mt-3 rounded border border-terminal-border p-3"><summary className="cursor-pointer text-sm">Create frozen-data experiment</summary><form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void act(async () => {
      const asOf = new Date(Math.min(new Date(utcEnd(form.as_of)).getTime(), Date.now())).toISOString();
      const { data } = await api.post<ExperimentSnapshot>("/research/experiments", { ...form, dossier_id: dossierId, symbol, bars, as_of: asOf, train_end: utcEnd(form.train_end), validation_start: `${form.validation_start}T00:00:00Z` });
      selectSnapshot(data); setReplay(undefined);
      await client.invalidateQueries({ queryKey: ["research-experiments", dossierId] }); setNotice("Experiment saved with separate training and validation results.");
    }); }}>
      <label className="block text-sm">Price bars CSV<input required type="file" accept=".csv,text/csv" className={input} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 8_000_000) throw new Error("CSV must be smaller than 8 MB."); setBars(parseFrozenBars(await file.text())); setNotice(""); } catch (error) { setBars([]); setNotice((error as Error).message); } }} /></label>
      <p className="text-xs text-terminal-muted">Columns: date, available_at, open, high, low, close, volume. Use timezone-qualified timestamps at the completed bar’s decision time. Publication times and adjustment policy must come from your source; they are not inferred.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {([['title', 'Experiment title'], ['provider', 'Data source'], ['data_version', 'Source version or snapshot ID']] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input required className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
        <label className="text-sm">Price adjustment<select aria-label="Price adjustment" className={input} value={form.adjustment_policy} onChange={(e) => setForm({ ...form, adjustment_policy: e.target.value })}><option value="raw">Raw prices</option><option value="split_adjusted">Split adjusted</option><option value="total_return_adjusted">Total return adjusted</option></select></label>
        {([['as_of', 'Data known by (UTC)'], ['train_end', 'Training ends (UTC)'], ['validation_start', 'Validation starts (UTC)']] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input required type="date" className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
        {([['short_window', 'Short moving average'], ['long_window', 'Long moving average'], ['fee_bps', 'Fees (basis points)'], ['slippage_bps', 'Slippage (basis points)']] as const).map(([key, label]) => <label key={key} className="text-sm">{label}<input required type="number" min={key.includes("window") ? 1 : 0} max={1000} className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} /></label>)}
      </div>
      <button disabled={busy || !bars.length} className="rounded border border-terminal-border px-3 py-2 text-sm">{busy ? "Running…" : `Freeze and test ${bars.length} bars`}</button>
    </form></details>
  </section>;
}
