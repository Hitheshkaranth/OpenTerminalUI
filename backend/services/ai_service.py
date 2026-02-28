from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional

import httpx
from backend.config.settings import get_settings
from backend.api.deps import get_unified_fetcher

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
You are an expert financial AI assistant for OpenTerminalUI.
Your task is to parse user natural language queries and determine the intent.
Available intents:
1. screener_results: For queries about finding stocks based on filters (e.g., "tech stocks PE < 20").
2. data_table: For lookups or comparisons of data (e.g., "compare AAPL and MSFT revenue", "what is RELIANCE PE").
3. chart_command: For navigation to charts (e.g., "show AAPL 6 month chart").
4. text_answer: For general questions or analysis.

You must return a JSON object with the following structure:
{
  "intent": "intent_name",
  "params": { ... },
  "explanation": "A brief explanation of what you found or are doing."
}

For 'chart_command', include 'ticker' and 'range'.
For 'data_table', include 'tickers' (list) and 'metrics' (list).
For 'screener_results', include 'filters' as a dictionary of key-value pairs.
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
            intent_data = json.loads(llm_response)
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
                except:
                    continue
            return {
                "type": "data_table",
                "data": results,
                "explanation": explanation
            }

        if intent == "screener_results":
            # Mocking screener execution based on filters for now
            # In a real scenario, this would translate params['filters'] into a DB/screener engine query
            filters = params.get("filters", {})
            mock_screener_data = [
                {"symbol": "AAPL", "price": 175.50, "pe": 28.5, "sector": "Technology"},
                {"symbol": "MSFT", "price": 420.10, "pe": 35.2, "sector": "Technology"},
                {"symbol": "NVDA", "price": 890.00, "pe": 65.0, "sector": "Technology"}
            ]
            return {
                "type": "screener_results",
                "data": mock_screener_data,
                "explanation": explanation or f"Found stocks matching your criteria: {filters}"
            }

        # Fallback to text
        return {
            "type": "text_answer",
            "data": explanation,
            "explanation": explanation
        }

    async def _call_llm(self, query: str) -> str:
        if self.settings.ai_provider == "openai":
            return await self._call_openai(query)
        else:
            return await self._call_ollama(query)

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
