"""Frozen-input SMA experiments: deterministic replay without provider requests."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
import hashlib
import importlib.metadata
import platform

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.core.backtesting_models import BacktestConfig
from backend.core.single_asset_backtest import BacktestEngine, generate_sma_crossover_signals
from backend.research_dossiers.models import ResearchExperiment
from backend.research_dossiers.service import owned, digest, commit

router = APIRouter(prefix="/api/research/experiments", tags=["research-experiments"])


def utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        raise ValueError("Timestamps must include timezone")
    return dt.astimezone(timezone.utc)


class FrozenBar(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    date: datetime
    available_at: datetime
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float = Field(ge=0)

    @model_validator(mode="after")
    def valid_bar(self):
        self.date, self.available_at = utc(self.date), utc(self.available_at)
        if self.available_at > self.date:
            raise ValueError("Bar was not available at its decision timestamp")
        if self.low > min(self.open, self.close) or self.high < max(self.open, self.close) or self.low > self.high:
            raise ValueError("OHLC range is inconsistent")
        return self


class ExperimentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    title: str = Field(min_length=1, max_length=240)
    symbol: str = Field(min_length=1, max_length=64)
    dossier_id: str | None = None
    strategy: Literal["sma_crossover"] = "sma_crossover"
    short_window: int = Field(20, ge=1, le=500)
    long_window: int = Field(50, ge=2, le=1000)
    provider: str = Field(min_length=1, max_length=120)
    data_version: str = Field(min_length=1, max_length=160)
    adjustment_policy: Literal["raw", "split_adjusted", "total_return_adjusted"]
    as_of: datetime
    train_end: datetime
    validation_start: datetime
    bars: list[FrozenBar] = Field(min_length=10, max_length=20000)
    fee_bps: float = Field(ge=0, le=1000)
    slippage_bps: float = Field(ge=0, le=1000)
    initial_cash: float = Field(100000, gt=0)
    allow_short: bool = False
    universe_policy: Literal["single_instrument_no_universe_selection"] = "single_instrument_no_universe_selection"

    @model_validator(mode="after")
    def validate_dates(self):
        self.as_of, self.train_end, self.validation_start = map(utc, (self.as_of, self.train_end, self.validation_start))
        if self.short_window >= self.long_window:
            raise ValueError("short_window must be less than long_window")
        if self.train_end >= self.validation_start:
            raise ValueError("Training and validation intervals must not overlap")
        if self.as_of > datetime.now(timezone.utc):
            raise ValueError("as_of must not be in the future")
        times = [b.date for b in self.bars]
        if times != sorted(set(times)):
            raise ValueError("Bars must have unique, increasing timestamps")
        if any(b.date > self.as_of or b.available_at > self.as_of for b in self.bars):
            raise ValueError("Point-in-time violation: future data")
        if sum(t <= self.train_end for t in times) < self.long_window:
            raise ValueError("Training interval needs at least long_window bars")
        if sum(t >= self.validation_start for t in times) < 2:
            raise ValueError("Validation interval needs at least two bars")
        if self.provider.strip().lower() in ("unknown", "", "unreported") or not self.data_version.strip():
            raise ValueError("Provider and immutable data version must be explicit")
        return self


def engine_identity() -> dict:
    import backend.core.single_asset_backtest as engine
    import backend.core.backtest_analytics as analytics
    import backend.core.backtesting_models as models
    content = b"".join(Path(m.__file__).read_bytes() for m in (engine, analytics, models))
    versions = {p: importlib.metadata.version(p) for p in ("numpy", "pandas", "pydantic")}
    return {"code_sha256": hashlib.sha256(content).hexdigest(), "python": platform.python_version(), "packages": versions}


def execute(payload: ExperimentCreate) -> dict:
    frame = pd.DataFrame([{k: v for k, v in b.model_dump().items() if k != "available_at"} for b in payload.bars])
    frame["date"] = pd.to_datetime(frame["date"], utc=True).dt.tz_localize(None)
    signals = generate_sma_crossover_signals(frame, payload.short_window, payload.long_window)
    config = BacktestConfig(initial_cash=payload.initial_cash, fee_bps=payload.fee_bps,
        slippage_bps=payload.slippage_bps, position_fraction=1, allow_short=payload.allow_short,
        fill_delay_bars=1, timeframe="1d")
    train = frame["date"] <= payload.train_end.replace(tzinfo=None)
    validation = frame["date"] >= payload.validation_start.replace(tzinfo=None)
    engine = BacktestEngine(config)
    results = {}
    for key, mask in (("training", train), ("validation", validation)):
        results[key] = engine.run(payload.symbol, frame.loc[mask].reset_index(drop=True),
            signals.loc[mask].reset_index(drop=True)).model_dump(mode="json")
    return {"config": config.model_dump(mode="json"), "results": results}


def out(row: ResearchExperiment, full=True):
    base = {"id": row.id, "dossier_id": row.dossier_id, "sha256": row.sha256, "created_at": row.created_at.isoformat()}
    return {**base, **row.snapshot} if full else {**base, "title": row.snapshot["request"]["title"], "symbol": row.snapshot["request"]["symbol"]}


@router.post("", status_code=201)
def create_experiment(payload: ExperimentCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if payload.dossier_id:
        owned(db, user.id, payload.dossier_id)
    request = payload.model_dump(mode="json")
    execution = execute(payload)
    snapshot = {"schema_version": 1, "kind": "openterminal.frozen-backtest", "request": request,
        "data_sha256": digest(request["bars"]), "engine": engine_identity(), **execution,
        "validation_policy": {"method": "fixed_parameters_chronological_holdout", "train_end": request["train_end"],
            "validation_start": request["validation_start"], "fill_delay_bars": 1, "optimization_on_validation": False,
            "unknown_available_at": "reject", "future_data": "reject", "warmup": "past training bars only", "random_seed": None},
        "limitations": ["Caller supplies provenance and publication timestamps; the API cannot authenticate a provider attestation.",
            "SMA single-instrument simulation only; no universe selection or historical constituent claim.",
            "Adjustment policy is declared by the caller; frozen rows are used exactly as supplied."]}
    row = ResearchExperiment(user_id=user.id, dossier_id=payload.dossier_id, snapshot=snapshot, sha256=digest(snapshot))
    db.add(row)
    commit(db)
    return out(row)


def get_owned(db, user, experiment_id):
    row = db.query(ResearchExperiment).filter_by(id=experiment_id, user_id=user.id).first()
    if row is None:
        raise HTTPException(404, "Experiment not found")
    return row


@router.get("")
def list_experiments(dossier_id: str | None = None, limit: int = Query(100, ge=1, le=500),
                     db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(ResearchExperiment).filter_by(user_id=user.id)
    if dossier_id:
        owned(db, user.id, dossier_id)
        q = q.filter_by(dossier_id=dossier_id)
    return {"items": [out(r, full=False) for r in q.order_by(ResearchExperiment.created_at.desc()).limit(limit).all()]}


@router.get("/{experiment_id}")
def get_experiment(experiment_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    return out(get_owned(db, user, experiment_id))


@router.post("/{experiment_id}/replay")
def replay_experiment(experiment_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    row = get_owned(db, user, experiment_id)
    if digest(row.snapshot) != row.sha256:
        raise HTTPException(409, "Snapshot integrity check failed")
    if row.snapshot["engine"] != engine_identity():
        raise HTTPException(409, "Engine or dependency versions changed; exact replay is unavailable")
    replay = execute(ExperimentCreate.model_validate(row.snapshot["request"]))
    return {"id": row.id, "data_sha256": row.snapshot["data_sha256"], "matches": digest(replay["results"]) == digest(row.snapshot["results"]),
            "results": replay["results"], "provider_requests": 0}
