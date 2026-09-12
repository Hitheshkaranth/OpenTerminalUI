import { useEffect, useState } from "react";
import { api } from "../../api/base";

type Operation = { name: string; description: string; input_schema: Record<string, unknown> };
type Result = {
  operation: string;
  records: Record<string, unknown>[];
  data: unknown;
  status: string;
  error?: string;
  source_url?: string;
};

export function FXMacroDataExplorer() {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [name, setName] = useState("data_catalogue");
  const [argumentsText, setArgumentsText] = useState('{"currency":"USD"}');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    api.get<Operation[]>("/economics/operations").then(({ data }) => setOperations(data))
      .catch(() => setError("Operation catalogue is unavailable."));
  }, []);
  const selected = operations.find(operation => operation.name === name);
  const columns = [...new Set((result?.records || []).flatMap(record => Object.keys(record)))];
  async function query() {
    setError(""); setResult(null); setLoading(true);
    try {
      const args: unknown = JSON.parse(argumentsText);
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("object required");
      const { data } = await api.post<Result>("/economics/query", { operation: name, arguments: args });
      setResult(data);
    } catch {
      setError("Request unavailable. Check the JSON parameters and operation schema.");
    } finally { setLoading(false); }
  }
  return <section className="flex flex-col gap-3" aria-label="FXMacroData explorer">
    <label>Operation <select aria-label="FXMacroData operation" value={name}
      onChange={event => setName(event.target.value)} className="bg-terminal-panel">
      {operations.map(operation => <option key={operation.name}>{operation.name}</option>)}
    </select></label>
    <p>{selected?.description}</p>
    <details><summary>Parameter schema</summary><pre className="whitespace-pre-wrap">{JSON.stringify(selected?.input_schema, null, 2)}</pre></details>
    <label>JSON parameters <textarea aria-label="FXMacroData parameters" value={argumentsText}
      onChange={event => setArgumentsText(event.target.value)} className="block w-full bg-terminal-panel p-2" rows={5} /></label>
    <button disabled={loading} onClick={query} className="self-start border px-3 py-1">{loading ? "Loading…" : "Run query"}</button>
    {(error || result?.error) && <p role="alert">{error || result?.error}</p>}
    {result && <>
      <p>{result.records.length} records · {result.status}</p>
      <div className="overflow-auto"><table><thead><tr>{columns.map(column => <th key={column} className="p-2">{column}</th>)}</tr></thead>
        <tbody>{result.records.map((row, index) => <tr key={index}>{columns.map(column => <td key={column} className="max-w-xs break-words p-2">{typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div>
      <details><summary>Complete response</summary><pre className="whitespace-pre-wrap">{JSON.stringify(result.data, null, 2)}</pre></details>
    </>}
  </section>;
}
