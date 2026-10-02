"""Filing-intelligence tools for the agent.

Handlers call the filings-rag engine (``backend.filings_rag.analyze.ask``)
directly, opening a throwaway DB session internally, so the tool is not
user-scoped — it operates on the symbol the caller supplies.
"""

from __future__ import annotations

from typing import Any

from backend.agent.tools.envelope import err, ok
from backend.agent.tools.registry import ToolSpec
from backend.filings_rag.analyze import ask as filings_ask
from backend.shared.db import SessionLocal


async def search_company_filings(args: dict[str, Any]) -> dict[str, Any]:
    try:
        symbol = str(args.get("symbol") or "").strip().upper()
        question = str(args.get("question") or "").strip()
        if not symbol:
            return err("symbol is required to search company filings.", code="bad_request")
        if len(question) < 3 or len(question) > 500:
            return err("question must be between 3 and 500 characters.", code="bad_request")
        k = int(args.get("k") or 6)
        if not 1 <= k <= 20:
            return err("k must be between 1 and 20.", code="bad_request")

        db = SessionLocal()
        try:
            result = await filings_ask(db, symbol, question, k=k)
        finally:
            db.close()
        return ok(result, source="filings_rag", note=f"Answered from filings of {symbol}.")
    except Exception as exc:  # noqa: BLE001 - agent tools must never raise
        return err(f"search_company_filings failed: {exc}", code="tool_error")


def filings_tool_specs() -> list[ToolSpec]:
    """Return the read-only filing-intelligence tool specs."""
    return [
        ToolSpec(
            name="search_company_filings",
            description="Search a company's filed documents (annual reports, 10-K/10-Q, concall "
            "transcripts, investor presentations, order-win / USFDA announcements) and return an "
            "answer with verbatim quotes cited to the originating document and page. The answer is "
            "built only from that symbol's filings, or falls back to the best matching snippets if "
            "no LLM is configured. Symbol is required; question is free text.",
            parameters={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "Ticker/symbol to search, e.g. RELIANCE, AAPL."},
                    "question": {"type": "string", "minLength": 3, "description": "The question about the company's filings."},
                    "k": {"type": "integer", "minimum": 1, "maximum": 20, "description": "How many filing chunks to draw from."},
                },
                "required": ["symbol", "question"],
            },
            handler=search_company_filings,
            read_only=True,
            write_class="none",
        ),
    ]