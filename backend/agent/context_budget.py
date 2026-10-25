"""Bound model context without cutting serialized JSON or losing source metadata."""
from __future__ import annotations

import json
from typing import Any


def tool_context(result: Any, *, reference: str, budget: int = 8000) -> str:
    def compact(value: Any, rows: int, chars: int, depth: int = 0) -> Any:
        if depth > 8:
            return {"omitted": True, "reason": "nested data; inspect full result"}
        if isinstance(value, dict):
            # Provenance and failure metadata are retained even for large tables.
            keys = list(value)
            priority = [k for k in ("ok", "error", "provenance", "source", "as_of", "total", "count", "truncated") if k in value]
            selected = priority + [k for k in keys if k not in priority][:40]
            out = {k: compact(value[k], rows, chars, depth + 1) for k in selected}
            if len(selected) < len(keys):
                out["_omitted_fields"] = len(keys) - len(selected)
            return out
        if isinstance(value, (list, tuple)):
            items = [compact(v, rows, chars, depth + 1) for v in value[:rows]]
            if len(value) > rows:
                items.append({"_omitted_rows": len(value) - rows})
            return items
        if isinstance(value, str) and len(value) > chars:
            return value[:chars] + " [excerpt; full text in stored result]"
        return value

    raw = json.dumps(result, default=str, ensure_ascii=False)
    if len(raw) <= budget:
        return raw
    for rows, chars in ((20, 1500), (10, 600), (4, 240), (1, 80)):
        preview = {"partial": True, "full_result_ref": reference, "result": compact(result, rows, chars)}
        encoded = json.dumps(preview, default=str, ensure_ascii=False)
        if len(encoded) <= budget:
            return encoded
    # A pathological wide payload still produces valid JSON with an explicit omission.
    return json.dumps({"partial": True, "full_result_ref": reference,
                       "message": "Result exceeds the context budget; use a narrower tool query.",
                       "provenance": result.get("provenance") if isinstance(result, dict) else None}, default=str)


def tool_failed(result: Any) -> bool:
    return isinstance(result, dict) and (result.get("ok") is False or
                                        ("error" in result and result.get("ok") is not True))
