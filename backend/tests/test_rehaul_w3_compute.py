from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi import HTTPException

from backend.api.routes import scripting
from backend.core.strategy_runner import StrategyRunner
from backend.model_lab import montecarlo
from backend.models.user_script import UserScriptCreateRequest, UserScriptUpdateRequest
from backend.services import backtest_jobs


def _frame(n: int = 8) -> pd.DataFrame:
    closes = [100.0 + i for i in range(n)]
    return pd.DataFrame(
        {
            "open": closes,
            "high": [c + 1 for c in closes],
            "low": [c - 1 for c in closes],
            "close": closes,
            "volume": [100] * n,
        }
    )


# --- SEC-11 / SCALE-1b: inline strategies run in a killable subprocess --------


def test_infinite_loop_strategy_times_out_and_event_loop_stays_responsive() -> None:
    code = "def generate_signals(df, context):\n    while True:\n        pass\n"
    timeout = 0.5
    runner = StrategyRunner(timeout_seconds=timeout)

    async def scenario() -> tuple[float, int, BaseException | None]:
        ticks = 0
        stop = asyncio.Event()

        async def ticker() -> None:
            nonlocal ticks
            while not stop.is_set():
                await asyncio.sleep(0.05)
                ticks += 1

        tick_task = asyncio.create_task(ticker())
        start = time.monotonic()
        error: BaseException | None = None
        try:
            await asyncio.to_thread(runner.run, code, _frame(), {})
        except BaseException as exc:  # noqa: BLE001
            error = exc
        elapsed = time.monotonic() - start
        stop.set()
        await tick_task
        return elapsed, ticks, error

    elapsed, ticks, error = asyncio.run(scenario())
    assert isinstance(error, TimeoutError)
    assert elapsed < timeout + 2.0
    # ~0.05s ticker kept running while the strategy spun.
    assert ticks >= int(timeout / 0.05) // 2


def test_strategy_swallowing_timeout_is_hard_killed() -> None:
    code = (
        "def generate_signals(df, context):\n"
        "    while True:\n"
        "        try:\n"
        "            while True:\n"
        "                pass\n"
        "        except:\n"
        "            pass\n"
    )
    start = time.monotonic()
    with pytest.raises(TimeoutError):
        StrategyRunner(timeout_seconds=0.2).run(code, _frame(), {})
    assert time.monotonic() - start < 0.2 + 3.0 + 1.5


def test_inline_strategy_output_does_not_touch_server_stdout(capsys) -> None:
    code = "def generate_signals(df, context):\n    print('inside child')\n    return [0] * len(df)\n"
    out = StrategyRunner(timeout_seconds=2.0).run(code, _frame(), {})
    assert "inside child" in out.stdout
    assert "inside child" not in capsys.readouterr().out


def test_inline_strategy_series_and_user_errors_roundtrip() -> None:
    frame = _frame()
    series_code = "def generate_signals(df, context):\n    return (df['close'] > 103).astype(int)\n"
    out = StrategyRunner(timeout_seconds=2.0).run(series_code, frame, {})
    assert out.signals.index.equals(frame.index)
    assert out.signals.tolist() == [0, 0, 0, 0, 1, 1, 1, 1]

    with pytest.raises(ZeroDivisionError):
        StrategyRunner(timeout_seconds=2.0).run("def generate_signals(df, context):\n    return 1 / 0\n", frame, {})
    with pytest.raises(ValueError, match="only -1, 0, 1"):
        StrategyRunner(timeout_seconds=2.0).run("def generate_signals(df, context):\n    return [5] * len(df)\n", frame, {})


# --- SEC-6: scripts are owner-scoped ------------------------------------------


@pytest.fixture()
def _clean_store():
    scripting._SCRIPT_STORE.clear()
    yield
    scripting._SCRIPT_STORE.clear()


def test_user_b_cannot_read_edit_run_or_delete_user_a_script(_clean_store) -> None:
    alice = SimpleNamespace(id="user-a")
    bob = SimpleNamespace(id="user-b")
    created = asyncio.run(
        scripting.create_script(UserScriptCreateRequest(name="A", source='plot(close, "Close", "blue", 1)'), alice)
    )
    assert created.owner_id == "user-a"

    assert [s.id for s in asyncio.run(scripting.list_scripts(alice))] == [created.id]
    assert asyncio.run(scripting.list_scripts(bob)) == []

    for call in (
        lambda: scripting.get_script(created.id, bob),
        lambda: scripting.update_script(created.id, UserScriptUpdateRequest(name="pwned"), bob),
        lambda: scripting.run_script(created.id, scripting.OpenScriptRunRequest(ohlcv=[]), bob),
        lambda: scripting.delete_script(created.id, bob),
    ):
        with pytest.raises(HTTPException) as excinfo:
            asyncio.run(call())
        assert excinfo.value.status_code == 404

    assert scripting._SCRIPT_STORE[created.id].name == "A"
    assert asyncio.run(scripting.get_script(created.id, alice)).id == created.id
    updated = asyncio.run(scripting.update_script(created.id, UserScriptUpdateRequest(name="A2"), alice))
    assert updated.owner_id == "user-a"


def test_per_user_script_cap(_clean_store, monkeypatch) -> None:
    monkeypatch.setattr(scripting, "_MAX_SCRIPTS_PER_USER", 2)
    alice = SimpleNamespace(id="user-a")
    req = UserScriptCreateRequest(name="A", source='plot(close, "Close", "blue", 1)')
    asyncio.run(scripting.create_script(req, alice))
    asyncio.run(scripting.create_script(req, alice))
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(scripting.create_script(req, alice))
    assert excinfo.value.status_code == 409
    # Another user's quota is independent.
    asyncio.run(scripting.create_script(req, SimpleNamespace(id="user-b")))


# --- SEC-18: execute worker gets rlimits + output cap ---------------------------


def test_execute_worker_passes_resource_limits_and_caps_output(monkeypatch) -> None:
    seen = {}
    original_run = scripting.subprocess.run

    def spy(command, **kwargs):
        seen.update(kwargs)
        return original_run(command, **kwargs)

    monkeypatch.setattr(scripting.subprocess, "run", spy)
    out = asyncio.run(
        scripting.execute_python(scripting.PythonExecuteRequest(code="for i in range(300000):\n    print('xxxxxxxxx')", timeout_seconds=5))
    )
    assert "preexec_fn" in seen
    assert len(out.stdout) <= 1_000_000 + 64
    assert "truncated" in out.stdout


# --- SCALE-14: progress goes only to the submitting user ----------------------


class _FakeHub:
    def __init__(self) -> None:
        self.sent: list[tuple[str, dict]] = []
        self.broadcasts: list[dict] = []

    async def send_to_user(self, user_id: str, message: dict) -> None:
        self.sent.append((user_id, message))

    async def broadcast_to_all(self, payload: dict) -> None:
        self.broadcasts.append(payload)


def test_backtest_progress_goes_only_to_send_to_user(monkeypatch) -> None:
    hub = _FakeHub()
    monkeypatch.setattr(backtest_jobs, "ws_manager", hub)
    asyncio.run(backtest_jobs.BacktestJobService._send_progress("user-a", {"type": "backtest_progress", "progress": 10}))
    asyncio.run(backtest_jobs.BacktestJobService._send_progress(None, {"type": "backtest_progress", "progress": 10}))
    assert hub.sent == [("user-a", {"type": "backtest_progress", "progress": 10})]
    assert hub.broadcasts == []


def test_backtest_progress_skipped_when_hub_lacks_send_to_user(monkeypatch) -> None:
    calls: list[dict] = []

    class _OldHub:
        async def broadcast_to_all(self, payload: dict) -> None:
            calls.append(payload)

    monkeypatch.setattr(backtest_jobs, "ws_manager", _OldHub())
    asyncio.run(backtest_jobs.BacktestJobService._send_progress("user-a", {"type": "backtest_progress"}))
    assert calls == []


def test_backtest_job_records_submitter_and_scopes_reads(monkeypatch) -> None:
    rows: dict[str, SimpleNamespace] = {}

    class _Query:
        def __init__(self, run_id_holder):
            self._holder = run_id_holder

        def filter(self, expr):
            self._run_id = expr.right.value
            return self

        def first(self):
            return rows.get(self._run_id)

    class _Db:
        def add(self, row):
            rows[row.run_id] = row

        def commit(self):
            pass

        def close(self):
            pass

        def query(self, _model):
            return _Query(None)

    monkeypatch.setattr(backtest_jobs, "get_db", lambda: iter([_Db()]))
    service = backtest_jobs.BacktestJobService()

    async def _noop_worker():
        return None

    monkeypatch.setattr(service, "ensure_worker", _noop_worker)
    run_id = asyncio.run(service.submit(backtest_jobs.BacktestJobRequest(symbol="AAPL"), user_id="user-a"))
    assert json.loads(rows[run_id].request_json)["user_id"] == "user-a"
    assert asyncio.run(service.get_status(run_id, user_id="user-a"))["status"] == "queued"
    assert asyncio.run(service.get_status(run_id, user_id="user-b"))["status"] == "not_found"
    assert asyncio.run(service.get_result(run_id, user_id="user-b"))["status"] == "not_found"
    # Unscoped (legacy) callers keep working.
    assert asyncio.run(service.get_status(run_id))["status"] == "queued"


# --- montecarlo job registry is bounded ----------------------------------------


def test_montecarlo_jobs_bounded(monkeypatch) -> None:
    monkeypatch.setattr(montecarlo, "_jobs", {})
    monkeypatch.setattr(montecarlo, "_MAX_JOBS", 5)
    running = montecarlo.create_monte_carlo_job("run-running")
    for i in range(10):
        job = montecarlo.create_monte_carlo_job(f"run-{i}")
        job.status = "succeeded"
    montecarlo.create_monte_carlo_job("last")
    assert len(montecarlo._jobs) <= 6
    assert running.id in montecarlo._jobs  # unfinished jobs are never evicted
