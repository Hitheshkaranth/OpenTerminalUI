from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import uuid4

from backend.breakout_engine.detectors import detect_pattern


_ALLOWED_FIELDS = {
    "close",
    "volume",
    "resistance",
    "support",
    "avg_volume",
    "range_pct",
    "close_change_pct",
}
_ALLOWED_OPERATORS = {">", ">=", "<", "<=", "==", "!="}


@dataclass(frozen=True)
class _ValueRef:
    token: str | None
    number: float | None
    factor: float


@dataclass(frozen=True)
class _Clause:
    left: str
    op: str
    right: _ValueRef


class BreakoutBuilderValidationError(ValueError):
    pass


class BreakoutBuilderService:
    def __init__(self) -> None:
        self._builders: dict[str, dict[str, Any]] = {}

    def validate(self, dsl: str) -> dict[str, Any]:
        clauses = _parse_dsl(dsl)
        return {
            "valid": True,
            "dsl": dsl.strip(),
            "clauses": [
                {
                    "left": c.left,
                    "op": c.op,
                    "right_token": c.right.token,
                    "right_number": c.right.number,
                    "right_factor": c.right.factor,
                }
                for c in clauses
            ],
        }

    def evaluate(self, candles: list[dict[str, Any]], dsl: str, *, lookback: int = 20) -> dict[str, Any]:
        clauses = _parse_dsl(dsl)
        context = _build_context(candles, lookback=lookback)

        evaluations: list[dict[str, Any]] = []
        passed = True
        for clause in clauses:
            left_val = float(context.get(clause.left, 0.0))
            right_val = _resolve_right(clause.right, context)
            ok = _eval_clause(left_val, clause.op, right_val)
            evaluations.append(
                {
                    "left": clause.left,
                    "op": clause.op,
                    "left_value": left_val,
                    "right_value": right_val,
                    "passed": ok,
                }
            )
            passed = passed and ok

        return {
            "triggered": passed,
            "clauses": evaluations,
            "context": context,
        }

    def save(self, name: str, dsl: str) -> dict[str, Any]:
        valid = self.validate(dsl)
        builder_id = str(uuid4())
        row = {
            "id": builder_id,
            "name": name.strip(),
            "dsl": valid["dsl"],
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        self._builders[builder_id] = row
        return dict(row)

    def get(self, builder_id: str) -> dict[str, Any] | None:
        row = self._builders.get(builder_id)
        return dict(row) if row else None

    def list(self) -> list[dict[str, Any]]:
        rows = sorted(self._builders.values(), key=lambda r: str(r.get("created_at") or ""), reverse=True)
        return [dict(row) for row in rows]


def _parse_dsl(dsl: str) -> list[_Clause]:
    expr = str(dsl or "").strip()
    if not expr:
        raise BreakoutBuilderValidationError("dsl must not be empty")

    normalized = expr.replace("&&", " AND ").replace(" and ", " AND ").replace(" And ", " AND ")
    if " OR " in normalized.upper() or "||" in normalized:
        raise BreakoutBuilderValidationError("OR is not supported; use AND clauses")

    raw_clauses = [c.strip() for c in normalized.split(" AND ") if c.strip()]
    if not raw_clauses:
        raise BreakoutBuilderValidationError("dsl contains no clauses")

    parsed: list[_Clause] = []
    for raw in raw_clauses:
        parsed.append(_parse_clause(raw))
    return parsed


def _parse_clause(raw: str) -> _Clause:
    for op in (">=", "<=", "==", "!=", ">", "<"):
        if op in raw:
            left, right = raw.split(op, 1)
            left_token = left.strip().lower()
            if left_token not in _ALLOWED_FIELDS:
                raise BreakoutBuilderValidationError(f"unsupported field '{left_token}'")
            value_ref = _parse_value_ref(right.strip().lower())
            return _Clause(left=left_token, op=op, right=value_ref)
    raise BreakoutBuilderValidationError(f"unsupported operator in clause '{raw}'")


def _parse_value_ref(token: str) -> _ValueRef:
    try:
        return _ValueRef(token=None, number=float(token), factor=1.0)
    except Exception:
        pass

    for field in sorted(_ALLOWED_FIELDS, key=len, reverse=True):
        if token == field:
            return _ValueRef(token=field, number=None, factor=1.0)
        if token.startswith(f"{field}*"):
            scale = float(token[len(field) + 1 :])
            return _ValueRef(token=field, number=None, factor=scale)
        if token.startswith(f"{field}/"):
            div = float(token[len(field) + 1 :])
            if div == 0:
                raise BreakoutBuilderValidationError("division by zero in right expression")
            return _ValueRef(token=field, number=None, factor=1.0 / div)

    raise BreakoutBuilderValidationError(f"unsupported right expression '{token}'")


def _build_context(candles: list[dict[str, Any]], *, lookback: int) -> dict[str, float]:
    bars = [c for c in candles if isinstance(c, dict)]
    if len(bars) < 2:
        raise BreakoutBuilderValidationError("need at least 2 candles to evaluate builder")

    latest = bars[-1]
    hist = bars[-(max(lookback, 2) + 1) : -1]
    if not hist:
        hist = bars[:-1]

    latest_close = float(latest.get("close", latest.get("c", 0.0)) or 0.0)
    latest_volume = float(latest.get("volume", latest.get("v", 0.0)) or 0.0)
    latest_high = float(latest.get("high", latest.get("h", latest_close)) or latest_close)
    latest_low = float(latest.get("low", latest.get("l", latest_close)) or latest_close)

    prev_close = float(hist[-1].get("close", hist[-1].get("c", latest_close)) or latest_close)
    resistance = max(float(x.get("high", x.get("h", latest_close)) or latest_close) for x in hist)
    support = min(float(x.get("low", x.get("l", latest_close)) or latest_close) for x in hist)
    avg_volume = sum(float(x.get("volume", x.get("v", 0.0)) or 0.0) for x in hist) / max(len(hist), 1)
    range_pct = ((latest_high - latest_low) / max(abs(latest_close), 1e-9)) * 100.0
    close_change_pct = ((latest_close - prev_close) / max(abs(prev_close), 1e-9)) * 100.0

    return {
        "close": latest_close,
        "volume": latest_volume,
        "resistance": resistance,
        "support": support,
        "avg_volume": avg_volume,
        "range_pct": range_pct,
        "close_change_pct": close_change_pct,
    }


def _resolve_right(ref: _ValueRef, context: dict[str, float]) -> float:
    if ref.number is not None:
        return float(ref.number)
    if ref.token is None:
        return 0.0
    base = float(context.get(ref.token, 0.0))
    return base * float(ref.factor)


def _eval_clause(left: float, op: str, right: float) -> bool:
    if op == ">":
        return left > right
    if op == ">=":
        return left >= right
    if op == "<":
        return left < right
    if op == "<=":
        return left <= right
    if op == "==":
        return left == right
    if op == "!=":
        return left != right
    return False


_builder_service: BreakoutBuilderService | None = None


def get_breakout_builder_service() -> BreakoutBuilderService:
    global _builder_service
    if _builder_service is None:
        _builder_service = BreakoutBuilderService()
    return _builder_service


def evaluate_builder_breakout(candles: list[dict[str, Any]], dsl: str, *, lookback: int = 20) -> dict[str, Any]:
    builder = get_breakout_builder_service()
    evaluated = builder.evaluate(candles, dsl, lookback=lookback)
    pattern_signal = detect_pattern(candles, "range_breakout_up", lookback=lookback)
    return {
        "triggered": bool(evaluated.get("triggered")) and bool(pattern_signal.get("triggered")),
        "dsl": dsl,
        "builder": evaluated,
        "pattern_reference": pattern_signal,
    }
