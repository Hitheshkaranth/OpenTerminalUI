# Live model evaluation fixes

The capture harness now separates provider access failures from model behavior,
bounds inference attempts, and records output-format repair without changing the
model's financial advice. The remaining free-provider and model failures are
reported below. No result here is an investment-performance benchmark or a useful
model ranking: the live checks cover two frozen paper-sizing cases.

## What changed

- Authentication and the exact target's catalog entry are checked before cases.
  Invalid credentials are checked once per provider, including across a model
  matrix. Authentication failures discovered after preflight stop later cases.
- `--preflight-only` checks credentials/catalog without case inference or model
  scores. Only explicit `--probe-provider` adds harmless tool/JSON probe inference.
  Provider blocks retain diagnostic artifacts and `summary: null`, not a fabricated
  zero-of-two model score.
- Retired targets are never silently replaced. `--resolve-free-model MODEL_ID`
  requires an explicitly selected, catalog-verified free tool-capable target and
  another successful check. Requested and selected IDs remain in the manifest.
- OpenRouter free targets require zero declared token prices. An omitted request
  price is unknown, not zero; every free inference/probe enforces zero prompt,
  completion and request price caps. Invalid or positive declared charges fail
  closed; observed positive billing stops the target's remaining case inference.
- Capture completions make one HTTP attempt. Normal application retry defaults
  remain unchanged. Repeated queries or exhausted unavailable-query recovery end
  the tool phase, and a portion of the wall-clock budget is reserved for an actual
  tool-free answer. The later recovery rule is described with versions 5/6 below.
- Progress goes to stderr. Observations are checkpointed after each case. Existing
  manifests, reservations, observations, preflights, scores and interrupted atomic
  writes prevent output-directory reuse. Original evidence is not overwritten.
- The evaluator's `sizing_abstention_v2` contract accepts an explicit empty
  recommendation array for valid zero-size abstention. Missing recommendations,
  failed sizing, unrelated evidence, positive advice or attempted proposals cannot
  use that exception.
- `frozen_capture_v3` introduced a dedicated evaluation prompt without conflicting
  production Markdown instructions. At most one real, tool-free formatting call
  may repair an invalid final JSON contract within the remaining deadline. The
  answer must stay verbatim; quantity and explicit identity guards reject changes
  to advice. No reference answer or desired sizing quantity is supplied. A failed
  repair remains a failure, and every extra inference is recorded.

Catalog checks alone do not prove model tool/JSON compliance. Formatting guards
and numeric grounding are deterministic checks, not complete semantic validation.
Missing or interrupted billing remains unknown; a reported zero subtotal cannot
establish the cost of an unfinished request.

## Original evidence and the separate offline rescore

The original [OpenRouter capture](../output/agent-captures/roadmap-live/manifest.json)
retains Nemotron's strict 1/2 result and Ling's two timeouts. The original
[retired-model attempt](../output/agent-captures/roadmap/manifest.json) retains its
HTTP 404, and the [Gemini attempt](../output/agent-captures/roadmap-gemini/manifest.json)
retains its HTTP 401. None was rewritten after the fixes.

The [offline rescore](../output/agent-captures/live-eval-rescore-v2.json) grades the
same original Nemotron observations under `sizing_abstention_v2` and passes 2/2.
It records zero new inference calls, the source path and source SHA-256
`4becf5864a997b87a638d9efb3ac932dc1146000717d8dcca02a9bac639f37f4`.
This corrects the earlier abstention contract; it is not a fresh live result or a
claim that a model improved.

## Version 2 checks and fresh captures

These artifacts use `frozen_capture_v2`, protocol SHA-256
`c6241dc35d07409c7e8945b04af8f84efd6ab813ef7406d248ae6f5a61fdde7c`.

| Evidence | Observed outcome | Meaning |
| --- | --- | --- |
| [Initial v2 preflight](../output/agent-captures/live-eval-fixes-v2/manifest.json) | Both free targets blocked before inference | The checker initially required a catalog request-price field that the live catalog omitted. This harness compatibility issue was corrected with explicit zero request-price caps. The failed attempt remains preserved. |
| [Verified v2 capture](../output/agent-captures/live-eval-fixes-v2-verified/manifest.json), Nemotron | Both cases completed; 1/2 passed | Positive sizing returned valid JSON. Zero sizing returned prose without the required recommendation array. Both cases reported complete USD 0 billing; the output-format failure remains a failure. |
| Same verified v2 capture, Ling | First inference returned HTTP 429; remaining case stopped | No model score was assigned. One attempt is preserved; the other case was not sent. Total billing was unavailable. |
| [Explicit free-target resolution](../output/agent-captures/live-eval-model-resolution-v2/manifest.json) | Retired `openai/gpt-oss-20b:free` absent; explicitly selected Nemotron passed preflight | Credentials/catalog checks only, zero inference and no model score. This validates the resolution path, not the replacement's financial reasoning. |
| [Gemini credential check](../output/agent-captures/live-eval-gemini-preflight-v2/manifest.json) | One `GET /models` returned HTTP 401 | No case inference or model score. A valid configured credential is still required; source changes cannot repair an invalid key. |

The fresh v2 model captures used `sizing_selection` and `sizing_zero_no_action`,
four steps, 2,048 maximum tokens per completion and a 60-second case limit.
Their fixture hash is
`cead80a295680bdaf6b9506212ea39cc4b3dac217a648bd820437bc862f4af13`.
The prompt/orchestration changed from the original captures, so those scores are
not a controlled before/after model comparison.

## Version 3 OpenRouter checks, preserved

The user selected finishing with OpenRouter. These version 3 captures use the
same two cases, fixture hash, four-step/2,048-token limits and 60-second deadline.
They record `frozen_capture_v3`, live protocol hash
`d517d7681a662ea7a45894f811b53431f06659a7f413b8880798e0300efec813`.

| Target and evidence | Actual result | Billing interpretation |
| --- | --- | --- |
| [Nemotron final v3](../output/agent-captures/live-eval-fixes-v3-final/manifest.json) | 1/2 passed. Positive sizing produced valid JSON without repair in 17.49 seconds. Zero sizing produced an unstructured 2,048-token final response; its one formatting repair timed out at the 60-second case deadline. | Positive case: complete reported USD 0. Zero case: total unknown, observed subtotal USD 0. The full two-case run cannot be labelled measured zero-cost. |
| [Gemma final v3](../output/agent-captures/live-eval-fixes-v3-gemma/manifest.json) | First inference returned HTTP 429. Remaining case stopped; no model score and zero completed cases. | No complete billing observation; total unknown. |

The Nemotron [observations](../output/agent-captures/live-eval-fixes-v3-final/openrouter-nvidia_nemotron-3.5-lightning_free-30e50dc7.observations.json)
preserve the unstructured original draft, attempted repair, timeout and incomplete
usage. A preserved timeout is not a completed protocol-compliant answer. Gemma's
quota block is not a model-quality result. The follow-up versions below retain
these artifacts and failures rather than rewriting them into passing outcomes.

After these live captures, independent review tightened the formatting guard
against relabelling explicit prose advice to another symbol or portfolio. That
validation-only hardening changes the mechanics digest; it does not retroactively
change the recorded live hash or certify a new live run. The earlier artifacts
continue to identify the exact protocol they used.

The guarded version 3 implementation's later dry-run protocol hash was
`945caf66ff8b852b91c13692c37b96e95c5aa6df609dfc2f50516c15313ce4a4`.
It is covered by offline regression tests; the live captures above retain their
earlier mechanics hash.

At the version 3 checkpoint, Gemini's configured credential was rejected, free
Ling/Gemma capacity was rate-limited, and Nemotron's zero-size response had not
completed the strict output contract within its budget. Later changes and their
separate results follow.

## OpenRouter follow-ups: versions 4 and 5

OpenRouter capture and optional probe requests now explicitly disable reasoning.
The capture gateway records the actual visible content, finish reason and whether
reasoning was present. It rejects reasoning-only responses before the normal
provider's legacy reasoning fallback. Truncated, filtered or errored completions
cannot become final answers or formatting-repair inputs, even if their visible
text happens to parse as JSON. Hidden reasoning text is not copied into the new
response records. Production gateway behavior remains unchanged.

The Lightning free endpoint did not advertise the necessary structured-output
parameters, so no unsupported response-format parameter or paid replacement was
added. Source changes are versioned; each row below retains its actual protocol
hash and original observations.

| Version and evidence | Fresh observed result | Interpretation |
| --- | --- | --- |
| [Version 4: reasoning/completion integrity](../output/agent-captures/live-eval-fixes-v4-reasoning/manifest.json) | Nemotron completed both cases with valid JSON, no capture failures and complete reported USD 0 billing. Score remained 1/2; mean case latency was 4.61 seconds. | The zero case chose an unavailable stock-snapshot query instead of the sizing calculator. Immediate tool-phase closure left the required sizing evidence missing. Completing JSON did not hide this tool-selection failure. |
| [Version 5: bounded query recovery](../output/agent-captures/live-eval-fixes-v5-recovery/manifest.json) | Both cases completed with valid JSON, complete reported USD 0 billing and correct sizing-tool selection. Score remained 1/2; mean case latency was 6.30 seconds. | The model recovered from the unavailable snapshot query and fetched sizing, but then attempted a simulated zero-quantity paper-order proposal in the zero case. The grader retained that failure. No order or real proposal executed. |

Version 4 records protocol hash
`a64d7b9b5d6ca0343fb30a8b3795ecdebd82202357f5cf5be52f485bea8bbc09`;
version 5 records
`38105c7a7ed075ed5cc7e1edbf73339600a36eed02582e31c9a67e771b83cb70`.
Both use the same two cases, fixture hash, four-step/2,048-token limits and
60-second deadline documented above. These changed capture protocols are separate
diagnostics, not paired model-ranking evidence. The version 3 timeout and unknown
billing remain preserved; the complete zero-cost observations in versions 4/5 do
not retroactively settle its interrupted request.

Recovery is uniform across fixtures. After a first unavailable exact query, the
capture loop allows the model to choose a distinct relevant tool/query within its
remaining budget. A repeated query or a second unavailable query closes the tool
phase. The harness never substitutes the expected argument values or expected
answer. The public sizing-tool description now explains that the calculator
already uses holdings, cash, marked prices and risk limits internally.

## Version 6 action-intent discipline

Version 6 reuses the same `ACTION_INTENT_DISCIPLINE` in the production playbook and
capture prompt. A research, estimate or sizing request does not authorize an order
proposal; a zero-size result must never become a zero-quantity order. This closes
a prompt-consistency gap exposed by version 5 rather than changing the observed
zero-order attempt or treating it as successful behavior. Shared instructions
are still subject to model compliance; independent runtime approval and risk
checks remain necessary.

Two final version 6 runs used the same cases, fixture and limits, with protocol
hash `22a20a7e83ccdc9c6bafa873711851cda30ac3292114da4d23dcdc3a57e9cf89`.
Both targets were explicitly selected OpenRouter free models; neither was a paid
fallback. The prompt and grading contract were not changed between these two runs.

| Version 6 target and evidence | Fresh observed result | Remaining failure |
| --- | --- | --- |
| [Nemotron Lightning](../output/agent-captures/live-eval-fixes-v6-action-intent/manifest.json) | Both cases completed with valid JSON, complete reported USD 0 billing and correct sizing-tool selection. Mean case latency 14.06 seconds; strict score 1/2. | Despite the shared action-intent instruction, the zero case still attempted a simulated zero-quantity order. The grader rejected it; no order executed. |
| [Nemotron Super VL](../output/agent-captures/live-eval-fixes-v6-super-vl/manifest.json) | Both cases completed with valid JSON and complete reported USD 0 billing. Mean case latency 4.59 seconds; strict score 1/2. | The zero case passed without an action. The positive case supplied optional sizing arguments absent from the frozen evidence (`risk_budget_pct: 1`, `max_position_pct: 5`); exact lookup failed, its subsequent snapshot query also lacked evidence, and the model abstained rather than inventing a quantity. Required sizing evidence/recommendation was missing. |

Super VL's positive-case result is an exact frozen-argument coverage miss, not an
executed unsafe trade or proof that its alternative risk assumptions are inherently
invalid. The harness did not replace those arguments with expected fixture values
to force a pass. Lightning's zero-order attempt likewise remains in its original
observations rather than being removed during formatting or scoring.

Reasoning-only/truncated output and the earlier repair timeout did not recur in
these final version 6 captures. That does not mean either model passed both strict
cases or that future calls will behave the same way. No further live calls, prompt
tuning or grading changes were made after these results. Gemini credential
rejection and free-provider quota blocks remain external statuses, not
model-performance scores. Software-test verification of the final source is
recorded separately from these live model outcomes.

## Reproduce a credential check

Use a fresh output directory; the following performs no case inference:

```sh
.venv/bin/python -m backend.evaluation.capture --preflight-only \
  --provider gemini --model gemini-3.8-flash \
  --output-dir output/agent-captures/new-gemini-health-check
```

Full commands, output contracts and test entry points are documented in the
[evaluation README](../backend/evaluation/README.md). Software regression tests
use scripted responses/HTTP transports and are separate from the live outcomes
above. Neither software-test passes nor catalog readiness establish trading
accuracy, provider availability or future model reliability.

## Version 3 software verification, preserved

- Full backend suite: **2,307 passed**, 18 warnings, in 151.86 seconds.
- After the final signed-quantity parsing fix: **82 targeted tests passed** across
  output protocol, deadline/billing budget and independent evaluation QC suites.
  These include rejecting both negative-to-positive quantity changes and omitted
  negative advice during formatting. The full-suite run preceded that narrow fix;
  the targeted supplement verified it afterward.
- Dry-run smoke check and `git diff --check` passed. Documentation links resolve.

The full-suite log is `/tmp/openterminal-live-eval-v3-backend.log`. Frontend code
was unchanged by these evaluation fixes; the earlier frontend checks are recorded
in the roadmap delivery.

## Final version 6 software verification

- Full backend suite: **2,329 passed**, 18 warnings, in 155.08 seconds.
  Log: `/tmp/openterminal-live-eval-final-backend.log`.
- Independent capture, completion-integrity and budget checks: **85 passed**,
  covering bounded distinct-query recovery, unchanged recovery defaults, shared
  action-intent instructions, incomplete response rejection and preserved evidence.
- Provider, probe and completion-integrity checks: **66 passed**.
- Documentation links and `git diff --check` passed. Frontend code was unchanged.

These software results verify the implementation; the two version 6 model scores
remain 1/2 each as recorded above.
