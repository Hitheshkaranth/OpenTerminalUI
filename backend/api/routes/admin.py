from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from backend.services.prefetch_worker import get_prefetch_worker

router = APIRouter()


@router.post("/admin/prefetch/run")
async def run_prefetch_now() -> dict[str, object]:
    worker = get_prefetch_worker()
    result = await worker.run_once()
    return {
        "status": "ok",
        "requested": result.get("requested", 0),
        "updated": result.get("updated", 0),
        "ran_at_utc": datetime.now(timezone.utc).isoformat(),
    }
