from typing import List, Optional
from datetime import date, datetime
from pydantic import BaseModel


class JobRequest(BaseModel):
    strategy_id: str
    start_date: date
    end_date: date
    universe: List[str]
    params: dict


class JobCreateResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: float


class JobResultResponse(BaseModel):
    equity_curve: List[dict]
    drawdown: List[dict]
    turnover_series: List[dict]
    metrics: dict
