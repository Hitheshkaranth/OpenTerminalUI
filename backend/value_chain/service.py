from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from backend.api.deps import fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.filings_rag.llm import citation_for, complete_json, llm_available, verify_quote
from backend.filings_rag.retrieve import search as retrieve_search

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #
_RAW_MATERIALS_YAML_PATH = None
for _candidate in (
    Path(__file__).resolve().parents[2] / "data" / "raw_materials.yaml",
    Path(__file__).resolve().parent / "data" / "raw_materials.yaml",
    Path(__file__).resolve().parent / "raw_materials.yaml",
):
    if _candidate.exists():
        _RAW_MATERIALS_YAML_PATH = _candidate
        break

_RAW_MATERIALS_CACHE: dict[str, list[dict[str, Any]]] | None = None

RETRIEVAL_QUERIES = [
    "our major customers include",
    "our major customers",
    "top 10 customers account for",
    "our largest customers",
    "significant customers",
    "supply agreement with",
    "we source raw materials from",
    "our raw materials",
    "key suppliers",
    "top suppliers",
    "our key suppliers",
    "the company has a contract with",
    "major clients",
    "our clients",
    "key clients",
]

_LLM_SYSTEM_PROMPT = (
    "You are a securities analyst extracting verbatim facts from a company filing. "
    "Return ONLY JSON with keys: customers, suppliers and raw_materials. "
    "customers and suppliers are arrays of objects with: name, symbol (the listed-company ticker, "
    "or null if the listed entity is not named), share_pct (a numeric fraction 0..1 ONLY when the filing "
    "states a percentage, otherwise null), detail, and quote. quote MUST be the exact verbatim phrase "
    "from the filing that names the entity. raw_materials are arrays of objects with name, "
    "commodity_symbol, share_pct and quote (verbatim). Do not invent entities that are not named in the text."
)

_LEX_CUSTOMER_RE = re.compile(
    r"customers?\s+(?:such as|including|include)\s+(?P<list>.+?)(?:\.|\r?\n|$)",
    re.IGNORECASE | re.DOTALL,
)


# --------------------------------------------------------------------------- #
# Raw-material YAML loading + lookup
# --------------------------------------------------------------------------- #
def load_raw_material_entries() -> list[dict[str, Any]]:
    global _RAW_MATERIALS_CACHE
    if _RAW_MATERIALS_CACHE is not None:
        return _RAW_MATERIALS_CACHE

    entries: list[dict[str, Any]] = []
    if _RAW_MATERIALS_YAML_PATH is not None:
        try:
            with open(_RAW_MATERIALS_YAML_PATH, encoding="utf-8") as fh:
                doc = yaml.safe_load(fh)
            raw = (doc or {}).get("raw_materials") if isinstance(doc, dict) else None
            if isinstance(raw, list):
                for entry in raw:
                    if not isinstance(entry, dict):
                        continue
                    industries = entry.get("industries") or entry.get("applies_to") or []
                    if isinstance(industries, str):
                        industries = [industries]
                    entries.append(
                        {
                            "name": str(entry.get("name", "")).strip(),
                            "commodity_symbol": entry.get("commodity_symbol"),
                            "industries": [str(i).strip() for i in industries if str(i).strip()],
                        }
                    )
        except Exception:
            entries = []
    _RAW_MATERIALS_CACHE = entries
    return entries


def raw_materials_for_industry(industry: str | None, sector: str | None) -> list[dict[str, Any]]:
    labels: list[str] = []
    for raw in (industry, sector):
        if isinstance(raw, str) and raw.strip():
            labels.append(raw.strip())

    entries = load_raw_material_entries()
    if not labels or not entries:
        return []

    chosen: list[dict[str, Any]] = []
    seen: set[tuple[str, Any]] = set()
    for entry in entries:
        matches = False
        for label in labels:
            if any(
                entry_label.lower() == label.lower()
                or entry_label.lower() in label.lower()
                or label.lower() in entry_label.lower()
                for entry_label in entry["industries"]
            ):
                matches = True
                break
        if not matches:
            haystack = " ".join(labels).lower()
            if entry["name"].lower() in haystack:
                matches = True
        if matches:
            key = (entry["name"], entry["commodity_symbol"])
            if key not in seen:
                seen.add(key)
                chosen.append(
                    {
                        "name": entry["name"],
                        "commodity_symbol": entry["commodity_symbol"],
                        "origin": "curated",
                    }
                )
    return chosen


def curated_symbol_for_name(name: str | None) -> str | None:
    if not name:
        return None
    haystack = str(name).lower()
    for entry in load_raw_material_entries():
        if entry["commodity_symbol"] and entry["name"].lower() in haystack:
            return entry["commodity_symbol"]
    return None


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def compute_change_pct(closes: list[float | None], lookback_rows: int) -> float | None:
    """Percent change of the latest close vs the close `lookback_rows` earlier.

    `lookback_rows` is in trading days (≈ 21 for 1 month, ≈ 252 for 1 year).
    """
    valid = [c for c in closes if isinstance(c, (int, float)) and c is not None]
    if len(valid) < 2 or lookback_rows < 1 or lookback_rows >= len(valid):
        return None
    base = valid[-1 - lookback_rows]
    last = valid[-1]
    if base == 0:
        return None
    return (last - base) / base * 100.0


def _extract_closes(history: Any) -> list[float | None]:
    if not isinstance(history, dict):
        return []
    result = history.get("chart")
    result = (result or {}).get("result")
    if not result:
        return []
    if isinstance(result, dict):
        result = [result]
    quote = (((result[0].get("indicators") or {}).get("quote")) or [{}])
    closes_series = None
    for block in quote:
        if isinstance(block, dict) and block.get("close"):
            closes_series = block["close"]
            break
    if closes_series is None:
        return []
    closes: list[float | None] = []
    for item in closes_series:
        if item is None:
            closes.append(None)
        elif isinstance(item, dict):
            if isinstance(item.get("raw"), (int, float)):
                closes.append(float(item["raw"]))
            elif isinstance(item.get("close"), (int, float)):
                closes.append(float(item["close"]))
            else:
                closes.append(None)
        elif isinstance(item, (int, float)):
            closes.append(float(item))
        else:
            closes.append(None)
    return closes


# --------------------------------------------------------------------------- #
# Competitors (peers dataset)
# --------------------------------------------------------------------------- #
async def peer_symbols(symbol: str) -> list[str]:
    try:
        unified = await get_unified_fetcher()
        peers_raw = await unified.fmp.get_peers(symbol)
    except Exception:
        return []
    if not isinstance(peers_raw, (list, tuple)):
        return []
    symbols: list[str] = []
    for peer in peers_raw:
        if isinstance(peer, str):
            peer = peer.strip().upper()
            if peer:
                symbols.append(peer)
        elif isinstance(peer, dict):
            sym = peer.get("symbol") or peer.get("ticker") or ""
            if sym:
                symbols.append(str(sym).strip().upper())
    return [s for s in symbols if s]


async def snapshot_name(symbol: str) -> str:
    try:
        snap = await fetch_stock_snapshot_coalesced(symbol)
        name = str(snap.get("company_name") or "").strip()
        if name:
            return name
    except Exception:
        pass
    return symbol


def competitor_node(symbol: str, name: str) -> dict[str, Any]:
    return {
        "name": name,
        "symbol": symbol,
        "relation": "competitor",
        "detail": "Peer in the same sector/industry (FMP peers dataset)",
        "share_pct": None,
        "origin": "peers",
        "citation": None,
    }


# --------------------------------------------------------------------------- #
# Symbol resolution (existing /api/search implementation)
# --------------------------------------------------------------------------- #
def infer_market(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    if ".NS" in s:
        return "NSE"
    if ".BO" in s:
        return "BSE"
    if any(suffix in s for suffix in (".US", ".Q", ".NMQ", ".O", ".K")):
        return "US"
    if re.fullmatch(r"[A-Z]{1,5}", s):
        return "US"
    return "NSE"


async def resolve_ticker(name: str | None, *, market: str = "NSE") -> str | None:
    """Ticker for a company named in a filing, or None when no listing clearly matches.

    The search route echoes an unknown query back as its own "ticker" ("THREE LARGEST WHOLESALERS")
    and ranks fuzzy hits first ("McKesson" -> MKTX), so a hit only counts when its company name
    matches the quoted name. US names resolve against SEC's official title -> ticker map.
    """
    if not name or is_generic_party(name):
        return None
    from backend.filings_rag.sources import normalize_company_name, sec_ticker_for_name

    if market == "US":
        try:
            return await sec_ticker_for_name(name)
        except Exception:
            return None
    wanted = normalize_company_name(name)
    if not wanted:
        return None
    try:
        from backend.api.routes.search import search as search_route

        response = await search_route(q=name, market=market)
        for result in getattr(response, "results", []) or []:
            ticker = str(getattr(result, "ticker", "") or "").strip()
            got = normalize_company_name(str(getattr(result, "name", "") or ""))
            if not ticker or ticker.upper() == name.strip().upper():
                continue
            if got == wanted or got.startswith(wanted + " ") or wanted.startswith(got + " "):
                return ticker
    except Exception:
        return None
    return None


_GENERIC_PARTY_TAIL = {
    "suppliers", "supplier", "customers", "customer", "wholesalers", "wholesaler", "distributors",
    "distributor", "vendors", "vendor", "partners", "manufacturers", "companies", "hospitals",
    "pharmacies", "retailers", "clients", "governments", "contractors", "payers", "third parties",
    "carriers", "providers", "operators", "resellers", "integrators", "csps", "oems", "odms",
    "makers", "builders", "developers", "clouds", "aibs", "enterprises", "consumers", "users",
    "segment", "segments", "division", "divisions", "unit", "units", "designers", "hyperscalers",
}
# Filings anonymise big counterparties ("One direct customer", "Another direct customer").
_QUANTITY_LEAD = {"one", "two", "three", "four", "five", "six", "another", "several", "certain", "some",
                  "various", "multiple", "many", "other"}


_GENERIC_MATERIALS = {"raw materials", "raw material", "materials", "material", "components", "commodities",
                      "inputs", "supplies", "parts"}


# Revenue-by-geography lines get read as customers ("United States").
_GEOGRAPHIES = {
    "united states", "us", "usa", "china", "taiwan", "japan", "korea", "south korea", "india", "europe",
    "emea", "apac", "asia", "asia pacific", "americas", "north america", "latin america", "germany",
    "united kingdom", "uk", "france", "singapore", "hong kong", "canada", "mexico", "brazil", "other countries",
}


def is_generic_party(name: str) -> bool:
    """'wholesalers', 'three largest wholesalers', 'China-based suppliers' are categories, not companies."""
    words = re.findall(r"[A-Za-z][A-Za-z.'-]*", re.sub(r"\([^)]*\)", " ", name or ""))
    if not words:
        return True
    if not any(w[0].isupper() for w in words):
        return True
    if words[0].lower() in _QUANTITY_LEAD:
        return True
    if " ".join(w.lower().strip(".") for w in words) in _GEOGRAPHIES:
        return True
    # Plural acronyms are segments ("CSPs", "OEMs", "AIBs"), and so is a name that leads with a
    # category word ("Customers headquartered outside of the United States").
    if len(words) == 1 and re.fullmatch(r"[A-Z]{2,}s", words[0]):
        return True
    return words[-1].lower() in _GENERIC_PARTY_TAIL or words[0].lower() in _GENERIC_PARTY_TAIL


# --------------------------------------------------------------------------- #
# Filings extraction (customers / suppliers / raw materials)
# --------------------------------------------------------------------------- #
def split_name_list(part: str) -> list[str]:
    if not part:
        return []
    cleaned: list[str] = []
    for token in re.split(r"\s+and\s+|,|;|/", part):
        token = token.strip()
        if token:
            cleaned.append(token)
    return cleaned


def chain_node_from_quote(
    relation: str,
    name: str,
    *,
    symbol: str | None,
    share_pct: float | None,
    detail: str,
    quote: str,
    chunk: dict[str, Any],
) -> dict[str, Any] | None:
    name = (name or "").strip()
    if not name:
        return None
    quote = (quote or "").strip()
    if not quote:
        return None
    if not verify_quote(quote, chunk.get("text", "")):
        return None
    citation = None
    try:
        citation = citation_for(chunk, quote)
    except Exception:
        citation = None
    return {
        "name": name,
        "symbol": symbol,
        "relation": relation,
        "detail": detail.strip() or None,
        "share_pct": share_pct,
        "origin": "filings",
        "citation": citation,
    }


def lexical_nodes_for_chunk(relation: str, chunk: dict[str, Any]) -> list[dict[str, Any]]:
    text = chunk.get("text", "") if isinstance(chunk, dict) else ""
    if not isinstance(text, str):
        return []
    nodes: list[dict[str, Any]] = []
    match = _LEX_CUSTOMER_RE.search(text)
    if not match:
        return nodes
    quote = text[match.start():match.end()].strip()
    for name in split_name_list(match.group("list")):
        if is_generic_party(name):
            continue
        node = chain_node_from_quote(
            relation,
            name,
            symbol=None,
            share_pct=None,
            detail="",
            quote=quote,
            chunk=chunk,
        )
        if node is not None:
            nodes.append(node)
    return nodes


def parse_share_pct(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = re.sub(r"[^0-9.\-]", "", value.strip())
        if not cleaned or cleaned in ("-", ".", "-."):
            return None
        try:
            return float(cleaned) / 100.0
        except (TypeError, ValueError):
            return None
    return None


async def node_from_llm(
    relation: str,
    node: dict[str, Any],
    *,
    chunk: dict[str, Any],
    market: str,
) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None
    quote_text = str(node.get("quote", "") or "").strip()
    if not quote_text:
        return None
    base_text = chunk.get("text", "") if isinstance(chunk, dict) else ""
    if not verify_quote(quote_text, base_text):
        return None

    name = str(
        node.get("name")
        or node.get("company")
        or node.get("client")
        or node.get("supplier")
        or node.get("material")
        or ""
    ).strip()
    if not name:
        return None

    if is_generic_party(name):
        return None
    # The model's own ticker guesses were wrong (MKTX for McKesson, CNCA for Cencora); resolve by name.
    symbol = await resolve_ticker(name, market=market)

    share_pct = parse_share_pct(
        node.get("share_pct")
        or node.get("percentage")
        or node.get("share")
        or node.get("weight")
    )
    detail = str(
        node.get("detail") or node.get("description") or node.get("note") or ""
    ).strip()
    return chain_node_from_quote(
        relation,
        name,
        symbol=symbol,
        share_pct=share_pct,
        detail=detail,
        quote=quote_text,
        chunk=chunk,
    )


async def extract_filings_nodes(
    db: Any,
    symbol: str,
    *,
    use_llm: bool,
    market: str,
    max_chunks: int = 6,
) -> list[dict[str, Any]]:
    from backend.filings_rag.sources import normalize_company_name

    nodes: list[dict[str, Any]] = []
    try:
        own_name = normalize_company_name(await snapshot_name(symbol))
    except Exception:
        own_name = ""

    def same_party(a: str, b: str) -> bool:
        # "samsung" and "samsung electronics" are one company; compare on whole words.
        return bool(a and b) and (a == b or a.startswith(b + " ") or b.startswith(a + " "))

    def add(node: dict[str, Any] | None) -> None:
        if node is None:
            return
        name = normalize_company_name(node.get("name") or "")
        # The filer itself showed up as its own supplier ("Microsoft" under MSFT).
        if (node.get("symbol") or "").upper() == symbol.upper() or same_party(name, own_name):
            return
        # One node per company per relation, matching "Samsung" with "Samsung Electronics Co., Ltd.";
        # a later duplicate can still contribute the ticker the first one lacked.
        for existing in nodes:
            if existing["relation"] == node["relation"] and same_party(normalize_company_name(existing.get("name") or ""), name):
                existing["symbol"] = existing.get("symbol") or node.get("symbol")
                return
        nodes.append(node)

    for query in RETRIEVAL_QUERIES:
        try:
            chunks = retrieve_search(db, symbol, query, k=4)
        except Exception:
            chunks = []
        if not isinstance(chunks, list):
            chunks = []
        for chunk in chunks[:max_chunks]:
            text = chunk.get("text", "") if isinstance(chunk, dict) else ""
            if not isinstance(text, str):
                continue

            if use_llm:
                try:
                    payload = await complete_json(_LLM_SYSTEM_PROMPT, text, max_tokens=1500)
                except Exception:
                    payload = None
                if isinstance(payload, dict):
                    for kind_field, relation in (
                        ("customers", "customer"),
                        ("suppliers", "supplier"),
                    ):
                        for node in (payload.get(kind_field) or []):
                            if isinstance(node, dict):
                                add(
                                    await node_from_llm(
                                        relation, node, chunk=chunk, market=market
                                    )
                                )

            for node in lexical_nodes_for_chunk("customer", chunk):
                add(node)

    return nodes


async def extract_raw_materials_from_filings(
    db: Any,
    symbol: str,
    *,
    use_llm: bool,
    market: str,
) -> list[dict[str, Any]]:
    if not use_llm:
        return []
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    try:
        chunks = retrieve_search(db, symbol, "raw materials we source", k=4)
    except Exception:
        chunks = []
    for chunk in (chunks if isinstance(chunks, list) else [])[:6]:
        text = chunk.get("text", "") if isinstance(chunk, dict) else ""
        if not isinstance(text, str):
            continue
        try:
            payload = await complete_json(_LLM_SYSTEM_PROMPT, text, max_tokens=1000)
        except Exception:
            payload = None
        if not isinstance(payload, dict):
            continue
        for node in (payload.get("raw_materials") or []):
            extracted = await node_from_llm(
                "raw_material", node, chunk=chunk, market=market
            )
            if extracted is None:
                continue
            name = extracted["name"]
            # "Raw materials" / "components" are the category heading, not a material.
            if re.sub(r"[^a-z ]", "", name.lower()).strip() in _GENERIC_MATERIALS:
                continue
            symbol_name = curated_symbol_for_name(name)
            key = symbol_name or name.lower()
            if key in seen:
                continue
            seen.add(key)
            results.append(
                {
                    "name": name,
                    "commodity_symbol": symbol_name,
                    "share_pct": extracted.get("share_pct"),
                    "origin": "filings",
                }
            )
    return results


# --------------------------------------------------------------------------- #
# Price / merge
# --------------------------------------------------------------------------- #
async def price_material(
    symbol: str | None,
    *,
    history_cache: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if not symbol:
        return {"price": None, "currency": None, "change_1m_pct": None, "change_1y_pct": None}

    if symbol not in history_cache:
        try:
            unified = await get_unified_fetcher()
            history_cache[symbol] = await unified.fetch_history(symbol, range_str="1y", interval="1d")
        except Exception:
            history_cache[symbol] = {}

    history = history_cache.get(symbol) or {}
    closes = _extract_closes(history)
    return {
        "price": closes[-1] if closes else None,
        "currency": "USD" if closes else None,
        "change_1m_pct": compute_change_pct(closes, 21),
        "change_1y_pct": compute_change_pct(closes, 252),
    }


# --------------------------------------------------------------------------- #
# Snapshot persistence
# --------------------------------------------------------------------------- #
def get_snapshot(db: Any, symbol: str) -> dict[str, Any] | None:
    from backend.value_chain.models import ValueChainSnapshot

    try:
        row = db.query(ValueChainSnapshot).filter_by(symbol=symbol).first()
        payload = getattr(row, "payload", None)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def save_snapshot(db: Any, symbol: str, payload: dict[str, Any], *, engine: str) -> None:
    from backend.value_chain.models import ValueChainSnapshot

    try:
        row = db.query(ValueChainSnapshot).filter_by(symbol=symbol).first()
        if row is None:
            db.add(
                ValueChainSnapshot(
                    symbol=symbol,
                    payload=payload,
                    engine=engine,
                    created_at=datetime.now(timezone.utc),
                )
            )
        else:
            row.payload = payload
            row.engine = engine
            row.created_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
        raise


# --------------------------------------------------------------------------- #
# Snapshot persistence
# --------------------------------------------------------------------------- #
def get_snapshot(db: Any, symbol: str) -> dict[str, Any] | None:
    try:
        from backend.value_chain.models import ValueChainSnapshot

        row = db.query(ValueChainSnapshot).filter_by(symbol=symbol).order_by(
            ValueChainSnapshot.created_at.desc()
        ).first()
        if row is None:
            return None
        payload = getattr(row, "payload", None)
        if isinstance(payload, dict):
            return payload
        return None
    except Exception:
        return None


def save_snapshot(db: Any, symbol: str, payload: dict[str, Any], *, engine: str) -> None:
    try:
        from backend.value_chain.models import ValueChainSnapshot

        now = datetime.now(timezone.utc)
        row = db.query(ValueChainSnapshot).filter_by(symbol=symbol).first()
        if row is None:
            row = ValueChainSnapshot(
                symbol=symbol,
                payload=payload,
                engine=engine,
                created_at=now,
            )
            db.add(row)
        else:
            row.payload = payload
            row.engine = engine
            row.created_at = now
        db.commit()
    except Exception:
        db.rollback()
        raise


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
async def _sector_industry(symbol: str) -> tuple[str | None, str | None]:
    try:
        snap = await fetch_stock_snapshot_coalesced(symbol)
        sector = str(snap.get("sector") or "").strip() or None
        industry = str(snap.get("industry") or "").strip() or sector
        return sector, (industry or None)
    except Exception:
        return None, None


def _engine_label(use_llm: bool, has_filing_nodes: bool) -> str | None:
    if use_llm and llm_available():
        return "llm"
    if has_filing_nodes:
        return "lexical"
    return None


async def build_value_chain(db: Any, symbol: str, *, use_llm: bool) -> dict[str, Any]:
    symbol = (symbol or "").strip().upper()
    warnings: list[str] = []

    sector, industry = await _sector_industry(symbol)
    market = infer_market(symbol)

    competitor_symbols = await peer_symbols(symbol)
    competitors = [competitor_node(sym, await snapshot_name(sym)) for sym in competitor_symbols]

    filing_nodes = await extract_filings_nodes(
        db, symbol, use_llm=use_llm, market=market
    )
    customers = [n for n in filing_nodes if n["relation"] == "customer"]
    suppliers = [n for n in filing_nodes if n["relation"] == "supplier"]
    if not filing_nodes:
        warnings.append(
            "No filing-derived counterparties found; filings may be unavailable for this symbol."
        )

    curated = raw_materials_for_industry(industry, sector)
    filings_materials = await extract_raw_materials_from_filings(
        db, symbol, use_llm=use_llm, market=market
    )

    merged: dict[str, dict[str, Any]] = {}
    for item in curated:
        key = item.get("commodity_symbol") or item["name"].lower()
        merged[key] = dict(item)
    for item in filings_materials:
        key = item.get("commodity_symbol") or item["name"].lower()
        if key in merged:
            if item.get("share_pct") is not None:
                merged[key]["cost_share_pct"] = item["share_pct"]
        else:
            merged[key] = {
                "name": item["name"],
                "commodity_symbol": item.get("commodity_symbol"),
                "cost_share_pct": item.get("share_pct"),
                "origin": "filings",
            }

    history_cache: dict[str, dict[str, Any]] = {}
    raw_materials: list[dict[str, Any]] = []
    for item in merged.values():
        pricing = await price_material(item.get("commodity_symbol"), history_cache=history_cache)
        raw_materials.append(
            {
                "name": item["name"],
                "commodity_symbol": item.get("commodity_symbol"),
                "price": pricing["price"],
                "currency": pricing["currency"],
                "change_1m_pct": pricing["change_1m_pct"],
                "change_1y_pct": pricing["change_1y_pct"],
                "cost_share_pct": item.get("cost_share_pct"),
                "origin": item.get("origin", "curated"),
                "citation": None,
            }
        )

    return {
        "symbol": symbol,
        "sector": sector,
        "industry": industry,
        "customers": customers,
        "suppliers": suppliers,
        "competitors": competitors,
        "raw_materials": raw_materials,
        "updated_at": _now_iso(),
        "warnings": warnings,
    }


async def fetch_value_chain(db: Any, symbol: str, *, use_llm: bool) -> dict[str, Any]:
    stored = get_snapshot(db, symbol)
    if stored is not None:
        return stored
    return await build_value_chain(db, symbol, use_llm=use_llm)


async def extract_value_chain(db: Any, symbol: str, *, use_llm: bool = True) -> dict[str, Any]:
    payload = await build_value_chain(db, symbol, use_llm=use_llm)
    has_filings = bool(payload.get("customers")) or bool(payload.get("suppliers")) or any(
        n.get("origin") == "filings" for n in payload.get("raw_materials", [])
    )
    engine = _engine_label(use_llm, has_filings)
    save_snapshot(db, symbol, payload, engine=engine)
    return payload