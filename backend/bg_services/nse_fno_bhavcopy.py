from __future__ import annotations

import csv
from io import StringIO
from typing import Any

from backend.api.deps import get_db
from backend.models import NseFnoBhavcopy


def parse_bhavcopy_csv(content: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(StringIO(content))
    rows: list[dict[str, Any]] = []
    for row in reader:
        if not row.get("SYMBOL"):
            continue
        rows.append(
            {
                "trade_date": row.get("TIMESTAMP", ""),
                "instrument": row.get("INSTRUMENT", ""),
                "symbol": row.get("SYMBOL", "").strip().upper(),
                "expiry_date": row.get("EXPIRY_DT", ""),
                "strike_price": float(row.get("STRIKE_PR", "0") or 0),
                "option_type": row.get("OPTION_TYP", ""),
                "open_price": float(row.get("OPEN", "0") or 0),
                "high_price": float(row.get("HIGH", "0") or 0),
                "low_price": float(row.get("LOW", "0") or 0),
                "close_price": float(row.get("CLOSE", "0") or 0),
                "settle_price": float(row.get("SETTLE_PR", "0") or 0),
                "contracts": int(float(row.get("CONTRACTS", "0") or 0)),
                "value_lakh": float(row.get("VAL_INLAKH", "0") or 0),
                "open_interest": int(float(row.get("OPEN_INT", "0") or 0)),
                "change_in_oi": int(float(row.get("CHG_IN_OI", "0") or 0)),
            }
        )
    return rows


def upsert_bhavcopy_rows(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    db = next(get_db())
    inserted = 0
    try:
        for row in rows:
            exists = (
                db.query(NseFnoBhavcopy)
                .filter(
                    NseFnoBhavcopy.trade_date == row["trade_date"],
                    NseFnoBhavcopy.symbol == row["symbol"],
                    NseFnoBhavcopy.expiry_date == row["expiry_date"],
                    NseFnoBhavcopy.option_type == row["option_type"],
                    NseFnoBhavcopy.strike_price == row["strike_price"],
                )
                .first()
            )
            if exists:
                continue
            db.add(NseFnoBhavcopy(**row))
            inserted += 1
        db.commit()
        return inserted
    finally:
        db.close()
