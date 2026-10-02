from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional

import httpx
from backend.config.settings import get_settings
from backend.api.deps import get_unified_fetcher
from backend.services.lm_studio_client import (
    LMStudioError,
    get_lm_studio_client,
    parse_json_response,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
You are an expert financial AI assistant for OpenTerminalUI.
Parse the user's natural-language query and classify its intent.

Available intents:
1. screener_results - finding stocks by filters (e.g. "tech stocks PE < 20 ROE > 15").
2. data_table - lookups or comparisons of specific tickers (e.g. "compare AAPL and MSFT").
3. chart_command - navigate to a chart (e.g. "show AAPL 6 month chart").
4. text_answer - general questions or analysis.

Return ONLY a JSON object, no prose, no code fences:
{"intent": "intent_name", "params": { ... }, "explanation": "brief explanation"}

For 'chart_command': params has "ticker" and "range".
For 'data_table': params has "tickers" (list) and "metrics" (list).
For 'screener_results': params has "filters" - a list of {"field","op","value"} -
  and optionally "markets" (list of NSE/NYSE/NASDAQ) and "limit" (int).
  Valid filter fields: market_cap, pe_ratio, pb_ratio, ps_ratio, dividend_yield,
  revenue_growth_yoy, earnings_growth_yoy, roe, roa, debt_to_equity, current_ratio,
  beta, avg_volume_10d, price_change_1d, price_change_1w, price_change_1m,
  price_change_3m, price_change_6m, price_change_1y, sector, industry, country, exchange.
  Valid ops: gte, gt, lte, lt, eq, neq, contains.
  Example: "cheap tech stocks under PE 20" ->
  {"intent":"screener_results","params":{"filters":[
    {"field":"pe_ratio","op":"lt","value":20},
    {"field":"sector","op":"contains","value":"Tech"}]},
   "explanation":"Technology stocks with P/E below 20"}
"""

class AIQueryService:
    def __init__(self):
        self.settings = get_settings()
        self.history = []
        self.rate_limits = {} # simple user_id -> [timestamps]

    async def query(self, user_id: str, query_text: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Process a natural language query."""
        if not self._check_rate_limit(user_id):
            return {"type": "text_answer", "data": "Rate limit exceeded. Max 20 queries per hour.", "explanation": "Rate limit"}

        # 1. Classify Intent using LLM
        try:
            llm_response = await self._call_llm(query_text)
            intent_data = parse_json_response(llm_response)
        except Exception as e:
            logger.error(f"AI classification error: {e}")
            return {"type": "text_answer", "data": f"Error processing query: {str(e)}", "explanation": "Error"}

        intent = intent_data.get("intent")
        params = intent_data.get("params", {})
        explanation = intent_data.get("explanation", "")

        # 2. Execute Action based on Intent
        if intent == "chart_command":
            ticker = params.get("ticker", context.get("active_symbol", "AAPL")).upper()
            return {
                "type": "chart_command",
                "data": {"url": f"/equity/security/{ticker}?tab=chart"},
                "explanation": explanation
            }

        if intent == "data_table":
            tickers = params.get("tickers", [context.get("active_symbol", "AAPL")])
            fetcher = await get_unified_fetcher()
            results = []
            for t in tickers:
                try:
                    quote = await fetcher.yahoo.get_quotes([t])
                    if quote:
                        results.append(quote[0])
                except Exception:
                    continue
            return {
                "type": "data_table",
                "data": results,
                "explanation": explanation
            }

        if intent == "screener_results":
            rows, skipped = await self._run_screener(params)
            if skipped:
                note = (f"No {', '.join(skipped)} data is available for these markets, "
                        "so that filter was skipped.")
                explanation = f"{explanation} {note}".strip() if explanation else note
            return {
                "type": "screener_results",
                "data": rows,
                "explanation": (
                    explanation or f"Found {len(rows)} stocks matching your criteria."
                ) if rows else (
                    f"{explanation} (no stocks matched, or filters were not understood)."
                    if explanation else "No stocks matched your criteria."
                ),
            }

        # Fallback to text
        return {
            "type": "text_answer",
            "data": explanation,
            "explanation": explanation
        }

    async def _call_llm(self, query: str) -> str:
        # Prefer the locally hosted Gemma model via LM Studio; no API key needed.
        if self.settings.lm_studio_enabled:
            try:
                return await self._call_lmstudio(query)
            except Exception as exc:  # noqa: BLE001 - fall through to other providers
                logger.warning(f"LM Studio call failed, falling back: {exc}")
        if self.settings.ai_provider == "openai" and self.settings.openai_api_key:
            return await self._call_openai(query)
        return await self._call_ollama(query)

    async def _call_lmstudio(self, query: str) -> str:
        client = get_lm_studio_client()
        # Call directly: a busy gateway can miss the short health probe yet answer the request.
        return await client.chat(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": query},
            ],
            temperature=0.1,
            max_tokens=400,
        )

    async def _run_screener(self, params: Dict[str, Any]) -> tuple[List[Dict[str, Any]], List[str]]:
        """Execute the real multi-market screener from LLM-extracted filters.

        Returns (rows, skipped_fields). A filter on a field no row in the universe has (debt_to_equity
        today) used to zero the whole result silently; it is dropped and reported instead.
        """
        from backend.api.routes.screener import (
            SCAN_ALLOWED_FIELDS,
            SCAN_ALLOWED_OPS,
            ScreenerScanRequest,
            run_multimarket_scan,
        )

        raw_filters = params.get("filters")
        if not isinstance(raw_filters, list):
            return [], []
        valid_filters: List[Dict[str, Any]] = []
        for entry in raw_filters:
            if not isinstance(entry, dict):
                continue
            field = str(entry.get("field", "")).strip().lower()
            op = str(entry.get("op", "")).strip().lower()
            if field in SCAN_ALLOWED_FIELDS and op in SCAN_ALLOWED_OPS:
                valid_filters.append({"field": field, "op": op, "value": entry.get("value")})
        if not valid_filters:
            return [], []

        markets = [str(m).strip().upper() for m in (params.get("markets") or []) if str(m).strip()]
        try:
            limit = max(1, min(50, int(params.get("limit") or 25)))
        except (TypeError, ValueError):
            limit = 25

        markets = markets or ["NSE", "NYSE", "NASDAQ"]

        async def scan(filters: List[Dict[str, Any]], n: int) -> List[Dict[str, Any]]:
            result = await run_multimarket_scan(ScreenerScanRequest(markets=markets, filters=filters, limit=n))
            rows = result.get("rows", []) if isinstance(result, dict) else []
            return rows if isinstance(rows, list) else []

        try:
            rows = await scan(valid_filters, limit)
            if rows:
                return rows, []
            universe = await scan([], 500)

            def has_data(field: str) -> bool:
                for row in universe:
                    value = row.get(field)
                    if value is not None and value == value and value != "":  # value == value drops NaN
                        return True
                return False

            skipped = sorted({f["field"] for f in valid_filters if not has_data(f["field"])})
            if not skipped:
                return [], []
            kept = [f for f in valid_filters if f["field"] not in skipped]
            return (await scan(kept, limit) if kept else []), skipped
        except Exception as exc:  # noqa: BLE001 - screener failures degrade to empty
            logger.error(f"AI screener execution failed: {exc}")
            return [], []

    async def _call_openai(self, query: str) -> str:
        if not self.settings.openai_api_key:
            raise ValueError("OpenAI API Key not set")

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
                json={
                    "model": "gpt-4-turbo-preview",
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": query}
                    ],
                    "response_format": {"type": "json_object"}
                }
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    async def _call_ollama(self, query: str) -> str:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self.settings.ollama_base_url}/api/chat",
                json={
                    "model": "llama3", # or configurable
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": query}
                    ],
                    "stream": False,
                    "format": "json"
                }
            )
            resp.raise_for_status()
            return resp.json()["message"]["content"]

    def _check_rate_limit(self, user_id: str) -> bool:
        now = time.time()
        hour_ago = now - 3600
        if user_id not in self.rate_limits:
            self.rate_limits[user_id] = []

        # Clean old
        self.rate_limits[user_id] = [t for t in self.rate_limits[user_id] if t > hour_ago]

        if len(self.rate_limits[user_id]) >= 20:
            return False

        self.rate_limits[user_id].append(now)
        return True

_ai_service: Optional[AIQueryService] = None

def get_ai_query_service() -> AIQueryService:
    global _ai_service
    if _ai_service is None:
        _ai_service = AIQueryService()
    return _ai_service
