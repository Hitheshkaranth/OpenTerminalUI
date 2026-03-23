type Props = {
  currencies: string[];
  matrix: number[][];
  selectedPair: string;
  onSelectPair: (pair: string) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toneForRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "bg-terminal-bg text-terminal-muted";
  const magnitude = clamp(Math.abs(Math.log(rate)) / 3, 0, 1);
  if (rate >= 1) {
    return `bg-emerald-500/${Math.round(10 + magnitude * 22)} text-emerald-200`;
  }
  return `bg-rose-500/${Math.round(10 + magnitude * 22)} text-rose-200`;
}

function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "--";
  if (rate >= 100) return rate.toFixed(2);
  if (rate >= 10) return rate.toFixed(3);
  return rate.toFixed(4);
}

export function CrossRatesMatrix({ currencies, matrix, selectedPair, onSelectPair }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-[10px] uppercase tracking-[0.16em] text-terminal-muted">Base</th>
            {currencies.map((currency) => (
              <th key={currency} className="px-2 py-1 text-center text-[10px] uppercase tracking-[0.16em] text-terminal-muted">
                {currency}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {currencies.map((base, rowIndex) => (
            <tr key={base}>
              <th className="px-2 py-2 text-left text-[10px] uppercase tracking-[0.16em] text-terminal-muted">{base}</th>
              {currencies.map((quote, columnIndex) => {
                const rate = Number(matrix[rowIndex]?.[columnIndex] ?? NaN);
                const pair = `${base}${quote}`;
                const selected = pair === selectedPair;
                const diagonal = rowIndex === columnIndex;
                return (
                  <td key={pair}>
                    <button
                      type="button"
                      disabled={diagonal}
                      className={`min-w-[72px] rounded border px-2 py-2 text-right ot-type-data transition ${
                        diagonal
                          ? "cursor-default border-terminal-border bg-terminal-bg/40 text-terminal-muted"
                          : selected
                            ? "border-terminal-accent bg-terminal-accent/14 text-terminal-accent"
                            : `border-terminal-border ${toneForRate(rate)} hover:border-terminal-accent/50`
                      }`}
                      onClick={() => {
                        if (!diagonal) onSelectPair(pair);
                      }}
                    >
                      {diagonal ? "1.0000" : formatRate(rate)}
                    </button>
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
