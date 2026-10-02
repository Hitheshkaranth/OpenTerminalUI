from __future__ import annotations

# OWNER: agent F
import asyncio

from fastapi import APIRouter, Query

from backend.thematic_indices.service import find_theme, get_cached_theme_data, list_by_market

router = APIRouter(prefix="/api/themes", tags=["themes"])

# The market-wide benchmark used whenever a whole-market listing is requested.
_MARKET_BENCHMARK = {"IN": "^NSEI", "US": "SPY"}


@router.get("")
async def list_themes(
    market: str = Query(..., pattern="^(IN|US)$", description="Desk market: IN or US"),
) -> dict:
    """List every curated theme for a market with its period returns."""
    market = str(market).upper()
    benchmark = _MARKET_BENCHMARK.get(market, "^NSEI")
    themes: list[dict] = []
    warnings: list[str] = []
    themes_for_market = list_by_market(market)
    # Themes are independent: build them concurrently (each caps its own fetch concurrency).
    computed = await asyncio.gather(*(get_cached_theme_data(market, str(t.get("id"))) for t in themes_for_market))
    for theme, data in zip(themes_for_market, computed):
        if data is None:
            warnings.append(f"No data available for theme {theme.get('id')}.")
            continue
        summary = {
            "id": data.get("id"),
            "name": data.get("name"),
            "description": data.get("description"),
            "market": data.get("market"),
            "constituents": data.get("constituents"),
            "return_1m": data.get("return_1m"),
            "return_3m": data.get("return_3m"),
            "return_6m": data.get("return_6m"),
            "return_1y": data.get("return_1y"),
            "vs_benchmark_1y": data.get("vs_benchmark_1y"),
            "benchmark": benchmark,
        }
        themes.append(summary)
        warnings.extend(data.get("warnings", []))
    return {"market": market, "benchmark": benchmark, "themes": themes, "warnings": warnings}


@router.get("/{theme_id}")
async def theme_detail(
    theme_id: str,
    market: str = Query(default=None, description="Optional market scoping for the theme id"),
) -> dict:
    """Return the full detail (benchmark, series, members) for a single theme."""
    market_label = str(market).upper() if market else None
    data = await get_cached_theme_data(market_label, theme_id) if market_label else None
    if data is None:
        # Fall back to a market-scoped lookup without a market param.
        for m in ("IN", "US"):
            found = await get_cached_theme_data(m, theme_id)
            if found is not None:
                data = found
                break

    if data is None or find_theme(theme_id, market_label) is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=f"Theme '{theme_id}' not found.")

    return data