import { useState } from "react";

import { compareGovernanceRuns, promoteGovernanceModel, registerGovernanceRun } from "../api/client";

export function ModelGovernancePage() {
  const [runId, setRunId] = useState("");
  const [dataVersionId, setDataVersionId] = useState("");
  const [codeHash, setCodeHash] = useState("");
  const [compareIds, setCompareIds] = useState("");
  const [compareRows, setCompareRows] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold text-terminal-accent">Model Governance</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" placeholder="Run ID" value={runId} onChange={(e) => setRunId(e.target.value)} />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" placeholder="Data Version ID" value={dataVersionId} onChange={(e) => setDataVersionId(e.target.value)} />
          <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" placeholder="Code Hash" value={codeHash} onChange={(e) => setCodeHash(e.target.value)} />
          <button
            className="rounded border border-terminal-border px-2 py-1 text-xs"
            onClick={async () => {
              await registerGovernanceRun({ run_id: runId, data_version_id: dataVersionId || undefined, code_hash: codeHash || undefined, execution_profile: {} });
              setMessage("Run governance metadata updated");
            }}
          >
            Register Run Meta
          </button>
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-xs font-semibold">Compare Runs</div>
        <div className="flex gap-2">
          <input className="flex-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" placeholder="run1,run2,run3" value={compareIds} onChange={(e) => setCompareIds(e.target.value)} />
          <button
            className="rounded border border-terminal-border px-2 py-1 text-xs"
            onClick={async () => {
              const rows = await compareGovernanceRuns(compareIds.split(",").map((x) => x.trim()).filter(Boolean));
              setCompareRows(rows);
            }}
          >
            Compare
          </button>
        </div>
        <div className="mt-2 space-y-1 text-xs">
          {compareRows.map((r) => (
            <div key={String(r.id)}>
              {String(r.id)} | DV={String(r.data_version_id || "-")} | hash={String(r.code_hash || "-")} | status={String(r.status || "-")}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <button
          className="rounded border border-terminal-accent px-2 py-1 text-xs text-terminal-accent"
          onClick={async () => {
            await promoteGovernanceModel({ registry_name: "default-model", run_id: runId, stage: "staging" });
            setMessage("Model promoted");
          }}
        >
          Promote To Staging
        </button>
        {message && <div className="mt-2 text-xs text-terminal-muted">{message}</div>}
      </div>
    </div>
  );
}
