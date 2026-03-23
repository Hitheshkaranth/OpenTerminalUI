export function FundOverlap() {
  const data = [
    { stock: "HDFC Bank", fundA: "9.5", fundB: "8.2", overlap: "8.2" },
    { stock: "ICICI Bank", fundA: "7.2", fundB: "6.5", overlap: "6.5" },
    { stock: "Reliance Ind", fundA: "5.4", fundB: "5.8", overlap: "5.4" },
    { stock: "Infosys", fundA: "4.8", fundB: "4.1", overlap: "4.1" },
    { stock: "TCS", fundA: "3.9", fundB: "3.5", overlap: "3.5" },
  ];

  const totalOverlap = data.reduce((sum, d) => sum + parseFloat(d.overlap), 0).toFixed(1);

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="mb-4 text-sm font-semibold uppercase tracking-wide text-terminal-accent">Fund Overlap Analysis</div>
      <div className="mb-2 text-[11px] text-terminal-muted">
        Comparing Fund A vs Fund B: <span className="text-terminal-accent font-semibold">{totalOverlap}%</span> Total Overlap
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-terminal-border text-left text-[10px] uppercase text-terminal-muted">
            <th className="px-2 py-1">Common Stock</th>
            <th className="px-2 py-1 text-right">Fund A (%)</th>
            <th className="px-2 py-1 text-right">Fund B (%)</th>
            <th className="px-2 py-1 text-right">Overlap</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.stock} className="border-b border-terminal-border/30 hover:bg-terminal-accent/5">
              <td className="px-2 py-1 text-terminal-text">{r.stock}</td>
              <td className="px-2 py-1 text-right text-terminal-muted">{r.fundA}</td>
              <td className="px-2 py-1 text-right text-terminal-muted">{r.fundB}</td>
              <td className="px-2 py-1 text-right text-terminal-accent">{r.overlap}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
