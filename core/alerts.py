from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import pandas as pd


OPS: dict[str, Callable[[Any, Any], bool]] = {
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


@dataclass(frozen=True)
class AlertRule:
    name: str
    field: str
    op: str
    threshold: float
    severity: str = "medium"


def evaluate_alert_rule(df: pd.DataFrame, rule: AlertRule) -> pd.DataFrame:
    if df.empty or rule.field not in df.columns or rule.op not in OPS:
        return pd.DataFrame()
    out_rows: list[dict] = []
    ts = datetime.utcnow().isoformat(timespec="seconds")
    for _, row in df.iterrows():
        ticker = row.get("ticker")
        value = row.get(rule.field)
        if ticker is None or pd.isna(value):
            continue
        try:
            lhs = float(value)
            if OPS[rule.op](lhs, float(rule.threshold)):
                out_rows.append(
                    {
                        "timestamp_utc": ts,
                        "ticker": str(ticker),
                        "rule_name": rule.name,
                        "field": rule.field,
                        "op": rule.op,
                        "threshold": float(rule.threshold),
                        "current_value": lhs,
                        "severity": rule.severity,
                        "message": f"{ticker}: {rule.field} {rule.op} {rule.threshold} (current={lhs:.4f})",
                    }
                )
        except (TypeError, ValueError):
            continue
    return pd.DataFrame(out_rows)


def append_alert_log(alerts_df: pd.DataFrame, log_path: Path) -> None:
    if alerts_df.empty:
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if log_path.exists():
        existing = pd.read_csv(log_path)
        merged = pd.concat([existing, alerts_df], ignore_index=True)
        merged.to_csv(log_path, index=False)
    else:
        alerts_df.to_csv(log_path, index=False)

