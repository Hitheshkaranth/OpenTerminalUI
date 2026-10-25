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

Fixtures carry their evaluation time for reproducible freshness checks. The starter set covers current-screen market context, a follow-up correction, stale quotes, a missing metric, and proposal-only behavior. Extend it with actual workflow failures, cross-provider conflicts, dated filings, and benchmark-vs-debate paired runs. Make independent model runs use the same frozen evidence and configuration for fair comparison.

The metric named `unsupported_claim_rate` covers extracted numeric claims only. Qualitative causal claims outside the checker are not fully validated. Task completion uses expected text fragments and is a regression check, not a semantic judge. This harness complements agent integration tests and human review rather than certifying financial accuracy.
