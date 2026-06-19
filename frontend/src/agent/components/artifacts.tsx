import type * as React from "react";
import type { AgentArtifact } from "../types";

const cell: React.CSSProperties = {
  padding: "var(--ot-space-1) var(--ot-space-2)",
  borderBottom: "1px solid var(--ot-color-border-subtle)",
  fontFamily: "var(--ot-font-data)",
  fontSize: 12,
  color: "var(--ot-color-text-primary)",
  textAlign: "left",
  whiteSpace: "nowrap",
};

function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div style={{ color: "var(--ot-color-text-muted)" }}>No rows.</div>;
  const cols = Object.keys(rows[0]);
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c} style={{ ...cell, color: "var(--ot-color-text-secondary)", fontFamily: "var(--ot-font-ui)" }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c} style={cell}>{r[c] == null ? "—" : String(r[c])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function asRows(data: unknown): Record<string, unknown>[] {
  // screen_stocks returns rows under `results`; compare_stocks under `rows`.
  const d = data as { rows?: unknown[]; results?: unknown[] } | null;
  const rows = d?.rows ?? d?.results;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

type ResearchRow = {
  title?: string;
  authors?: string[];
  url?: string;
  published_at?: string;
  score?: number;
  abstract?: string;
};

function ResearchList({ data }: { data: unknown }) {
  const rows = ((data as { results?: ResearchRow[] })?.results ?? []) as ResearchRow[];
  if (!rows.length) return <div style={{ color: "var(--ot-color-text-muted)" }}>No research found.</div>;
  return (
    <div style={{ display: "grid", gap: "var(--ot-space-2)" }}>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            border: "1px solid var(--ot-color-border-subtle)",
            borderRadius: "var(--ot-radius-sm)",
            padding: "var(--ot-space-2)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--ot-space-2)" }}>
            <a
              href={r.url || "#"}
              target="_blank"
              rel="noreferrer"
              style={{ fontFamily: "var(--ot-font-ui)", fontSize: 12, fontWeight: 600, color: "var(--ot-color-text-primary)" }}
            >
              {r.title || "Untitled"}
            </a>
            {typeof r.score === "number" ? (
              <span style={{ fontFamily: "var(--ot-font-data)", fontSize: 10, color: "var(--ot-color-accent)" }}>
                {r.score.toFixed(3)}
              </span>
            ) : null}
          </div>
          <div style={{ fontFamily: "var(--ot-font-ui)", fontSize: 10, color: "var(--ot-color-text-muted)", marginTop: 2 }}>
            {(r.authors || []).join(", ") || "Unknown authors"}
            {r.published_at ? ` · ${String(r.published_at).slice(0, 10)}` : ""}
          </div>
          {r.abstract ? (
            <p style={{ margin: "var(--ot-space-1) 0 0", fontFamily: "var(--ot-font-data)", fontSize: 11, color: "var(--ot-color-text-secondary)", lineHeight: 1.4 }}>
              {String(r.abstract).slice(0, 280)}
              {String(r.abstract).length > 280 ? "…" : ""}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SnapshotCard({ data }: { data: Record<string, unknown> }) {
  const fields = Object.entries(data).filter(([, v]) => typeof v !== "object");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--ot-space-1) var(--ot-space-3)" }}>
      {fields.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <span style={{ color: "var(--ot-color-text-muted)", fontFamily: "var(--ot-font-ui)", fontSize: 12 }}>{k}</span>
          <span style={{ color: "var(--ot-color-text-primary)", fontFamily: "var(--ot-font-data)", fontSize: 12 }}>
            {v == null ? "—" : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ArtifactView({ artifact }: { artifact: AgentArtifact }) {
  let body: React.ReactNode;
  switch (artifact.kind) {
    case "screener_table":
    case "compare_table":
      body = <RowsTable rows={asRows(artifact.data)} />;
      break;
    case "snapshot_card":
      body = <SnapshotCard data={(artifact.data as Record<string, unknown>) || {}} />;
      break;
    case "research_list":
      body = <ResearchList data={artifact.data} />;
      break;
    default:
      body = (
        <pre style={{ margin: 0, fontFamily: "var(--ot-font-data)", fontSize: 11, color: "var(--ot-color-text-secondary)", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(artifact.data, null, 2)}
        </pre>
      );
  }
  return (
    <section
      style={{
        background: "var(--ot-color-canvas-elevated)",
        border: "1px solid var(--ot-color-border-default)",
        borderRadius: "var(--ot-radius-md)",
        padding: "var(--ot-space-2)",
        overflowX: "auto",
      }}
    >
      <header style={{ fontFamily: "var(--ot-font-ui)", fontSize: 11, color: "var(--ot-color-text-muted)", marginBottom: "var(--ot-space-1)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {artifact.name}
      </header>
      {body}
    </section>
  );
}
