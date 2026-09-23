"""MCP prompts: named, parameterised workflows for the agent to run.

A tool is a single call; a prompt is a proven sequence of calls plus the
judgment calls in between, written down so the agent doesn't reinvent — or
skip — them. Every prompt below names the actual tools it expects to drive
(see ``backend/agent/tools/`` for their handlers) and every one ends with an
explicit instruction to state data provenance.

That instruction is load-bearing, not boilerplate: the provider waterfall
(Kite/NSE/Finnhub -> Yahoo/FMP -> synthetic mock) falls back silently in some
deployments, particularly in Docker where the live providers reject the
container. A tool envelope's ``provenance.quality`` field says ``live``,
``delayed``, ``cached``, or ``synthetic``; a prompt that lets the agent quote
a synthetic price as if it were a live one is the exact failure mode these
prompts are designed to prevent.
"""

from __future__ import annotations

from typing import Any

_PROVENANCE_INSTRUCTION = (
    "Every tool result carries a `provenance` block with a `quality` field "
    "(live, delayed, cached, or synthetic). When you report any number pulled "
    "from a tool, say plainly whether it is live, delayed, or synthetic data "
    "— synthetic is a mock fallback the provider waterfall emits when "
    "real providers are unreachable, and must never be reported as a real "
    "market figure. If any tool you call returns synthetic or unavailable "
    "quality, call out that limitation before drawing conclusions from it."
)


def _msg(text: str) -> dict[str, Any]:
    return {"role": "user", "content": {"type": "text", "text": text}}


# ---------------------------------------------------------------------------
# Prompt bodies
# ---------------------------------------------------------------------------

def _morning_brief(market: str | None) -> str:
    scope = f" Focus on the {market} market." if market else ""
    return (
        "You are producing a morning brief for the user before the trading day.\n\n"
        f"1. Call `get_portfolio` and `get_paper_positions` to see current exposure.{scope}\n"
        "2. Call `get_watchlists` and `get_stock_snapshot` (or `compare_stocks`) for the "
        "symbols on them to see what moved overnight.\n"
        "3. Call `get_alerts` to see which alerts are active and near trigger.\n"
        "4. Call `get_upcoming_events` for the user's holdings and watchlist symbols "
        "(earnings, dividends, corporate actions) over the next few days.\n"
        "5. Call `get_provider_status` once and keep the result in mind for step 6.\n"
        "6. Write a short, prioritised brief: biggest overnight movers in the portfolio "
        "first, then watchlist movers, then alerts close to firing, then upcoming events. "
        "Do not pad it with anything not tied to the user's actual holdings/watchlists.\n\n"
        f"{_PROVENANCE_INSTRUCTION}"
    )


def _position_review(ticker: str) -> str:
    return (
        f"You are reviewing the user's position in {ticker}.\n\n"
        f"1. Call `get_stock_snapshot` for {ticker} for current price and key stats.\n"
        f"2. Call `analyze_technicals` for {ticker} to assess trend, momentum, and levels.\n"
        f"3. Call `get_upcoming_events` scoped to {ticker} for anything that could move it "
        "soon (earnings, ex-dividend, etc.).\n"
        f"4. Call `get_portfolio` and `get_paper_positions` and pull out the user's actual "
        f"exposure to {ticker} — quantity, cost basis, current weight — from the results.\n"
        "5. Synthesize: does the technical picture support the current position size? "
        "End with an explicit hold / trim / add view and the reasoning behind it. This is "
        "a view for the user to weigh, not an instruction — do not call `propose_paper_order` "
        "unless the user separately asks you to act on it.\n\n"
        f"{_PROVENANCE_INSTRUCTION}"
    )


def _screen_to_thesis(criteria: str, market: str | None) -> str:
    scope = f" in the {market} market" if market else ""
    return (
        f"You are screening for names matching: {criteria}{scope}, then building a thesis.\n\n"
        f"1. Call `screen_stocks` with criteria derived from: {criteria}.\n"
        "2. For the top 3-5 results, call `get_stock_snapshot` and `analyze_technicals` to "
        "pull the numbers that actually justify each one qualifying.\n"
        "3. Optionally call `search_research` for each name if you need qualitative context "
        "(news, filings) the screener doesn't surface.\n"
        "4. Write a short thesis per name: 2-4 sentences stating the specific criterion (or "
        "criteria) it qualified on, with the actual numbers, not just 'it passed the screen.' "
        "Flag any name whose qualifying numbers came from delayed or synthetic data as "
        "lower-confidence.\n\n"
        f"{_PROVENANCE_INSTRUCTION}"
    )


def _risk_check() -> str:
    return (
        "You are running a risk check across the user's current holdings.\n\n"
        "1. Call `get_portfolio` and `get_paper_positions` to get every current holding "
        "and its weight.\n"
        "2. Concentration: identify any single name, sector, or theme that dominates the "
        "book — call `compare_stocks` across the largest holdings if it helps surface "
        "shared sector/factor exposure.\n"
        "3. Correlation: flag holdings that are likely to move together (same sector, same "
        "index, same macro driver) rather than treating position count as diversification.\n"
        "4. Event risk: call `get_upcoming_events` for every holding's symbol and flag "
        "anything with an event (earnings, macro print) inside the next 5-10 trading days.\n"
        "5. Summarize as a short risk memo: top concentration risk, top correlation risk, "
        "top event risk, in that order. Do not propose trades — this is diagnostic.\n\n"
        f"{_PROVENANCE_INSTRUCTION}"
    )


def _idea_to_backtest(idea: str) -> str:
    return (
        f"You are turning a stated trading idea into a testable rule set: {idea}\n\n"
        "1. Restate the idea as a precise, mechanical entry rule and exit rule — specific "
        "indicators, thresholds, and timeframes, not vague language. If the idea as stated "
        "is ambiguous, state the assumption you're making explicitly.\n"
        "2. If the idea implies a scan for candidates, call `scan_setups` or `screen_stocks` "
        "to find symbols matching the setup.\n"
        "3. Call `validate_backtest` on the rule set before running it, to catch look-ahead "
        "bias or an unreasonable parameter space.\n"
        "4. Call `backtest_symbol` (single name) or `backtest_basket` (the scanned universe) "
        "to test the rule set.\n"
        "5. Report the result with an explicit curve-fitting warning: a rule tuned to fit "
        "one backtest window is not validated by that same window. Call out small sample "
        "size, parameter counts that look tuned to the data, and the lack of an out-of-sample "
        "or walk-forward check if one wasn't run. Do not present a good backtest number as "
        "proof the idea works live.\n\n"
        f"{_PROVENANCE_INSTRUCTION}"
    )


# ---------------------------------------------------------------------------
# Prompt catalog
# ---------------------------------------------------------------------------

_PROMPTS: dict[str, dict[str, Any]] = {
    "morning_brief": {
        "description": "Walk the user's portfolio, watchlists, alerts and upcoming events into a prioritised morning brief.",
        "arguments": [
            {"name": "market", "description": "Optional market to focus on (e.g. NSE, US).", "required": False},
        ],
        "build": lambda args: _morning_brief(args.get("market")),
    },
    "position_review": {
        "description": "Snapshot + technicals + events + the user's own exposure for one ticker, ending in a hold/trim/add view.",
        "arguments": [
            {"name": "ticker", "description": "Ticker to review, e.g. NSE:RELIANCE.", "required": True},
        ],
        "build": lambda args: _position_review(_require(args, "ticker")),
    },
    "screen_to_thesis": {
        "description": "Screen for names matching criteria, then build a short written thesis for the top qualifiers.",
        "arguments": [
            {"name": "criteria", "description": "Screening criteria in plain language.", "required": True},
            {"name": "market", "description": "Optional market to scope the screen to.", "required": False},
        ],
        "build": lambda args: _screen_to_thesis(_require(args, "criteria"), args.get("market")),
    },
    "risk_check": {
        "description": "Concentration, correlation and event risk across current holdings.",
        "arguments": [],
        "build": lambda args: _risk_check(),
    },
    "idea_to_backtest": {
        "description": "Turn a stated trading idea into a testable rule set and validate it, warning against curve-fitting.",
        "arguments": [
            {"name": "idea", "description": "The trading idea in plain language.", "required": True},
        ],
        "build": lambda args: _idea_to_backtest(_require(args, "idea")),
    },
}


def _require(arguments: dict[str, Any], name: str) -> str:
    value = arguments.get(name)
    if not value:
        raise ValueError(f"missing required argument: {name}")
    return value


def list_prompts() -> list[dict[str, Any]]:
    """Return the MCP prompt catalog."""
    return [
        {"name": name, "description": spec["description"], "arguments": spec["arguments"]}
        for name, spec in _PROMPTS.items()
    ]


def get_prompt(name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """Render *name* with *arguments* into MCP prompt messages.

    Raises ``KeyError`` for an unknown prompt name (the transport layer is
    responsible for converting that into whatever error shape the client
    expects) and ``ValueError`` for a missing required argument.
    """
    spec = _PROMPTS[name]  # KeyError propagates on unknown name, by design
    text = spec["build"](arguments or {})
    return {"description": spec["description"], "messages": [_msg(text)]}
