from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET

import httpx
from backend.shared.http_client import shared_session

logger = logging.getLogger(__name__)

ATOM_NS = "http://www.w3.org/2005/Atom"
ARXIV_NS = "http://arxiv.org/schemas/atom"
NS = {"atom": ATOM_NS, "arxiv": ARXIV_NS}


def _collapse_ws(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _external_id(raw_id: str) -> str:
    value = raw_id.strip()
    marker = "arxiv.org/"
    if marker in value:
        return value.split(marker, 1)[1]
    return value.rsplit("/", 1)[-1] if "/" in value else value


async def fetch_arxiv(query: str = "cat:q-fin.*", *, max_results: int = 25, timeout: float = 20.0) -> list[dict]:
    params = {
        "search_query": query,
        "start": 0,
        "max_results": max_results,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    try:
        async with shared_session(timeout=timeout, follow_redirects=True) as client:
            # arXiv 301-redirects http -> https; use https and follow redirects.
            response = await client.get("https://export.arxiv.org/api/query", params=params)
            response.raise_for_status()
        root = ET.fromstring(response.text)
    except Exception as exc:
        logger.warning("Failed to fetch or parse arXiv feed: %s", exc)
        return []

    items: list[dict] = []
    for entry in root.findall("atom:entry", NS):
        try:
            id_text = _collapse_ws(entry.findtext("atom:id", default="", namespaces=NS))
            if not id_text:
                continue
            link_url = id_text
            for link in entry.findall("atom:link", NS):
                if link.attrib.get("rel") == "alternate" and link.attrib.get("href"):
                    link_url = link.attrib["href"]
                    break

            authors = [
                _collapse_ws(author.findtext("atom:name", default="", namespaces=NS))
                for author in entry.findall("atom:author", NS)
            ]
            categories = [
                category.attrib["term"].strip()
                for category in entry.findall("atom:category", NS)
                if category.attrib.get("term", "").strip()
            ]

            items.append(
                {
                    "source": "arxiv",
                    "external_id": _external_id(id_text),
                    "title": _collapse_ws(entry.findtext("atom:title", default="", namespaces=NS)),
                    "authors": [author for author in authors if author],
                    "abstract": _collapse_ws(entry.findtext("atom:summary", default="", namespaces=NS)),
                    "url": link_url,
                    "categories": categories,
                    "published_at": _collapse_ws(entry.findtext("atom:published", default="", namespaces=NS)),
                }
            )
        except Exception as exc:
            logger.warning("Skipping malformed arXiv entry: %s", exc)
            continue
    return items
