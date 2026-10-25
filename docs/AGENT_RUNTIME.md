# Agent execution and recovery

Agent requests, event logs and tool checkpoints are persisted in additive database tables. The API and MCP registry share the same tool implementation. The default browser flow remains `POST /api/agent/runs`, then `GET /api/agent/runs/{id}/stream`.

## API

- `GET /runs/{id}` returns the persisted status, request/context and final answer.
- `GET /runs/{id}/stream?after=N` replays events after the cursor, then follows the active worker. Every SSE event has an integer `id`. `Last-Event-ID` is also supported. IDs are monotonically increasing database event IDs, not zero-based per-run indexes.
- `GET /runs/{id}/events?after=N` returns `{items: [{id, event}]}`.
- `POST /runs/{id}/cancel` stops a pending or active run. Cancellation is recorded before signalling the worker.
- `POST /runs/{id}/resume` prepares an interrupted, cancelled or failed run for recovery. Connect to its stream to start the worker. A still-active worker returns 409. Completed runs are replayed without running the model again.
- `GET /runs/{id}/export` returns a versioned evidence bundle containing the original request, configured provider/model, full recorded events, tool arguments and full tool results. It contains no provider API keys.

All paths above have the `/api/agent` prefix and require ownership of the run.

## Recovery semantics

A browser disconnect does not cancel the worker. A worker obtains an atomic database lease and updates its heartbeat every ten seconds. A lease with no heartbeat for ninety seconds is treated as interrupted. Explicit resume obtains a new lease; an old worker cannot heartbeat, execute new tools or finish the new lease.

Recovery starts orchestration again using the stored request and reuses completed tool calls with identical names and arguments. It is evidence reuse, not bit-for-bit model replay or a checkpoint inside a model completion. Model prose can differ. A new run is required to deliberately fetch fresh data.

A tool checkpoint is committed before invoking the handler. If a write was started but its result was not committed, recovery refuses to repeat that write. Inspect the original proposals/notes before starting a new request. This conservative rule handles a crash after an action commits but before its result is recorded. Confirming a proposal remains a separate human action.

## Context and latency

Conversation storage and restored threads retain full messages. Model history selects the most recent turns, in chronological order, within a 24,000-character prompt budget. Large tool outputs are reduced structurally to valid JSON, with explicit omitted rows/text and a full-result reference; raw evidence remains in the run export.

Debate analysts run with concurrency three for ordinary hosted providers. Local model servers, explicitly free model IDs, and Gemini endpoints use concurrency one. Rate-limit retry/backoff is handled by the provider HTTP client; debate does not add fixed sleeps to every role. Independent analyst tasks receive isolated context variables. This is bounded concurrency, not a guaranteed provider-specific requests-per-minute quota.

Rebalance proposals use marked quotes for existing and target holdings, retain quote provenance and valuation time, and fail if a usable price is missing. Entry cost is never substituted for a current price. Confirmation fills only the paper portfolio, with all reviewed legs in one transaction. A 0.2% cash reserve covers simulated costs (5 basis points each of slippage and commission). A changed portfolio snapshot, unavailable price, greater than 1% quote drift, or unfunded leg fails without executing any rebalance legs. Proposal status is `executing` while confirmation works, then `confirmed` or `failed`; an uncertain interrupted confirmation is not automatically retried.

Research-note confirmation stores a research memory note, not a fictitious trade. Watchlist removal checks ownership. Screener-alert confirmation supports only the existing tick evaluator: explicit exchange-qualified symbols and structured price, change_pct, volume, oi_change or iv conditions, with on_match delivery. Fundamental query expressions and daily/weekly universe scans are rejected explicitly because they have no evaluator. Alerts use the standard in-app delivery and fifteen-minute cooldown.

## Verification

`pytest backend/tests/test_agent_execution.py` covers durable replay, lease replacement, cancellation/resume, complete evidence exports, valid context budgets, unsuccessful provider status, completed-write reuse and uncertain-write refusal. Additional agent suites cover memory, grounding, proposals, research modes and tool integrations. Grounding fixtures use a controlled clock so a previously valid test quote does not fail merely because the calendar advances.

The browser stores only the latest unfinished run/thread identifiers in per-account session storage, never the conversation or an access token. After a reload, it revalidates the saved run against the authenticated API before restoring content. Reconnect replays all events after a reload (or events after the in-memory cursor for a transient disconnect). Logging out or switching accounts clears displayed state and fences late requests and stream callbacks. Recovery is limited to the current browser session/tab; closing it clears session storage, while server-side run exports remain available.
