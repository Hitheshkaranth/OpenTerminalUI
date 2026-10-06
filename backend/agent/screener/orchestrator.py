from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, AsyncGenerator

from backend.agent import events
from backend.core.provenance import make_provenance
from backend.screener.engine import ScreenerEngine
from backend.screener.parser import parse_query
from backend.screener.presets import list_presets
from backend.services.llm.base import LLMMessage


class ScreenerAgentOrchestrator:
    def __init__(self, *, provider: Any, engine: Any = None) -> None:
        self.provider = provider
        self.engine = engine or ScreenerEngine()

    @staticmethod
    def _json_number(value: Any) -> float | None:
        try:
            f = float(value)
        except (TypeError, ValueError):
            return None
        return f if math.isfinite(f) else None

    @staticmethod
    def _display_value(value: Any) -> str:
        if value is None:
            return "n/a"
        try:
            if value != value:
                return "n/a"
            if isinstance(value, float) and math.isinf(value):
                return "n/a"
        except TypeError:
            pass
        if isinstance(value, float):
            return f"{value:.2f}"
        return str(value)

    _FUNDAMENTAL_KEYS = (
        "pe", "roe", "roce", "debt_equity", "revenue_growth", "opm", "market_cap", "promoter_holding",
    )

    @classmethod
    def _fundamentals(cls, row: Any) -> dict[str, str]:
        data = row.iloc[0]
        return {key: cls._display_value(data[key]) for key in cls._FUNDAMENTAL_KEYS if key in row.columns}

    @staticmethod
    def _group_passed(passed: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for preset in passed:
            grouped[str(preset.get("category") or "other")].append(preset)
        return dict(grouped)

    @staticmethod
    def _membership_markdown(
        symbol: str,
        grouped: dict[str, list[dict[str, Any]]],
        passed_count: int,
        evaluated_count: int,
    ) -> str:
        lines = [f"## Screen memberships for {symbol}", ""]
        if grouped:
            for category in sorted(grouped):
                lines.append(f"**{category}**")
                for preset in sorted(grouped[category], key=lambda item: str(item.get("name") or "")):
                    lines.append(f"- {preset.get('name') or preset.get('id')}")
                lines.append("")
        else:
            lines.extend(["No built-in preset screens qualified for this stock.", ""])
        lines.append(f"Qualifies under {passed_count} of {evaluated_count} screens.")
        return "\n".join(lines).strip()

    @staticmethod
    def _fundamentals_markdown(fundamentals: dict[str, str]) -> str:
        if not fundamentals:
            return "Key fundamentals: unavailable"
        values = ", ".join(f"{key}: {value}" for key, value in fundamentals.items())
        return f"Key fundamentals: {values}"

    @staticmethod
    def _failed_categories(grouped: dict[str, list[dict[str, Any]]], presets: list[dict[str, Any]]) -> list[str]:
        all_categories = {str(preset.get("category") or "other") for preset in presets}
        passed_categories = set(grouped)
        return sorted(all_categories - passed_categories)

    _US_MARKETS = {"US", "USA", "NASDAQ", "NYSE", "AMEX"}

    @staticmethod
    def _looks_like_ticker(value: str) -> bool:
        # A ticker is short and has no spaces; a typed prompt ("which screens does this
        # stock fit") is neither, so we should fall back to the context symbol instead.
        token = (value or "").strip()
        return bool(token) and " " not in token and len(token) <= 15

    def _find_row(self, candidates: list[str], market: str | None):
        """Locate the stock row across the market-appropriate universe(s).

        Returns (row, symbol_used). Tries the US and IN universes so that US tickers
        (S&P 500) resolve as well as Indian ones (Nifty 500), regardless of which
        market the caller passed.
        """
        market_code = (market or "").strip().upper()
        us_first = market_code in self._US_MARKETS
        # Use the broadest available universe ("all") for each market so coverage is not limited to
        # the Nifty 500 / S&P 500 index members.
        # "all" is not a universe key: the loader fell back to the NSE list for both markets, so US
        # tickers (AAPL) were never found. Use each market's broadest real universe.
        universes = (
            [("us_all", "US"), ("all_nse", "IN")]
            if us_first
            else [("all_nse", "IN"), ("us_all", "US")]
        )
        wanted = [c.strip().upper() for c in candidates if c and c.strip()]
        for universe, mkt in universes:
            try:
                df = self.engine._load_data(universe, market=mkt)
            except Exception:
                continue
            if getattr(df, "empty", True) or "ticker" not in getattr(df, "columns", []):
                continue
            tickers = df["ticker"].astype(str).str.upper()
            for sym in wanted:
                row = df[tickers == sym]
                if not getattr(row, "empty", True):
                    return row, sym
        return None, (wanted[0] if wanted else "")

    async def run(
        self,
        ticker: str,
        *,
        screen_context: dict[str, Any] | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        final_yielded = False
        fallback = "Unable to complete the screener profile."
        try:
            ctx = screen_context or {}
            # Prefer an explicit ticker; if the caller passed a whole prompt (e.g. from the
            # agent console), fall back to the symbol the user is currently looking at.
            candidates: list[str] = []
            if self._looks_like_ticker(ticker):
                candidates.append(ticker.strip().upper())
            ctx_symbol = str(ctx.get("symbol") or "").strip().upper()
            if ctx_symbol:
                candidates.append(ctx_symbol)
            if not candidates and ticker:
                candidates.append(ticker.strip().upper())

            yield events.phase("memberships", "Screen membership scan")

            row, symbol = self._find_row(candidates, ctx.get("market"))
            if row is None or getattr(row, "empty", True):
                note = f"{symbol or ticker} is not in the screener universe, so screen membership cannot be computed."
                yield events.role_message("screens", note)
                final_yielded = True
                yield events.final(f"{note} Screen membership needs a stock covered by the screener's fundamentals dataset.")
                return

            presets = list_presets()
            passed: list[dict[str, Any]] = []
            evaluated_count = 0
            for preset in presets:
                try:
                    pq = parse_query(preset["query"])
                    res = row.query(pq.filter_expr, engine="python") if pq.filter_expr.strip() else row
                except Exception:
                    continue
                evaluated_count += 1
                if len(res) > 0:
                    passed.append(preset)

            grouped = self._group_passed(passed)
            fundamentals = self._fundamentals(row)
            # The fundamentals row is the ground truth for every figure in the interpretation; emit it as a
            # tool step so the grounding layer (and the user) can cite it.
            yield events.tool_call("screener-fundamentals", "screener_fundamentals", {"ticker": symbol})
            yield events.tool_result("screener-fundamentals", "screener_fundamentals", {
                "ticker": symbol,
                **{key: self._json_number(row.iloc[0][key]) for key in self._FUNDAMENTAL_KEYS if key in row.columns},
                "screens_passed": len(passed), "screens_evaluated": evaluated_count,
                "provenance": make_provenance("screener fundamentals store", "cached"),
            })
            membership_summary = self._membership_markdown(symbol, grouped, len(passed), evaluated_count)
            fundamentals_summary = self._fundamentals_markdown(fundamentals)

            yield events.role_message("screens", membership_summary)
            yield events.phase("synthesis", "Interpretation")

            failed_categories = self._failed_categories(grouped, presets)
            user_content = (
                f"{membership_summary}\n\n"
                f"{fundamentals_summary}\n\n"
                f"Categories with no qualifying screens: {', '.join(failed_categories) if failed_categories else 'none'}.\n"
                f"Screen context: {screen_context or {}}"
            )
            system_content = (
                "You are an equity screening analyst. Given which named screens a stock passes and "
                "its key fundamentals, explain what the profile implies (quality vs value vs momentum vs "
                "thematic tilt), call out contradictions, and note what categories it FAILS. Be concise, "
                "do not give buy/sell advice."
            )
            fallback = (
                f"{symbol} qualifies under {len(passed)} of {evaluated_count} evaluated preset screens. "
                f"{fundamentals_summary}."
            )
            resp = await self.provider.complete(
                [
                    LLMMessage(role="system", content=system_content),
                    LLMMessage(role="user", content=user_content),
                ],
                temperature=0.3,
                max_tokens=800,
            )
            final_yielded = True
            yield events.final((resp.content or "").strip() or fallback)
        except Exception as exc:
            yield events.error(str(exc))
            if not final_yielded:
                yield events.final(fallback)
