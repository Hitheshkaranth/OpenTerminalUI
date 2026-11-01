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


def test_timed_out_worker_is_reaped_and_stdout_is_not_redirected(monkeypatch) -> None:
    import sys
    import time
    children = []
    original_popen = scripting.subprocess.Popen
    def track_process(*args, **kwargs):
        child = original_popen(*args, **kwargs)
        children.append(child)
        return child
    monkeypatch.setattr(scripting.subprocess, "Popen", track_process)
    stdout = sys.stdout
    start = time.monotonic()
    out = asyncio.run(scripting.execute_python(PythonExecuteRequest(code="while True:\n    pass", timeout_seconds=0.2)))
    assert out.timed_out is True
    assert time.monotonic() - start < 3
    assert children and all(child.poll() is not None for child in children)
    assert sys.stdout is stdout
    # A timed-out request must not poison subsequent requests or test reporting.
    success = asyncio.run(scripting.execute_python(PythonExecuteRequest(code="print('next request')\nresult = {'value': 7}", timeout_seconds=2)))
    assert success.result == {"value": 7}
    assert success.stdout == "next request\n"
    assert sys.stdout is stdout
    assert all(child.poll() is not None for child in children)


def test_packaged_runtime_selects_worker_dispatch_without_starting_app(monkeypatch) -> None:
    import json
    from types import SimpleNamespace
    calls = []
    monkeypatch.setattr(scripting.sys, "frozen", True, raising=False)
    def fake_run(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(returncode=0, stdout=json.dumps({"stdout": "", "stderr": "", "result": 1, "timed_out": False}))
    monkeypatch.setattr(scripting.subprocess, "run", fake_run)
    out = asyncio.run(scripting.execute_python(PythonExecuteRequest(code="result = 1", timeout_seconds=2)))
    assert out.result == 1
    assert calls == [[scripting.sys.executable, "--ot-python-execution-worker"]]


def test_windows_launcher_dispatches_worker_before_server_or_browser(monkeypatch) -> None:
    import runpy
    import threading
    from pathlib import Path
    from backend.core import python_execution_worker
    calls = []
    def unexpected_thread(*args, **kwargs):
        raise AssertionError("Worker must not start browser or server threads")
    monkeypatch.setattr(threading, "Thread", unexpected_thread)
    monkeypatch.setattr(python_execution_worker, "main", lambda: calls.append("worker"))
    launcher = runpy.run_path(str(Path(__file__).resolve().parents[2] / "packaging/windows/run_windows.py"))
    launcher["main"](["--ot-python-execution-worker"])
    assert calls == ["worker"]


def test_worker_serializes_collections_and_execution_errors(monkeypatch) -> None:
    import io
    import json
    from backend.core import python_execution_worker
    for code, expected, error in (
        ("result = {'values': {1, 2}}", {"values": [1, 2]}, False),
        ("result = 1 / 0", None, True),
        ("result = float('nan')", None, True),
    ):
        output = io.StringIO()
        monkeypatch.setattr(python_execution_worker.sys, "stdin", io.StringIO(json.dumps({"code": code, "builtins": list(scripting._SAFE_BUILTINS)})))
        monkeypatch.setattr(python_execution_worker.sys, "stdout", output)
        python_execution_worker.main()
        response = json.loads(output.getvalue())
        assert response["result"] == expected
        assert bool(response["stderr"]) == error
        assert response["timed_out"] is False
