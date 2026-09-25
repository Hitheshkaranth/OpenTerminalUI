from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from backend.services.ai_service import AIQueryService, get_ai_query_service

# Mounted under the global "/api" prefix in main.py, so this resolves to /api/ai.
router = APIRouter(prefix="/ai", tags=["ai"])

@router.post("/query", response_model=Dict[str, Any])
async def ai_query(
    request: Request,
    payload: Dict[str, Any],
    service: AIQueryService = Depends(get_ai_query_service)
):
    """Process a natural language query using AI."""
    query_text = payload.get("query")
    context = payload.get("context", {})
    if not query_text:
        raise HTTPException(status_code=400, detail="Query text is required")

    # Rate limits are per user; the auth middleware sets current_user on /api requests.
    current_user = getattr(request.state, "current_user", None)
    user_id = str(getattr(current_user, "id", None) or "default_user")

    data = await service.query(user_id, query_text, context)
    return data
