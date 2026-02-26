from typing import List
from sqlalchemy.orm import Session
from backend.instruments.models import InstrumentMaster
from backend.instruments.schemas import InstrumentSearchResult

def search_instruments(db: Session, query: str, limit: int = 20) -> List[InstrumentSearchResult]:
    query_upper = query.upper().strip()
    if not query_upper:
        return []

    # 1. Exact match
    exact = db.query(InstrumentMaster).filter(InstrumentMaster.display_symbol == query_upper).all()

    # 2. Prefix match
    prefix = db.query(InstrumentMaster).filter(
        InstrumentMaster.display_symbol.like(f"{query_upper}%"),
        InstrumentMaster.display_symbol != query_upper
    ).limit(limit).all()

    # 3. Fuzzy match
    fuzzy = db.query(InstrumentMaster).filter(
        InstrumentMaster.display_symbol.like(f"%{query_upper}%"),
        ~InstrumentMaster.display_symbol.like(f"{query_upper}%")
    ).limit(limit).all()

    results = exact + prefix + fuzzy

    seen = set()
    final = []

    for r in results:
        if r.canonical_id not in seen:
            seen.add(r.canonical_id)

            # Helper safely parse tick_size/lot_size to float if possible
            tick = None
            if r.tick_size:
                try: tick = float(r.tick_size)
                except ValueError: pass

            lot = None
            if r.lot_size:
                try: lot = float(r.lot_size)
                except ValueError: pass

            final.append(InstrumentSearchResult(
                canonical_id=r.canonical_id,
                display_symbol=r.display_symbol,
                type=r.type,
                exchange=r.exchange,
                currency=r.currency,
                vendor_ids=r.vendor_mappings_json or {},
                tick_size=tick,
                lot_size=lot
            ))

            if len(final) >= limit:
                break

    return final
