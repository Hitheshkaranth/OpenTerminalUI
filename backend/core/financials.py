from __future__ import annotations

import pandas as pd


def parse_statement(df: pd.DataFrame) -> list[dict[str, object]]:
    if df is None or df.empty:
        return []
    out: list[dict[str, object]] = []
    for metric, row in df.iterrows():
        payload: dict[str, object] = {"metric": str(metric)}
        for col, val in row.items():
            key = col.strftime("%Y-%m-%d") if hasattr(col, "strftime") else str(col)
            payload[key] = None if pd.isna(val) else float(val)
        out.append(payload)
    return out
