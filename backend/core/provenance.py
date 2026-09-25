from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

Quality = Literal["live", "delayed", "cached", "synthetic", "unavailable"]


def make_provenance(
    source: str,
    quality: str,
    *,
    as_of: str | None = None,
    latency_ms: float | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    """Return the Contract-1 provenance dict. Always all 5 keys. latency_ms rounded to 1 decimal."""
    return {
        "source": source,
        "quality": quality,
        "as_of": as_of,
        "latency_ms": round(latency_ms, 1) if latency_ms is not None else None,
        "note": note,
    }


_PRICE_SOURCE_MAP = {
    "adapter": "kite",
    "nse": "nse",
    "yahoo": "yahoo",
    "fmp": "fmp",
    "finnhub": "finnhub",
    "mock": "mock",
    "synthetic": "mock",
}

_DETAIL_ORDER = ("kite", "nse", "fmp", "finnhub", "yahoo")

_LIVE_SOURCES = {"kite", "nse", "finnhub", "alpaca"}
_DELAYED_SOURCES = {"yahoo", "fmp"}

_NOTE_MAP = {
    "yahoo": "Yahoo Finance (delayed ~15m)",
    "fmp": "FMP (delayed)",
    "mock": "Synthetic fallback data — configure a provider",
}


def provenance_from_snapshot(
    snap: dict[str, Any],
    *,
    from_cache: bool = False,
    latency_ms: float | None = None,
) -> dict[str, Any]:
    """Derive provenance from a UnifiedFetcher snapshot dict."""
    details = (snap or {}).get("details") or {}
    current_price = (snap or {}).get("current_price")

    # Rule: empty snap or no price and no details flags -> unavailable
    has_data = (
        current_price is not None
        or any(details.get(k) for k in _DETAIL_ORDER)
        or details.get("price_source") not in (None, "unavailable")
    )
    if not has_data:
        return make_provenance("none", "unavailable", note="No provider returned data", latency_ms=latency_ms)

    # Derive source from price_source (applies to cached snapshots too)
    raw_source = details.get("price_source", "unavailable") or "unavailable"
    source = _PRICE_SOURCE_MAP.get(raw_source, raw_source)

    # If price_source was adapter/kite but kite flag is false, fall back to first truthy detail
    if source == "kite" and raw_source == "adapter":
        if not details.get("kite"):
            source = "none"
            for k in _DETAIL_ORDER:
                if details.get(k):
                    source = k
                    break

    # Fallback: first truthy detail
    if source == "none" or source == "unavailable":
        for k in _DETAIL_ORDER:
            if details.get(k):
                source = k
                break

    if source == "unavailable":
        source = "none"

    # from_cache override for quality
    if from_cache:
        quality = "cached"
        as_of = None
    else:
        # Map quality from source
        if source == "mock":
            quality = "synthetic"
        elif source in _LIVE_SOURCES:
            quality = "live"
        elif source in _DELAYED_SOURCES:
            quality = "delayed"
        else:
            quality = "unavailable"

        # as_of
        if quality in ("live", "delayed", "synthetic"):
            as_of = datetime.now(timezone.utc).isoformat()
        else:
            as_of = None

    if source in ("unavailable", ""):
        source = "none"
    note = _NOTE_MAP.get(source)

    return make_provenance(source, quality, as_of=as_of, latency_ms=latency_ms, note=note)