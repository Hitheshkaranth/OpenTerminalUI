from __future__ import annotations

import ast
import io
import queue
import threading
import traceback
from contextlib import redirect_stdout

from fastapi import APIRouter, HTTPException

from backend.core.models import PythonExecuteRequest, PythonExecuteResponse

router = APIRouter()

_BLOCKED_MODULES = {"os", "sys", "subprocess", "socket", "pathlib", "shutil", "ctypes", "importlib"}


def _validate_code(code: str) -> None:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise HTTPException(status_code=400, detail=f"Syntax error: {exc.msg}") from exc
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in _BLOCKED_MODULES:
                    raise HTTPException(status_code=400, detail=f"Import blocked: {root}")
        if isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root in _BLOCKED_MODULES:
                raise HTTPException(status_code=400, detail=f"Import blocked: {root}")


def _run_user_code(code: str) -> PythonExecuteResponse:
    safe_builtins = {
        "abs": abs,
        "all": all,
        "any": any,
        "dict": dict,
        "enumerate": enumerate,
        "float": float,
        "int": int,
        "len": len,
        "list": list,
        "max": max,
        "min": min,
        "print": print,
        "range": range,
        "round": round,
        "set": set,
        "str": str,
        "sum": sum,
        "tuple": tuple,
    }
    globals_env = {"__builtins__": safe_builtins}
    locals_env: dict[str, object] = {}
    stdout_buf = io.StringIO()
    try:
        with redirect_stdout(stdout_buf):
            exec(code, globals_env, locals_env)  # noqa: S102
        return PythonExecuteResponse(stdout=stdout_buf.getvalue(), stderr="", result=locals_env.get("result"), timed_out=False)
    except Exception:
        return PythonExecuteResponse(stdout=stdout_buf.getvalue(), stderr=traceback.format_exc(limit=1), result=None, timed_out=False)


def _run_user_code_worker(code: str, out_queue: "queue.Queue[dict]") -> None:
    out_queue.put(_run_user_code(code).model_dump())


@router.post("/v1/scripting/python/execute", response_model=PythonExecuteResponse)
async def execute_python(payload: PythonExecuteRequest) -> PythonExecuteResponse:
    _validate_code(payload.code)
    timeout = max(0.1, min(float(payload.timeout_seconds), 10.0))
    out_queue: "queue.Queue[dict]" = queue.Queue(maxsize=1)
    worker = threading.Thread(target=_run_user_code_worker, args=(payload.code, out_queue), daemon=True)
    worker.start()
    worker.join(timeout=timeout)
    if worker.is_alive():
        return PythonExecuteResponse(stdout="", stderr="Execution timed out", result=None, timed_out=True)
    if out_queue.empty():
        return PythonExecuteResponse(stdout="", stderr="Execution failed", result=None, timed_out=False)
    return PythonExecuteResponse(**out_queue.get())
