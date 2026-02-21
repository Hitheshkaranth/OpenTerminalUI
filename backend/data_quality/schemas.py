from typing import List
from pydantic import BaseModel


class DataQualityRunRequest(BaseModel):
    dataset_id: str


class DataQualityRunResponse(BaseModel):
    scan_id: str
    status: str


class AnomalyEvent(BaseModel):
    type: str
    description: str


class DataQualityDashboardResponse(BaseModel):
    scans: List[dict]
    anomalies: List[AnomalyEvent]
