export type WorkflowPersona = "all" | "trader" | "research" | "portfolio" | "quant" | "macro";
export type ToolCategory = Exclude<WorkflowPersona, "all">;
export interface TerminalTool {
  id: string;
  title: string;
  description: string;
  path: string;
  category: ToolCategory;
  context?: "ticker" | "left";
  requirement?: string;
}
export interface TerminalWorkflow {
  id: string;
  title: string;
  description: string;
  outcome: string;
  category: ToolCategory;
  steps: Array<{ tool: string; instruction: string }>;
}

export const WORKFLOW_PERSONAS: Array<{ id: WorkflowPersona; label: string }> = [
  { id: "all", label: "All workflows" }, { id: "trader", label: "Trading" },
  { id: "research", label: "Research" }, { id: "portfolio", label: "Portfolio" },
  { id: "quant", label: "Quant" }, { id: "macro", label: "Macro" },
];

export const TERMINAL_TOOLS: TerminalTool[] = [
  { id: "review-desk", title: "Watchlist review desk", description: "Review a shortlist with a linked chart, saved notes and review status.", path: "/equity/watchlist?view=review", category: "research" },
  { id: "overview", title: "Market overview", description: "Review indices, movers, and market themes.", path: "/equity/dashboard", category: "trader" },
  { id: "screen", title: "Equity screener", description: "Filter companies by financial, technical, and research criteria.", path: "/equity/screener", category: "research" },
  { id: "security", title: "Security Hub", description: "Inspect company fundamentals, financials, filings, and peers.", path: "/equity/security", category: "research", context: "ticker" },
  { id: "chart", title: "Price chart", description: "Examine price action, indicators, and volume for a security.", path: "/equity/stocks", category: "trader", context: "ticker" },
  { id: "workstation", title: "Chart workstation", description: "Build multi-chart layouts with linked symbol and time context.", path: "/equity/chart-workstation", category: "trader" },
  { id: "dossiers", title: "Research dossiers", description: "Record a thesis, evidence, assumptions, and invalidation conditions.", path: "/equity/research-dossiers", category: "research" },
  { id: "today", title: "Today review", description: "Review research changes and scheduled screen events.", path: "/equity/monitoring", category: "research", requirement: "Set up research monitoring or a scheduled screen first." },
  { id: "news", title: "News desk", description: "Read market headlines and inspect company news.", path: "/equity/news", category: "research", context: "ticker" },
  { id: "watchlist", title: "Watchlists", description: "Keep securities on a persistent watchlist.", path: "/equity/watchlist", category: "trader" },
  { id: "alerts", title: "Alerts", description: "Configure conditions and review triggered market alerts.", path: "/equity/alerts", category: "trader", requirement: "Create an alert rule to begin monitoring." },
  { id: "size", title: "Position sizer", description: "Calculate position size from risk, stop distance, or volatility.", path: "/equity/position-sizer", category: "trader" },
  { id: "paper", title: "Paper trading", description: "Practice an execution plan with a simulated portfolio.", path: "/equity/paper", category: "trader", requirement: "Create a paper portfolio; orders are simulated." },
  { id: "journal", title: "Trade journal", description: "Capture your trade rationale and review past decisions.", path: "/equity/journal", category: "trader" },
  { id: "portfolio", title: "Portfolio holdings", description: "Review holdings, allocation, and portfolio performance.", path: "/equity/portfolio", category: "portfolio", requirement: "Add or import holdings to see your exposure." },
  { id: "risk", title: "Risk desk", description: "Investigate exposure and portfolio risk measures.", path: "/equity/risk", category: "portfolio", context: "ticker" },
  { id: "correlation", title: "Correlation", description: "Compare co-movement and diversification across securities.", path: "/equity/correlation", category: "portfolio" },
  { id: "portfolio-lab", title: "Portfolio Lab", description: "Construct, simulate, and compare portfolio allocations.", path: "/equity/portfolio/lab", category: "portfolio" },
  { id: "dividends", title: "Dividends", description: "Review distributions and income characteristics.", path: "/equity/dividends", category: "portfolio" },
  { id: "etf", title: "ETF analytics", description: "Explore exchange-traded fund characteristics and exposure.", path: "/equity/etf-analytics", category: "portfolio" },
  { id: "backtest", title: "Backtesting", description: "Test a strategy against historical observations.", path: "/backtesting", category: "quant", requirement: "Choose a dataset, date range, and trading costs. Results are simulated." },
  { id: "model-lab", title: "Model Lab", description: "Build experiments and compare recorded validation results.", path: "/backtesting/model-lab", category: "quant" },
  { id: "statistics", title: "Statistical Lab", description: "Explore return distributions, relationships, and hypothesis tests.", path: "/equity/stat-lab", category: "quant" },
  { id: "pairs", title: "Pair trading", description: "Investigate spreads and statistical relationships between securities.", path: "/equity/pair-trading", category: "quant" },
  { id: "factors", title: "Factor dashboard", description: "Inspect factor exposures and ranked investment characteristics.", path: "/equity/factors", category: "quant" },
  { id: "options", title: "Option chain", description: "Inspect contracts, strikes, expiry, and option pricing.", path: "/fno", category: "trader", requirement: "Select a supported underlying and expiry in the options desk." },
  { id: "greeks", title: "Greeks calculator", description: "Explore option sensitivity to price, volatility, and time.", path: "/equity/option-greeks", category: "trader" },
  { id: "economics", title: "Economic terminal", description: "Explore economic series and scheduled macro releases.", path: "/equity/economics", category: "macro" },
  { id: "yields", title: "Yield curve", description: "Compare interest rates across bond maturities.", path: "/equity/yield-curve", category: "macro" },
  { id: "rotation", title: "Sector rotation", description: "Inspect relative strength and changes in sector leadership.", path: "/equity/sector-rotation", category: "macro" },
  { id: "heatmap", title: "Market heatmap", description: "Scan relative market performance visually.", path: "/equity/heatmap", category: "macro" },
  { id: "forex", title: "Foreign exchange", description: "Review currency markets and cross rates.", path: "/equity/forex", category: "macro" },
  { id: "compare", title: "Security comparison", description: "Compare two securities side by side.", path: "/equity/compare", category: "research", context: "left" },
  { id: "earnings", title: "Earnings calendar", description: "Review upcoming company reporting dates.", path: "/equity/earnings", category: "research" },
  { id: "launchpad", title: "Launchpad", description: "Arrange a reusable workspace from charts and research panels.", path: "/equity/launchpad", category: "trader" },
  { id: "quality", title: "Data quality", description: "Inspect provider coverage and data health before relying on a result.", path: "/equity/data-quality", category: "quant" },
  { id: "settings", title: "Provider settings", description: "Configure data and model providers for your installation.", path: "/equity/settings", category: "research", requirement: "Provider administration may require an administrator account." },
];

export const TERMINAL_WORKFLOWS: TerminalWorkflow[] = [
  { id: "first-session", title: "Find your first research idea", description: "A guided path from the market overview to a thesis you can revisit.", outcome: "A shortlist and a documented investment question", category: "research", steps: [
    { tool: "overview", instruction: "Get a sense of market direction and the themes moving today." },
    { tool: "screen", instruction: "Choose a preset or filter companies against your own criteria." },
    { tool: "security", instruction: "Inspect your selected company and check the sources behind its metrics." },
    { tool: "dossiers", instruction: "Create a dossier for that company and write what would support or invalidate your thesis." },
  ] },
  { id: "trading-plan", title: "Prepare a trading plan", description: "Move from price action to defined risk and a practice trade.", outcome: "A risk-defined plan tested with simulated capital", category: "trader", steps: [
    { tool: "chart", instruction: "Inspect the selected security and identify a setup and invalidation level." },
    { tool: "size", instruction: "Enter your account size, entry, and stop to calculate a risk budget." },
    { tool: "paper", instruction: "Select the instrument and place a simulated order in a paper portfolio." },
    { tool: "journal", instruction: "Record your rationale, risk, and a plan for reviewing the outcome." },
  ] },
  { id: "evidence-review", title: "Challenge a company thesis", description: "Check primary evidence and competing explanations before building conviction.", outcome: "A thesis with supporting evidence and explicit counterarguments", category: "research", steps: [
    { tool: "security", instruction: "Open Filings in the Security Hub; ingest a primary document if none are available." },
    { tool: "news", instruction: "Look for recent events that could change the research question." },
    { tool: "compare", instruction: "Choose a peer and compare its business and financial characteristics." },
    { tool: "dossiers", instruction: "Attach supporting and opposing evidence to the relevant company dossier." },
  ] },
  { id: "daily-review", title: "Build a daily review routine", description: "Keep research, watchlists, and alerts in a repeatable review loop.", outcome: "A review queue with explicit follow-up actions", category: "research", steps: [
    { tool: "today", instruction: "Review changed theses and scheduled screen entries or exits." },
    { tool: "review-desk", instruction: "Move through your shortlist, inspect the linked chart and save notes or a review status." },
    { tool: "alerts", instruction: "Create conditions for price moves or other supported events." },
    { tool: "earnings", instruction: "Check the next reporting dates before scheduling your follow-up." },
  ] },
  { id: "portfolio-review", title: "Review portfolio concentration", description: "Connect holdings to risk and investigate diversification choices.", outcome: "A reviewed exposure map and an allocation experiment", category: "portfolio", steps: [
    { tool: "portfolio", instruction: "Review your holdings and look for concentrated positions." },
    { tool: "risk", instruction: "Inspect exposure and the assumptions behind reported risk measures." },
    { tool: "correlation", instruction: "Check whether different holdings actually diversify the portfolio." },
    { tool: "portfolio-lab", instruction: "Compare an alternative allocation in simulation before making a decision." },
  ] },
  { id: "strategy-validation", title: "Validate a strategy idea", description: "Start with data quality, then separate discovery from validation.", outcome: "A recorded experiment with costs and validation results", category: "quant", steps: [
    { tool: "quality", instruction: "Check data availability and provenance for your intended universe." },
    { tool: "backtest", instruction: "Define the strategy, evaluation period, and transaction costs." },
    { tool: "model-lab", instruction: "Create an experiment and inspect training and validation results separately." },
    { tool: "paper", instruction: "Evaluate the execution assumptions with a simulated portfolio." },
  ] },
  { id: "macro-check", title: "Read the macro backdrop", description: "Connect the economic calendar, rates, and sector leadership.", outcome: "A market context to compare with your company thesis", category: "macro", steps: [
    { tool: "economics", instruction: "Inspect scheduled releases and the relevant historical economic series." },
    { tool: "yields", instruction: "Check the curve for changes across short and long maturities." },
    { tool: "rotation", instruction: "Look at which sectors are leading or lagging." },
    { tool: "heatmap", instruction: "Compare the broader pattern with the securities on your radar." },
  ] },
  { id: "options-plan", title: "Explore an options position", description: "Inspect the underlying, contract terms, and option sensitivities.", outcome: "A reviewed options scenario with explicit risk assumptions", category: "trader", steps: [
    { tool: "chart", instruction: "Establish a view on the selected underlying and its risk levels." },
    { tool: "options", instruction: "Select a supported underlying, expiry, and strike in the option chain." },
    { tool: "greeks", instruction: "Enter the contract assumptions to inspect price and volatility sensitivity." },
    { tool: "journal", instruction: "Document the scenario, maximum acceptable loss, and review conditions." },
  ] },
];

export function normalizeWorkflowSymbol(input: string): string | null {
  const symbol = input.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9._:=&^\-]{0,39}$/.test(symbol) ? symbol : null;
}

export function toolDestination(tool: TerminalTool, symbol: string): string {
  const normalized = normalizeWorkflowSymbol(symbol);
  if (!tool.context || !normalized) return tool.path;
  return `${tool.path}?${new URLSearchParams({ [tool.context]: normalized }).toString()}`;
}

export function filterTools(query: string, persona: WorkflowPersona): TerminalTool[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return TERMINAL_TOOLS.filter((tool) =>
    (persona === "all" || tool.category === persona) &&
    terms.every((term) => `${tool.title} ${tool.description} ${tool.category}`.toLowerCase().includes(term)),
  );
}

export function filterWorkflows(query: string, persona: WorkflowPersona): TerminalWorkflow[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return TERMINAL_WORKFLOWS.filter((workflow) => {
    const tools = workflow.steps.map((step) => TERMINAL_TOOLS.find((tool) => tool.id === step.tool));
    const haystack = `${workflow.title} ${workflow.description} ${workflow.outcome} ${workflow.category} ${tools.map((tool) => `${tool?.title} ${tool?.description}`).join(" ")}`.toLowerCase();
    return (persona === "all" || workflow.category === persona) && terms.every((term) => haystack.includes(term));
  });
}
