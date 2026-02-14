import { useState } from "react";

import { executePython } from "../../api/client";
import type { PythonExecuteResponse } from "../../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function PythonLabWidget() {
  const [code, setCode] = useState("print('hello from Python Lab')\nresult = [{'col': 'A', 'value': 1}, {'col': 'B', 'value': 2}]");
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<PythonExecuteResponse | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const out = await executePython({ code, timeout_seconds: 2 });
      setResponse(out);
    } catch (err) {
      setResponse({ stdout: "", stderr: String(err), result: null, timed_out: false });
    } finally {
      setRunning(false);
    }
  };

  const rows = Array.isArray(response?.result) ? response?.result : [];
  const first = rows.length > 0 && isRecord(rows[0]) ? rows[0] : null;
  const cols = first ? Object.keys(first) : [];

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-terminal-accent">Python Lab</div>
        <button
          className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-accent disabled:opacity-50"
          onClick={() => {
            void run();
          }}
          disabled={running}
        >
          {running ? "Running..." : "Run"}
        </button>
      </div>
      <textarea
        className="h-40 w-full rounded border border-terminal-border bg-terminal-bg p-2 text-xs text-terminal-text outline-none focus:border-terminal-accent"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
      />
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded border border-terminal-border bg-terminal-bg p-2">
          <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Console</div>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs text-terminal-text">
            {response?.stdout || "(no stdout)"}
          </pre>
          {response?.stderr ? <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-xs text-terminal-neg">{response.stderr}</pre> : null}
        </div>
        <div className="rounded border border-terminal-border bg-terminal-bg p-2">
          <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Dataframe Preview</div>
          {cols.length ? (
            <div className="mt-2 overflow-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    {cols.map((col) => (
                      <th key={col} className="border-b border-terminal-border px-2 py-1 text-left text-terminal-muted">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((row, idx) => (
                    <tr key={idx}>
                      {cols.map((col) => (
                        <td key={col} className="border-b border-terminal-border/50 px-2 py-1">
                          {isRecord(row) ? String(row[col] ?? "") : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap text-xs text-terminal-text">{JSON.stringify(response?.result ?? null, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
