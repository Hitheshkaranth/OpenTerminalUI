from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from backend.services.ai_service import AIQueryService, get_ai_query_service

router = APIRouter(prefix="/api/ai", tags=["ai"])

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

    # In a real app, user_id would come from auth token
    user_id = "default_user" # Mock for now

    data = await service.query(user_id, query_text, context)
    return data
