"""A dedicated historical tool registry; all cutoffs are bound by the server."""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any

from backend.agent.historical import validate_historical_as_of
from backend.agent.tools.envelope import err, ok
from backend.agent.tools.registry import ToolRegistry, ToolSpec
from backend.filings_rag.availability import cutoff_utc
from backend.shared.db import SessionLocal


def _symbol(args: dict) -> str:
    value = args.get("symbol")
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 64:
        raise ValueError("symbol must be a nonempty string of at most 64 characters")
    return value.strip().upper()


def _publication(value: Any):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        if len(value) == 10:
            return cutoff_utc(value)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except ValueError:
        return None


def historical_tool_specs(historical_as_of: str) -> list[ToolSpec]:
    as_of = validate_historical_as_of(historical_as_of)
    cutoff = cutoff_utc(as_of)

    def fundamentals(args: dict) -> dict:
        from backend.models import DataVersionORM, FundamentalsPitORM
        try:
            symbol = _symbol(args)
            db = SessionLocal()
            try:
                version = db.query(DataVersionORM).filter(DataVersionORM.is_active.is_(True)).order_by(DataVersionORM.created_at.desc()).first()
                if version is None:
                    return err("No point-in-time dataset is available", code="historical_unavailable")
                rows = db.query(FundamentalsPitORM).filter(FundamentalsPitORM.symbol == symbol,
                    FundamentalsPitORM.data_version_id == version.id, FundamentalsPitORM.as_of_date <= as_of,
                    FundamentalsPitORM.release_date_estimated.is_(False)).order_by(
                    FundamentalsPitORM.as_of_date.desc(), FundamentalsPitORM.fiscal_period.desc(), FundamentalsPitORM.id).all()
                latest = {}
                for row in rows:
                    try:
                        released = cutoff_utc(row.as_of_date)
                        value = float(row.value)
                    except (ValueError, TypeError, OverflowError):
                        continue
                    if released > cutoff or not math.isfinite(value) or not row.source.strip() or row.source.lower() in {"mock", "synthetic", "snapshot"}:
                        continue
                    latest.setdefault(row.metric, {"metric": row.metric, "value": value,
                        "fiscal_period": row.fiscal_period, "released_at": row.as_of_date,
                        "source": row.source, "release_date_estimated": False})
                if not latest:
                    return err("No verified-release fundamentals available by the cutoff", code="historical_unavailable")
                return ok({"symbol": symbol, "historical_as_of": as_of, "data_version_id": version.id,
                    "facts": list(latest.values()), "availability_basis": "verified_release_date"},
                    source="fundamentals_pit", quality="cached", as_of=as_of,
                    note="No estimated releases or current snapshots. Release metadata is supplied by the ingested dataset; values are not independently audited.")
            finally:
                db.close()
        except (ValueError, TypeError) as exc:
            return err(str(exc), code="invalid_args")
        except Exception as exc:
            return err(f"Historical fundamentals unavailable: {exc}", code="historical_unavailable")

    def news(args: dict) -> dict:
        from backend.models import NewsArticle
        try:
            symbol = _symbol(args)
            limit = args.get("limit", 10)
            if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 25:
                raise ValueError("limit must be an integer from 1 to 25")
            db = SessionLocal()
            try:
                # Explicit confidence metadata is mandatory. Legacy records may
                # carry ingestion-time fallback dates and are never inferred safe.
                rows = db.query(NewsArticle).filter(NewsArticle.publication_verified.is_(True),
                    NewsArticle.source_published_at <= cutoff.isoformat()).order_by(NewsArticle.source_published_at.desc(), NewsArticle.id.desc()).all()
                articles = []
                for row in rows:
                    published = _publication(row.source_published_at)
                    if published is None or published > cutoff or row.publication_source not in {"finnhub", "fmp", "yahoo"}:
                        continue
                    try:
                        tickers = json.loads(row.tickers)
                    except (ValueError, TypeError):
                        continue
                    if not isinstance(tickers, list) or symbol not in {str(item).strip().upper() for item in tickers}:
                        continue
                    articles.append({"title": row.title, "summary": row.summary, "url": row.url,
                        "source": row.source, "published_at": published.isoformat(), "publication_source": row.publication_source})
                articles.sort(key=lambda item: (item["published_at"], item["url"]), reverse=True)
                articles = articles[:limit]
                if not articles:
                    return err("No source-dated news available by the cutoff; legacy unverified dates are excluded", code="historical_unavailable")
                return ok({"symbol": symbol, "historical_as_of": as_of, "articles": articles,
                    "availability_basis": "verified_provider_publication"}, source="historical_news", quality="cached", as_of=as_of,
                    note="Provider publication timestamps bound availability. Current sentiment and analysis are excluded; source article revision history is not independently reconstructed.")
            finally:
                db.close()
        except (ValueError, TypeError) as exc:
            return err(str(exc), code="invalid_args")
        except Exception as exc:
            return err(f"Historical news unavailable: {exc}", code="historical_unavailable")

    async def filings(args: dict) -> dict:
        from backend.agent.tools.filings_tools import search_company_filings
        return await search_company_filings({**args, "as_of": as_of})

    symbol_schema = {"symbol": {"type": "string", "minLength": 1, "maxLength": 64}}
    return [
        ToolSpec("get_historical_fundamentals", "Read ingested source-release-dated fundamentals available by the server cutoff; estimated releases/current snapshots excluded.",
            {"type": "object", "properties": symbol_schema, "required": ["symbol"]}, fundamentals, True),
        ToolSpec("get_historical_news", "Read source-publication-dated news available by the server cutoff; legacy unverified dates/current sentiment excluded.",
            {"type": "object", "properties": {**symbol_schema, "limit": {"type": "integer", "minimum": 1, "maximum": 25}}, "required": ["symbol"]}, news, True),
        ToolSpec("search_company_filings", "Search verified source-publication filings available by the server cutoff; model arguments cannot change the cutoff.",
            {"type": "object", "properties": {**symbol_schema, "question": {"type": "string"}, "k": {"type": "integer", "minimum": 1, "maximum": 20}}, "required": ["symbol", "question"]}, filings, True),
    ]


def build_historical_registry(historical_as_of: str) -> ToolRegistry:
    registry = ToolRegistry()
    registry.register_many(historical_tool_specs(historical_as_of))
    registry.historical_as_of = validate_historical_as_of(historical_as_of)
    return registry
