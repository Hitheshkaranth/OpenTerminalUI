# Agent capability comparison and implementation

Reviewed 2026-11-16 against upstream GitHub documentation and source. This is a
capability comparison, not a model performance or investment-return benchmark.
Upstream main branches may change after this review.

The remaining rollout is now implemented. See [roadmap implementation and current
limits](agent-roadmap-implementation.md) for expanded execution checks, FX-aware
paper books, walk-forward/experiment accounting, historical research isolation and
actual frozen-evidence model captures. The earlier follow-up priorities below are
retained as comparison context; the linked rollout describes the current behavior.

| Project | Relevant design | OpenTerminalUI assessment |
| --- | --- | --- |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents) | Specialist analysts, research debate, risk review, portfolio decisions | Existing debate, ensemble, playbook and research tools already cover much of this composition. More personas have lower marginal value than reliable financial calculations. |
| [AI Hedge Fund](https://github.com/virattt/ai-hedge-fund/blob/main/hedge_fund/README.md) | Investor views feed deterministic portfolio construction and risk limits | Existing tools measure risk and propose weights, but paper-order quantities could still come directly from the model. Separate the thesis from sizing arithmetic. See [risk limits implementation](https://github.com/virattt/ai-hedge-fund/blob/main/hedge_fund/risk/limits.py). |
| [FinRobot](https://github.com/AI4Finance-Foundation/FinRobot) | Financial research agents and financial-analysis tools | Existing filings, dossiers, grounding and claim checks are a strong base. Expose calculated sizing inputs and assumptions as evidence rather than relying on model arithmetic. |
| [FinRL-X](https://github.com/AI4Finance-Foundation/FinRL-Trading) | Research/backtest/execution pipeline and pre-trade checks | Keep research results distinct from execution authorization. The [trade executor](https://github.com/AI4Finance-Foundation/FinRL-Trading/blob/master/src/trading/trade_executor.py) illustrates checks at the action boundary. |

## Selected improvements

### Portfolio-aware sizing

`get_trade_size` is registered for authenticated users in the default agent
registry and remains available to read-only MCP sessions. Anonymous and dedicated
strategy-loop registries do not expose it. It sizes an incremental long-only paper
BUY in whole shares. Example tool arguments:

```json
{"symbol":"NSE:TCS","stop_price":3000,"risk_budget_pct":1,"max_position_pct":20,"portfolio_id":"owned-paper-book-id"}
```

The tool resolves an owned paper book, marks every nonzero holding and the requested
symbol through the existing provider/provenance path, and returns the smallest of:

1. Stop risk: `floor(equity * risk_budget_pct / 100 / (price - stop))`.
2. Cash: `floor(cash / (price * 1.002))`.
3. Concentration: remaining single-name capacity, accounting for the reduction in
   post-trade equity caused by the 0.2% cost buffer.

All calculations use decimal arithmetic before conversion to JSON. Outputs include
the marked equity, quote provenance, stop/risk assumptions, each quantity cap,
binding constraints, estimated remaining cash and post-trade concentration. Missing
prices are errors; entry prices never substitute for current valuations. Defaults
are illustrative sizing assumptions (1% incremental risk and 20% concentration),
not personalized investment recommendations.

The shared action playbook directs agents to obtain a user-specified hypothetical
stop before sizing a discretionary long BUY idea and to explain the limiting cap.
The tool never creates a proposal, places a stop, reserves cash or executes a trade.
Its output is advisory and respects stricter enabled policy limits. The separate
proposal preflight below enforces saved policy. Existing orders
still require human confirmation. The sizing estimate does not net pending orders;
foreign quotes use dated FX conversion into the paper book's base currency. Stop risk excludes existing
positions' risk and fees, and price gaps can exceed the calculated loss. Quotes and
holdings can change after the estimate; quote timestamps remain in per-symbol
provenance, separately from the calculation timestamp.

### Proposal input validation

The paper-order proposal handler rejects boolean, nonfinite, zero or negative
quantities before opening a database session. It also validates order type,
required limit/stop trigger fields, finite positive prices and finite nonnegative
execution costs. These are runtime checks rather than reliance on the model obeying
the tool's JSON schema. Valid proposals retain the existing approval flow.

### Honest strategy research evidence

Permutation and cross-window diagnostics reuse the selected training curve and
are labelled as in-sample checks. They cannot certify a validated edge solely
from a small p-value plus consistency. Nonfinite Sharpe metrics are rejected.

## Implemented follow-ups

### Enforced paper-trade policy

Open **Agent → Paper risk limits** to load, edit and explicitly save the current
user's policy. It starts disabled, preserving existing unconfigured workflows.
The authenticated endpoints are `GET /api/agent/risk-policy` and
`PUT /api/agent/risk-policy`. The policy is not an agent-callable write tool.

Example request body:

```json
{"enabled":true,"max_position_pct":20,"risk_budget_pct":1,"require_stop":true,"max_quote_drift_pct":1,"max_quote_age_seconds":3600}
```

When enabled, paper-order proposals require an owned active portfolio, dated usable
marks for every exposure, adequate cash after actual paper-engine fees/slippage,
post-cost position concentration and, for buys with a stop, an incremental stop-risk
budget. Pending orders and unexpired proposals reserve capacity; sells never release
cash before filling. Delayed limit/stop-trigger fills repeat checks at execution.
Guarded rebalances simulate combined risk and require pending capacity to be resolved
before proposing the all-leg transaction.

The preview persists the policy, book snapshot, order parameters and quote evidence.
Confirmation locks the book, repeats all checks at current marks, rejects changed
policy/book/order parameters or excess quote drift, and commits the fill atomically.
Legacy previews cannot bypass enabled policy. A failed fill rolls back the order,
position, cash and trade changes. Hypothetical stop prices are not placed as actual
stop orders. The policy covers agent and manual equity paper execution, including
delayed fills, but not live broker endpoints. A policy change invalidates existing guarded
previews, including disabling it.

`0015_agent_risk_policy` adds the policy table; upgrade through the normal Alembic
workflow. The new migration was also verified against a disposable SQLite database.

### Frozen chronological SMA holdout

Strategy Lab loads one private three-year OHLC snapshot before proposing parameters.
Its first 70% is training data and its final 30% is a holdout, with at least 120
training bars and 40 test bars. The ticker and dataset remain frozen. Parameter
refinement sees training results only; the winning trained candidate is evaluated
once on the holdout, after which no further model call or training is allowed.

Indicators warm using preceding training bars, orders use previous-bar signals,
and the test account starts flat. Both partitions include 5bps fees and 5bps
slippage. Sharpe and drawdown include first-bar execution costs against the initial
cash baseline. Reports include split dates, candidate count, costs and train/test
metrics. That single split does not certify an investment edge. The subsequent
roadmap adds expanding walk-forward testing and persistent repeated-test accounting;
see the linked rollout for protocol and overlap limitations. Momentum baskets fail
closed without historical membership evidence.

### Horizon-correct ensemble outcomes

Signals settle using their stored calendar-day horizon, or the requested horizon
when none was stored. Historical prices are fetched for a bounded date window;
settlement uses the earliest completed daily bar on or after the horizon date,
allowing seven calendar days for holidays. Current UTC-day bars, malformed dates,
missing prices and conflicting duplicate observations are excluded. Later prices
never substitute for unavailable target-date evidence.

### Captured-run sizing evaluation

The offline evaluator now checks structured recommended and proposed quantities
against successful preceding sizing evidence for the same symbol and portfolio.
It catches positive actions after zero/failed sizing, cumulative split quantities
over the cap, missing matching sizing and stale underlying quotes. Results expose
`sizing_violations`; reference-fixture self-checks are labelled as harness checks,
not live-model benchmarks.

### Publication-cutoff filing evidence

`search_company_filings` accepts `as_of: "YYYY-MM-DD"`, inclusive end of that UTC
day. The store filters publication-eligible document IDs before loading text;
retrieval and answer generation repeat the cutoff discipline before ranking or
building model context. Historical calls accept source-dated SEC/NSE publication
metadata and exclude undated, estimated or unverified-source availability. Fiscal
periods and ingestion timestamps never substitute for availability.

Date-only source filings become available conservatively at the end of their
source-local day, including New York time for SEC and IST for NSE. If no eligible
passages exist, the tool returns unsupported without consulting a model. This is
a bounded historical filing tool; the rest of the agent's current-data tools and
model priors are not a universally point-in-time historical research environment.

## Roadmap status

These four follow-ups are now implemented in the supported equity/SMA research
scope: shared fill-time policy and FX checks, walk-forward/experiment accounting,
historical news/fundamentals/filings isolation, and actual frozen-evidence model
capture. See [current behavior and explicit limits](agent-roadmap-implementation.md).
Historical basket membership, source revision reconstruction and live brokerage
remain outside the supported evidence/execution boundary.

## Verification

The implementation includes deterministic database-backed sizing tests, independent
default-registry/MCP-permission integration tests, malformed proposal-input
regressions, and strategy evidence-label regressions. Provider calls are mocked;
these tests verify software behavior, not data-provider freshness, live LLM tool
selection, broker execution, or profitability. Full-suite outcomes and any unrelated
failures are reported with the delivery rather than treated as live-model evidence.

Final swarm QC results including follow-ups:

- Full backend suite: **2,176 passed** (18 warnings).
- Full frontend suite: **938 passed** across 176 files; production build passed.
- Independent adversarial paper-preflight coverage: **58 passed**, included above.
- Captured-run evaluator reference self-check: **9/9 passed** (harness only).
- Alembic upgrade through `0015_agent_risk_policy`, downgrade to `0014`, and
  re-upgrade passed on a disposable SQLite database.
- Browser checks used an isolated fake identity and mocked API responses: form
  load/edit/explicit-save passed, desktop and 390px mobile screenshots were
  inspected, and the mobile form had no horizontal overflow. See
  [desktop evidence](../output/playwright/agent-risk-limits-desktop.png) and
  [mobile evidence](../output/playwright/agent-risk-limits-mobile.png).
- Whitespace validation: `git diff --check` passed.

Existing warnings include dependency deprecations, React test warnings,
browser-environment limitations and a frontend bundle-size warning. PostgreSQL
concurrency was reviewed in code but not exercised against a running PostgreSQL
server. The separate [actual model captures](agent-roadmap-implementation.md#captured-model-evaluation)
include successful inference, timeouts and provider/authentication failures; these
are not included in the software-test totals. No live broker was exercised.
