from typing import List, Optional
from pydantic import BaseModel


class InstrumentSearchResult(BaseModel):
    canonical_id: str
    display_symbol: str
    type: str
    exchange: str
    currency: Optional[str] = None
    vendor_ids: Optional[dict] = None
    tick_size: Optional[float] = None
    lot_size: Optional[float] = None


class InstrumentSearchResponse(BaseModel):
    results: List[InstrumentSearchResult]
