from __future__ import annotations

import asyncio
import logging

from sqlalchemy import inspect, select, text

from backend.core.research import arxiv_source, fetch
from backend.core.research.index import search_items
from backend.core.research.models import ResearchItem, ResearchItemOut
from backend.shared.db import SessionLocal, engine

# Schema is created by Alembic (0019) or by init_db() in development.
logger = logging.getLogger(__name__)


def _ensure_schema() -> None:
    """Add columns that SQLAlchemy's create_all cannot add to an existing DB."""
    try:
        columns = {column["name"] for column in inspect(engine).get_columns("research_items")}
        if "full_text" not in columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE research_items ADD COLUMN full_text TEXT DEFAULT ''"))
    except Exception as exc:
        logger.warning("Could not ensure research_items full_text column: %s", exc)


_ensure_schema()


def _join_values(values: object) -> str:
    if isinstance(values, list):
        return ", ".join(str(value).strip() for value in values if str(value).strip())
    return str(values or "")


def _item_to_dict(item: ResearchItem) -> dict:
    result = ResearchItemOut.from_orm_item(item).model_dump()
    result["full_text"] = item.full_text or ""
    return result


async def ingest_arxiv(
    query: str = "cat:q-fin.*", *, max_results: int = 25, with_fulltext: bool = True
) -> dict:
    fetched_items = await arxiv_source.fetch_arxiv(query, max_results=max_results)

    full_texts: list[str] = ["" for _ in fetched_items]
    if with_fulltext and fetched_items:
        semaphore = asyncio.Semaphore(4)

        async def fetch_one(raw: dict) -> str:
            pdf_source = str(raw.get("url") or raw.get("external_id") or "")
            async with semaphore:
                try:
                    return await fetch.fetch_arxiv_fulltext(pdf_source)
                except Exception as exc:
                    logger.warning("Skipping arXiv full-text fetch: %s", exc)
                    return ""

        full_texts = list(await asyncio.gather(*(fetch_one(raw) for raw in fetched_items)))

    session = SessionLocal()
    ingested = 0
    try:
        for raw, full_text in zip(fetched_items, full_texts):
            try:
                external_id = str(raw.get("external_id") or "").strip()
                title = str(raw.get("title") or "").strip()
                if not external_id or not title:
                    continue
                exists = session.execute(
                    select(ResearchItem.id).where(ResearchItem.external_id == external_id)
                ).scalar_one_or_none()
                if exists:
                    continue
                session.add(
                    ResearchItem(
                        source=str(raw.get("source") or "arxiv"),
                        external_id=external_id,
                        title=title,
                        authors=_join_values(raw.get("authors")),
                        abstract=str(raw.get("abstract") or ""),
                        url=str(raw.get("url") or ""),
                        categories=_join_values(raw.get("categories")),
                        published_at=str(raw.get("published_at") or ""),
                        full_text=full_text or "",
                    )
                )
                ingested += 1
            except Exception:
                continue
        session.commit()
    except Exception:
        session.rollback()
    finally:
        session.close()
    return {"ingested": ingested, "fetched": len(fetched_items), "query": query}


async def ingest_url(url: str) -> dict:
    """Fetch a web document and upsert it by URL."""
    row = await fetch.fetch_url(url)
    title = str(row.get("title") or "").strip()
    if not row or not title:
        return {"ingested": 0, "url": url, "title": "", "text_chars": 0}

    session = SessionLocal()
    try:
        external_id = str(row.get("external_id") or url).strip()
        existing = session.execute(
            select(ResearchItem).where(ResearchItem.external_id == external_id)
        ).scalar_one_or_none()
        if existing is None:
            existing = ResearchItem(
                source="web",
                external_id=external_id,
                title=title,
                authors="",
                abstract=str(row.get("abstract") or ""),
                url=str(row.get("url") or url),
                categories="",
                published_at=str(row.get("published_at") or ""),
                full_text=str(row.get("text") or ""),
            )
            session.add(existing)
            ingested = 1
        else:
            existing.source = "web"
            existing.title = title
            existing.abstract = str(row.get("abstract") or "")
            existing.url = str(row.get("url") or url)
            existing.published_at = str(row.get("published_at") or "")
            existing.full_text = str(row.get("text") or "")
            ingested = 0
        session.commit()
        return {
            "ingested": ingested,
            "url": url,
            "title": title,
            "text_chars": len(existing.full_text or ""),
        }
    except Exception as exc:
        session.rollback()
        logger.warning("Could not ingest URL %s: %s", url, exc)
        return {"ingested": 0, "url": url, "title": title, "text_chars": 0}
    finally:
        session.close()


def search(query: str, *, k: int = 10) -> list[dict]:
    session = SessionLocal()
    try:
        items = session.execute(
            select(ResearchItem).order_by(ResearchItem.created_at.desc()).limit(5000)
        ).scalars().all()
        return search_items([_item_to_dict(item) for item in items], query, k)
    finally:
        session.close()


def list_items(*, limit: int = 50) -> list[dict]:
    session = SessionLocal()
    try:
        items = session.execute(
            select(ResearchItem).order_by(ResearchItem.created_at.desc()).limit(limit)
        ).scalars().all()
        return [_item_to_dict(item) for item in items]
    finally:
        session.close()
