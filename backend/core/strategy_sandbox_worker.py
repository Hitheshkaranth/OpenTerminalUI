"""Sandbox for user-supplied inline backtest strategies.

This module holds the restricted execution environment (AST validation, the
attribute guard and the builtin allow-list) and doubles as a child-process
entry point. ``StrategyRunner`` validates the code in the server process, then
runs it here in a separate interpreter (``python -I strategy_sandbox_worker.py``)
under RLIMIT_AS/RLIMIT_CPU and a wall-clock kill, so a runaway or hostile
strategy can neither block the event loop nor leave a thread spinning in the
server.

Protocol: stdin carries a pickle written by the trusted parent
(``{"code", "frame", "context", "timeout"}``). stdout carries JSON only -- the
child never pickles anything back, because it runs untrusted code.

Only pandas/numpy/stdlib are imported so the child starts quickly without the
backend package on sys.path.
"""
from __future__ import annotations

import ast
import contextlib
import io
import json
import pickle
import signal
import sys
import types
from typing import Any

import numpy as np
import pandas as pd

MAX_STREAM_CHARS = 1_000_000

# Builtins available to inline strategies. This is both the execution environment
# and the set of names inline code is allowed to call, so the two cannot drift.
SAFE_STRATEGY_BUILTINS: dict[str, Any] = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "filter": filter,
    "float": float,
    "int": int,
    "isinstance": isinstance,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "print": print,
    "range": range,
    "reversed": reversed,
    "round": round,
    "set": set,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
}


# Attribute names inline code may never touch: pandas/numpy file I/O, string
# evaluators/formatters, and frame/generator introspection (frame.f_globals escapes scope).
BLOCKED_STRATEGY_ATTRS: frozenset[str] = frozenset({
    "to_csv", "to_pickle", "to_parquet", "to_excel", "to_hdf", "to_sql", "to_feather",
    "to_stata", "to_json", "to_html", "to_latex", "to_markdown", "to_clipboard", "to_xml",
    "to_orc", "to_string", "tofile", "save", "savez", "savez_compressed", "savetxt",
    "load", "loadtxt", "genfromtxt", "fromfile", "fromregex", "memmap", "DataSource",
    "ExcelWriter", "ExcelFile", "HDFStore", "eval", "query", "dump",
    # str.format/format_map walk attributes and keys inside the format string
    # ("{0.__init__.__globals__[sys].modules[os].environ}"), bypassing the AST checks.
    "format", "format_map",
    "gi_frame", "gi_code", "cr_frame", "cr_code", "ag_frame", "ag_code",
    "f_back", "f_globals", "f_locals", "f_builtins", "f_code", "tb_frame", "tb_next",
})
# Submodules reachable by attribute access; any other module (e.g. pd.io.common.os)
# is refused at runtime.
ALLOWED_STRATEGY_MODULES: frozenset[str] = frozenset({"numpy.random", "numpy.linalg", "numpy.fft"})


def sandbox_getattr(obj: Any, name: str) -> Any:
    value = getattr(obj, name)
    if isinstance(value, types.ModuleType) and value.__name__ not in ALLOWED_STRATEGY_MODULES:
        raise ValueError(f"Inline strategy blocked module access: {name}")
    return value


class AttributeGuard(ast.NodeTransformer):
    """Route every attribute read through sandbox_getattr."""

    def visit_Attribute(self, node: ast.Attribute) -> ast.AST:
        self.generic_visit(node)
        if not isinstance(node.ctx, ast.Load):
            return node
        return ast.copy_location(
            ast.Call(
                func=ast.Name(id="_sandbox_getattr", ctx=ast.Load()),
                args=[node.value, ast.Constant(value=node.attr)],
                keywords=[],
            ),
            node,
        )


def validate_inline_strategy(code: str) -> ast.Module:
    """AST-level validation; raises ValueError on anything outside the sandbox."""
    tree = ast.parse(code, mode="exec")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise ValueError("Inline strategy imports are disabled")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"open", "exec", "eval", "compile", "__import__"}:
            raise ValueError(f"Inline strategy blocked call: {node.func.id}")
        # Block dunder traversal (e.g. ().__class__.__base__.__subclasses__()),
        # which reaches arbitrary loaded classes and escapes the sandbox -> RCE.
        if isinstance(node, ast.Attribute) and ("__" in node.attr or node.attr.startswith("read_") or node.attr in BLOCKED_STRATEGY_ATTRS):
            raise ValueError(f"Inline strategy blocked attribute access: {node.attr}")
        if isinstance(node, ast.Name) and "__" in node.id:
            raise ValueError(f"Inline strategy blocked name: {node.id}")
        # Block ALL function calls except the builtins actually exposed below,
        # which excludes globals()/locals() and every context-leaking name.
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id not in SAFE_STRATEGY_BUILTINS:
                raise ValueError(f"Inline strategy blocked call: {node.func.id}")
    return tree


def run_inline_strategy(
    code: str,
    frame: pd.DataFrame,
    context: dict[str, Any],
    *,
    out: io.StringIO | None = None,
    err: io.StringIO | None = None,
) -> tuple[pd.Series | list[int], str, str]:
    """Validate, guard and execute inline strategy code in this interpreter."""
    tree = validate_inline_strategy(code)
    tree = ast.fix_missing_locations(AttributeGuard().visit(tree))
    # Only expose pandas, numpy, and the safe builtins - nothing else.
    scope: dict[str, Any] = {
        "pd": pd,
        "np": np,
        "_sandbox_getattr": sandbox_getattr,
        "__builtins__": dict(SAFE_STRATEGY_BUILTINS),
    }
    out = out if out is not None else io.StringIO()
    err = err if err is not None else io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        exec(compile(tree, "<inline_strategy>", "exec"), scope, scope)
        fn = scope.get("generate_signals")
        if not callable(fn):
            raise ValueError("Inline strategy must define callable generate_signals(df, context)")
        raw_signals = fn(frame.copy(), context.copy())
    return raw_signals, out.getvalue(), err.getvalue()


def signal_values(raw_signals: Any, frame: pd.DataFrame) -> list[int]:
    """Convert strategy output to a JSON-safe list aligned to ``frame``'s rows."""
    if isinstance(raw_signals, pd.Series):
        aligned = raw_signals.reindex(frame.index)
        if aligned.isna().any():
            raise ValueError("Signal series must align to OHLCV index without gaps")
        return [int(v) for v in aligned.astype(int).tolist()]
    if isinstance(raw_signals, list):
        return [int(v) for v in pd.Series(raw_signals, dtype=int).tolist()]
    raise ValueError("Signals must be a list[int] or pandas.Series")


class _SandboxTimeout(BaseException):
    """Raised by the interval timer; BaseException so `except Exception` cannot swallow it."""


def _arm_timer(seconds: float) -> bool:
    if not hasattr(signal, "setitimer"):
        return False

    def _on_alarm(signum, frame):  # noqa: ARG001
        raise _SandboxTimeout()

    signal.signal(signal.SIGALRM, _on_alarm)
    signal.setitimer(signal.ITIMER_REAL, max(0.001, float(seconds)))
    return True


def _disarm_timer() -> None:
    if hasattr(signal, "setitimer"):
        signal.setitimer(signal.ITIMER_REAL, 0)


def _cap(text: str) -> str:
    if len(text) > MAX_STREAM_CHARS:
        return text[:MAX_STREAM_CHARS] + "\n[output truncated at 1MB]"
    return text


def main() -> None:
    request = pickle.loads(sys.stdin.buffer.read())
    timeout = float(request.get("timeout") or 2.0)
    frame = request["frame"]
    out, err = io.StringIO(), io.StringIO()
    response: dict[str, Any]
    try:
        _arm_timer(timeout)
        try:
            raw, _, _ = run_inline_strategy(request["code"], frame, request.get("context") or {}, out=out, err=err)
        finally:
            _disarm_timer()
        response = {"ok": True, "signals": signal_values(raw, frame)}
    except _SandboxTimeout:
        response = {"ok": False, "error_type": "TimeoutError", "error": f"Strategy execution exceeded timeout of {timeout}s"}
    except Exception as exc:  # user-code errors are reported, never raised in the parent as-is
        response = {"ok": False, "error_type": type(exc).__name__, "error": _cap(str(exc))}
    response["stdout"] = _cap(out.getvalue())
    response["stderr"] = _cap(err.getvalue())
    sys.stdout.write(json.dumps(response))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
