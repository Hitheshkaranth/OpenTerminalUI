# Agent evaluation

The evaluator scores captured runs offline without provider or model calls. It checks required tool names and argument values, numeric grounding, the statement families supported by the existing claim checker, stale-source disclosure, required task output fragments, and actions executed without human confirmation.

```sh
.venv/bin/python -m backend.evaluation.agent
.venv/bin/python -m backend.evaluation.agent --observations /path/to/captured-runs.json --output /tmp/agent-score.json
.venv/bin/python -m pytest backend/tests/test_agent_evaluation.py
```

The first invocation uses reference responses to self-check the harness. It is explicitly labeled `reference_fixture_self_check` and **is not a benchmark of any live model**. Supply actual captured runs with `--observations` to evaluate a model. Missing cases fail rather than silently disappearing.

Observations are a JSON object keyed by fixture ID:

```json
{
  "screen_context_india": {
    "answer": "TCS P/E is 27.4.",
    "tool_calls": [{
      "name": "get_stock_snapshot",
      "arguments": {"ticker": "TCS"},
      "result": {"symbol": "TCS", "pe": 27.4}
    }],
    "actions_executed": [],
    "latency_ms": 1200,
    "cost_usd": 0.003
  }
}
```

Include `result` from each tool-result event and `arguments` from its matching tool-call event. Do not replace outputs with expected fixtures: the grader must see the evidence the model actually saw. Capture end-to-end latency and provider-billed cost where available. If absent, aggregate latency and cost remain null, not zero. The returned observation counts show how many cases contributed to each measurement.

Sizing fixtures additionally require structured recommendations so the evaluator can compare quantities numerically rather than infer compliance from prose:

```json
{
  "recommendations": [{"symbol": "AAPL", "portfolio_id": "paper-1", "quantity": 10}]
}
```

Capture these alongside `answer` and ordered `tool_calls` in the observation. Alternatively, `suggested_quantity` supplies the quantity for the fixture's `context.symbol` and `context.portfolio_id`. Positive-allowance tasks requiring advice fail if structured advice is absent. Under `sizing_abstention_v2`, explicit `recommendations: []` is valid abstention only when the latest successful sizing evidence for the required symbol/portfolio allows zero shares, no proposal or action occurred, and the answer contains no contradictory positive share advice. Omitted recommendations, failed/malformed sizing and unrelated zero results cannot waive the requirement. A recommendation must be a non-negative whole-share quantity no larger than its matching successful `get_trade_size` result. A default-portfolio call may match the resolved portfolio ID returned by that call. Proposal calls (`propose_paper_order`, `execute_order`) must have preceding sizing evidence, so a later sizing call cannot legitimize an earlier proposal. These are evaluator checks, not a replacement for runtime proposal enforcement or complete natural-language semantic validation.

Per-case `sizing_violations` lists structured reasons; the summary counts all violations while retaining existing metrics and schema version. Frozen sizing fixtures cover selecting the sizing tool, zero and failed sizing without action, and stale underlying marked quotes. Staleness checks inspect each sizing result's `data.price_provenance`, rather than treating the calculation timestamp as quote freshness. Regression tests inject oversized recommendations and proposals into these captures and verify rejection. Captured recommendations must be extracted faithfully from actual model outputs; free-form numeric advice without structured extraction is not fully graded by these checks.

Fixtures carry their evaluation time for reproducible freshness checks. The set covers current-screen market context, a follow-up correction, stale quotes, a missing metric, proposal-only behavior, and paper sizing limits. Extend it with actual workflow failures, cross-provider conflicts, dated filings, and benchmark-vs-debate paired runs. Make independent model runs use the same frozen evidence and configuration for fair comparison.

The metric named `unsupported_claim_rate` covers extracted numeric claims only. Qualitative causal claims outside the checker are not fully validated. Task completion uses expected text fragments and is a regression check, not a semantic judge. This harness complements agent integration tests and human review rather than certifying financial accuracy.

## Capture actual model runs with frozen evidence

`backend.evaluation.capture` runs the real agent `Orchestrator` through the configured OpenAI-compatible gateway, with a dedicated evaluation prompt. Every financial tool uses only a frozen fixture; no production market/action handler is registered or reachable. The runner never contacts a market provider, creates a real proposal, or fills an order. Proposal outputs are explicitly marked as simulations. This measures reasoning and tool use on a small fixed regression set, not performance against live markets.

Inspect the protocol without making model requests:

```sh
.venv/bin/python -m backend.evaluation.capture --dry-run \
  --provider lmstudio --model YOUR_LOCAL_MODEL \
  --case screen_context_india --case sizing_selection
```

Run a bounded two-case capture using a model already configured in the gateway:

```sh
.venv/bin/python -m backend.evaluation.capture --run \
  --provider lmstudio --model YOUR_LOCAL_MODEL \
  --case screen_context_india --case sizing_selection \
  --max-steps 3 --max-tokens 1024 --timeout 45 \
  --output-dir output/agent-captures/local
```

`--provider` and `--model` may be repeated; the runner checks their Cartesian product. If omitted, they use the configured agent provider/model (or the configured local model for LM Studio). Each completion is pinned to the explicitly selected model; routed model chains and configured model fallbacks are disabled. An unavailable OpenRouter target changes only when the caller explicitly supplies a catalog-verified `--resolve-free-model` replacement; both targets and checks are recorded. A chosen hosted paid model can incur its normal inference charge. Capture makes one HTTP attempt per completion, within the case timeout; normal application retry defaults remain unchanged. `--run` evaluates cases. `--preflight-only` checks credentials/catalog without case inference; adding `--probe-provider` explicitly permits capability-probe inference. `--dry-run` constructs no provider and performs no network or output-file writes.

Every checked target produces a preflight result and an entry in `manifest.json`. A ready target evaluated with `--run` additionally produces observations keyed by fixture ID and a scored report. Blocked preflight targets and preflight-only checks have `summary: null`, no case observations and no model score. Authentication/quota/model-availability failures discovered during case inference retain attempted observations and stop subsequent cases, with no fabricated model-performance score. The manifest records cases, requested/selected model identifiers, capture protocol and dataset hashes, limits, and skipped work. Observations retain ordered actual arguments/results, raw final output, parsed answer/recommendations, measured agent latency, and capture failures. Returned model identifiers are recorded separately; an omitted actual identifier stays unreported.

Only provider-reported costs are captured. OpenRouter's documented [`usage.cost`](https://github.com/OpenRouterTeam/docs/blob/main/cookbook/administration/usage-accounting.mdx) is denominated in USD; explicit `usage.cost_usd` is also accepted. Missing or partial billing information stays `null`, including local inference; token counts are never converted into invented prices. The gateway may not expose billing for every provider. Attempted failed/timed-out cases remain in observations and cannot pass evaluation; cases never sent because of a provider block are explicitly skipped. The command exits nonzero for provider blocks, capture failures, skipped planned cases or failed regressions. Preflight-only mode exits zero only when every target is ready; readiness is not a model score.

`capture.billing_complete` states whether every attempted completion supplied billing metadata. `capture.reported_response_cost_usd` preserves the subtotal actually reported by observed responses. For example, a reported zero-cost tool-selection response followed by a timed-out inference has a reported subtotal of zero and an unknown total `cost_usd`, not a measured free run.

The model receives the user prompt, screen context, frozen reference clock, public tool schemas, and the results of tools it actually calls. It does not receive reference answers, expected argument values, grading criteria, or expected recommendations. Frozen lookups require exact arguments; unsupported queries return an explicit evidence-unavailable error instead of querying a real provider. Output results are fresh copies of the same evidence, so models cannot mutate shared fixtures. Tools have no access to run checkpoint writes, even if the capture function is called inside another agent context.

Fixtures carrying `context.historical_as_of` are explicitly unsupported by this capture runner: that context causes the production orchestrator to install its historical registry. The runner rejects it before model inference so a custom fixture cannot escape the frozen-tool boundary. Historical-mode integration has its own fixture-backed tests.

The current `frozen_capture_v6` prompt requests a final JSON object containing `answer` and `recommendations`, without conflicting production Markdown-format instructions. It reuses the production playbook's `ACTION_INTENT_DISCIPLINE`: research, estimates and sizing alone do not authorize proposals, and zero-quantity orders must never be proposed. These shared instructions do not replace server approval/preflight checks or prove model compliance. The frozen sizing-tool schema also states its actual capability: it already considers cash, holdings, marks and risk limits; fetching a separate stock snapshot is not a prerequisite.

The runner extracts only what the model actually emitted; it never infers quantities from fixture answers or clamps oversized advice to a sizing cap. If a complete visible final answer violates the JSON contract, the runner may make one actual, tool-free formatting call within the remaining case deadline. The repair receives only the original task, draft and observed evidence. It must preserve the draft answer verbatim, preserve explicit signed quantity advice and explicit symbol/portfolio identity, and cannot invent a zero recommendation. A malformed original recommendation schema, changed answer/quantity/identity, attempted tool call, repair timeout or provider failure remains a failed capture.

Both original and repaired text, repair status, model/usage records, enabled state and the actual prompt/repair protocol hash are retained under `capture.output_repair` and related metadata. The Python `capture_case(..., enable_output_repair=False)` option disables repair; there is no corresponding CLI flag. Accepted repair is a separately recorded inference call, not an offline score correction or new financial evidence. Quantity/identity guards are deterministic regression checks, not a complete natural-language semantic verifier. Output that remains unstructured or fails a repair guard still fails rather than being silently treated as protocol-compliant. This contract applies to the evaluation runner, not every production-console response.

Before live captures were added, two fixture prompts lacked information required by their expected tools. The journal case now explicitly supplies its requested title/body, and the failed-sizing case explicitly supplies its hypothetical stop. Those task details were corrected before model runs; the reference answers and numerical evidence were unchanged. `screen_context_india` and `sizing_selection` are representative starting cases for a bounded capture. All models must use the same fixture hash, cases, and limits for a comparison. The score remains a regression diagnostic; do not rank models from a two-case run.

The existing offline evaluator accepts the generated observations via `--observations`. A subset capture must be evaluated against the same subset of fixture cases; scoring it against the full fixture file deliberately fails the missing cases. The capture command's generated score already uses its selected subset.

The earlier zero-sizing contract incorrectly required a structured `quantity: 0` even when the capture protocol permitted an empty array for abstention. That mismatch is corrected under the versioned evaluator above. Original captures and scores remain unchanged; an offline rescore must be labelled `offline_rescore`, identify its original observation hash and report zero new inference calls. The retained original Nemotron observations pass 2/2 under the corrected contract; that is an offline rescore, not a new live benchmark.

## Provider checks and bounded captures

Every live target is checked against its configured authentication/model catalog before case inference. Missing credentials, authentication failures, absent models, unsupported tools and quota errors have diagnostic statuses and no fabricated model score. Authentication failures after preflight also stop later cases and targets for that provider. Capture requests make one HTTP attempt; normal application retry defaults remain unchanged.

```sh
# Authentication/catalog only; no case inference or model score.
.venv/bin/python -m backend.evaluation.capture --preflight-only \
  --provider gemini --model GEMINI_MODEL_ID --output-dir output/agent-captures/health-check

# An explicitly selected, catalog-verified free replacement; never paid fallback.
.venv/bin/python -m backend.evaluation.capture --preflight-only \
  --provider openrouter --model RETIRED_MODEL_ID \
  --resolve-free-model CURRENT_FREE_MODEL_ID --output-dir output/agent-captures/model-check
```

Use a fresh output directory for every attempt. Previous manifests, reservations, observations, scores, preflight results and interrupted atomic writes are protected from overwrite. Observations are checkpointed after each case and progress goes to stderr. `--probe-provider` explicitly adds a bounded harmless tool/JSON capability probe; catalogs alone do not prove that a model follows the protocol.

OpenRouter `:free` targets require zero declared prompt/completion prices. A present invalid, unknown or nonzero request price is rejected. An omitted request price remains unknown; every free inference and probe additionally enforces zero prompt, completion **and request** price caps, recorded as `zero_token_catalog_and_zero_request_cap`. No paid fallback is configured, and a reported positive charge stops the target's remaining case inference while preserving the billed evidence. See [free variants](https://openrouter.ai/docs/guides/routing/model-variants/free) and [provider price caps](https://openrouter.ai/docs/guides/routing/provider-selection).

OpenRouter capture requests and optional provider probes explicitly send `reasoning: {enabled: false}`. The Lightning free endpoint did not advertise the required structured-output parameters, so capture does not add unsupported `response_format` settings or silently switch models. Visible `content` must provide the final answer: reasoning-only responses are rejected before the shared gateway's legacy reasoning fallback. Completions marked `length`, `max_tokens`, `content_filter` or `error` are rejected even if their visible text parses as JSON; they cannot enter formatting repair as complete answers. Valid tool-call turns may carry reasoning metadata. A missing finish reason remains compatible when visible content exists.

Per-response records preserve `finish_reason`, actual visible `raw_content`, `visible_content_present`, `reasoning_present`, model ID and usage. Hidden reasoning text is not copied into those records. Normal application-provider fallback/retry behavior is unchanged; these integrity rules belong to capture.

Capture reserves part of each case's wall-clock budget for a real answer without tools. A first unavailable exact frozen query has one uniform recovery allowance: the model may choose a distinct relevant query within the remaining budget. Repeating a query or receiving a second unavailable result closes the tool phase; the last step and time boundary also force finalization. No expected tool arguments or fixture answers are inserted to repair the model's query. `capture.unavailable_tool_recoveries` records use of this allowance. Normal orchestrator recovery defaults remain unchanged; capture explicitly opts into the allowance and avoids redundant synthesis of an already finished answer. Partial requests keep unknown total billing. Provider slowness, quota and invalid credentials cannot be converted into passing model results by the harness.

```sh
.venv/bin/python -m pytest backend/tests/test_agent_capture.py backend/tests/test_agent_evaluation.py
```

See the [live evaluation fix record](../../docs/live-model-evaluation-fixes.md) for immutable original captures, the separately labelled offline rescore, provider preflight evidence and revised-protocol runs. Results across different capture protocol hashes are not paired model comparisons.
