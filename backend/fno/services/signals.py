from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.fno.services.oi_analyzer import get_oi_analyzer
from backend.fno.services.option_chain_fetcher import get_option_chain_fetcher


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    if out != out:
        return default
    return out


def _market_for_symbol(symbol: str, market: str | None = None) -> str:
    text = (market or "").strip().upper()
    if text in {"US", "NYSE", "NASDAQ", "USA"}:
        return "US"
    if text in {"IN", "NSE", "BSE", "INDIA"}:
        return "IN"
    upper = symbol.upper()
    if upper.endswith(".NS") or upper.endswith(".BO") or upper in {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"}:
        return "IN"
    return "US" if "." not in upper and len(upper) <= 5 else "IN"


def _dominant_buildup(analysis: dict[str, Any]) -> dict[str, Any]:
    counts: dict[str, float] = {}
    for row in analysis.get("strikes", []) if isinstance(analysis.get("strikes"), list) else []:
        if not isinstance(row, dict):
            continue
        for side in ("ce", "pe"):
            label = str(row.get(f"{side}_pattern") or "")
            weight = abs(_to_float(row.get(f"{side}_oi_change"), 0.0))
            if not label:
                continue
            counts[label] = counts.get(label, 0.0) + max(weight, 1.0)
    if not counts:
        return {"classification": "neutral", "confidence": 0.0, "distribution": {}}
    total = sum(counts.values())
    label, value = max(counts.items(), key=lambda item: item[1])
    return {
        "classification": label,
        "confidence": round(value / total, 4) if total else 0.0,
        "distribution": {key: round(val / total, 4) for key, val in sorted(counts.items())},
    }


def _directional_bias(pcr_oi: float, buildup: str) -> float:
    score = 0.0
    if pcr_oi > 1.15:
        score += 0.35
    elif 0.0 < pcr_oi < 0.7:
        score -= 0.35
    if buildup == "long_buildup":
        score += 0.30
    elif buildup == "short_buildup":
        score -= 0.30
    elif buildup == "short_covering":
        score += 0.15
    elif buildup == "long_unwinding":
        score -= 0.15
    return round(max(-1.0, min(1.0, score)), 4)


async def get_option_chain_signals(symbol: str, *, market: str | None = None, expiry: str | None = None) -> dict[str, Any]:
    symbol_u = symbol.strip().upper()
    market_key = _market_for_symbol(symbol_u, market)
    if market_key != "IN":
        return {
            "symbol": symbol_u,
            "market": market_key,
            "available": False,
            "reason": "fno_signals_india_only",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    try:
        fetcher = get_option_chain_fetcher()
        chain = await fetcher.get_option_chain(symbol_u, expiry=expiry, strike_range=30)
        analyzer = get_oi_analyzer()
        pcr = analyzer.get_pcr(chain)
        buildup = _dominant_buildup(analyzer.analyze_oi_buildup(chain))
        iv_percentile = _to_float(chain.get("iv_percentile"), 0.0)
        pcr_oi = _to_float(pcr.get("pcr_oi"), 0.0)
        return {
            "symbol": chain.get("symbol") or symbol_u,
            "market": "IN",
            "available": bool(chain.get("strikes")),
            "timestamp": chain.get("timestamp") or datetime.now(timezone.utc).isoformat(),
            "expiry_date": chain.get("expiry_date") or "",
            "pcr_oi": pcr_oi,
            "pcr_volume": _to_float(pcr.get("pcr_volume"), 0.0),
            "pcr_signal": pcr.get("signal") or "Neutral",
            "oi_buildup": buildup["classification"],
            "oi_buildup_confidence": buildup["confidence"],
            "oi_buildup_distribution": buildup["distribution"],
            "iv_percentile": iv_percentile,
            "iv_rank": _to_float(chain.get("iv_rank"), 0.0),
            "atm_iv": _to_float(chain.get("atm_iv"), 0.0),
            "directional_bias": _directional_bias(pcr_oi, str(buildup["classification"])),
        }
    except Exception as exc:
        return {
            "symbol": symbol_u,
            "market": "IN",
            "available": False,
            "reason": "provider_unavailable",
            "error": type(exc).__name__,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

