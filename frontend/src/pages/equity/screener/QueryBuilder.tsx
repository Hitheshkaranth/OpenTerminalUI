import { useState } from "react";

import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

const FIELD_OPTIONS = ["Market Capitalization", "ROE", "ROCE", "PE", "Debt to equity", "Revenue Growth", "Promoter holding", "RSI"];
const OP_OPTIONS = [">", ">=", "<", "<=", "=", "!="];
const COMBINATORS = ["AND", "OR"] as const;

type QueryRow = {
  field: string;
  op: string;
  value: string;
  combinator?: (typeof COMBINATORS)[number];
};

export function QueryBuilder() {
  const { setQuery, run, loading } = useScreenerContext();
  const [rows, setRows] = useState<QueryRow[]>([{ field: "Market Capitalization", op: ">", value: "500", combinator: "AND" }]);
  const [validationError, setValidationError] = useState<string | null>(null);

  function normalizeValue(raw: string): string {
    const trimmed = raw.trim();
    const numeric = Number(trimmed);
    if (trimmed !== "" && Number.isFinite(numeric)) return String(numeric);
    return trimmed;
  }

  function syncQuery(nextRows: QueryRow[]) {
    const activeRows = nextRows.filter((row) => row.field.trim() && row.op.trim() && row.value.trim());
    const expression = activeRows
      .map((row, index) => {
        const clause = `${row.field} ${row.op} ${normalizeValue(row.value)}`;
        if (index === 0) return clause;
        return `${row.combinator || "AND"} ${clause}`;
      })
      .join(" ");
    setQuery(expression);
  }

  function validateRows(nextRows: QueryRow[]): string | null {
    if (!nextRows.length) return "Add at least one filter row";
    for (const row of nextRows) {
      if (!row.field.trim() || !row.op.trim() || !row.value.trim()) {
        return "Every row must include field, operator, and value";
      }
    }
    return null;
  }

  return (
    <TerminalPanel title="Query Builder" subtitle="GUI Filters" bodyClassName="space-y-2">
      {validationError ? <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 px-2 py-1 text-xs text-terminal-neg">{validationError}</div> : null}
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_86px_1fr_78px_84px] gap-1">
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
          <TerminalInput
            as="select"
            value={row.combinator || "AND"}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...next[index], combinator: event.target.value as (typeof COMBINATORS)[number] };
              setRows(next);
              syncQuery(next);
            }}
            disabled={index === 0}
            title={index === 0 ? "First row does not require a join operator" : "Join operator before this row"}
          >
            {COMBINATORS.map((option) => <option key={option} value={option}>{option}</option>)}
          </TerminalInput>
          <TerminalButton variant="danger" onClick={() => {
            const next = rows.filter((_, idx) => idx !== index);
            setRows(next);
            syncQuery(next);
          }} disabled={rows.length <= 1}>Remove</TerminalButton>
        </div>
      ))}
      <div className="flex flex-wrap gap-1">
        <TerminalButton onClick={() => {
          const next: QueryRow[] = [...rows, { field: "ROE", op: ">", value: "15", combinator: "AND" as const }];
          setRows(next);
          syncQuery(next);
        }}>Add Row</TerminalButton>
        <TerminalButton variant="accent" loading={loading} onClick={() => {
          const maybeError = validateRows(rows);
          setValidationError(maybeError);
          if (maybeError) return;
          syncQuery(rows);
          void run({ preset_id: null });
        }}>Run Built Query</TerminalButton>
      </div>
    </TerminalPanel>
  );
}
