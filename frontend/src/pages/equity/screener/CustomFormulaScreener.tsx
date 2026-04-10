import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createSavedFormula,
  deleteSavedFormula,
  fetchSavedFormulas,
  runCustomFormulaScreener,
} from "../../../api/client";
import { DataGrid } from "../../../components/common/DataGrid";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalModal } from "../../../components/terminal/TerminalModal";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import type { CustomFormulaResponse, SavedFormula } from "../../../types";

const AVAILABLE_FIELDS = [
  ["pe", "Price to earnings"],
  ["pb", "Price to book"],
  ["ps", "Price to sales"],
  ["ev_ebitda", "Enterprise value to EBITDA"],
  ["roe", "Return on equity"],
  ["roa", "Return on assets"],
  ["roce", "Return on capital employed"],
  ["debt_equity", "Debt to equity ratio"],
  ["current_ratio", "Current ratio"],
  ["revenue_growth", "Revenue growth %"],
  ["eps_growth", "EPS growth %"],
  ["net_profit_growth", "Net profit growth %"],
  ["dividend_yield", "Dividend yield %"],
  ["market_cap", "Market capitalization"],
  ["price", "Current price"],
  ["volume", "Volume"],
  ["turnover", "Turnover"],
  ["net_profit_margin", "Net profit margin %"],
  ["operating_margin", "Operating margin %"],
  ["ebitda_margin", "EBITDA margin %"],
  ["free_cash_flow", "Free cash flow"],
  ["promoter_holding", "Promoter holding %"],
  ["fii_holding", "FII holding / change"],
  ["dii_holding", "DII holding / change"],
  ["high_52w", "52-week high"],
  ["low_52w", "52-week low"],
  ["beta", "Beta"],
  ["book_value", "Book value"],
  ["face_value", "Face value"],
] as const;

const EXAMPLE_FORMULAS = [
  ["pe * pb", "Graham Number proxy"],
  ["(roe - 15) * 2 + revenue_growth", "Quality + Growth"],
  ["price / high_52w * 100", "52W High %"],
] as const;

function formatNumber(value: unknown, maximumFractionDigits = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("en-IN", { maximumFractionDigits, minimumFractionDigits: maximumFractionDigits === 0 ? 0 : 2 });
}

function validateFormulaInput(formula: string): string {
  const input = formula.trim();
  if (!input) return "Formula is required";
  if (/[{}\[\];]/.test(input)) return "Only arithmetic expressions are allowed";
  if (/\b(import|open|exec|eval|lambda|class|def|for|while|with|return)\b/i.test(input)) return "Unsafe token in formula";
  if (/__|=|>|</.test(input)) return "Only arithmetic formula syntax is allowed";
  if (/[A-Za-z_][A-Za-z0-9_]*\s*\./.test(input)) return "Attribute access is not allowed";
  const tokens = input.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  const allowed = new Set([
    ...AVAILABLE_FIELDS.map(([field]) => field),
    "abs",
    "min",
    "max",
    "round",
    "sqrt",
  ]);
  for (const token of tokens) {
    if (!allowed.has(token)) return `Unknown field '${token}'`;
  }
  return "";
}

export function CustomFormulaScreener() {
  const navigate = useNavigate();
  const [formula, setFormula] = useState("pe * pb");
  const [universe, setUniverse] = useState<"nifty50" | "nifty100" | "nifty200" | "nifty500" | "all">("nifty200");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [filterExpr, setFilterExpr] = useState("");
  const [result, setResult] = useState<CustomFormulaResponse | null>(null);
  const [savedFormulas, setSavedFormulas] = useState<SavedFormula[]>([]);
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => validateFormulaInput(formula), [formula]);

  const loadSaved = async () => {
    const items = await fetchSavedFormulas();
    setSavedFormulas(items);
  };

  useEffect(() => {
    void loadSaved();
  }, []);

  const selectedSaved = savedFormulas.find((item) => String(item.id) === selectedSavedId) || null;

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <TerminalPanel title="Formula Editor" subtitle="Computed Ratio Builder" bodyClassName="space-y-3">
          <TerminalInput
            as="textarea"
            rows={7}
            className="font-mono text-sm"
            value={formula}
            onChange={(event) => setFormula(event.target.value)}
            placeholder="pe * pb"
            invalid={Boolean(validationError)}
          />
          <div className={`rounded-sm border px-2 py-1 text-xs ${validationError ? "border-terminal-neg bg-terminal-neg/10 text-terminal-neg" : "border-terminal-pos bg-terminal-pos/10 text-terminal-pos"}`}>
            {validationError || "Validation OK"}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <TerminalInput as="select" value={universe} onChange={(event) => setUniverse(event.target.value as typeof universe)}>
              <option value="nifty50">Nifty 50</option>
              <option value="nifty100">Nifty 100</option>
              <option value="nifty200">Nifty 200</option>
              <option value="nifty500">Nifty 500</option>
              <option value="all">All</option>
            </TerminalInput>
            <TerminalInput as="select" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="desc">Computed Value Desc</option>
              <option value="asc">Computed Value Asc</option>
            </TerminalInput>
            <TerminalButton
              variant="accent"
              loading={loading}
              disabled={Boolean(validationError)}
              onClick={async () => {
                setLoading(true);
                setError(null);
                try {
                  const data = await runCustomFormulaScreener({
                    formula,
                    universe,
                    sort,
                    limit: 50,
                    filter_expr: filterExpr.trim() || undefined,
                  });
                  setResult(data);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to run custom formula");
                } finally {
                  setLoading(false);
                }
              }}
            >
              Run
            </TerminalButton>
          </div>
          <TerminalInput
            value={filterExpr}
            onChange={(event) => setFilterExpr(event.target.value)}
            placeholder="Optional filter, e.g. market_cap > 10000"
            className="font-mono"
          />
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_FORMULAS.map(([example, label]) => (
              <button
                key={example}
                type="button"
                className="rounded-sm border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
                onClick={() => setFormula(example)}
              >
                {label}: <span className="font-mono">{example}</span>
              </button>
            ))}
          </div>
          <details className="rounded-sm border border-terminal-border bg-terminal-bg/40">
            <summary className="cursor-pointer px-3 py-2 text-xs uppercase tracking-wide text-terminal-muted">Available Fields</summary>
            <div className="grid grid-cols-1 gap-2 px-3 py-2 md:grid-cols-2">
              {AVAILABLE_FIELDS.map(([field, description]) => (
                <div key={field} className="rounded-sm border border-terminal-border/60 px-2 py-1">
                  <div className="font-mono text-xs text-terminal-accent">{field}</div>
                  <div className="text-[11px] text-terminal-muted">{description}</div>
                </div>
              ))}
            </div>
          </details>
          {error ? <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 px-2 py-1 text-xs text-terminal-neg">{error}</div> : null}
        </TerminalPanel>

        <TerminalPanel title="Saved Formulas" subtitle="Load Or Persist" bodyClassName="space-y-3">
          <TerminalInput as="select" value={selectedSavedId} onChange={(event) => setSelectedSavedId(event.target.value)}>
            <option value="">Load saved formula</option>
            {savedFormulas.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </TerminalInput>
          <div className="flex flex-wrap gap-2">
            <TerminalButton
              variant="default"
              disabled={!selectedSaved}
              onClick={() => {
                if (!selectedSaved) return;
                setFormula(selectedSaved.formula);
                setSaveDescription(selectedSaved.description || "");
                setSaveName(selectedSaved.name);
              }}
            >
              Load Saved
            </TerminalButton>
            <TerminalButton
              variant="danger"
              disabled={!selectedSaved}
              onClick={async () => {
                if (!selectedSaved) return;
                await deleteSavedFormula(selectedSaved.id);
                setSelectedSavedId("");
                await loadSaved();
              }}
            >
              Delete
            </TerminalButton>
            <TerminalButton
              variant="accent"
              disabled={Boolean(validationError)}
              onClick={() => {
                setSaveName(saveName || "My Formula");
                setSaveOpen(true);
              }}
            >
              Save Formula
            </TerminalButton>
          </div>
          {selectedSaved ? (
            <div className="rounded-sm border border-terminal-border px-3 py-2 text-xs">
              <div className="text-terminal-text">{selectedSaved.name}</div>
              <div className="mt-1 font-mono text-terminal-accent">{selectedSaved.formula}</div>
              <div className="mt-1 text-terminal-muted">{selectedSaved.description || "No description"}</div>
            </div>
          ) : (
            <div className="rounded-sm border border-terminal-border px-3 py-2 text-xs text-terminal-muted">No saved formula selected.</div>
          )}
        </TerminalPanel>
      </div>

      <TerminalPanel title="Custom Formula Results" subtitle={`Rows: ${result?.count ?? 0}`}>
        <DataGrid
          preset="screener"
          rows={result?.results || []}
          rowKey={(row, index) => `${String(row.symbol || index)}-${index}`}
          onRowSelect={(index) => {
            const row = result?.results[index];
            if (!row?.symbol) return;
            navigate(`/equity/security/${encodeURIComponent(String(row.symbol))}`);
          }}
          emptyText="Run a formula to see computed results"
          className="max-h-[52vh] xl:max-h-[56vh]"
          columns={[
            {
              key: "rank",
              header: "#",
              align: "right",
              renderCell: (_row, index) => index + 1,
            },
            {
              key: "symbol",
              header: "Symbol",
              sortable: true,
              sortValue: (row) => String(row.symbol || ""),
              renderCell: (row) => <span className="font-mono text-terminal-accent">{String(row.symbol || "-")}</span>,
            },
            {
              key: "name",
              header: "Name",
              sortable: true,
              sortValue: (row) => String(row.name || ""),
              renderCell: (row) => String(row.name || "-"),
            },
            {
              key: "sector",
              header: "Sector",
              sortable: true,
              sortValue: (row) => String(row.sector || ""),
              renderCell: (row) => <span className="text-terminal-muted">{String(row.sector || "-")}</span>,
            },
            {
              key: "computed_value",
              header: formula.trim() ? `Computed Value (${formula.trim()})` : "Computed Value",
              align: "right",
              sortable: true,
              headerClassName: "text-terminal-accent",
              cellClassName: "text-terminal-accent",
              sortValue: (row) => Number(row.computed_value || 0),
              renderCell: (row) => formatNumber(row.computed_value),
            },
            {
              key: "pe",
              header: "PE",
              align: "right",
              sortable: true,
              sortValue: (row) => Number(row.pe || 0),
              renderCell: (row) => formatNumber(row.pe),
            },
            {
              key: "pb",
              header: "PB",
              align: "right",
              sortable: true,
              sortValue: (row) => Number(row.pb || 0),
              renderCell: (row) => formatNumber(row.pb),
            },
            {
              key: "roe",
              header: "ROE",
              align: "right",
              sortable: true,
              sortValue: (row) => Number(row.roe || 0),
              renderCell: (row) => formatNumber(row.roe),
            },
            {
              key: "market_cap",
              header: "Market Cap",
              align: "right",
              sortable: true,
              sortValue: (row) => Number(row.market_cap || 0),
              renderCell: (row) => formatNumber(row.market_cap, 0),
            },
          ]}
        />
      </TerminalPanel>

      <TerminalModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save Formula"
        subtitle="Persist custom screener formula"
        footer={
          <div className="flex justify-end gap-2">
            <TerminalButton variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </TerminalButton>
            <TerminalButton
              variant="accent"
              onClick={async () => {
                const safeName = saveName.trim();
                if (!safeName) {
                  setSaveError("Name is required");
                  return;
                }
                setSaveError(null);
                await createSavedFormula({
                  name: safeName,
                  formula,
                  description: saveDescription.trim(),
                });
                setSaveOpen(false);
                setSelectedSavedId("");
                await loadSaved();
              }}
            >
              Save
            </TerminalButton>
          </div>
        }
      >
        <div className="space-y-3">
          {saveError ? <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 px-2 py-1 text-xs text-terminal-neg">{saveError}</div> : null}
          <TerminalInput value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Formula name" />
          <TerminalInput value={saveDescription} onChange={(event) => setSaveDescription(event.target.value)} placeholder="Description" />
          <div className="rounded-sm border border-terminal-border px-3 py-2 font-mono text-xs text-terminal-accent">{formula}</div>
        </div>
      </TerminalModal>
    </section>
  );
}
