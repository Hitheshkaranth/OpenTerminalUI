import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Bookmark, Check, Compass, Search, Settings2, X } from "lucide-react";

import { useStockStore } from "../store/stockStore";
import {
  TERMINAL_TOOLS, TERMINAL_WORKFLOWS, WORKFLOW_PERSONAS,
  filterTools, filterWorkflows, normalizeWorkflowSymbol, toolDestination,
  type WorkflowPersona,
} from "../data/workflowCatalog";
import "./WorkflowHub.css";

const STORAGE_KEY = "ot:workflow-hub:v1";
type HubPreferences = { selected: string; pinned: string[] };

function readPreferences(): HubPreferences {
  const fallback = { selected: TERMINAL_WORKFLOWS[0].id, pinned: [] };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return fallback;
    const candidate = saved as Partial<HubPreferences>;
    return {
      selected: TERMINAL_WORKFLOWS.some((item) => item.id === candidate.selected) ? candidate.selected! : fallback.selected,
      pinned: Array.isArray(candidate.pinned)
        ? [...new Set(candidate.pinned.filter((id) => typeof id === "string" && TERMINAL_WORKFLOWS.some((item) => item.id === id)))]
        : [],
    };
  } catch {
    return fallback;
  }
}

export function WorkflowHubPage() {
  const ticker = useStockStore((state) => state.ticker);
  const setTicker = useStockStore((state) => state.setTicker);
  const [preferences, setPreferences] = useState(readPreferences);
  const [query, setQuery] = useState("");
  const [persona, setPersona] = useState<WorkflowPersona>("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [symbolInput, setSymbolInput] = useState(ticker);
  const [symbolError, setSymbolError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [symbolNotice, setSymbolNotice] = useState("");
  const symbol = normalizeWorkflowSymbol(ticker) || "RELIANCE";

  useEffect(() => { setSymbolInput(ticker); }, [ticker]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [preferences]);

  const workflows = useMemo(() => {
    return filterWorkflows(query, persona)
      .filter((item) => !pinnedOnly || preferences.pinned.includes(item.id))
      .sort((a, b) => Number(preferences.pinned.includes(b.id)) - Number(preferences.pinned.includes(a.id)));
  }, [query, persona, pinnedOnly, preferences.pinned]);
  const tools = useMemo(() => filterTools(query, persona), [query, persona]);
  const selected = workflows.find((item) => item.id === preferences.selected) || workflows[0];

  const applySymbol = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeWorkflowSymbol(symbolInput);
    setSymbolError(!normalized);
    if (normalized) {
      setTicker(normalized);
      setSymbolInput(normalized);
      setSymbolNotice(`Symbol context set to ${normalized}.`);
    }
  };

  const togglePin = (id: string) => setPreferences((current) => ({
    ...current,
    pinned: current.pinned.includes(id) ? current.pinned.filter((value) => value !== id) : [...current.pinned, id],
  }));
  const resetFilters = () => { setQuery(""); setPersona("all"); setPinnedOnly(false); };

  return (
    <main className="workflow-hub">
      <header className="workflow-header">
        <div>
          <div className="workflow-eyebrow"><Compass size={15} aria-hidden="true" /> Workflow library</div>
          <h1>Start with a question.</h1>
          <p>Find the right tools, follow a research path, and keep the next step in view.</p>
        </div>
        <Link className="workflow-button" to="/equity/launchpad"><Settings2 size={15} aria-hidden="true" /> Build a workspace <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </header>

      <section className="workflow-context" aria-label="Research context">
        <div><strong>One symbol, less repetition</strong><p>Your symbol follows you into compatible company, chart, and comparison tools.</p></div>
        <form onSubmit={applySymbol} className="workflow-symbol-form">
          <label htmlFor="workflow-symbol">Symbol context</label>
          <div className="workflow-symbol-controls">
            <input id="workflow-symbol" value={symbolInput} maxLength={40} autoComplete="off" spellCheck={false}
              aria-invalid={symbolError} aria-describedby={symbolError ? "workflow-symbol-error" : "workflow-symbol-help"}
              onChange={(event) => { setSymbolInput(event.target.value); setSymbolError(false); setSymbolNotice(""); }} />
            <button type="submit" className="workflow-button">Apply symbol</button>
          </div>
          <span id="workflow-symbol-help">For example AAPL, RELIANCE.NS, or NASDAQ:AAPL</span>
          {symbolError && <span id="workflow-symbol-error" role="alert">Enter a symbol using letters, numbers, or market punctuation, without spaces.</span>}
          <span className="workflow-sr-only" role="status">{symbolNotice}</span>
        </form>
      </section>

      <div className="workflow-discovery">
        <div className="workflow-search">
          <Search size={17} aria-hidden="true" />
          <input aria-label="Search workflows and tools" placeholder="Search a task, tool, or topic" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} aria-hidden="true" /></button>}
        </div>
        <button type="button" className="workflow-button" aria-pressed={pinnedOnly} onClick={() => setPinnedOnly((current) => !current)}>
          <Bookmark size={14} fill={pinnedOnly ? "currentColor" : "none"} aria-hidden="true" /> Pinned workflows <span>{preferences.pinned.length}</span>
        </button>
      </div>
      <div className="workflow-filters" role="group" aria-label="Filter by purpose">
        {WORKFLOW_PERSONAS.map((option) => <button key={option.id} type="button" aria-pressed={persona === option.id} onClick={() => setPersona(option.id)}>{option.label}</button>)}
      </div>

      <section className="workflow-library" aria-label="Guided workflows">
        <div className="workflow-list">
          <div className="workflow-list-heading"><h2>Choose a workflow</h2><span aria-live="polite">{workflows.length} available</span></div>
          {workflows.map((workflow) => <div className={`workflow-list-row${selected?.id === workflow.id ? " is-selected" : ""}`} key={workflow.id}>
            <button type="button" className="workflow-select" aria-pressed={selected?.id === workflow.id} onClick={() => setPreferences((current) => ({ ...current, selected: workflow.id }))}>
              <span className="workflow-category">{WORKFLOW_PERSONAS.find((item) => item.id === workflow.category)?.label}</span>
              <strong>{workflow.title}</strong>
              <span>{workflow.steps.length} steps <span aria-hidden="true">·</span> {workflow.outcome}</span>
            </button>
            <button className="workflow-pin" type="button" aria-label={`${preferences.pinned.includes(workflow.id) ? "Unpin" : "Pin"} ${workflow.title}`} aria-pressed={preferences.pinned.includes(workflow.id)} onClick={() => togglePin(workflow.id)}>
              <Bookmark size={16} fill={preferences.pinned.includes(workflow.id) ? "currentColor" : "none"} aria-hidden="true" />
            </button>
          </div>)}
          {!workflows.length && <div className="workflow-empty"><h3>{pinnedOnly ? "No pinned workflows match" : "No matching workflows"}</h3><p>Try another topic or remove a filter. Pin a workflow with its bookmark button to keep it here.</p><button type="button" className="workflow-button" onClick={resetFilters}>Reset filters</button></div>}
        </div>

        {selected ? <article className="workflow-detail" key={selected.id} aria-label={`${selected.title} steps`}>
          <div className="workflow-detail-top"><span className="workflow-category">Guided workflow</span><span>{selected.steps.length} steps</span></div>
          <h2>{selected.title}</h2>
          <p className="workflow-description">{selected.description}</p>
          <div className="workflow-outcome"><Check size={16} aria-hidden="true" /><span><strong>Work toward</strong> {selected.outcome.toLowerCase()}.</span></div>
          <ol className="workflow-steps">
            {selected.steps.map((step, index) => {
              const tool = TERMINAL_TOOLS.find((item) => item.id === step.tool)!;
              return <li key={step.tool}>
                <span className="workflow-step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div className="workflow-step-content"><h3>{tool.title}</h3><p>{step.instruction}</p>{tool.requirement && <p className="workflow-requirement">{tool.requirement}</p>}</div>
                <Link className="workflow-step-link" to={toolDestination(tool, symbol)} aria-label={`Open ${tool.title}`}><span>Open</span><ArrowUpRight size={17} aria-hidden="true" /></Link>
              </li>;
            })}
          </ol>
          <div className="workflow-detail-footer"><span>Tools open in this tab. Return here to continue; your selected workflow is saved in this browser.</span><Link className="workflow-primary-link" to={toolDestination(TERMINAL_TOOLS.find((item) => item.id === selected.steps[0].tool)!, symbol)}>Start workflow <ArrowRight size={15} aria-hidden="true" /></Link></div>
        </article> : <div className="workflow-detail workflow-no-selection"><Compass size={30} aria-hidden="true" /><h2>Find your next step</h2><p>Clear a filter to discover a path through research, trading, portfolio review, or strategy validation.</p></div>}
      </section>

      <section className="workflow-tool-directory" aria-labelledby="workflow-directory-title">
        <div className="workflow-directory-heading"><div><h2 id="workflow-directory-title">Go straight to a tool</h2><p>Know what you need? Open it directly.</p></div><span aria-live="polite">{tools.length} tools</span></div>
        <div className="workflow-directory-grid">
          {tools.map((tool) => <Link className="workflow-tool" key={tool.id} to={toolDestination(tool, symbol)}>
            <div><strong>{tool.title}</strong><ArrowUpRight size={15} aria-hidden="true" /></div><p>{tool.description}</p><span>{WORKFLOW_PERSONAS.find((item) => item.id === tool.category)?.label}{tool.context ? ` · ${symbol}` : ""}</span>
          </Link>)}
        </div>
        {!tools.length && <div className="workflow-empty"><h3>No tools match this search</h3><p>Try “chart”, “risk”, “filings”, or “portfolio”.</p><button type="button" className="workflow-button" onClick={resetFilters}>Reset filters</button></div>}
      </section>

      <footer className="workflow-page-footer"><span>Data coverage depends on your configured providers. Check provenance and availability inside each tool.</span><Link to="/equity/data-quality">Review data quality <ArrowRight size={13} aria-hidden="true" /></Link></footer>
      {storageError && <p role="status" className="workflow-storage-error">Browser storage is unavailable. Your workflow selection and pins will last for this visit.</p>}
    </main>
  );
}
