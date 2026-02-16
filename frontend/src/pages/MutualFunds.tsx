import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import { addMutualFundHolding } from "../api/client";
import { MutualFundCompare } from "../components/mutualFunds/MutualFundCompare";
import { MutualFundDetail } from "../components/mutualFunds/MutualFundDetail";
import { MutualFundPortfolioSection } from "../components/mutualFunds/MutualFundPortfolioSection";
import { MutualFundSearch } from "../components/mutualFunds/MutualFundSearch";
import { TopFundsPanel } from "../components/mutualFunds/TopFundsPanel";
import { TerminalButton } from "../components/terminal/TerminalButton";
import { TerminalInput } from "../components/terminal/TerminalInput";
import type { MutualFund } from "../types";

type Section = "search" | "top" | "compare" | "holdings";

export function MutualFundsPage() {
  const location = useLocation();
  const [section, setSection] = useState<Section>("search");
  const [selectedFund, setSelectedFund] = useState<MutualFund | null>(null);
  const [compareFunds, setCompareFunds] = useState<MutualFund[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [units, setUnits] = useState(10);
  const [avgNav, setAvgNav] = useState(0);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [headerMessage, setHeaderMessage] = useState<string | null>(null);

  const addForCompare = (fund: MutualFund) => {
    setSelectedFund(fund);
    setCompareFunds((prev) => {
      if (prev.some((x) => x.scheme_code === fund.scheme_code)) return prev;
      if (prev.length >= 5) return prev;
      return [...prev, fund];
    });
  };

  const compareLabel = useMemo(() => compareFunds.map((x) => x.scheme_name).join(" | "), [compareFunds]);

  useEffect(() => {
    const hash = (location.hash || "").replace("#", "").trim().toLowerCase();
    if (hash === "search" || hash === "top" || hash === "compare" || hash === "holdings") {
      setSection(hash);
    }
  }, [location.hash]);

  useEffect(() => {
    if (selectedFund?.nav && Number.isFinite(Number(selectedFund.nav))) {
      setAvgNav(Number(selectedFund.nav));
    }
  }, [selectedFund]);

  const addSelectedFundToPortfolio = async () => {
    setHeaderError(null);
    setHeaderMessage(null);
    if (!selectedFund) {
      setHeaderError("Select a mutual fund first from Search or Top Funds.");
      return;
    }
    if (!Number.isFinite(units) || units <= 0 || !Number.isFinite(avgNav) || avgNav <= 0) {
      setHeaderError("Enter valid Units and Avg NAV.");
      return;
    }
    try {
      await addMutualFundHolding({
        scheme_code: selectedFund.scheme_code,
        scheme_name: selectedFund.scheme_name,
        fund_house: selectedFund.fund_house,
        category: selectedFund.scheme_sub_category || selectedFund.scheme_category,
        units,
        avg_nav: avgNav,
        sip_transactions: [],
      });
      setHeaderMessage("Mutual fund holding added to portfolio.");
      setRefreshToken((n) => n + 1);
      setSection("holdings");
    } catch (e) {
      setHeaderError(e instanceof Error ? e.message : "Failed to add mutual fund holding.");
    }
  };

  return (
    <div className="space-y-3 p-4">
      <div className="rounded border border-terminal-border bg-terminal-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Add Mutual Fund Holding</div>
          <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-0.5 text-[11px] text-terminal-muted">
            {selectedFund ? `Selected: ${selectedFund.scheme_name}` : "Select a fund from Search/Top Funds"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Scheme Code</label>
            <TerminalInput className="w-full text-xs" value={selectedFund?.scheme_code ?? ""} readOnly />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Units</label>
            <TerminalInput className="w-full text-xs" type="number" value={units} onChange={(e) => setUnits(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-terminal-muted">Avg NAV</label>
            <TerminalInput className="w-full text-xs" type="number" value={avgNav} onChange={(e) => setAvgNav(Number(e.target.value))} />
          </div>
          <div className="flex items-end">
            <TerminalButton variant="accent" className="w-full justify-center" onClick={() => void addSelectedFundToPortfolio()}>
              Add Holding
            </TerminalButton>
          </div>
        </div>
        {headerError && <div className="mt-2 text-xs text-terminal-neg">{headerError}</div>}
        {headerMessage && <div className="mt-2 text-xs text-terminal-pos">{headerMessage}</div>}
      </div>

      <div className="flex flex-wrap gap-1">
        <button className={`rounded border px-2 py-1 text-xs ${section === "search" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setSection("search")}>Search</button>
        <button className={`rounded border px-2 py-1 text-xs ${section === "top" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setSection("top")}>Top Funds</button>
        <button className={`rounded border px-2 py-1 text-xs ${section === "compare" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setSection("compare")}>Compare</button>
        <button className={`rounded border px-2 py-1 text-xs ${section === "holdings" ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`} onClick={() => setSection("holdings")}>My Holdings</button>
      </div>

      {section === "search" && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <MutualFundSearch onSelect={addForCompare} />
          <MutualFundDetail fund={selectedFund} onAdded={() => setRefreshToken((n) => n + 1)} />
        </div>
      )}

      {section === "top" && <TopFundsPanel onSelectFund={setSelectedFund} />}

      {section === "compare" && (
        <div className="space-y-2">
          <div className="rounded border border-terminal-border bg-terminal-panel p-2 text-xs text-terminal-muted">
            Selected ({compareFunds.length}/5): {compareLabel || "No funds selected yet"}
          </div>
          <MutualFundCompare selected={compareFunds} />
        </div>
      )}

      {section === "holdings" && <MutualFundPortfolioSection refreshToken={refreshToken} />}
    </div>
  );
}
