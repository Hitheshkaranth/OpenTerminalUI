type ScorecardGridProps = {
  labels: string[];
  components: number[];
};

export function ScorecardGrid({ labels, components }: ScorecardGridProps) {
  return (
    <div className="grid grid-cols-3 gap-1 text-xs">
      {labels.map((label, index) => {
        const ok = components[index] === 1;
        return (
          <div key={label} className={`rounded border p-2 ${ok ? "border-terminal-pos text-terminal-pos" : "border-terminal-neg text-terminal-neg"}`}>
            <div>{label}</div>
            <div>{ok ? "PASS" : "FAIL"}</div>
          </div>
        );
      })}
    </div>
  );
}
