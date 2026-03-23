from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any, Iterable

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from backend.core.technicals import ema as technical_ema
from backend.core.technicals import sma as technical_sma
from backend.scanner_engine.indicators import rsi as scanner_rsi


_ALLOWED_FUNCTIONS = {
    "sma",
    "ema",
    "rsi",
    "crossover",
    "crossunder",
    "highest",
    "lowest",
    "plot",
    "hline",
    "bgcolor",
    "alertcondition",
}

_OUTPUT_FUNCTIONS = {"plot", "hline", "bgcolor", "alertcondition"}

_BANNED_STRING_TOKENS = {
    "eval",
    "exec",
    "compile",
    "__import__",
    "getattr",
    "setattr",
    "delattr",
    "globals",
    "locals",
    "vars",
    "dir",
    "type",
    "open",
    "file",
}

_ALLOWED_BINARY_OPS = (ast.Add, ast.Sub, ast.Mult, ast.Div)
_ALLOWED_UNARY_OPS = (ast.USub, ast.UAdd, ast.Not)
_ALLOWED_COMPARE_OPS = (ast.Eq, ast.NotEq, ast.Gt, ast.GtE, ast.Lt, ast.LtE)


class CompileError(BaseModel):
    message: str
    line: int | None = None
    col: int | None = None


class CompileResult(BaseModel):
    success: bool
    ast: dict[str, Any] | None = None
    outputs: list[dict[str, Any]] = Field(default_factory=list)
    errors: list[CompileError] = Field(default_factory=list)


class EvalOutput(BaseModel):
    kind: str
    title: str | None = None
    color: str | None = None
    linewidth: int | None = None
    message: str | None = None
    series: list[Any] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvalResult(BaseModel):
    outputs: list[EvalOutput] = Field(default_factory=list)
    variables: dict[str, Any] = Field(default_factory=dict)


class OpenScriptError(ValueError):
    def __init__(self, message: str, node: ast.AST | None = None) -> None:
        super().__init__(message)
        self.node = node


def _node_location(node: ast.AST | None) -> tuple[int | None, int | None]:
    if node is None:
        return None, None
    return getattr(node, "lineno", None), getattr(node, "col_offset", None)


def _is_constant_string(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _reject_string_literal(value: str, node: ast.AST) -> None:
    lowered = value.lower()
    if any(token in lowered for token in _BANNED_STRING_TOKENS):
        raise OpenScriptError(f"String literal contains blocked token: {value!r}", node)


class _Validator:
    def validate(self, tree: ast.AST) -> None:
        if not isinstance(tree, ast.Module):
            raise OpenScriptError("OpenScript source must parse to a module", tree)
        for node in ast.walk(tree):
            self._validate_node(node)

    def _validate_node(self, node: ast.AST) -> None:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal, ast.Lambda, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            raise OpenScriptError(f"Unsupported syntax: {type(node).__name__}", node)
        if isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            raise OpenScriptError(f"Comprehensions are not supported: {type(node).__name__}", node)
        if isinstance(node, ast.Attribute):
            raise OpenScriptError("Attribute access is not allowed", node)
        if isinstance(node, ast.NamedExpr):
            raise OpenScriptError("Walrus operator is not allowed", node)
        if isinstance(node, ast.Subscript):
            if not isinstance(node.slice, ast.Constant) or not isinstance(node.slice.value, int):
                raise OpenScriptError("Only integer lookback subscripts are allowed", node)
            if node.slice.value < 0:
                raise OpenScriptError("Negative lookbacks are not allowed", node)
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise OpenScriptError("Only direct function calls are allowed", node)
            if node.func.id not in _ALLOWED_FUNCTIONS:
                raise OpenScriptError(f"Unsupported function: {node.func.id}", node)
            if node.keywords:
                raise OpenScriptError("Keyword arguments are not supported", node)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, str):
                _reject_string_literal(node.value, node)
        if isinstance(node, ast.Name):
            if node.id in {"__import__", "eval", "exec", "compile", "getattr", "setattr", "delattr", "globals", "locals", "vars", "dir", "type", "open", "file"}:
                raise OpenScriptError(f"Blocked name: {node.id}", node)
        if isinstance(node, ast.BinOp) and not isinstance(node.op, _ALLOWED_BINARY_OPS):
            raise OpenScriptError(f"Unsupported operator: {type(node.op).__name__}", node)
        if isinstance(node, ast.UnaryOp) and not isinstance(node.op, _ALLOWED_UNARY_OPS):
            raise OpenScriptError(f"Unsupported operator: {type(node.op).__name__}", node)
        if isinstance(node, ast.Compare):
            for op in node.ops:
                if not isinstance(op, _ALLOWED_COMPARE_OPS):
                    raise OpenScriptError(f"Unsupported comparator: {type(op).__name__}", node)


def _series_to_python(series: pd.Series | pd.Index | Any) -> list[Any]:
    if isinstance(series, pd.Series):
        values = series.tolist()
    elif isinstance(series, pd.Index):
        values = series.tolist()
    elif isinstance(series, (list, tuple)):
        values = list(series)
    else:
        values = [series]
    out: list[Any] = []
    for value in values:
        if value is None or value is pd.NA:
            out.append(None)
        elif pd.isna(value):
            out.append(None)
        elif isinstance(value, (np.bool_, bool)):
            out.append(bool(value))
        elif isinstance(value, (np.integer, int)) and not isinstance(value, bool):
            out.append(int(value))
        elif isinstance(value, (np.floating, float)):
            out.append(float(value))
        else:
            out.append(value)
    return out


def _coerce_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    out = frame.copy()
    out.columns = [str(col).strip().lower() for col in out.columns]
    rename_map = {
        "o": "open",
        "h": "high",
        "l": "low",
        "c": "close",
        "v": "volume",
    }
    out = out.rename(columns=rename_map)
    for col in ["open", "high", "low", "close", "volume"]:
        if col not in out.columns:
            out[col] = np.nan
        out[col] = pd.to_numeric(out[col], errors="coerce")
    return out


def _series_from_env(env: dict[str, Any], name: str, index: pd.Index) -> pd.Series:
    if name in env:
        value = env[name]
        if isinstance(value, pd.Series):
            return value.reindex(index)
        if isinstance(value, (list, tuple, np.ndarray)):
            return pd.Series(list(value), index=index)
        return pd.Series([value] * len(index), index=index)
    if name == "true":
        return pd.Series([True] * len(index), index=index, dtype=bool)
    if name == "false":
        return pd.Series([False] * len(index), index=index, dtype=bool)
    raise OpenScriptError(f"Unknown variable: {name}")


def _as_scalar(value: Any, *, kind: type | tuple[type, ...] | None = None) -> Any:
    if isinstance(value, pd.Series):
        if value.empty:
            return None
        value = value.iloc[-1]
    if kind is not None and not isinstance(value, kind):
        raise OpenScriptError(f"Expected scalar {kind}, got {type(value).__name__}")
    return value


def _binary_op(left: Any, right: Any, op: ast.operator) -> Any:
    if isinstance(op, ast.Add):
        return left + right
    if isinstance(op, ast.Sub):
        return left - right
    if isinstance(op, ast.Mult):
        return left * right
    if isinstance(op, ast.Div):
        return left / right
    raise OpenScriptError(f"Unsupported operator: {type(op).__name__}")


def _unary_op(operand: Any, op: ast.unaryop) -> Any:
    if isinstance(op, ast.USub):
        return -operand
    if isinstance(op, ast.UAdd):
        return +operand
    if isinstance(op, ast.Not):
        if isinstance(operand, pd.Series):
            return ~operand.fillna(False).astype(bool)
        return not bool(operand)
    raise OpenScriptError(f"Unsupported operator: {type(op).__name__}")


def _compare_pair(left: Any, right: Any, op: ast.cmpop) -> Any:
    if isinstance(op, ast.Eq):
        return left == right
    if isinstance(op, ast.NotEq):
        return left != right
    if isinstance(op, ast.Gt):
        return left > right
    if isinstance(op, ast.GtE):
        return left >= right
    if isinstance(op, ast.Lt):
        return left < right
    if isinstance(op, ast.LtE):
        return left <= right
    raise OpenScriptError(f"Unsupported comparator: {type(op).__name__}")


def _vectorize_bool(value: Any, index: pd.Index) -> pd.Series:
    if isinstance(value, pd.Series):
        return value.fillna(False).astype(bool)
    return pd.Series([bool(value)] * len(index), index=index, dtype=bool)


def _call_function(name: str, args: list[Any], index: pd.Index) -> Any:
    if name == "sma":
        series = args[0]
        period = int(_as_scalar(args[1], kind=(int, float)))
        return technical_sma(pd.Series(series, index=index, dtype=float), period)
    if name == "ema":
        series = args[0]
        period = int(_as_scalar(args[1], kind=(int, float)))
        return technical_ema(pd.Series(series, index=index, dtype=float), period)
    if name == "rsi":
        series = args[0]
        period = int(_as_scalar(args[1], kind=(int, float)))
        return scanner_rsi(pd.Series(series, index=index, dtype=float), period)
    if name == "highest":
        series = pd.Series(args[0], index=index, dtype=float)
        period = int(_as_scalar(args[1], kind=(int, float)))
        return series.rolling(period).max()
    if name == "lowest":
        series = pd.Series(args[0], index=index, dtype=float)
        period = int(_as_scalar(args[1], kind=(int, float)))
        return series.rolling(period).min()
    if name == "crossover":
        left = pd.Series(args[0], index=index, dtype=float)
        right = pd.Series(args[1], index=index, dtype=float)
        return (left > right) & (left.shift(1) <= right.shift(1))
    if name == "crossunder":
        left = pd.Series(args[0], index=index, dtype=float)
        right = pd.Series(args[1], index=index, dtype=float)
        return (left < right) & (left.shift(1) >= right.shift(1))
    raise OpenScriptError(f"Unsupported function: {name}")


def _serialize_expr(node: ast.AST) -> dict[str, Any]:
    if isinstance(node, ast.Constant):
        return {"type": "const", "value": node.value}
    if isinstance(node, ast.Name):
        return {"type": "name", "value": node.id}
    if isinstance(node, ast.Subscript):
        if not isinstance(node.slice, ast.Constant) or not isinstance(node.slice.value, int):
            raise OpenScriptError("Only integer lookback subscripts are allowed", node)
        return {"type": "lookback", "value": _serialize_expr(node.value), "bars": int(node.slice.value)}
    if isinstance(node, ast.BinOp):
        return {
            "type": "binop",
            "op": type(node.op).__name__,
            "left": _serialize_expr(node.left),
            "right": _serialize_expr(node.right),
        }
    if isinstance(node, ast.UnaryOp):
        return {"type": "unary", "op": type(node.op).__name__, "operand": _serialize_expr(node.operand)}
    if isinstance(node, ast.BoolOp):
        return {"type": "boolop", "op": type(node.op).__name__, "values": [_serialize_expr(v) for v in node.values]}
    if isinstance(node, ast.Compare):
        return {
            "type": "compare",
            "left": _serialize_expr(node.left),
            "ops": [type(op).__name__ for op in node.ops],
            "comparators": [_serialize_expr(comp) for comp in node.comparators],
        }
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise OpenScriptError("Only direct function calls are allowed", node)
        fn = node.func.id
        if fn in _OUTPUT_FUNCTIONS:
            raise OpenScriptError(f"Output function {fn} must be a top-level statement", node)
        if fn not in _ALLOWED_FUNCTIONS:
            raise OpenScriptError(f"Unsupported function: {fn}", node)
        if node.keywords:
            raise OpenScriptError("Keyword arguments are not supported", node)
        return {"type": "call", "name": fn, "args": [_serialize_expr(arg) for arg in node.args]}
    if isinstance(node, ast.Tuple):
        return {"type": "tuple", "items": [_serialize_expr(item) for item in node.elts]}
    raise OpenScriptError(f"Unsupported syntax: {type(node).__name__}", node)


def _serialize_statement(node: ast.stmt) -> dict[str, Any]:
    if isinstance(node, ast.Assign):
        if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            raise OpenScriptError("Only simple variable assignments are allowed", node)
        return {
            "type": "assign",
            "target": node.targets[0].id,
            "value": _serialize_expr(node.value),
            "line": getattr(node, "lineno", None),
            "col": getattr(node, "col_offset", None),
        }
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name):
        fn = node.value.func.id
        if fn in _OUTPUT_FUNCTIONS:
            return {
                "type": "output",
                "function": fn,
                "args": [_serialize_expr(arg) for arg in node.value.args],
                "line": getattr(node, "lineno", None),
                "col": getattr(node, "col_offset", None),
            }
        raise OpenScriptError(f"Only output statements can stand alone: {fn}", node)
    raise OpenScriptError(f"Unsupported top-level statement: {type(node).__name__}", node)


def _build_program(tree: ast.Module, source: str) -> dict[str, Any]:
    statements = [_serialize_statement(stmt) for stmt in tree.body]
    outputs = [stmt for stmt in statements if stmt["type"] == "output"]
    return {"kind": "openscript", "version": 1, "source": source, "statements": statements, "outputs": outputs}


def _expr_from_serialized(expr: dict[str, Any], env: dict[str, Any], index: pd.Index) -> Any:
    etype = expr["type"]
    if etype == "const":
        return expr["value"]
    if etype == "name":
        return _series_from_env(env, str(expr["value"]), index)
    if etype == "tuple":
        return tuple(_expr_from_serialized(item, env, index) for item in expr["items"])
    if etype == "lookback":
        base = _expr_from_serialized(expr["value"], env, index)
        if not isinstance(base, pd.Series):
            base = pd.Series(base, index=index)
        return base.shift(int(expr["bars"]))
    if etype == "binop":
        left = _expr_from_serialized(expr["left"], env, index)
        right = _expr_from_serialized(expr["right"], env, index)
        op_name = expr["op"]
        op_node: ast.operator
        if op_name == "Add":
            op_node = ast.Add()
        elif op_name == "Sub":
            op_node = ast.Sub()
        elif op_name == "Mult":
            op_node = ast.Mult()
        elif op_name == "Div":
            op_node = ast.Div()
        else:
            raise OpenScriptError(f"Unsupported operator: {op_name}")
        return _binary_op(left, right, op_node)
    if etype == "unary":
        operand = _expr_from_serialized(expr["operand"], env, index)
        op_name = expr["op"]
        if op_name == "USub":
            op_node = ast.USub()
        elif op_name == "UAdd":
            op_node = ast.UAdd()
        elif op_name == "Not":
            op_node = ast.Not()
        else:
            raise OpenScriptError(f"Unsupported operator: {op_name}")
        return _unary_op(operand, op_node)
    if etype == "boolop":
        values = [_expr_from_serialized(item, env, index) for item in expr["values"]]
        result = _vectorize_bool(values[0], index)
        for value in values[1:]:
            rhs = _vectorize_bool(value, index)
            if expr["op"] == "And":
                result = result & rhs
            elif expr["op"] == "Or":
                result = result | rhs
            else:
                raise OpenScriptError(f"Unsupported operator: {expr['op']}")
        return result
    if etype == "compare":
        left = _expr_from_serialized(expr["left"], env, index)
        comparators = [_expr_from_serialized(item, env, index) for item in expr["comparators"]]
        ops = expr["ops"]
        result: Any = _compare_pair(left, comparators[0], _compare_op_from_name(ops[0]))
        for idx in range(1, len(ops)):
            prev = comparators[idx - 1]
            current = comparators[idx]
            result = result & _compare_pair(prev, current, _compare_op_from_name(ops[idx]))
        return result
    if etype == "call":
        args = [_expr_from_serialized(arg, env, index) for arg in expr["args"]]
        return _call_function(str(expr["name"]), args, index)
    raise OpenScriptError(f"Unsupported expression type: {etype}")


def _compare_op_from_name(name: str) -> ast.cmpop:
    if name == "Eq":
        return ast.Eq()
    if name == "NotEq":
        return ast.NotEq()
    if name == "Gt":
        return ast.Gt()
    if name == "GtE":
        return ast.GtE()
    if name == "Lt":
        return ast.Lt()
    if name == "LtE":
        return ast.LtE()
    raise OpenScriptError(f"Unsupported comparator: {name}")


def _series_output(kind: str, series: Any, *, title: str | None = None, color: str | None = None, linewidth: int | None = None, message: str | None = None, metadata: dict[str, Any] | None = None) -> EvalOutput:
    if isinstance(series, pd.Series):
        payload = _series_to_python(series)
    elif isinstance(series, (list, tuple)):
        payload = _series_to_python(list(series))
    else:
        payload = _series_to_python([series])
    return EvalOutput(
        kind=kind,
        title=title,
        color=color,
        linewidth=linewidth,
        message=message,
        series=payload,
        metadata=metadata or {},
    )


class OpenScriptCompiler:
    def compile(self, source: str) -> CompileResult:
        try:
            tree = ast.parse(source, mode="exec")
        except SyntaxError as exc:
            line = exc.lineno
            col = exc.offset
            return CompileResult(
                success=False,
                errors=[CompileError(message=f"Syntax error: {exc.msg}", line=line, col=col)],
            )

        try:
            _Validator().validate(tree)
            program = _build_program(tree, source)
        except OpenScriptError as exc:
            line, col = _node_location(exc.node)
            return CompileResult(success=False, errors=[CompileError(message=str(exc), line=line, col=col)])

        return CompileResult(success=True, ast=program, outputs=program["outputs"], errors=[])

    def evaluate(self, ast_payload: dict[str, Any], ohlcv_data: pd.DataFrame) -> EvalResult:
        if not isinstance(ast_payload, dict):
            raise OpenScriptError("Compiled AST payload must be a dictionary")
        frame = _coerce_frame(ohlcv_data).reset_index(drop=True)
        index = frame.index
        env: dict[str, Any] = {
            "open": frame["open"],
            "high": frame["high"],
            "low": frame["low"],
            "close": frame["close"],
            "volume": frame["volume"],
        }
        outputs: list[EvalOutput] = []
        for statement in ast_payload.get("statements", []):
            stype = statement.get("type")
            if stype == "assign":
                env[str(statement["target"])] = _expr_from_serialized(statement["value"], env, index)
                continue
            if stype == "output":
                fn = str(statement["function"])
                args = [_expr_from_serialized(arg, env, index) for arg in statement.get("args", [])]
                if fn == "plot":
                    series = args[0] if args else pd.Series(dtype=float)
                    title = _as_scalar(args[1], kind=str) if len(args) > 1 else None
                    color = _as_scalar(args[2], kind=str) if len(args) > 2 else None
                    linewidth = int(_as_scalar(args[3], kind=(int, float))) if len(args) > 3 else None
                    outputs.append(_series_output("plot", series, title=title, color=color, linewidth=linewidth))
                elif fn == "hline":
                    price = _as_scalar(args[0], kind=(int, float)) if args else None
                    title = _as_scalar(args[1], kind=str) if len(args) > 1 else None
                    color = _as_scalar(args[2], kind=str) if len(args) > 2 else None
                    outputs.append(_series_output("hline", pd.Series([price] * len(index), index=index, dtype=float), title=title, color=color, metadata={"price": price}))
                elif fn == "bgcolor":
                    color = _as_scalar(args[0], kind=str) if len(args) > 0 else None
                    condition = _vectorize_bool(args[1] if len(args) > 1 else False, index)
                    series = pd.Series([color if cond else None for cond in condition.tolist()], index=index, dtype="object")
                    outputs.append(_series_output("bgcolor", series, color=color, metadata={"when": condition.tolist()}))
                elif fn == "alertcondition":
                    condition = _vectorize_bool(args[0] if args else False, index)
                    title = _as_scalar(args[1], kind=str) if len(args) > 1 else None
                    message = _as_scalar(args[2], kind=str) if len(args) > 2 else None
                    outputs.append(_series_output("alertcondition", condition, title=title, message=message, metadata={"alerts": condition.tolist()}))
                else:
                    raise OpenScriptError(f"Unsupported output function: {fn}")
                continue
            raise OpenScriptError(f"Unsupported statement type: {stype}")
        serializable_vars: dict[str, Any] = {}
        for key, value in env.items():
            if key in {"open", "high", "low", "close", "volume"}:
                continue
            if isinstance(value, pd.Series):
                serializable_vars[key] = _series_to_python(value)
            elif pd.isna(value):
                serializable_vars[key] = None
            elif isinstance(value, (np.integer, int)) and not isinstance(value, bool):
                serializable_vars[key] = int(value)
            elif isinstance(value, (np.bool_, bool)):
                serializable_vars[key] = bool(value)
            else:
                serializable_vars[key] = value
        return EvalResult(outputs=outputs, variables=serializable_vars)
