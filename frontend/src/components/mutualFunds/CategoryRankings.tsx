export function CategoryRankings() {
  const data = [
    { category: "Large Cap", rank1: "HDFC Top 100", rank2: "ICICI Bluechip", rank3: "SBI Bluechip", avgReturn: "14.5" },
    { category: "Mid Cap", rank1: "HDFC Mid-Cap", rank2: "Kotak Emerging", rank3: "Axis Midcap", avgReturn: "18.2" },
    { category: "Small Cap", rank1: "Nippon Small Cap", rank2: "SBI Small Cap", rank3: "HDFC Small Cap", avgReturn: "22.1" },
    { category: "Flexi Cap", rank1: "Parag Parikh", rank2: "UTI Flexi Cap", rank3: "HDFC Flexi Cap", avgReturn: "16.8" },
    { category: "ELSS", rank1: "Mirae Asset Tax", rank2: "Axis Long Term", rank3: "DSP Tax Saver", avgReturn: "15.3" },
  ];

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="mb-4 text-sm font-semibold uppercase tracking-wide text-terminal-accent">Category Rankings</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-terminal-border text-left text-[10px] uppercase text-terminal-muted">
            <th className="px-2 py-1">Category</th>
            <th className="px-2 py-1">Rank 1</th>
            <th className="px-2 py-1">Rank 2</th>
            <th className="px-2 py-1">Rank 3</th>
            <th className="px-2 py-1 text-right">Avg Return</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.category} className="border-b border-terminal-border/30 hover:bg-terminal-accent/5">
              <td className="px-2 py-1 font-semibold text-terminal-text">{r.category}</td>
              <td className="px-2 py-1 text-terminal-accent">{r.rank1}</td>
              <td className="px-2 py-1 text-terminal-muted">{r.rank2}</td>
              <td className="px-2 py-1 text-terminal-muted">{r.rank3}</td>
              <td className="px-2 py-1 text-right text-green-400">{r.avgReturn}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
