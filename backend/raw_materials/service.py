from __future__ import annotations

import asyncio
import inspect
from pathlib import Path
from typing import Any, Callable

import yaml

from backend.value_chain import service as value_chain_service
from backend.value_chain.service import infer_market

# OWNER: agent N (swarm fi_v1).
#
# Merges the curated links.yaml source (this file) with the value-chain
# snapshots stored by agent E (backend.value_chain). The curated entries are the
# primary source of commodity -> listed-company linkages; the value-chain entries
# add companies whose own filings recorded the commodity as a raw material.

_LINKS_PATH = Path(__file__).resolve().parent / "links.yaml"

VALID_RELATIONS = ("input_cost", "output_price")
VALID_SENSITIVITIES = ("high", "medium", "low")
VALID_MARKETS = ("IN", "US")

NameResolver = Callable[[str], Any]


def _market_label(symbol: str) -> str:
    """Map an exchange-inferred market to the IN/US labels used across the stack."""
    inferred = infer_market(symbol)
    return "IN" if inferred in ("NSE", "BSE") else "US"


def _load_document() -> dict[str, Any]:
    if not _LINKS_PATH.exists():
        return {}
    try:
        with open(_LINKS_PATH, encoding="utf-8") as fh:
            doc = yaml.safe_load(fh)
    except Exception:
        return {}
    return doc if isinstance(doc, dict) else {}


def load_links() -> dict[str, dict[str, Any]]:
    """Return the curated commodity table keyed by upper-cased commodity symbol."""
    doc = _load_document()
    entries = doc.get("commodities")
    if not isinstance(entries, list):
        return {}

    result: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        symbol = str(entry.get("commodity_symbol", "")).strip().upper()
        if not symbol:
            continue

        input_cost = _normalize_company_list(entry.get("input_cost"), "input_cost", symbol)
        output_price = _normalize_company_list(
            entry.get("output_price"), "output_price", symbol
        )

        industries_raw = entry.get("industries") or []
        if isinstance(industries_raw, str):
            industries_raw = [industries_raw]
        industries = [str(i).strip() for i in industries_raw if str(i).strip()]
        if not industries:  # derive from the linked companies' industries
            industries = sorted({c["industry"] for c in input_cost + output_price if c.get("industry")})

        result[symbol] = {
            "commodity_symbol": symbol,
            "name": str(entry.get("name", symbol)).strip() or symbol,
            "industries": industries,
            "impact_note": str(entry.get("impact_note", "")).strip(),
            "input_cost": input_cost,
            "output_price": output_price,
        }
    return result


def _normalize_company_list(
    raw: Any, relation: str, commodity_symbol: str
) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue

        relation_val = str(item.get("relation", relation)).strip().lower()
        if relation_val not in VALID_RELATIONS:
            relation_val = relation

        sensitivity = str(item.get("sensitivity", "medium")).strip().lower()
        if sensitivity not in VALID_SENSITIVITIES:
            sensitivity = "medium"

        market = str(item.get("market", "IN")).strip().upper()
        if market not in VALID_MARKETS:
            market = "IN"

        industry = str(item.get("industry", "")).strip() or None
        symbol = str(item.get("symbol", "")).strip() or None

        normalized.append(
            {
                "symbol": symbol,
                "name": name,
                "industry": industry,
                "relation": relation_val,
                "sensitivity": sensitivity,
                "market": market,
                "source": "curated",
                "commodity_symbol": commodity_symbol,
            }
        )
    return normalized


def list_items() -> list[dict[str, Any]]:
    """Curated commodity catalog without live prices (price is cheap + network)."""
    links = load_links()
    return [
        {
            "commodity_symbol": entry["commodity_symbol"],
            "name": entry["name"],
            "industries": list(entry["industries"]),
        }
        for entry in links.values()
    ]


async def _price(
    symbol: str, cache: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    try:
        return await value_chain_service.price_material(
            symbol, history_cache=cache
        )
    except Exception:
        return {
            "price": None,
            "currency": None,
            "change_1m_pct": None,
            "change_1y_pct": None,
        }


async def list_items_priced() -> list[dict[str, Any]]:
    cache: dict[str, dict[str, Any]] = {}
    out: list[dict[str, Any]] = []
    items = list_items()
    pricings = await asyncio.gather(*(_price(i["commodity_symbol"], cache) for i in items))
    for item, pricing in zip(items, pricings):
        out.append(
            {
                "commodity_symbol": item["commodity_symbol"],
                "name": item["name"],
                "industries": item["industries"],
                "price": pricing.get("price"),
                "change_1m_pct": pricing.get("change_1m_pct"),
                "change_1y_pct": pricing.get("change_1y_pct"),
            }
        )
    return out


async def _resolve_name(
    symbol: str, name_resolver: NameResolver | None
) -> str:
    if name_resolver is None:
        return symbol
    result = name_resolver(symbol)
    if inspect.isawaitable(result):
        result = await result  # type: ignore[misc]
    text = str(result or "").strip()
    return text or symbol


def _sensitivity_from_share(share: Any) -> str:
    # cost_share_pct is a percentage (15 = 15% of costs); the old 0.15 / 0.03 thresholds
    # treated it as a fraction and marked almost every company "high".
    if not isinstance(share, (int, float)) or isinstance(share, bool):
        return "medium"
    if share >= 15:
        return "high"
    if share <= 3:
        return "low"
    return "medium"


# Value-chain data prices crude off Brent (BZ=F) while the Commodities page uses WTI (CL=F):
# treat benchmarks of the same commodity as one when linking companies.
_EQUIVALENT = [{"CL=F", "BZ=F"}]


def _same_commodity(a: str, b: str) -> bool:
    a, b = a.strip().upper(), b.strip().upper()
    return a == b or any(a in grp and b in grp for grp in _EQUIVALENT)


async def _value_chain_companies(
    db: Any, commodity_symbol: str, name_resolver: NameResolver | None
) -> list[dict[str, Any]]:
    """Companies whose stored value-chain lists the commodity as a raw material.

    A company using a raw material is hurt when that material's price rises, so
    these are always tagged ``input_cost`` and sourced from the value chain.
    """
    try:
        from backend.value_chain.models import ValueChainSnapshot
    except Exception:
        return []

    try:
        rows = db.query(ValueChainSnapshot).all()
    except Exception:
        return []

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        symbol_attr = str(getattr(row, "symbol", None) or "").strip().upper()
        if not symbol_attr or symbol_attr in seen:
            continue
        payload = getattr(row, "payload", None)
        if not isinstance(payload, dict):
            continue

        raw_materials = payload.get("raw_materials")
        if not isinstance(raw_materials, list):
            continue

        matched: bool = False
        matched_share: Any = None
        for rm in raw_materials:
            if not isinstance(rm, dict):
                continue
            if _same_commodity(str(rm.get("commodity_symbol", "")), commodity_symbol):
                matched = True
                matched_share = rm.get("cost_share_pct")
                break

        if not matched:
            continue
        seen.add(symbol_attr)

        industry = str(payload.get("industry", "")).strip() or None
        out.append(
            {
                "symbol": symbol_attr,
                "name": await _resolve_name(symbol_attr, name_resolver),
                "industry": industry,
                "relation": "input_cost",
                "sensitivity": _sensitivity_from_share(matched_share),
                "market": _market_label(symbol_attr),
                "source": "value_chain",
                "commodity_symbol": commodity_symbol,
            }
        )
    return out


async def companies_for(
    db: Any,
    commodity_symbol: str,
    *,
    market: str | None = None,
    name_resolver: NameResolver | None = None,
) -> list[dict[str, Any]]:
    symbol = str(commodity_symbol or "").strip().upper()
    if not symbol:
        return []

    entry = load_links().get(symbol)

    curated: list[dict[str, Any]] = []
    if entry is not None:
        curated = list(entry.get("input_cost", [])) + list(entry.get("output_price", []))

    value_chain = await _value_chain_companies(db, symbol, name_resolver)

    merged: dict[str, dict[str, Any]] = {}
    for company in curated + value_chain:
        key = (str(company.get("symbol") or "").strip().lower(), company["relation"])
        if key not in merged:
            merged[key] = company

    companies = list(merged.values())

    if market:
        want = str(market).strip().upper()
        if want in VALID_MARKETS:
            companies = [c for c in companies if (c.get("market") or "").upper() == want]

    companies.sort(
        key=lambda c: (
            c["relation"],
            str(c.get("market") or "").lower(),
            str(c.get("symbol") or "").lower(),
        )
    )
    return companies