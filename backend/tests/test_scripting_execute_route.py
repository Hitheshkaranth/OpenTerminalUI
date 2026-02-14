from __future__ import annotations

import asyncio

from backend.api.routes import scripting
from backend.core.models import PythonExecuteRequest


def test_execute_python_returns_stdout_and_result() -> None:
    payload = PythonExecuteRequest(code="print('hello')\nresult = 42", timeout_seconds=2)
    out = asyncio.run(scripting.execute_python(payload))
    assert out.timed_out is False
    assert "hello" in out.stdout
    assert out.result == 42


def test_execute_python_blocks_imports() -> None:
    payload = PythonExecuteRequest(code="import os\nprint('x')", timeout_seconds=2)
    try:
        asyncio.run(scripting.execute_python(payload))
    except Exception as exc:  # FastAPI HTTPException
        assert "Import blocked" in str(exc.detail)
    else:
        raise AssertionError("Expected blocked import exception")


def test_execute_python_times_out() -> None:
    payload = PythonExecuteRequest(code="while True:\n    pass", timeout_seconds=0.2)
    out = asyncio.run(scripting.execute_python(payload))
    assert out.timed_out is True
