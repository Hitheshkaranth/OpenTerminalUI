# Research dossiers

Dossiers preserve a user's company thesis, assumptions, catalysts, invalidation conditions, and supporting/opposing/neutral evidence. They are private by default and scoped by authenticated user. Evidence is analyst-curated: monitoring never rewrites it or silently changes the thesis.

## API

All endpoints are under `/api/research/dossiers` and require the normal user authentication except the token-based shared snapshot reader.

| Method | Path | Result |
|---|---|---|
| GET | `/` | `{items}`; optional `symbol` and `limit` |
| POST | `/` | New dossier, HTTP 201 |
| GET / PATCH / DELETE | `/{id}` | Read, update, delete owned dossier |
| GET | `/{id}/revisions` | Immutable snapshots and structured changes, newest first |
| POST | `/{id}/monitor` | Compare supplied evidence or scan ingested filings |
| GET | `/{id}/export` | Versioned evidence/run export with SHA-256 |
| POST / DELETE | `/{id}/share` | Create/rotate or revoke a read-only snapshot link |
| GET | `/shared/{token}` | Public read-only frozen snapshot |
| GET | `/{id}/search?q=...` | Search this company's ingested filings |
| GET | `/{id}/passages/{chunk_id}` | Full passage with document and page reference |

Create fields: `title`, `symbol`, `market`, `thesis`, `assumptions[]`, `catalysts[]`, `invalidation_conditions[]`, `evidence[]`, `linked_run_ids[]`, optional `portfolio_id`, `monitoring_enabled` (false), and `materiality_threshold` (5 percent). Run and portfolio links must belong to the caller.

Evidence fields: `id`, `claim`, `stance` (`supporting`, `opposing`, `neutral`), optional `source_url`, `source_title`, `quote`, `published_at`, `observed_at`, `metric`, numeric `value`, `unit`, `document_id`, and `page`. Preserve an evidence ID across metric updates for comparisons. Source dates accept ISO datetime strings. URLs must use HTTP(S).

Send `expected_revision` with PATCH to reject an edit based on stale state (HTTP 409). Full payload validation also applies to patches. Concurrent writes are additionally protected by a SQLAlchemy version column. A revision is created for content changes and observed evidence changes; checking unchanged evidence does not create duplicate history.

## Monitoring

`POST /{id}/monitor` accepts `{evidence: [...]}`. An omitted body or `{}` scans locally ingested filings. It does not fetch new filings, call a model, or place trades. Existing filings ingestion/watch services remain responsible for importing documents.

Numeric change uses `abs((new - old) / old) * 100` for matching metric and unit. Zero-to-nonzero is represented as a 100% change. Stance changes and new evidence are material; changes below the configured numeric threshold remain in history without a notification. Repeated observations are deduplicated independently of `observed_at`. A material batch creates one in-app notification. Monitoring preserves the user-curated evidence, with observations retained separately.

The scheduler checks enabled dossiers every 15 minutes. Disable it globally with `RESEARCH_DOSSIER_MONITOR_ENABLED=0`. Local filing candidates are drawn from up to 50 recent documents imported since dossier creation, constrained to the dossier symbol and optional market. Matching uses thesis/invalidation keyword overlap. These are explicitly neutral review candidates, not automatically verified contradictions. Published dates are retained separately from ingestion dates.

## Sharing and reproducibility

Sharing publishes a frozen copy of the current dossier. Linked run IDs, private run content, and portfolio linkage are excluded. The user should review the dossier's own prose and evidence before sharing. Sharing again rotates the token; revocation invalidates access. Editing the private dossier never silently updates the public snapshot.

Exports include the current dossier, observed monitoring evidence, and owned linked runs with prompts, final answers, grounding, and persisted runtime payloads where available. `schema_version=1` and `kind=openterminal.research-dossier` identify the format. To verify `sha256`, remove the `sha256` field, JSON-serialize with sorted keys, separators `(',', ':')`, UTF-8 and unescaped Unicode, then compute SHA-256.

An export freezes stored evidence, not all external data used by every engine. Historical market-data availability and LLM nondeterminism remain explicit limitations. Never label a later restated filing as information known at an earlier analysis date.

## Retrieval

Optional search parameters: `as_of=YYYY-MM-DD`, `filed_after=YYYY-MM-DD`, `period`, `hybrid=true`. Date filters use filing publication dates and exclude unknown dates. `as_of` is inclusive. Local hybrid retrieval blends word and character TF-IDF; it requires no model credentials. It is not embedding-based semantic search. Numeric/table-like passages receive a modest relevance boost when the query concerns numeric financial information. Results preserve the full passage, page span, document ID and content hash.

Python callers may pass an optional reranker callback to `backend.filings_rag.retrieve.search`. It may reorder known candidates but cannot inject new evidence. The vectorizer cache keys corpus content, so replacement documents with the same number of chunks do not reuse stale vocabulary.

## Validation

`pytest backend/tests/test_research_dossiers.py backend/tests/test_filings_retrieval_filters.py`

Tests cover ownership, immutable history, stale edits, input validation, private run links, share revocation and snapshot isolation, monitoring deduplication/materiality, export hashes, historical date exclusion, passage references, and cache invalidation.

## Frozen backtest experiments

`POST /api/research/experiments` creates a private immutable SMA experiment. Required fields: title, symbol, provider, data_version, adjustment_policy (`raw`, `split_adjusted`, `total_return_adjusted`), timezone-aware `as_of`, `train_end`, `validation_start`, explicit fee_bps/slippage_bps, and `bars` (date, available_at, open, high, low, close, volume). Optional dossier_id links an owned dossier. SMA defaults are short_window=20 and long_window=50; initial_cash=100000 and allow_short=false.

This is a distinct frozen-input execution path, not a claim that legacy backtest records contain full replay inputs. The API rejects missing availability timestamps, future data, unknown source labels, duplicate/non-increasing timestamps, invalid OHLC ranges and overlapping validation intervals. The decision timestamp is the supplied bar `date`; `available_at` must be at or before it. Signal fills are delayed one bar. Warmup uses earlier bars only, and training/validation run separately with fixed parameters. No optimizer inspects the validation results.

`GET /api/research/experiments?dossier_id=...` lists owned experiments. `GET /{id}` downloads the full immutable snapshot. `POST /{id}/replay` recomputes from frozen rows with no provider requests, returning `matches`. Replay rejects modified snapshot content or a changed Python/dependency/engine identity. Inputs include raw bars, content hash, resolved execution config, source/version identifiers, adjustment policy, date bounds and validation policy. The source/publication declarations are caller-supplied and cannot establish historical correctness independently; the API enforces their internal consistency. This first replay engine is deliberately restricted to single-instrument SMA and makes no survivorship/universe claim.

Run `pytest backend/tests/test_research_experiments.py` for fee impact, deterministic replay, integrity, user isolation and point-in-time rejection coverage.
