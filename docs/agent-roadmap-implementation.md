# Agent roadmap implementation

This extends the [competitive comparison](agent-competitive-analysis.md). All
execution described here is paper trading. No live broker endpoint is invoked.

## Shared paper execution checks

Saved limits now apply to agent proposals, manual equity paper orders, delayed
limit/stop-trigger fills and guarded rebalances. Enable them under **Agent → Paper
risk limits**. Policies remain opt-in and cannot be modified by an agent tool.

- Pending orders and proposals reserve capacity. Legacy pending orders without a
  risk review must be cancelled and replaced after enabling policy.
- Delayed fills fetch usable current quotes and repeat cash, concentration, stop
  risk and policy checks. Tick prices only trigger evaluation; they cannot supply
  an unverified execution price. Stop gaps outside the reviewed collar are rejected.
- Limit prices are respected after simulated slippage. Hypothetical buy-risk stops
  are separate from stop-order triggers and are never placed as protective stops.
- The synchronous paper fill method requires a matching per-call authorization
  after risk checks, closing internal bypasses. Rejected or pending orders are
  shown as such in both the paper page and trading hotkeys.
- Rebalance previews simulate sells before buys without creating orders. The
  combined new-buy stop risk and post-cost exposure must satisfy policy. Pending
  orders/proposals must be resolved first. Confirmation verifies the reviewed
  policy, book, target plan, prices and FX, then commits every leg or rolls all back.

`DELETE /api/paper/orders/{order_id}` cancels an owned pending order and releases
its reserved capacity. Filled orders cannot be cancelled this way.

## Currency-aware paper ledgers

New paper books have an explicit base currency, selectable at creation. Quotes
retain their native currency; dated, source-verified direct FX quotes convert
cash requirements, exposure, stop risk, fill prices and cost bases into base units.
FX changes are checked again at fill time. Missing, stale, zero or synthetic FX
evidence fails closed. Foreign fills retain their rate, pair and source evidence.

Bare tickers retain the existing paper-book convention; use exchange-qualified
symbols for international exposure. Hotkey Max is disabled when quote and ledger
currencies differ or cannot be established, instead of estimating with mixed units.
Valuation caches cannot hide newer domestic ticks. Foreign cached FX must be dated;
fallback cost/cached valuations are not fresh provider-backed portfolio measurements.

Legacy books default to INR, matching the previous NSE paper convention. Old foreign
cost bases cannot be reconstructed from current FX and are not silently converted.
Trades with unverifiable foreign position costs are rejected; reconcile them into
a new paper book. Manual derivatives and live broker systems are separate from
this long-only equity paper policy.

## Walk-forward strategy evidence and repeated tests

SMA research retains one frozen symbol and price snapshot. In addition to the
single 70/30 holdout, a predeclared four-candidate grid runs three expanding
training windows. Each fold chooses parameters from past training data only and
executes only the subsequent, disjoint test window, with previous-bar signals,
fees, slippage and terminal liquidation. Net test-window returns are chained.

The walk-forward result evaluates the fixed grid selector, not the LLM's single
winning proposal. It shares dataset/test dates with the final holdout and is not
independent replication. A preselected symbol is stable throughout; this does not
claim to reconstruct historical index membership or delisted securities. Momentum
basket research fails closed without historical membership evidence.

Append-only experiment events persist registration, test opening and completed
results per user/run. Openings are committed before test computation. Completed
runs replay their recorded result without fetching or retuning; interrupted
openings cannot silently reopen tests. Same-dataset and overlapping-date exposure
counts make repeated human testing visible. Reports never certify an investment
edge. History is available through `GET /api/agent/strategy-experiments`.

History provenance now follows the actual successful failover adapter. A mock
fallback is labelled synthetic; unknown adapters remain unreported. Neither can
qualify as real strategy evidence.

## Historical research boundary

Choose **Evidence cutoff (UTC)** before starting an agent thread. The server binds
the cutoff and subject to that thread; follow-ups inherit them. A new thread is
required to switch between current and historical research or change the cutoff.

Historical runs expose only released fundamentals, verified-publication news and
cutoff-filtered filings. The server-bound registry prevents the model from widening
the cutoff or reaching live snapshots, portfolio state or action tools. Current
memories, screen metrics and prior assistant evidence are excluded. Historical mode
supports standard/deep research; incompatible modes are disabled in the UI and
rejected at the API and direct orchestrator boundaries.

Fundamental availability uses release dates, not fiscal periods. News ingestion
preserves verified source publication metadata separately from ingest time;
undated legacy rows do not become historical evidence by backfilling today's date.
Unknown or estimated availability returns unavailable rather than current facts.
These controls govern fetched evidence, not the model's training knowledge, and do
not independently reconstruct every source revision or every historical universe.

## Captured model evaluation

```sh
.venv/bin/python -m backend.evaluation.capture --dry-run
.venv/bin/python -m backend.evaluation.capture --run \
  --provider openrouter --model MODEL_ID \
  --case sizing_selection --case sizing_zero_no_action \
  --max-steps 4 --max-tokens 2048 --timeout 60 \
  --output-dir output/agent-captures/example
```

The real agent loop receives fixture-backed tools with exact-argument matching.
No production handler is reachable and simulated proposals never execute. Requested
and returned model IDs, ordered tool evidence, raw/decoded answers, protocol hashes,
latency, errors and provider-reported usage are retained. Model fallbacks are
disabled for comparisons. Missing or interrupted billing is unknown, not zero;
reported partial response costs are retained separately. Account identifiers are
redacted from errors.

Observed runs on the same two frozen sizing cases:

| Target | Result | Interpretation |
| --- | --- | --- |
| OpenRouter `nvidia/nemotron-3.5-lightning:free` | Both completed; strict score 1/2 | Sizing passed. Zero-size response abstained safely but omitted the grader's structured zero recommendation. This is an output-contract ambiguity, not an executed unsafe trade. |
| OpenRouter `inclusionai/ling-3.2-flash:free` | Both timed out at 60 seconds | Partial tool evidence is retained; incomplete requests make total billing unknown. |
| Configured OpenRouter `openai/gpt-oss-20b:free` | HTTP 404 | The configured free target was unavailable. No paid-model fallback was made. |
| Gemini `gemini-3.8-flash` | HTTP 401 | The configured credential was rejected. This is an authentication failure, not a model performance score. |

This table preserves the original observations and original strict scores. The two
cases are a protocol check, not a statistically useful model ranking or an
investment-return benchmark. See the [original live manifest](../output/agent-captures/roadmap-live/manifest.json)
and [original Gemini attempt](../output/agent-captures/roadmap-gemini/manifest.json).

Subsequent work corrected the zero-abstention grading contract, added provider
preflight and bounded execution, and revised the capture prompt/formatting
protocol. The [live evaluation fix record](live-model-evaluation-fixes.md)
separately identifies the original-data offline rescore, fresh v2/v3 captures,
protocol hashes and remaining external/model failures. The offline rescore is not
a new inference run; different capture-protocol hashes are not paired model
comparisons. Final v3 Nemotron passed 1/2, while Gemma was rate-limited before any
case completed. These residual failures are retained rather than rewritten into
passing evidence.

## Schema and verification

Migrations `0016_strategy_experiments`, `0017_news_availability` and
`0018_paper_currency` follow the risk-policy migration. Bootstrap repairs preserve
legacy startup support. Upgrade/downgrade/re-upgrade were exercised on disposable
SQLite databases, including bootstrap-created paper tables. No production user
database was migrated during these checks.

Final test and browser evidence is recorded alongside the delivery. PostgreSQL
locking paths were reviewed but not exercised against a running PostgreSQL server.
The older `0008_pit_fundamentals_release_metadata` revision ID exceeds PostgreSQL's
usual Alembic version-column length; its deployed identity was preserved. The new
revision IDs fit that limit.

Roadmap baseline checks, before the subsequent live-evaluation fixes:

- **2,176 backend tests passed** (18 existing warnings).
- **938 frontend tests passed** across 176 files; production build passed.
- Disposable SQLite upgrade/downgrade/re-upgrade passed both before and after
  application schema bootstrap. Migration graph has one head, `0018_paper_currency`.
- Desktop/mobile browser checks used mocked API responses and an isolated fake
  identity. Historical mode disabled incompatible modes and live memory. Paper
  forms displayed their base currency and distinct order-trigger/risk-stop fields
  without horizontal form overflow. Screenshots: [historical desktop](../output/playwright/agent-historical-roadmap-desktop.png),
  [historical mobile](../output/playwright/agent-historical-roadmap-mobile.png),
  [paper desktop](../output/playwright/paper-roadmap-desktop.png),
  [paper mobile](../output/playwright/paper-roadmap-mobile.png).
- `git diff --check` passed. Build retains its existing bundle-size warning.

Live model capture outcomes are recorded separately above and are not included in
the passing software-test totals. No account policy was changed and no live broker
order was placed during verification.
