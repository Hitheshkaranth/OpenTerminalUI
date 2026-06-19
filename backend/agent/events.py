from __future__ import annotations

from typing import Any


def token(text: str) -> dict[str, Any]:
    return {"type": "token", "text": text}


def tool_call(call_id: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return {"type": "tool_call", "id": call_id, "name": name, "arguments": arguments}


def tool_result(call_id: str, name: str, result: Any, is_error: bool = False) -> dict[str, Any]:
    return {"type": "tool_result", "id": call_id, "name": name,
            "result": result, "is_error": is_error}


def artifact(kind: str, name: str, data: Any) -> dict[str, Any]:
    return {"type": "artifact", "kind": kind, "name": name, "data": data}


def final(content: str) -> dict[str, Any]:
    return {"type": "final", "content": content}


def error(message: str) -> dict[str, Any]:
    return {"type": "error", "message": message}


# Map tool name -> artifact kind for the frontend canvas.
ARTIFACT_KINDS = {
    "screen_stocks": "screener_table",
    "compare_stocks": "compare_table",
    "get_stock_snapshot": "snapshot_card",
    "search_research": "research_list",
}
