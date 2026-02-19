from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

DATA_DIR = Path("data") / "backtest_store"
PARQUET_DIR = DATA_DIR / "parquet"
CATALOG_FILE = DATA_DIR / "catalog.sqlite"


def ensure_store() -> None:
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def write_equity_curve(run_id: str, equity_curve: list[dict[str, Any]]) -> dict[str, Any]:
    ensure_store()
    frame = pd.DataFrame(equity_curve)
    if frame.empty:
        return {"run_id": run_id, "rows": 0, "path": ""}
    out_path = PARQUET_DIR / f"{run_id}.parquet"
    try:
        frame.to_parquet(out_path, index=False)
    except Exception:
        fallback = PARQUET_DIR / f"{run_id}.csv"
        frame.to_csv(fallback, index=False)
        return {"run_id": run_id, "rows": len(frame), "path": str(fallback)}
    return {"run_id": run_id, "rows": len(frame), "path": str(out_path)}


def list_store_items() -> list[dict[str, Any]]:
    ensure_store()
    items: list[dict[str, Any]] = []
    for path in sorted(PARQUET_DIR.glob("*")):
        if not path.is_file():
            continue
        items.append(
            {
                "name": path.name,
                "bytes": path.stat().st_size,
                "updated_at": path.stat().st_mtime,
            }
        )
    return items
