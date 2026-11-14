from __future__ import annotations

from io import BytesIO

import httpx
import pytest

from backend.core.research.clean import clean_text, html_to_text
from backend.core.research.fetch import fetch_url, pdf_to_text
from backend.core.research.index import search_items


def test_clean_text_normalizes_and_bounds_text():
    assert clean_text("  alpha\t\n beta\x00  gamma ", max_chars=10) == "alpha beta"


def test_html_to_text_omits_non_visible_elements():
    html = "<html><head><style>hidden</style><script>bad()</script></head><body><h1>Visible</h1><p>content</p></body></html>"
    assert html_to_text(html) == "Visible content"


def test_pdf_to_text_extracts_a_known_string():
    reportlab = pytest.importorskip("reportlab.pdfgen.canvas")
    buffer = BytesIO()
    canvas = reportlab.Canvas(buffer)
    canvas.drawString(72, 720, "research full text sentinel")
    canvas.save()

    assert "research full text sentinel" in pdf_to_text(buffer.getvalue())


@pytest.mark.asyncio
async def test_fetch_url_routes_html_to_normalized_web_row(monkeypatch):
    async def fake_download(url, **kwargs):
        return b"<html><head><title>Example title</title></head><body><script>bad()</script><h1>Heading</h1><p>Visible body</p></body></html>", "text/html; charset=utf-8", url
    monkeypatch.setattr("backend.core.research.fetch.fetch_public_bytes", fake_download)
    result = await fetch_url("https://example.test/article")

    assert result["source"] == "web"
    assert result["title"] == "Example title"
    assert "Visible body" in result["text"]
    assert "bad()" not in result["text"]


def test_search_items_uses_full_text_for_ranking():
    items = [
        {"external_id": "body-match", "title": "Unrelated", "abstract": "Nothing useful", "full_text": "Rarefied arbitrage telemetry appears here."},
        {"external_id": "non-match", "title": "Other", "abstract": "Different material", "full_text": ""},
    ]

    results = search_items(items, "arbitrage telemetry", k=1)

    assert results[0]["external_id"] == "body-match"
