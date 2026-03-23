import { useState } from "react";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalButton } from "../terminal/TerminalButton";

export function SIPCalculator() {
  const [monthlyAmount, setMonthlyAmount] = useState(5000);
  const [years, setYears] = useState(10);
  const [expectedReturn, setExpectedReturn] = useState(12);
  const [totalValue, setTotalValue] = useState(0);

  const calculateSIP = () => {
    const i = expectedReturn / 100 / 12;
    const n = years * 12;
    const futureValue = monthlyAmount * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
    setTotalValue(Math.round(futureValue));
  };

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="mb-4 text-sm font-semibold uppercase tracking-wide text-terminal-accent">SIP Calculator</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-[11px] uppercase text-terminal-muted">Monthly SIP Amount</label>
          <TerminalInput
            type="number"
            value={monthlyAmount}
            onChange={(e) => setMonthlyAmount(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase text-terminal-muted">Investment Period (Years)</label>
          <TerminalInput
            type="number"
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase text-terminal-muted">Expected Return (%)</label>
          <TerminalInput
            type="number"
            value={expectedReturn}
            onChange={(e) => setExpectedReturn(Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <TerminalButton onClick={calculateSIP} variant="accent">Calculate</TerminalButton>
        <div className="text-right">
          <div className="text-[11px] uppercase text-terminal-muted">Estimated Future Value</div>
          <div className="text-xl font-bold text-terminal-pos">INR {totalValue.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}
