from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

from backend.api.deps import get_unified_fetcher
from backend.adapters.registry import get_adapter_registry

router = APIRouter()

_PROVIDER_DEFS: list[dict[str, Any]] = [
    {
        "id": "kite",
        "name": "Zerodha Kite",
        "markets": ["NSE", "BSE"],
        "env_keys": ["KITE_API_KEY", "KITE_API_SECRET", "KITE_ACCESS_TOKEN"],
        "unlocks": ["Real-time NSE/BSE ticks", "Kite historical bars", "Holdings & positions import"],
    },
    {
        "id": "alpaca",
        "name": "Alpaca",
        "markets": ["US"],
        "env_keys": ["ALPACA_API_KEY", "ALPACA_SECRET_KEY"],
        "unlocks": ["US bars & quotes"],
    },
    {
        "id": "fmp",
        "name": "Financial Modeling Prep",
        "markets": ["US"],
        "env_keys": ["FMP_API_KEY"],
        "unlocks": ["US fundamentals", "Earnings & estimates", "Analyst consensus"],
    },
    {
        "id": "finnhub",
        "name": "Finnhub",
        "markets": ["US"],
        "env_keys": ["FINNHUB_API_KEY"],
        "unlocks": ["Real-time US ticks", "Company profiles", "US news"],
    },
    {
        "id": "fred",
        "name": "FRED",
        "markets": ["GLOBAL"],
        "env_keys": ["FRED_API_KEY"],
        "unlocks": ["Macro series", "Yield curve history"],
    },
    {
        "id": "yahoo",
        "name": "Yahoo Finance",
        "markets": ["GLOBAL"],
        "env_keys": [],
        "unlocks": ["Delayed quotes & history (fallback)"],
    },
    {
        "id": "nse",
        "name": "NSE India (public)",
        "markets": ["NSE"],
        "env_keys": [],
        "unlocks": ["Option chain", "Corporate actions", "Market status"],
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "markets": ["AI"],
        "env_keys": ["OPENROUTER_API_KEY"],
        "unlocks": ["AI research agent", "Debate mode"],
    },
    {
        "id": "lmstudio",
        "name": "LM Studio (local LLM)",
        "markets": ["AI"],
        "env_keys": ["LM_STUDIO_BASE_URL"],
        "unlocks": ["Local sentiment/emotion", "Local agent"],
    },
]

# Providers that have light network probes (others use health_snapshot only)
_PROBE_MAP: dict[str, Any] = {
    "yahoo": ("get_quotes", ["AAPL"]),
    "nse": ("get_market_status", []),
}

# Free providers (yahoo, nse) — "down" overall doesn't require them to be ok
_FREE_IDS = {"yahoo", "nse"}


def _is_configured(provider: dict[str, Any]) -> bool:
    for key in provider["env_keys"]:
        val = os.getenv(key)
        if not val:
            return False
    return True


def _build_provider_list(probe_results: dict[str, dict[str, Any]], health: dict[str, dict[str, Any]], lm_studio_enabled: bool) -> list[dict[str, Any]]:
    providers: list[dict[str, Any]] = []
    for pdef in _PROVIDER_DEFS:
        pid = pdef["id"]
        configured = _is_configured(pdef)

        # Special: lmstudio also checks LM_STUDIO_ENABLED
        if pid == "lmstudio" and configured:
            configured = lm_studio_enabled

        # Determine last_success_at and last_error from health_snapshot
        hs_key = pid
        hs_entry = health.get(hs_key, {})
        last_success_at = hs_entry.get("last_success_at")
        last_error = hs_entry.get("last_error")
        probe_error = (probe_results.get(pid) or {}).get("error")
        if probe_error:
            last_error = probe_error
        health_available = hs_entry.get("available", False)

        probe = probe_results.get(pid)

        # Determine status
        if not configured:
            status = "unconfigured"
        elif probe and probe.get("status") == "ok":
            status = "ok"
        elif (probe and probe.get("status") in ("down",)) or (hs_entry and hs_entry.get("available") is False):
            status = "down"
        elif health_available and last_success_at:
            status = "ok"
        else:
            status = "degraded"

        providers.append({
            "id": pid,
            "name": pdef["name"],
            "markets": list(pdef["markets"]),
            "configured": configured,
            "status": status,
            "last_success_at": last_success_at,
            "last_error": last_error,
            "unlocks": list(pdef["unlocks"]),
            "env_keys": list(pdef["env_keys"]),
        })
    return providers


def _compute_overall(providers: list[dict[str, Any]]) -> str:
    configured = [p for p in providers if p["configured"]]
    if not configured:
        return "ok"
    if all(p["status"] == "ok" for p in configured):
        return "ok"
    # "down" if all configured non-free providers are down
    non_free_configured = [p for p in configured if p["id"] not in _FREE_IDS]
    if non_free_configured and all(p["status"] == "down" for p in non_free_configured):
        return "down"
    return "degraded"


async def _light_probe(name: str, coro) -> dict[str, Any]:
    try:
        await asyncio.wait_for(coro, timeout=2.0)
        return {"status": "ok"}
    except asyncio.TimeoutError:
        return {"status": "down", "error": f"{name} probe timed out (2s)"}
    except Exception as exc:
        return {"status": "down", "error": str(exc)[:160]}


@router.get("/providers/status")
async def providers_status() -> dict[str, Any]:
    """Contract 2. Never raises: on internal failure every provider is reported as
    degraded/unconfigured and the error string is attached at the top level."""
    try:
        return await _providers_status_impl()
    except Exception as exc:  # pragma: no cover - defensive
        providers = _build_provider_list({}, {}, False)
        for row in providers:
            if row["configured"]:
                row["status"] = "degraded"
        return {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "overall": "degraded",
            "providers": providers,
            "error": str(exc),
        }


async def _providers_status_impl() -> dict[str, Any]:
    try:
        from backend.config.settings import get_settings
        settings = get_settings()
        lm_studio_enabled = settings.lm_studio_enabled
    except Exception:
        lm_studio_enabled = os.getenv("LM_STUDIO_ENABLED", "true").lower() in ("1", "true", "yes", "on")

    health = get_adapter_registry().health_snapshot()

    fetcher = await get_unified_fetcher()

    # Build probes
    probe_tasks: list[tuple[str, asyncio.Task[dict[str, Any]]]] = []

    # yahoo probe
    yahoo_probing = asyncio.ensure_future(
        _light_probe("yahoo", fetcher.yahoo.get_quotes(["AAPL"]))
    )
    probe_tasks.append(("yahoo", yahoo_probing))

    # nse probe
    nse_probing = asyncio.ensure_future(
        _light_probe("nse", fetcher.nse.get_market_status())
    )
    probe_tasks.append(("nse", nse_probing))

    # fmp probe (if configured)
    fmp_key = os.getenv("FMP_API_KEY") or os.getenv("OPENTERMINALUI_FMP_API_KEY")
    if fmp_key:
        fmp_probing = asyncio.ensure_future(
            _light_probe("fmp", fetcher.fmp.get_quote("AAPL"))
        )
        probe_tasks.append(("fmp", fmp_probing))

    # finnhub probe (if configured)
    finnhub_key = os.getenv("FINNHUB_API_KEY") or os.getenv("OPENTERMINALUI_FINNHUB_API_KEY")
    if finnhub_key:
        finnhub_probing = asyncio.ensure_future(
            _light_probe("finnhub", fetcher.finnhub.get_company_profile("AAPL"))
        )
        probe_tasks.append(("finnhub", finnhub_probing))

    # kite probe (if configured): /user/profile is the cheapest authenticated call.
    # KiteClient._get returns {} on 401/403, which is exactly the "token expired" case.
    kite_token = os.getenv("KITE_ACCESS_TOKEN")
    if os.getenv("KITE_API_KEY") and kite_token:
        async def _kite_profile_ok() -> None:
            from backend.core.kite_client import KiteClient

            client = KiteClient()
            try:
                profile = await client.get_profile(kite_token)
            finally:
                try:
                    await client.close()
                except Exception:
                    pass
            if not profile:
                raise RuntimeError("Kite rejected the access token (it expires daily)")

        probe_tasks.append(("kite", asyncio.ensure_future(_light_probe("kite", _kite_profile_ok()))))

    # Run all probes concurrently
    probe_results: dict[str, dict[str, Any]] = {}
    if probe_tasks:
        results = await asyncio.gather(*[t for _, t in probe_tasks], return_exceptions=True)
        for (name, _), result in zip(probe_tasks, results):
            if isinstance(result, Exception):
                probe_results[name] = {"status": "down"}
            else:
                probe_results[name] = result
    # If no probes were run (no tasks), probe_results stays empty

    providers = _build_provider_list(probe_results, health, lm_studio_enabled)
    overall = _compute_overall(providers)

    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "overall": overall,
        "providers": providers,
    }