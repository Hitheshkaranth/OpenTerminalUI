import { useState } from "react";

import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useScreenerContext } from "./ScreenerContext";

export function AlternateDataFilter() {
  const { query, setQuery } = useScreenerContext();
  const [sector, setSector] = useState("Chemicals");

  return (
    <TerminalPanel title="Alternate Data" subtitle="Tijori-style filters">
      <div className="grid grid-cols-2 gap-1">
        <TerminalInput as="select" value={sector} onChange={(event) => setSector(event.target.value)}>
          <option>Chemicals</option>
          <option>Electronics</option>
          <option>Textiles</option>
          <option>Pharma API</option>
          <option>Auto Components</option>
        </TerminalInput>
        <TerminalButton onClick={() => setQuery(`${query}${query ? " AND " : ""}Sector = '${sector}'`)}>Add Sector</TerminalButton>
      </div>
    </TerminalPanel>
  );
}
