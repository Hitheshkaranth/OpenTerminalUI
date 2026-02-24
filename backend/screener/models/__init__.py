from __future__ import annotations

from typing import Any

from . import altman, buffett, can_slim, dividend, dupont, graham, greenblatt, lynch, multi_factor, piotroski, reverse_dcf, technical

MODEL_REGISTRY = {
    "piotroski": piotroski,
    "altman": altman,
    "greenblatt": greenblatt,
    "buffett": buffett,
    "graham": graham,
    "lynch": lynch,
    "can_slim": can_slim,
    "dupont": dupont,
    "reverse_dcf": reverse_dcf,
    "multi_factor": multi_factor,
    "dividend": dividend,
    "technical": technical,
}


def compute_model(name: str, financials: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    module = MODEL_REGISTRY.get(name)
    if module is None:
        return {"value": None, "error": f"Unknown model: {name}"}
    return module.compute(financials, **kwargs)


def compute_many(names: list[str], financials: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in names:
        out[name] = compute_model(name, financials, **kwargs)
    return out
