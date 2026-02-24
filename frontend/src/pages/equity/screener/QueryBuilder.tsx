import { useState } from "react";

import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

const FIELD_OPTIONS = ["Market Capitalization", "ROE", "ROCE", "PE", "Debt to equity", "Revenue Growth", "Promoter holding", "RSI"];
const OP_OPTIONS = [">", ">=", "<", "<=", "=", "!="];

export function QueryBuilder() {
  const { setQuery, run } = useScreenerContext();
  const [rows, setRows] = useState<Array<{ field: string; op: string; value: string }>>([{ field: "Market Capitalization", op: ">", value: "500" }]);

  function syncQuery(nextRows: Array<{ field: string; op: string; value: string }>) {
    const expression = nextRows.filter((row) => row.field && row.op && row.value).map((row) => `${row.field} ${row.op} ${row.value}`).join(" AND ");
    setQuery(expression);
  }

  return (
    <TerminalPanel title="Query Builder" subtitle="GUI Filters" bodyClassName="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_90px_1fr_80px] gap-1">
          <TerminalInput as="select" value={row.field} onChange={(event) => {
            const next = [...rows];
            next[index] = { ...next[index], field: event.target.value };
            setRows(next);
            syncQuery(next);
          }}>{FIELD_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</TerminalInput>
          <TerminalInput as="select" value={row.op} onChange={(event) => {
            const next = [...rows];
            next[index] = { ...next[index], op: event.target.value };
            setRows(next);
            syncQuery(next);
          }}>{OP_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</TerminalInput>
          <TerminalInput value={row.value} onChange={(event) => {
            const next = [...rows];
            next[index] = { ...next[index], value: event.target.value };
            setRows(next);
            syncQuery(next);
          }} />
          <TerminalButton variant="danger" onClick={() => {
            const next = rows.filter((_, idx) => idx !== index);
            setRows(next);
            syncQuery(next);
          }}>Remove</TerminalButton>
        </div>
      ))}
      <div className="flex flex-wrap gap-1">
        <TerminalButton onClick={() => {
          const next = [...rows, { field: "ROE", op: ">", value: "15" }];
          setRows(next);
          syncQuery(next);
        }}>Add Row</TerminalButton>
        <TerminalButton variant="accent" onClick={() => void run({ preset_id: null })}>Run Built Query</TerminalButton>
      </div>
    </TerminalPanel>
  );
}
