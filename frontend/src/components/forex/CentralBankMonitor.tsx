export type CentralBankEntry = {
  currency: string;
  bank: string;
  policy_rate: number;
  last_decision_date: string;
  next_decision_date: string | null;
  last_action: string;
  last_change_bps: number;
  days_since_last_decision: number;
  days_until_next_decision: number | null;
  decision_cycle: string;
};

type Props = {
  banks: CentralBankEntry[];
  loading?: boolean;
  snapshotAsOf?: string | null;
  stale?: boolean;
};

function toneForDays(daysUntil: number): string {
  if (daysUntil <= 7) return "text-terminal-warn";
  if (daysUntil <= 21) return "text-terminal-accent";
  return "text-terminal-muted";
}

export function CentralBankMonitor({ banks, loading = false, snapshotAsOf = null, stale = false }: Props) {
  return (
    <div className="overflow-x-auto">
      {snapshotAsOf ? (
        <div className={`mb-2 px-3 text-[11px] ${stale ? "text-terminal-warn" : "text-terminal-muted"}`}>
          Static snapshot as of {snapshotAsOf}
          {stale ? " — stale, rates may have changed since" : ""}
        </div>
      ) : null}
      <table className="min-w-full text-xs">
        <thead className="bg-terminal-bg/40 text-[10px] uppercase tracking-[0.16em] text-terminal-muted">
          <tr>
            <th className="px-3 py-2 text-left">Bank</th>
            <th className="px-3 py-2 text-right">Rate</th>
            <th className="px-3 py-2 text-left">Last Action</th>
            <th className="px-3 py-2 text-left">Next Decision</th>
            <th className="px-3 py-2 text-right">Cycle</th>
          </tr>
        </thead>
        <tbody>
          {banks.map((bank) => (
            <tr key={`${bank.currency}:${bank.bank}`} className="border-t border-terminal-border/70">
              <td className="px-3 py-2">
                <div className="font-medium text-terminal-text">{bank.bank}</div>
                <div className="text-[11px] text-terminal-muted">{bank.currency}</div>
              </td>
              <td className="px-3 py-2 text-right ot-type-data text-terminal-text">{bank.policy_rate.toFixed(2)}%</td>
              <td className="px-3 py-2">
                <div className="text-terminal-text">{bank.last_action}</div>
                <div className="text-[11px] text-terminal-muted">
                  {bank.last_change_bps >= 0 ? "+" : ""}{bank.last_change_bps} bps on {bank.last_decision_date}
                </div>
              </td>
              <td className="px-3 py-2">
                {bank.next_decision_date && bank.days_until_next_decision != null && bank.days_until_next_decision >= 0 ? (
                  <>
                    <div className={toneForDays(bank.days_until_next_decision)}>{bank.next_decision_date}</div>
                    <div className="text-[11px] text-terminal-muted">{bank.days_until_next_decision}d remaining</div>
                  </>
                ) : (
                  <div className="text-terminal-muted">—</div>
                )}
              </td>
              <td className="px-3 py-2 text-right text-terminal-muted">{bank.decision_cycle}</td>
            </tr>
          ))}
          {!banks.length && !loading ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-terminal-muted">
                No central bank data available.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
