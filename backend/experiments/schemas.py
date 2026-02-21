from typing import List, Dict, Optional, Any
from pydantic import BaseModel


class ExperimentCreate(BaseModel):
    name: str
    config: dict


class ExperimentResponse(BaseModel):
    id: int
    name: str
    data_hash: Optional[str] = None
    code_hash: Optional[str] = None
    config_json: Optional[dict] = None
    metrics_json: Optional[dict] = None
    tags: Optional[List[str]] = None


class ExperimentCompareRequest(BaseModel):
    experiment_ids: List[int]


class ExperimentCompareResponse(BaseModel):
    metrics_table: dict
    deltas: dict


class PromoteResponse(BaseModel):
    receipt_id: str
    status: str
