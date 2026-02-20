type Props = {
  rows: Array<Record<string, string | number | null>>;
};

export function ScreenerResults({ rows }: Props) {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold">Screener Results ({rows.length})</div>
      {rows.length === 0 && (
        <div className="mb-2 rounded border border-terminal-border/50 bg-terminal-bg p-2 text-xs text-terminal-muted">
          No companies matched this filter set. Adjust rules and run again.
        </div>
      )}
      <div className="max-h-[480px] overflow-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-terminal-border text-terminal-muted">
              {columns.map((col) => (
                <th key={col} className="px-2 py-1 text-left">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-terminal-border/50">
                {columns.map((col) => (
                  <td key={col} className="px-2 py-1">
                    {typeof row[col] === "number" ? (row[col] as number).toFixed(2) : String(row[col] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
