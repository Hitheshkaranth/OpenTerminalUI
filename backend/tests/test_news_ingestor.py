from __future__ import annotations

from backend.services.news_ingestor import NewsIngestor, NormalizedNews, normalize_news_record


def test_normalize_news_record_finnhub() -> None:
    row = {
        "source": "Reuters",
        "headline": "Markets rally",
        "url": "https://example.com/a",
        "summary": "Stocks moved higher",
        "image": "https://img.example.com/a.jpg",
        "datetime": 1735603200,
        "related": "RELIANCE, INFY",
    }
    item = normalize_news_record(row, provider="finnhub")
    assert item is not None
    assert item.source == "Reuters"
    assert item.title == "Markets rally"
    assert item.url == "https://example.com/a"
    assert item.tickers == ["RELIANCE", "INFY"]
    assert item.published_at.endswith("+00:00")


def test_normalize_news_record_fmp() -> None:
    row = {
        "site": "Bloomberg",
        "title": "Oil edges lower",
        "url": "https://example.com/b",
        "text": "Crude declined after data release",
        "image": "https://img.example.com/b.jpg",
        "publishedDate": "2025-01-15 10:00:00",
        "symbol": "ONGC",
    }
    item = normalize_news_record(row, provider="fmp")
    assert item is not None
    assert item.source == "Bloomberg"
    assert item.title == "Oil edges lower"
    assert item.url == "https://example.com/b"
    assert item.tickers == ["ONGC"]


def test_news_dedupe_by_url_keeps_latest_seen() -> None:
    ingestor = NewsIngestor()
    one = NormalizedNews(
        source="SrcA",
        title="T1",
        url="https://example.com/same",
        summary="S1",
        image_url="",
        published_at="2025-01-01T00:00:00+00:00",
        tickers=["AAA"],
    )
    two = NormalizedNews(
        source="SrcB",
        title="T2",
        url="https://example.com/same",
        summary="S2",
        image_url="",
        published_at="2025-01-01T01:00:00+00:00",
        tickers=["BBB"],
    )
    out = ingestor._dedupe([one, two])  # noqa: SLF001
    assert len(out) == 1
    assert out[0].source == "SrcB"
    assert out[0].title == "T2"
