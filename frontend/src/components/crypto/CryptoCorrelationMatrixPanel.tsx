export type CryptoCorrelationData = {
  symbols: string[];
  matrix: number[][];
};

function cellClass(value: number): string {
  if (value >= 0.7) return "bg-terminal-pos/20 text-terminal-pos";
  if (value >= 0.3) return "bg-terminal-pos/10 text-terminal-text";
  if (value <= -0.7) return "bg-terminal-neg/20 text-terminal-neg";
  if (value <= -0.3) return "bg-terminal-neg/10 text-terminal-text";
  return "bg-terminal-bg text-terminal-muted";
}

export function CryptoCorrelationMatrixPanel({ data }: { data: CryptoCorrelationData }) {
  const symbols = data.symbols || [];
  const matrix = data.matrix || [];

  return (
    <div className="overflow-auto" data-testid="crypto-correlation-panel">
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <thead>
          <tr>
            <th className="border border-terminal-border p-2 text-left text-terminal-muted">Pair</th>
            {symbols.map((symbol) => (
              <th key={symbol} className="border border-terminal-border p-2 text-right text-terminal-muted">
                {symbol.replace("-USD", "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((left, i) => (
            <tr key={left}>
              <td className="border border-terminal-border p-2 text-terminal-accent">{left.replace("-USD", "")}</td>
              {symbols.map((right, j) => {
                const value = Number(matrix[i]?.[j] ?? 0);
                return (
                  <td
                    key={`${left}-${right}`}
                    className={`border border-terminal-border p-2 text-right ${cellClass(value)}`}
                    data-testid={`corr-cell-${i}-${j}`}
                  >
                    {value.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
