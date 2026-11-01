from __future__ import annotations
import asyncio
import math
from collections import defaultdict
import re
from urllib.parse import urlparse
from datetime import datetime, timezone
from fastapi import HTTPException
from backend.api.deps import fetch_stock_snapshot_coalesced
from backend.models.core import PortfolioORM, PortfolioHoldingORM
from backend.research_dossiers.models import ResearchDossier
from backend.value_chain.models import ValueChainSnapshot


def number(value):
    try:
        if isinstance(value, bool):
            return None
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def canonical_symbol(symbol, market=""):
    """Normalize supported exchange aliases without conflating Indian and US tickers."""
    symbol = str(symbol or "").strip().upper()
    if ":" in symbol:
        exchange, ticker = symbol.split(":", 1)
        if exchange == "NSE":
            return ticker if ticker.endswith(".NS") else ticker + ".NS"
        if exchange == "BSE":
            return ticker if ticker.endswith(".BO") else ticker + ".BO"
        if exchange in {"NASDAQ", "NYSE", "AMEX", "US"}:
            return ticker
    if str(market or "").upper() in {"IN", "NSE"} and "." not in symbol:
        return symbol + ".NS"
    if str(market or "").upper() == "BSE" and "." not in symbol:
        return symbol + ".BO"
    return symbol


def symbol_aliases(symbol):
    canonical = canonical_symbol(symbol)
    if canonical.endswith(".NS"):
        return {canonical, canonical[:-3], "NSE:" + canonical[:-3]}
    if canonical.endswith(".BO"):
        return {canonical, canonical[:-3], "BSE:" + canonical[:-3]}
    if ":" not in canonical:
        return {canonical, *(f"{venue}:{canonical}" for venue in ("NYSE", "NASDAQ", "AMEX", "US"))}
    return {canonical}


def quote_timestamp(value):
    """Canonicalize provider epochs; leave absent/ambiguous dates unknown."""
    if value is None or isinstance(value, bool):
        return None
    try:
        if isinstance(value, (float, int)) or (isinstance(value, str) and value.replace('.', '', 1).isdigit()):
            epoch = float(value)
            if not math.isfinite(epoch) or epoch <= 0:
                return None
            date = datetime.fromtimestamp(epoch / 1000 if epoch >= 100_000_000_000 else epoch, tz=timezone.utc)
        else:
            date = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            if date.tzinfo is None:
                return None
        return date.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def quote_evidence(quote, currency):
    if not isinstance(quote, dict):
        quote = {}
    provenance = quote.get("provenance")
    provenance = provenance if isinstance(provenance, dict) else {}
    details = quote.get("details") if isinstance(quote.get("details"), dict) else {}
    source = str(provenance.get("source") or details.get("price_source") or quote.get("source") or "unknown").lower()
    quality = str(provenance.get("quality") or quote.get("data_status") or "unreported").lower()
    price = number(quote.get("current_price"))
    quote_currency = str(quote.get("currency") or "").upper()
    reasons = []
    status_values = " ".join(str(v).lower() for v in (source, quality, quote.get("provenance"), details.get("price_source")))
    if any(word in status_values for word in ("synthetic", "mock", "simulated")):
        reasons.append("synthetic_quote")
    if source in {"unknown", "none", "unavailable", ""} or quality in {"unknown", "unavailable", "error", "stale"}:
        reasons.append("unverified_quote_provenance")
    if price is None or price <= 0:
        reasons.append("missing_price")
    if quote_currency != str(currency or "").upper():
        reasons.append("currency_mismatch" if quote_currency else "missing_currency")
    return {"source": source, "quality": quality, "as_of": quote_timestamp(provenance.get("as_of") or quote.get("as_of") or quote.get("ts")),
            "currency": quote_currency or None, "eligible": not reasons, "reasons": reasons}, price


def cited_relationship(citation):
    if not isinstance(citation, dict) or not str(citation.get("quote") or "").strip():
        return None
    parsed = urlparse(str(citation.get("source_url") or ""))
    source = parsed.scheme in {"http", "https"} and bool(parsed.netloc)
    document = citation.get("doc_id") or citation.get("document_id")
    return citation if source or document else None


def disclosed_share(node, citation):
    value = number(node.get("share_pct") if node.get("share_pct") is not None else node.get("cost_share_pct"))
    if citation is None or value is None or not 0 <= value <= 1:
        return None
    # A cited relationship alone does not establish the model's numeric share estimate.
    percentages = re.findall(r"(\d+(?:\.\d+)?)\s*(?:%|percent|per cent)", str(citation.get("quote") or ""), re.I)
    return value * 100 if any(math.isclose(float(pct), value * 100, abs_tol=.01) for pct in percentages) else None


def build_exposure(holdings, snapshots, dossiers, quotes, currency):
    quantities = defaultdict(float)
    for holding in holdings:
        shares = number(holding.shares)
        if shares is not None and shares > 0:
            quantities[canonical_symbol(holding.symbol)] += shares
    snapshots = {canonical_symbol(symbol, (row.payload or {}).get("market", "")): row for symbol, row in snapshots.items()}
    quotes = {canonical_symbol(symbol): quote for symbol, quote in quotes.items()}
    dossier_symbols = {d.id: canonical_symbol(d.symbol, d.payload.get("market", "")) for d in dossiers}
    values, quote_gaps, quote_status = {}, [], {}
    for symbol, quantity in quantities.items():
        evidence, price = quote_evidence(quotes.get(symbol), currency)
        quote_status[symbol] = evidence
        if not evidence["eligible"]:
            quote_gaps.append(symbol)
        else:
            values[symbol] = quantity * price
    total = sum(values.values())
    complete = not quote_gaps and total > 0 and math.isfinite(total)
    weights = {s: v / total * 100 for s, v in values.items()} if complete else {}
    groups = {}
    covered = set()
    for symbol in quantities:
        snapshot = snapshots.get(symbol)
        payload = snapshot.payload if snapshot else {}
        for collection, kind in (("suppliers", "supplier"), ("customers", "customer"), ("raw_materials", "commodity")):
            for node in payload.get(collection, []):
                if not isinstance(node, dict):
                    continue
                name = str(node.get("name") or "").strip()
                if not name:
                    continue
                key = f"{kind}:{str(node.get('symbol') or node.get('commodity_symbol') or name).casefold()}"
                group = groups.setdefault(key, {"id": key, "name": name, "kind": kind, "holdings": []})
                if any(h["symbol"] == symbol for h in group["holdings"]):
                    continue
                citation = cited_relationship(node.get("citation"))
                if citation:
                    covered.add(symbol)
                related = [d for d in dossiers if dossier_symbols[d.id] == symbol]
                group["holdings"].append({"symbol": symbol, "weight_pct": weights.get(symbol),
                    "business_share_pct": disclosed_share(node, citation),
                    "basis": "disclosed" if citation else "unknown", "citation": citation,
                    "quote_provenance": quote_status[symbol], "observed_at": payload.get("updated_at"),
                    "dossiers": [{"id": d.id, "title": d.payload.get("title", symbol)} for d in related]})
    for d in dossiers:
        symbol = dossier_symbols[d.id]
        if symbol not in quantities:
            continue
        for condition in d.payload.get("thesis_conditions", []):
            if not condition.get("enabled", True):
                continue
            key = f"assumption:{condition['metric']}:{condition['unit']}:{condition.get('operator')}:{condition.get('threshold')}"
            group = groups.setdefault(key, {"id": key, "name": condition["metric"].replace("_", " "), "kind": "assumption", "holdings": []})
            existing = next((h for h in group["holdings"] if h["symbol"] == symbol), None)
            if existing:
                if d.id not in {item["id"] for item in existing["dossiers"]}:
                    existing["dossiers"].append({"id": d.id, "title": d.payload.get("title", symbol)})
                continue
            group["holdings"].append({"symbol": symbol, "weight_pct": weights.get(symbol), "business_share_pct": None,
                "basis": "user_assumption", "citation": None, "condition": condition, "quote_provenance": quote_status[symbol],
                "dossiers": [{"id": d.id, "title": d.payload.get("title", symbol)}]})
    rows = list(groups.values())
    for row in rows:
        row["holding_count"] = len(row["holdings"])
        row["portfolio_weight_pct"] = sum(h["weight_pct"] for h in row["holdings"]) if complete else None
    rows.sort(key=lambda r: (r["holding_count"], r["portfolio_weight_pct"] or 0), reverse=True)
    return {"items": rows, "coverage": {"holdings": len(quantities), "with_cited_relationships": len(covered),
        "unknown_symbols": sorted(set(quantities) - covered), "quote_gaps": quote_gaps, "weights_complete": complete,
        "quotes": quote_status},
        "weight_basis": "Share of quoted long equity holdings, excluding cash and short positions. Quotes may be delayed or cached; unknown quote times remain unknown. All holdings require sourced quotes in portfolio currency; no FX conversion is inferred.",
        "interpretation": "Affected holdings weight is not a predicted loss or quantified business exposure. Relationships may overlap.", "currency": currency}


async def portfolio_impact(db, user_id, portfolio_id):
    portfolio = db.query(PortfolioORM).filter_by(id=portfolio_id, user_id=user_id).first()
    if not portfolio:
        raise HTTPException(404, "Portfolio not found")
    holdings = db.query(PortfolioHoldingORM).filter_by(portfolio_id=portfolio_id).all()
    symbols = list({h.symbol for h in holdings if h.shares > 0})
    holdings = [h for h in holdings if h.shares > 0]
    semaphore = asyncio.Semaphore(5)
    async def quote(symbol):
        try:
            async with semaphore:
                return symbol, await asyncio.wait_for(fetch_stock_snapshot_coalesced(canonical_symbol(symbol)), 8)
        except Exception:
            return symbol, {}
    quotes = dict(await asyncio.gather(*(quote(s) for s in symbols)))
    aliases = set().union(*(symbol_aliases(symbol) for symbol in symbols)) if symbols else set()
    snapshots = {s.symbol: s for s in db.query(ValueChainSnapshot).filter(ValueChainSnapshot.symbol.in_(aliases)).all()}
    # Dossiers carry market separately, so a bare Indian ticker can match its qualified holding safely.
    dossiers = db.query(ResearchDossier).filter(ResearchDossier.user_id == user_id).all()
    result = build_exposure(holdings, snapshots, dossiers, quotes, portfolio.currency)
    return {"portfolio_id": portfolio.id, "portfolio_name": portfolio.name, **result}
