export function RollingReturns() {
  const data = [
    { scheme: "HDFC Top 100", r1y: "12.4", r3y: "14.2", volatility: "15.1" },
    { scheme: "ICICI Bluechip", r1y: "11.8", r3y: "13.9", volatility: "14.5" },
    { scheme: "SBI Bluechip", r1y: "13.2", r3y: "15.1", volatility: "16.2" },
    { scheme: "Parag Parikh Flexi", r1y: "15.1", r3y: "17.3", volatility: "13.8" },
    { scheme: "Mirae Asset Large", r1y: "14.6", r3y: "16.5", volatility: "14.9" },
  ];

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="mb-4 text-sm font-semibold uppercase tracking-wide text-terminal-accent">Rolling Returns Analysis</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-terminal-border text-left text-[10px] uppercase text-terminal-muted">
            <th className="px-2 py-1">Scheme Name</th>
            <th className="px-2 py-1 text-right">1Y Rolling</th>
            <th className="px-2 py-1 text-right">3Y Rolling</th>
            <th className="px-2 py-1 text-right">Volatility</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.scheme} className="border-b border-terminal-border/30 hover:bg-terminal-accent/5">
              <td className="px-2 py-1 text-terminal-text">{r.scheme}</td>
              <td className="px-2 py-1 text-right text-green-400">{r.r1y}%</td>
              <td className="px-2 py-1 text-right text-green-400">{r.r3y}%</td>
              <td className="px-2 py-1 text-right text-yellow-400">{r.volatility}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
