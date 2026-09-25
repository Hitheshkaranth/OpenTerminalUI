from __future__ import annotations

import pytest

from backend.strategy_export.presets import PRESETS
from backend.strategy_export.service import generate


def test_all_presets_generate_pine_and_mql5() -> None:
    """Every preset should produce useful Pine and MQL5 code."""
    assert len(PRESETS) >= 6
    for preset in PRESETS.values():
        spec = preset["spec"]
        pine = generate(spec, "pine")
        assert pine["code"]
        assert pine["code"].startswith("//@version=6")
        assert "strategy(" in pine["code"]
        assert "strategy.entry" in pine["code"]
        assert "when=" not in pine["code"]  # removed in Pine v6
        assert _balanced_parentheses(pine["code"])

        mql5 = generate(spec, "mql5")
        assert mql5["code"]
        assert "OnTick" in mql5["code"]
        assert "CTrade" in mql5["code"]
        assert any(token in mql5["code"] for token in ("iMA", "iRSI", "iMACD", "iBands", "iATR"))


def test_invalid_indicator_reference_is_value_error() -> None:
    """Bad indicator references should be caller-handleable."""
    spec = {
        "name": "Invalid",
        "indicators": [],
        "entry_long": [
            {
                "left": {"kind": "indicator", "ref": "missing"},
                "op": ">",
                "right": {"kind": "const", "value": 1},
            }
        ],
        "risk": {"qty_pct": 100},
    }
    with pytest.raises(ValueError, match="unknown indicator"):
        generate(spec, "pine")


def test_bad_format_is_value_error() -> None:
    """Unsupported formats should become route-friendly errors."""
    with pytest.raises(ValueError, match="format"):
        generate(PRESETS["sma_cross"]["spec"], "python")


def _balanced_parentheses(code: str) -> bool:
    depth = 0
    for char in code:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if depth < 0:
            return False
    return depth == 0


def test_mql5_only_releases_declared_handles_and_escapes_name() -> None:
    """highest/lowest have no indicator handle, and control chars in the name must not break the source."""
    import re

    spec = {
        "name": 'Breakout\n"v2"',
        "indicators": [{"id": "hh", "type": "highest", "params": {"length": 20}}],
        "entry_long": [
            {
                "left": {"kind": "price", "ref": "close"},
                "op": ">",
                "right": {"kind": "indicator", "ref": "hh"},
            }
        ],
    }
    code = generate(spec, "mql5")["code"]
    for handle in re.findall(r"IndicatorRelease\((\w+)\)", code):
        assert f"int {handle} " in code
    assert '#property description "Breakout\\n\\"v2\\""' in code
