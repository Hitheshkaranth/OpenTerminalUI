from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from backend.models import ScanAlertRuleORM, ScanPresetORM, ScanResultORM, ScanRunORM
from backend.scanner_engine.schemas import ScanPresetCreate, ScanPresetOut, ScanPresetUpdate


def default_preset_pack() -> list[dict[str, Any]]:
    return [
        {
            "name": "20D High Breakout + RVOL",
            "universe": "NSE:NIFTY200",
            "timeframe": "1d",
            "liquidity_gate": {"min_price": 50, "min_avg_volume": 100000, "min_avg_traded_value": 5_000_000},
            "rules": [{"type": "breakout_n_day_high", "params": {"n": 20, "buffer_pct": 0.001, "rvol_threshold": 2.0, "near_trigger_pct": 0.003}}],
            "ranking": {"mode": "default", "params": {}},
        },
        {
            "name": "55D High Breakout + RVOL",
            "universe": "NSE:NIFTY500",
            "timeframe": "1d",
            "liquidity_gate": {"min_price": 50, "min_avg_volume": 100000, "min_avg_traded_value": 5_000_000},
            "rules": [{"type": "breakout_n_day_high", "params": {"n": 55, "buffer_pct": 0.001, "rvol_threshold": 2.0, "near_trigger_pct": 0.003}}],
            "ranking": {"mode": "default", "params": {}},
        },
        {
            "name": "BB Squeeze → Expansion",
            "universe": "NSE:NIFTY200",
            "timeframe": "1d",
            "liquidity_gate": {"min_price": 50, "min_avg_volume": 100000, "min_avg_traded_value": 5_000_000},
            "rules": [{"type": "bb_squeeze_breakout", "params": {"width_pct_threshold": 15.0, "lookback": 120, "require_keltner": True}}],
            "ranking": {"mode": "default", "params": {}},
        },
        {
            "name": "Supertrend Flip + EMA Stack",
            "universe": "NSE:NIFTY200",
            "timeframe": "1d",
            "liquidity_gate": {"min_price": 50, "min_avg_volume": 100000, "min_avg_traded_value": 5_000_000},
            "rules": [{"type": "supertrend_flip_ema_stack", "params": {}}],
            "ranking": {"mode": "default", "params": {}},
        },
        {
            "name": "NR7 Breakout",
            "universe": "NSE:NIFTY200",
            "timeframe": "1d",
            "liquidity_gate": {"min_price": 50, "min_avg_volume": 100000, "min_avg_traded_value": 5_000_000},
            "rules": [{"type": "nr7_breakout", "params": {"volume_mult": 1.2}}],
            "ranking": {"mode": "default", "params": {}},
        },
        {
            "name": "Inside Bar Breakout",
            "universe": "NSE:NIFTY200",
            "timeframe": "1d",
            "liquidity_gate": {"min_price": 50, "min_avg_volume": 100000, "min_avg_traded_value": 5_000_000},
            "rules": [{"type": "inside_bar_breakout", "params": {}}],
            "ranking": {"mode": "default", "params": {}},
        },
        {
            "name": "Trend Retest",
            "universe": "NSE:NIFTY200",
            "timeframe": "1d",
            "liquidity_gate": {"min_price": 50, "min_avg_volume": 100000, "min_avg_traded_value": 5_000_000},
            "rules": [{"type": "trend_retest", "params": {"ema_tolerance_pct": 0.005, "rvol_threshold": 1.5}}],
            "ranking": {"mode": "default", "params": {}},
        },
    ]


def ensure_default_presets(db: Session, user_id: str) -> None:
    exists = db.query(ScanPresetORM).filter(ScanPresetORM.user_id == user_id).count()
    if exists > 0:
        return
    now = datetime.utcnow()
    for payload in default_preset_pack():
        row = ScanPresetORM(
            user_id=user_id,
            name=str(payload["name"]),
            universe=str(payload["universe"]),
            timeframe=str(payload["timeframe"]),
            liquidity_gate_json=payload["liquidity_gate"],
            rules_json=payload["rules"],
            ranking_json=payload["ranking"],
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    db.commit()


def list_presets(db: Session, user_id: str) -> list[ScanPresetOut]:
    ensure_default_presets(db, user_id)
    rows = (
        db.query(ScanPresetORM)
        .filter(ScanPresetORM.user_id == user_id)
        .order_by(ScanPresetORM.updated_at.desc(), ScanPresetORM.created_at.desc())
        .all()
    )
    return [
        ScanPresetOut(
            id=row.id,
            name=row.name,
            universe=row.universe,
            timeframe=row.timeframe,
            liquidity_gate=row.liquidity_gate_json if isinstance(row.liquidity_gate_json, dict) else {},
            rules=row.rules_json if isinstance(row.rules_json, list) else [],
            ranking=row.ranking_json if isinstance(row.ranking_json, dict) else {"mode": "default", "params": {}},
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


def create_preset(db: Session, user_id: str, payload: ScanPresetCreate) -> ScanPresetOut:
    now = datetime.utcnow()
    row = ScanPresetORM(
        user_id=user_id,
        name=payload.name,
        universe=payload.universe,
        timeframe=payload.timeframe,
        liquidity_gate_json=payload.liquidity_gate.model_dump(),
        rules_json=[x.model_dump() for x in payload.rules],
        ranking_json=payload.ranking.model_dump(),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ScanPresetOut(
        id=row.id,
        name=row.name,
        universe=row.universe,
        timeframe=row.timeframe,
        liquidity_gate=row.liquidity_gate_json,
        rules=row.rules_json,
        ranking=row.ranking_json,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def update_preset(db: Session, user_id: str, preset_id: str, payload: ScanPresetUpdate) -> ScanPresetOut | None:
    row = db.query(ScanPresetORM).filter(ScanPresetORM.id == preset_id, ScanPresetORM.user_id == user_id).first()
    if row is None:
        return None
    row.name = payload.name
    row.universe = payload.universe
    row.timeframe = payload.timeframe
    row.liquidity_gate_json = payload.liquidity_gate.model_dump()
    row.rules_json = [x.model_dump() for x in payload.rules]
    row.ranking_json = payload.ranking.model_dump()
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return ScanPresetOut(
        id=row.id,
        name=row.name,
        universe=row.universe,
        timeframe=row.timeframe,
        liquidity_gate=row.liquidity_gate_json,
        rules=row.rules_json,
        ranking=row.ranking_json,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def delete_preset(db: Session, user_id: str, preset_id: str) -> bool:
    row = db.query(ScanPresetORM).filter(ScanPresetORM.id == preset_id, ScanPresetORM.user_id == user_id).first()
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def create_run(db: Session, user_id: str, preset_id: str | None, status: str = "running", meta: dict[str, Any] | None = None) -> ScanRunORM:
    now = datetime.utcnow()
    row = ScanRunORM(
        user_id=user_id,
        preset_id=preset_id,
        started_at=now,
        finished_at=None,
        status=status,
        meta_json=meta or {},
        summary_json={},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def finalize_run(db: Session, run_id: str, status: str, summary: dict[str, Any]) -> None:
    row = db.query(ScanRunORM).filter(ScanRunORM.id == run_id).first()
    if row is None:
        return
    row.status = status
    row.summary_json = summary
    row.finished_at = datetime.utcnow()
    db.commit()


def save_results(db: Session, run_id: str, rows: list[dict[str, Any]]) -> None:
    for row in rows:
        result = ScanResultORM(
            run_id=run_id,
            symbol=str(row.get("symbol") or ""),
            setup_type=str(row.get("setup_type") or ""),
            score=float(row.get("score") or 0.0),
            signal_ts=row.get("signal_ts"),
            levels_json=row.get("levels") if isinstance(row.get("levels"), dict) else {},
            features_json=row.get("features") if isinstance(row.get("features"), dict) else {},
            explain_json=row.get("explain") if isinstance(row.get("explain"), dict) else {},
        )
        db.add(result)
    db.commit()


def list_runs(db: Session, user_id: str, limit: int, offset: int) -> list[ScanRunORM]:
    return (
        db.query(ScanRunORM)
        .filter(ScanRunORM.user_id == user_id)
        .order_by(ScanRunORM.started_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def list_results(db: Session, user_id: str, run_id: str, limit: int, offset: int) -> list[ScanResultORM]:
    return (
        db.query(ScanResultORM)
        .join(ScanRunORM, ScanRunORM.id == ScanResultORM.run_id)
        .filter(ScanRunORM.user_id == user_id, ScanResultORM.run_id == run_id)
        .order_by(ScanResultORM.score.desc(), ScanResultORM.symbol.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def create_scanner_alert_rule(
    db: Session,
    user_id: str,
    payload: dict[str, Any],
) -> ScanAlertRuleORM:
    row = ScanAlertRuleORM(
        user_id=user_id,
        preset_id=payload.get("preset_id"),
        symbol=str(payload.get("symbol") or "").upper(),
        setup_type=str(payload.get("setup_type") or "").upper(),
        trigger_level=float(payload.get("trigger_level") or 0.0),
        invalidation_level=float(payload.get("invalidation_level")) if payload.get("invalidation_level") is not None else None,
        near_trigger_pct=float(payload.get("near_trigger_pct") or 0.003),
        dedupe_minutes=int(payload.get("dedupe_minutes") or 15),
        enabled=bool(payload.get("enabled", True)),
        meta_json=payload.get("meta_json") if isinstance(payload.get("meta_json"), dict) else {},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_scanner_alert_rules(db: Session, user_id: str) -> list[ScanAlertRuleORM]:
    return (
        db.query(ScanAlertRuleORM)
        .filter(ScanAlertRuleORM.user_id == user_id)
        .order_by(ScanAlertRuleORM.updated_at.desc())
        .all()
    )
