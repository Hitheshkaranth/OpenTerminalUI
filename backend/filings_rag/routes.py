from __future__ import annotations

from fastapi import APIRouter

from backend.filings_rag.routes_analysis import router as analysis_router
from backend.filings_rag.routes_documents import router as documents_router
from backend.filings_rag.routes_knowledge import router as knowledge_router

router = APIRouter(prefix="/api/filings-rag", tags=["filings-rag"])
router.include_router(documents_router)
router.include_router(analysis_router)
router.include_router(knowledge_router)
