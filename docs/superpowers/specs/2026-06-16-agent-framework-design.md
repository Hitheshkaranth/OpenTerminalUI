# OpenTerminalUI Agent Framework — Design Spec

**Date:** 2026-06-16
**Status:** Approved (design); implementation phased
**Author:** Architecture/PM (Claude)

---

## 1. Goal

Add an **agentic AI layer** on top of OpenTerminalUI's existing ~60 backend tool
domains. A user configures an LLM (via a multi-provider abstraction, OpenRouter
primary) and converses with an agent in a new **Home / Agent Console**. The agent
performs multi-step financial analysis to **determine stocks** — screening,
valuation, peer comparison, risk, factors, technicals, sentiment, backtesting —
and can take actions on the platform, with **all order placement gated behind
explicit human approval**.

This document captures the **full target architecture**. Implementation is
**phased** (Section 9); the first implementation plan covers **Phase 1** only.

---

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Agent scope | **Full, including trading** | User-selected; analysis + soft writes + order proposal. |
| Order execution | **All orders (paper & live) require human approval** | Agent is execution co-pilot; nothing hits OMS without an Approve click. |
| Soft writes (alerts, watchlists, journal) | **Autonomous within rate/limit guardrails** | Low blast radius; keeps the agent useful without constant interruption. |
| Model/provider config | **Multi-provider abstraction** (OpenRouter / OpenAI / LM Studio interchangeable), **BYO key per user**, encrypted at rest; server config fallback | OpenRouter & OpenAI are OpenAI-compatible → one base impl; LM Studio reused for local tasks. |
| Tool catalog | **Hybrid**: curated typed core (~18 tools) **+** dynamic meta-tool over a whitelist of read-only routes | Keeps tool-def context small while reaching the long tail of domains. |
| Orchestration engine | **Lightweight native tool-calling loop** (no LangGraph/MCP dependency in v1) | Clean httpx/FastAPI codebase, security-sensitive; native OpenAI-compatible function-calling suffices. |
| Console UX | **Chat thread + live artifact canvas** (SSE-streamed) | Feels like a financial Claude/Cursor; reuses existing table/chart/card components. |
| Console placement | **Global, invokable from any screen** — a keyboard-invokable slide-over panel mounted in the app shell; a full-page version is reachable from Home | The agent is an ambient co-pilot available everywhere, not a single route. |
| Screen context | The console captures the **current screen's context** (route, active symbol, selection) and injects it into the run | "Value this" on a StockDetail page just works without retyping the ticker. |
| Build order | **Phased** (read-only → soft writes/meta-tool/persistence → order HITL) | Large scope; each phase ships value and gets its own plan. |

---

## 3. High-level architecture

```
FRONTEND (React)  — Home = Agent Console
  Chat thread + approval cards  <—— SSE (tokens + tool events) ——  Artifact Canvas
        │  POST /api/agent/runs · GET /runs/{id}/stream · POST /runs/{id}/approve
        ▼
BACKEND (FastAPI)
  Agent Orchestrator (native tool-calling loop)
    plan → LLM.chat(tools) → tool_calls → Tool Registry execute → feed results → repeat
        │                    │                         │
   LLM Provider        Tool Registry            Guardrail & Approval Engine
   Abstraction         curated core + dynamic   risk limits, order HITL, audit
   (OpenRouter/        meta-tool over whitelist
    OpenAI/LMStudio)
        └──────────── reuses existing services ────────────┘
        screener.engine, valuation, risk_engine, portfolio_analytics,
        marketdata_hub, oms, sentiment_engine, pattern_recognition, ...
```

**Invariant:** the orchestrator never calls an LLM endpoint, an internal service,
or the OMS with raw, unchecked input. Every outbound action passes through the
Provider Abstraction, the Tool Registry, or the Guardrail Engine.

---

## 4. Backend components

### 4.1 LLM Provider Abstraction — `backend/services/llm/`
- `LLMProvider` protocol: `async chat(messages, tools, stream) -> AsyncIterator[Delta]`
  where `Delta` carries token text and/or partial `tool_calls`.
- `OpenAICompatibleProvider` base (httpx, `/v1/chat/completions`, `tools`,
  `tool_choice`); subclasses set base_url/auth/headers:
  - `OpenRouterProvider` (primary), `OpenAIProvider`, `LMStudioProvider`
    (generalizes existing `lm_studio_client.py`; JSON-mode shim for models
    lacking native function-calling).
- **Config resolution per run:** user-selected provider + model + key (BYO,
  encrypted via the repo's existing secrets/`api_keys` pattern) → fallback to
  server config in `backend/config/settings.py` (add `openrouter_*` settings).

### 4.2 Tool Registry — `backend/agent/tools/`
Each tool: `{ name, json_schema, handler, read_only, write_class }` where
`write_class ∈ {none, soft, order}`. Handlers call **internal services**, not HTTP.

**Curated core (~18):**
- Analysis (read): `screen_stocks`, `get_quote`, `get_fundamentals`,
  `value_stock`, `compare_peers`, `get_chart_series`, `get_technicals`,
  `get_risk_metrics`, `factor_exposure`, `correlation`, `sentiment_news`,
  `pattern_scan`, `backtest_idea`.
- Context (read): `get_portfolio`, `get_watchlist`.
- Soft writes: `create_alert`, `upsert_watchlist`, `write_journal_note`.
- Order (HITL): `propose_order` — **never executes**; emits an approval artifact.

**Dynamic meta-tool:** `list_capabilities(domain)` + `call_endpoint(name, params)`
over an explicit whitelist of read-only GET routes (derived from FastAPI OpenAPI,
filtered). Non-whitelisted or mutating routes are hard-blocked.

### 4.3 Agent Orchestrator — `backend/agent/orchestrator.py`
- Async tool-calling loop with **max-step budget**, **per-run token/cost ceiling**,
  and **wall-clock timeout**.
- Emits typed SSE events: `token`, `tool_call`, `tool_result`, `artifact`,
  `approval_required`, `final`, `error`.
- On `write_class == order`: loop **pauses**, persists run state, emits
  `approval_required`; resumes on `/approve`, aborts on reject. Soft writes run
  inline within guardrails.

### 4.4 Guardrail & Approval Engine — `backend/agent/guardrails.py`
- **All orders require approval** (paper & live); execution routed through existing
  **OMS** with its immutable audit trail.
- Pre-trade risk via `risk_engine` (notional caps, per-symbol limits, kill switch).
- Soft-write rate limits; meta-tool route-whitelist enforcement.
- Reuse existing AST/sandbox safety (no `eval`, block dunder traversal) for **any
  expression the agent generates** — screener formulas, backtest scripts. See the
  exec-sandbox hardening already in `scripting.py` / `strategy_runner.py`.

### 4.5 Persistence — `backend/agent/models.py` + Alembic migration
- `agent_runs`, `agent_messages`, `agent_tool_calls`, `agent_approvals` — full
  transcript, tool I/O, and approvals for audit/replay. Order approvals link to the
  OMS audit record.

### 4.6 API surface — `backend/api/routes/agent.py`
- `POST /api/agent/runs` — start a run (prompt + optional context).
- `GET  /api/agent/runs/{id}/stream` — SSE event stream.
- `POST /api/agent/runs/{id}/approve` — approve a pending order; `/cancel` to abort.
- `GET  /api/agent/runs` — run history.
- `GET/PUT /api/agent/config` — provider, model, BYO key, enabled tools, risk limits.

Auth: reuse existing auth; `user_id` from the auth token (the current `ai.py`
mock `default_user` is replaced).

---

## 5. Frontend — Global Agent Console

The console is **globally available on every screen**, not a single route.

- **Mount point:** a top-level `AgentConsole` mounted once in the app shell
  (`App.tsx` layout), so it overlays the current page regardless of route. State
  lives in a Zustand store so a run survives navigation between screens.
- **Invocation:** keyboard hotkey (e.g. `Ctrl/Cmd+K` or a dedicated chord, honoring
  the platform's keyboard-first requirement) **and** a persistent launcher button in
  the shell chrome. Toggling open/closed does not interrupt an in-flight run.
- **Form factor:** a **slide-over panel** (right-docked drawer) over the current
  screen. A **full-page version** is reachable from Home for an expansive workspace;
  both render the same chat + artifact components. Current Home content moves to a
  "Markets" dashboard tab.
- **Screen context:** on open, the console reads the active route's context provider
  (current symbol, selected rows, timeframe) and offers it to the run, so prompts
  like "value this" or "compare these" resolve against what the user is looking at.
  Each screen exposes its context via a small `useScreenContext()` contract.
- **Left — chat thread:** streamed tokens, collapsible tool-step trace
  ("ran `screen_stocks` → 18 results"), inline **approval cards** for orders.
- **Right — artifact canvas:** typed renderers keyed off `artifact` events, reusing
  existing components — `TerminalTable`/`DataGrid` (screener results), existing chart
  component (chart artifacts), valuation/risk cards, and a new **OrderConfirmCard**
  that calls `/approve`. In the slide-over form factor the canvas stacks below the
  chat; in full-page it sits side-by-side.
- **Transport:** SSE via fetch-stream into the Zustand store. Must honor the project's
  React infinite-loop rules: module-level stable empty refs, `useMemo` on
  `chartPointsToBars()` calls, functional `setState` bail-outs.
- **Settings → Agent tab:** provider (OpenRouter/OpenAI/LM Studio), model picker
  (OpenRouter catalog fetch), BYO key entry, per-tool enable toggles, risk limits.

---

## 6. Data flow (example: "find cheap quality midcaps and propose a position")

1. Frontend `POST /api/agent/runs` with the user prompt **+ current screen context**
   (route, active symbol, selection) → run created → opens SSE.
2. Orchestrator calls LLM with tool defs → LLM emits `screen_stocks(filters)`.
3. Registry runs `screener.engine` → results → `artifact: screener_table` event.
4. LLM calls `value_stock` / `get_risk_metrics` on top names → more artifacts.
5. LLM calls `propose_order` → guardrails build an order proposal + risk check →
   `approval_required` event; loop pauses, state persisted.
6. User clicks Approve → `POST /approve` → OMS executes (paper/live) with audit →
   loop resumes → `final` summary.

---

## 7. Error handling

- Provider errors (auth/rate/timeout): surfaced as `error` events; run marked failed;
  no partial side effects for orders (orders only ever execute post-approval).
- Tool errors: returned to the LLM as a structured tool result so it can recover or
  report; logged to `agent_tool_calls`.
- Budget/timeout exceeded: loop halts with a graceful `final` explaining the limit.
- Meta-tool whitelist violation or write outside guardrails: hard error, audited,
  never silently executed.

---

## 8. Testing strategy

- **Provider abstraction:** unit tests with mocked httpx for each provider; shim test
  for LM Studio JSON mode.
- **Orchestrator:** loop tests with a fake LLM that returns scripted tool_calls;
  assert event sequence, budget/timeout enforcement, approval pause/resume.
- **Tool registry:** each curated tool tested against existing service mocks
  (`mock_kite`, `mock_finnhub`, `mock_fmp`); schema validation tests.
- **Guardrails:** order-always-requires-approval test; risk-limit rejection; meta-tool
  whitelist enforcement; generated-expression sandbox safety (regression alongside
  `test_exec_sandbox_escape_safety.py`).
- **Frontend:** Vitest for store/event-reducer (no infinite loops); Playwright e2e for
  a full chat → artifact → approval flow against a mocked agent stream.
- **Gates:** 0 pytest failures, 0 build errors, 0 Vitest failures.

---

## 9. Phasing (each phase = its own plan → implementation cycle)

- **Phase 1 — Agent core, read-only.** Provider abstraction (OpenRouter first),
  orchestrator loop, ~10 read tools, SSE, **global slide-over console mounted in the
  app shell** (hotkey + launcher) with screen-context injection, Settings model
  config. Delivers "determining stocks" end-to-end from any screen. *(First
  implementation plan.)*
- **Phase 2 — Soft writes + dynamic meta-tool + persistence/history + full config UI.**
- **Phase 3 — Order HITL.** `propose_order`, approval cards, OMS integration, risk
  guardrails, audit linkage.

---

## 10. Out of scope (v1)

- Fully autonomous live trading (explicitly rejected; all orders need approval).
- Heavyweight agent frameworks (LangGraph) and a standalone MCP server.
- Multi-agent orchestration / saved-agent roster (the "agent workbench" UX variant).
- Voice, mobile, or external API exposure of the agent.
