from fastapi import APIRouter, Query, Depends
from sqlalchemy.orm import Session
from backend.api.deps import get_db
from backend.instruments.schemas import InstrumentSearchResponse
from backend.instruments.search import search_instruments as _search_instruments

router = APIRouter(prefix="/instruments", tags=["instruments"])


@router.get("/search", response_model=InstrumentSearchResponse)
async def search_instruments(q: str = Query(..., min_length=1, description="Search query"), db: Session = Depends(get_db)):
    results = _search_instruments(db, q)
    return InstrumentSearchResponse(results=results)
