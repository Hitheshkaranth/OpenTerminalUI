from __future__ import annotations

import asyncio

import numpy as np
import pandas as pd
import pytest
from fastapi import HTTPException

from backend.api.routes import scripting
from backend.models.user_script import (
    OpenScriptCompileRequest,
    OpenScriptRunRequest,
    UserScriptCreateRequest,
    UserScriptUpdateRequest,
)
from backend.services.openscript_compiler import OpenScriptCompiler


@pytest.fixture(autouse=True)
def _clear_script_store() -> None:
    scripting._SCRIPT_STORE.clear()
    yield
    scripting._SCRIPT_STORE.clear()


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "open": [10, 11, 12, 11, 13, 14, 15, 16],
            "high": [11, 12, 13, 12, 14, 15, 16, 17],
            "low": [9, 10, 11, 10, 12, 13, 14, 15],
            "close": [10, 10, 10, 10, 20, 21, 22, 23],
            "volume": [100, 110, 120, 130, 140, 150, 160, 170],
        }
    )


def _compile(source: str):
    return OpenScriptCompiler().compile(source)


def test_compile_simple_ema() -> None:
    res = _compile('fast = ema(close, 3)\nplot(fast, "Fast EMA", "blue", 2)')
    assert res.success is True
    assert len(res.outputs) == 1
    out = OpenScriptCompiler().evaluate(res.ast or {}, _frame())
    assert len(out.outputs) == 1
    assert len(out.outputs[0].series) == len(_frame())


def test_compile_crossover_alert() -> None:
    source = (
        'fast = ema(close, 2)\n'
        'slow = ema(close, 4)\n'
        'plot(fast, "Fast", "blue", 2)\n'
        'plot(slow, "Slow", "red", 2)\n'
        'alertcondition(crossover(fast, slow), "Golden Cross", "Fast crossed above slow")'
    )
    res = _compile(source)
    assert res.success is True
    assert len(res.outputs) == 3


def test_compile_multi_output() -> None:
    source = (
        'fast = ema(close, 3)\n'
        'slow = sma(close, 3)\n'
        'trend = rsi(close, 3)\n'
        'plot(fast, "Fast", "blue", 2)\n'
        'plot(slow, "Slow", "red", 2)\n'
        'plot(trend, "Trend", "green", 1)'
    )
    res = _compile(source)
    assert res.success is True
    assert len(res.outputs) == 3


def test_compile_syntax_error() -> None:
    res = _compile('fast = ema(close, 3\nplot(fast, "Fast", "blue", 2)')
    assert res.success is False
    assert res.errors
    assert res.errors[0].line is not None
    assert res.errors[0].col is not None


def test_compile_unknown_function() -> None:
    res = _compile("foo(close, 10)")
    assert res.success is False
    assert res.errors
    assert "Unsupported function" in res.errors[0].message


def test_compile_lookback() -> None:
    res = _compile('plot(close[1], "Prev Close", "blue", 1)')
    assert res.success is True
    eval_out = OpenScriptCompiler().evaluate(res.ast or {}, _frame())
    values = eval_out.outputs[0].series
    assert values[0] is None
    assert values[1] == 10


def test_eval_sma() -> None:
    res = _compile('plot(sma(close, 3), "SMA", "blue", 1)')
    out = OpenScriptCompiler().evaluate(res.ast or {}, _frame())
    series = out.outputs[0].series
    expected = pd.Series([np.nan, np.nan, 10.0, 10.0, 13.3333333333, 17.0, 21.0, 22.0])
    assert series[2] == pytest.approx(expected.iloc[2], rel=1e-6)
    assert series[-1] == pytest.approx(expected.iloc[-1], rel=1e-6)


def test_eval_ema() -> None:
    res = _compile('plot(ema(close, 3), "EMA", "blue", 1)')
    out = OpenScriptCompiler().evaluate(res.ast or {}, _frame())
    series = out.outputs[0].series
    assert series[-1] == pytest.approx(21.5, rel=1e-6)


def test_eval_rsi() -> None:
    res = _compile('plot(rsi(close, 3), "RSI", "blue", 1)')
    out = OpenScriptCompiler().evaluate(res.ast or {}, _frame())
    series = [value for value in out.outputs[0].series if value is not None]
    assert series
    assert all(0.0 <= float(value) <= 100.0 for value in series)


def test_eval_crossover() -> None:
    frame = pd.DataFrame(
        {
            "open": [1, 1, 1, 1, 1],
            "high": [1, 1, 1, 1, 10],
            "low": [1, 1, 1, 1, 1],
            "close": [1, 1, 1, 1, 10],
            "volume": [1, 1, 1, 1, 1],
        }
    )
    source = 'fast = close\nslow = sma(close, 3)\nplot(crossover(fast, slow), "Cross", "blue", 1)'
    res = _compile(source)
    out = OpenScriptCompiler().evaluate(res.ast or {}, frame)
    assert out.outputs[0].series[-1] is True
    assert any(out.outputs[0].series)


def test_eval_highest_lowest() -> None:
    res = _compile('plot(highest(close, 3), "High", "blue", 1)\nplot(lowest(close, 3), "Low", "red", 1)')
    out = OpenScriptCompiler().evaluate(res.ast or {}, _frame())
    high_series = out.outputs[0].series
    low_series = out.outputs[1].series
    assert high_series[2] == pytest.approx(10.0)
    assert high_series[-1] == pytest.approx(23.0)
    assert low_series[2] == pytest.approx(10.0)
    assert low_series[-1] == pytest.approx(21.0)


@pytest.mark.parametrize(
    "source",
    [
        "import os",
        "eval('1+1')",
        "exec('print(1)')",
        "__import__('os')",
        "open('/etc/passwd')",
        "globals()",
        "locals()",
        "getattr(close, '__class__')",
        "lambda x: x",
        "[x for x in close]",
        "close.__class__.__bases__",
        "type.__subclasses__(type)",
        'sma(eval("close"), 10)',
        '"{0.__class__}".format(close)',
        'compile("1+1", "", "eval")',
        "class Evil:\n    pass",
        "@evil\ndef f():\n    pass",
        'with open("x") as f:\n    pass',
        "from os import *",
        "(x := __import__('os'))",
    ],
)
def test_security_fuzz_rejections(source: str) -> None:
    res = _compile(source)
    assert res.success is False
    assert res.errors


def test_create_script() -> None:
    payload = UserScriptCreateRequest(name="Golden Cross", description="test", source='plot(close, "Close", "blue", 1)')
    script = asyncio.run(scripting.create_script(payload))
    assert script.id
    assert script.name == "Golden Cross"
    assert script.compiled_ast["kind"] == "openscript"
    assert script.id in scripting._SCRIPT_STORE


def test_list_get_update_delete_script() -> None:
    created = asyncio.run(scripting.create_script(UserScriptCreateRequest(name="Script A", description="one", source='plot(close, "Close", "blue", 1)')))
    listed = asyncio.run(scripting.list_scripts())
    assert len(listed) == 1
    fetched = asyncio.run(scripting.get_script(created.id))
    assert fetched.id == created.id
    updated = asyncio.run(
        scripting.update_script(
            created.id,
            UserScriptUpdateRequest(name="Script B", source='plot(ema(close, 3), "EMA", "red", 1)'),
        )
    )
    assert updated.name == "Script B"
    assert len(updated.outputs) == 1
    deleted = asyncio.run(scripting.delete_script(created.id))
    assert deleted["deleted"] is True
    with pytest.raises(HTTPException):
        asyncio.run(scripting.get_script(created.id))


def test_run_script() -> None:
    created = asyncio.run(scripting.create_script(UserScriptCreateRequest(name="Run Script", source='plot(close, "Close", "blue", 1)')))
    payload = OpenScriptRunRequest(ohlcv=_frame().to_dict(orient="records"))
    out = asyncio.run(scripting.run_script(created.id, payload))
    assert out.script_id == created.id
    assert out.row_count == len(_frame())
    assert len(out.outputs) == 1
    assert len(out.outputs[0].series) == len(_frame())
