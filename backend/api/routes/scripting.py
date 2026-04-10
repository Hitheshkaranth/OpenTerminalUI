from __future__ import annotations

import ast
import io
import queue
import threading
import traceback
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4
from contextlib import redirect_stdout

import pandas as pd
from fastapi import APIRouter, HTTPException

from backend.core.models import PythonExecuteRequest, PythonExecuteResponse
from backend.models.user_script import (
    OpenScriptCompileRequest,
    OpenScriptOutput,
    OpenScriptRunRequest,
    OpenScriptRunResponse,
    UserScript,
    UserScriptCreateRequest,
    UserScriptUpdateRequest,
)
from backend.services.openscript_compiler import CompileResult, OpenScriptCompiler

router = APIRouter()

_BLOCKED_MODULES = {"os", "sys", "subprocess", "socket", "pathlib", "shutil", "ctypes", "importlib"}
_COMPILER = OpenScriptCompiler()
_SCRIPT_STORE: dict[str, UserScript] = {}


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


def _compile_or_raise(source: str) -> CompileResult:
    result = _COMPILER.compile(source)
    if result.success:
        return result
    detail = result.errors[0].message if result.errors else "OpenScript compilation failed"
    if result.errors and result.errors[0].line is not None:
        detail = f"{detail} (line {result.errors[0].line}, col {result.errors[0].col})"
    raise HTTPException(status_code=400, detail=detail)


def _script_from_source(script_id: str, payload: UserScriptCreateRequest | UserScriptUpdateRequest, *, existing: UserScript | None = None) -> UserScript:
    source = payload.source if isinstance(payload, UserScriptCreateRequest) else payload.source or (existing.source if existing else "")
    compile_result = _compile_or_raise(source)
    created_at = existing.created_at if existing else datetime.now(timezone.utc)
    updated_at = datetime.now(timezone.utc)
    return UserScript(
        id=existing.id if existing else uuid4().hex,
        name=payload.name if isinstance(payload, UserScriptCreateRequest) else (payload.name if payload.name is not None else existing.name if existing else ""),
        description=payload.description if isinstance(payload, UserScriptCreateRequest) else (payload.description if payload.description is not None else existing.description if existing else ""),
        source=source,
        compiled_ast=compile_result.ast or {},
        outputs=compile_result.outputs,
        is_public=payload.is_public if isinstance(payload, UserScriptCreateRequest) else (payload.is_public if payload.is_public is not None else existing.is_public if existing else False),
        created_at=created_at,
        updated_at=updated_at,
    )


def _normalize_ohlcv_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    frame = pd.DataFrame(rows).copy()
    frame.columns = [str(col).strip().lower() for col in frame.columns]
    rename_map = {"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume"}
    frame = frame.rename(columns=rename_map)
    for col in ["open", "high", "low", "close", "volume"]:
        if col not in frame.columns:
            frame[col] = pd.NA
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    return frame[["open", "high", "low", "close", "volume"]].copy()


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


@router.post("/scripting/compile", response_model=CompileResult)
async def compile_openscript(payload: OpenScriptCompileRequest) -> CompileResult:
    return _COMPILER.compile(payload.source)


@router.post("/scripting/scripts", response_model=UserScript)
async def create_script(payload: UserScriptCreateRequest) -> UserScript:
    script = _script_from_source("", payload)
    _SCRIPT_STORE[script.id] = script
    return script


@router.get("/scripting/scripts", response_model=list[UserScript])
async def list_scripts() -> list[UserScript]:
    return sorted(_SCRIPT_STORE.values(), key=lambda item: item.updated_at, reverse=True)


@router.get("/scripting/scripts/{script_id}", response_model=UserScript)
async def get_script(script_id: str) -> UserScript:
    script = _SCRIPT_STORE.get(script_id)
    if script is None:
        raise HTTPException(status_code=404, detail="Script not found")
    return script


@router.put("/scripting/scripts/{script_id}", response_model=UserScript)
async def update_script(script_id: str, payload: UserScriptUpdateRequest) -> UserScript:
    existing = _SCRIPT_STORE.get(script_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Script not found")
    updated_payload = UserScriptCreateRequest(
        name=payload.name if payload.name is not None else existing.name,
        description=payload.description if payload.description is not None else existing.description,
        source=payload.source if payload.source is not None else existing.source,
        is_public=payload.is_public if payload.is_public is not None else existing.is_public,
    )
    script = _script_from_source(script_id, updated_payload, existing=existing)
    _SCRIPT_STORE[script_id] = script
    return script


@router.delete("/scripting/scripts/{script_id}")
async def delete_script(script_id: str) -> dict[str, Any]:
    existing = _SCRIPT_STORE.pop(script_id, None)
    if existing is None:
        raise HTTPException(status_code=404, detail="Script not found")
    return {"deleted": True, "id": script_id}


@router.post("/scripting/scripts/{script_id}/run", response_model=OpenScriptRunResponse)
async def run_script(script_id: str, payload: OpenScriptRunRequest) -> OpenScriptRunResponse:
    script = _SCRIPT_STORE.get(script_id)
    if script is None:
        raise HTTPException(status_code=404, detail="Script not found")
    if not script.compiled_ast:
        script = _script_from_source(script_id, UserScriptCreateRequest(name=script.name, description=script.description, source=script.source, is_public=script.is_public), existing=script)
        _SCRIPT_STORE[script_id] = script
    frame = _normalize_ohlcv_frame(payload.ohlcv)
    eval_result = _COMPILER.evaluate(script.compiled_ast, frame)
    outputs = [
        OpenScriptOutput(
            kind=item.kind,
            title=item.title,
            color=item.color,
            linewidth=item.linewidth,
            message=item.message,
            series=item.series,
            metadata=item.metadata,
        )
        for item in eval_result.outputs
    ]
    return OpenScriptRunResponse(script_id=script.id, script_name=script.name, outputs=outputs, row_count=len(frame))
