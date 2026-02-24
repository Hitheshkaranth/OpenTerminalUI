import { useState } from "react";

import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function AdvancedArithmetic() {
  const { query, setQuery } = useScreenerContext();
  const [left, setLeft] = useState("Total Borrowings");
  const [op, setOp] = useState("/");
  const [right, setRight] = useState("EBITDA");
  const [cmp, setCmp] = useState("<");
  const [value, setValue] = useState("3");

  return (
    <TerminalPanel title="Advanced Arithmetic" subtitle="Expression Builder" bodyClassName="space-y-1">
      <div className="grid grid-cols-5 gap-1">
        <TerminalInput value={left} onChange={(event) => setLeft(event.target.value)} />
        <TerminalInput value={op} onChange={(event) => setOp(event.target.value)} />
        <TerminalInput value={right} onChange={(event) => setRight(event.target.value)} />
        <TerminalInput value={cmp} onChange={(event) => setCmp(event.target.value)} />
        <TerminalInput value={value} onChange={(event) => setValue(event.target.value)} />
      </div>
      <TerminalButton onClick={() => setQuery(`${query}${query ? " AND " : ""}(${left} ${op} ${right}) ${cmp} ${value}`)}>Append Equation</TerminalButton>
    </TerminalPanel>
  );
}
