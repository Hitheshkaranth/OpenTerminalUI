from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Any


@dataclass(frozen=True)
class ExecutionModelConfig:
    model: str = "fixed_bps"
    fixed_bps: float = 0.0
    participation_cap: float = 1.0
    adv: float | None = None
    volume_weighted_bps: float = 25.0
    impact_coefficient_bps: float = 35.0
    min_bps: float = 0.0
    max_bps: float = 500.0


@dataclass(frozen=True)
class ExecutionFill:
    requested_quantity: float
    filled_quantity: float
    unfilled_quantity: float
    fill_price: float
    base_price: float
    slippage_bps: float
    participation_rate: float
    capped: bool


def parse_execution_config(raw: dict[str, Any] | None, *, default_slippage_bps: float = 0.0) -> ExecutionModelConfig:
    raw = raw or {}
    node = raw.get("execution_model") if isinstance(raw.get("execution_model"), dict) else raw
    model = str(node.get("model") or node.get("type") or "fixed_bps").strip().lower()
    if model not in {"fixed_bps", "volume_weighted", "impact_curve"}:
        model = "fixed_bps"
    fixed = float(node.get("fixed_bps", node.get("slippage_bps", default_slippage_bps)) or 0.0)
    cap = float(node.get("participation_cap", node.get("max_participation", node.get("volume_cap_pct", 1.0))) or 1.0)
    cap = max(0.0, min(cap, 1.0))
    adv_raw = node.get("adv", node.get("adv_volume"))
    adv = float(adv_raw) if adv_raw not in (None, "") else None
    return ExecutionModelConfig(
        model=model,
        fixed_bps=max(0.0, fixed),
        participation_cap=cap,
        adv=adv if adv and adv > 0 else None,
        volume_weighted_bps=max(0.0, float(node.get("volume_weighted_bps") if node.get("volume_weighted_bps") not in (None, "") else 25.0)),
        impact_coefficient_bps=max(0.0, float(node.get("impact_coefficient_bps") if node.get("impact_coefficient_bps") not in (None, "") else 35.0)),
        min_bps=max(0.0, float(node.get("min_bps", 0.0) or 0.0)),
        max_bps=max(0.0, float(node.get("max_bps") if node.get("max_bps") not in (None, "") else 500.0)),
    )


def estimate_slippage_bps(order_quantity: float, *, bar_volume: float | None, config: ExecutionModelConfig) -> float:
    qty = abs(float(order_quantity or 0.0))
    adv = float(config.adv or bar_volume or 0.0)
    if qty <= 0:
        return 0.0
    if config.model == "fixed_bps" or adv <= 0:
        raw = config.fixed_bps
    else:
        participation = max(0.0, qty / adv)
        if config.model == "impact_curve":
            raw = config.fixed_bps + config.impact_coefficient_bps * sqrt(participation)
        else:
            raw = config.fixed_bps + config.volume_weighted_bps * participation
    return min(config.max_bps, max(config.min_bps, float(raw)))


def apply_execution_model(
    order_quantity: float,
    base_price: float,
    *,
    side: str,
    bar_volume: float | None,
    config: ExecutionModelConfig,
) -> ExecutionFill:
    requested = float(order_quantity or 0.0)
    available = abs(float(bar_volume or 0.0)) * config.participation_cap if bar_volume is not None else abs(requested)
    fill_abs = min(abs(requested), available) if available > 0 else abs(requested)
    filled = fill_abs if requested >= 0 else -fill_abs
    unfilled_abs = max(0.0, abs(requested) - fill_abs)
    unfilled = unfilled_abs if requested >= 0 else -unfilled_abs
    bps = estimate_slippage_bps(filled, bar_volume=bar_volume, config=config)
    direction = 1.0 if side.upper() == "BUY" else -1.0
    fill_price = float(base_price) * (1.0 + direction * bps / 10_000.0)
    participation = fill_abs / float(bar_volume) if bar_volume and bar_volume > 0 else 0.0
    return ExecutionFill(
        requested_quantity=requested,
        filled_quantity=filled,
        unfilled_quantity=unfilled,
        fill_price=fill_price,
        base_price=float(base_price),
        slippage_bps=bps,
        participation_rate=participation,
        capped=unfilled_abs > 0,
    )
