from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models import JournalEntry, User

router = APIRouter()

_ALLOWED_DIRECTIONS = {"LONG", "SHORT"}
_DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _normalize_direction(value: str) -> str:
    direction = str(value or "").strip().upper()
    if direction not in _ALLOWED_DIRECTIONS:
        raise HTTPException(status_code=400, detail="direction must be LONG or SHORT")
    return direction


def _normalize_tags(tags: list[str] | None) -> list[str]:
    if not tags:
        return []
    normalized: list[str] = []
    for raw in tags:
        value = str(raw or "").strip()
        if value and value not in normalized:
            normalized.append(value)
    return normalized


def _compute_pnl(direction: str, entry_price: float, exit_price: float | None, quantity: int, fees: float) -> tuple[float | None, float | None]:
    if exit_price is None:
        return None, None
    gross = (exit_price - entry_price) * quantity if direction == "LONG" else (entry_price - exit_price) * quantity
    pnl = float(gross - fees)
    basis = entry_price * quantity
    pnl_pct = (pnl / basis * 100.0) if basis else None
    return pnl, pnl_pct


def _serialize_entry(row: JournalEntry) -> dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "symbol": row.symbol,
        "direction": row.direction,
        "entry_date": row.entry_date.isoformat() if row.entry_date else None,
        "entry_price": row.entry_price,
        "exit_date": row.exit_date.isoformat() if row.exit_date else None,
        "exit_price": row.exit_price,
        "quantity": row.quantity,
        "pnl": row.pnl,
        "pnl_pct": row.pnl_pct,
        "fees": row.fees,
        "strategy": row.strategy,
        "setup": row.setup,
        "emotion": row.emotion,
        "notes": row.notes,
        "tags": list(row.tags or []),
        "rating": row.rating,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _closed_outcome(row: JournalEntry) -> int:
    pnl = float(row.pnl or 0.0)
    if pnl > 0:
        return 1
    if pnl < 0:
        return -1
    return 0


def _compute_streaks(closed_rows: list[JournalEntry]) -> tuple[int, int, int]:
    if not closed_rows:
        return 0, 0, 0
    current = 0
    best = 0
    worst = 0
    for row in closed_rows:
        outcome = _closed_outcome(row)
        if outcome == 0:
            current = 0
        elif current == 0:
            current = outcome
        elif current > 0 and outcome > 0:
            current += 1
        elif current < 0 and outcome < 0:
            current -= 1
        else:
            current = outcome
        best = max(best, current)
        worst = min(worst, current)
    return current, best, worst


class JournalEntryBase(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    direction: str
    entry_date: datetime
    entry_price: float = Field(gt=0)
    exit_date: datetime | None = None
    exit_price: float | None = Field(default=None, gt=0)
    quantity: int = Field(gt=0)
    fees: float = Field(default=0, ge=0)
    strategy: str | None = Field(default=None, max_length=100)
    setup: str | None = Field(default=None, max_length=100)
    emotion: str | None = Field(default=None, max_length=50)
    notes: str | None = None
    tags: list[str] = Field(default_factory=list)
    rating: int | None = Field(default=None, ge=1, le=5)

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, value: str) -> str:
        return _normalize_direction(value)

    @field_validator("strategy", "setup", "emotion", "notes")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, value: list[str]) -> list[str]:
        return _normalize_tags(value)

    @model_validator(mode="after")
    def validate_dates(self) -> "JournalEntryBase":
        if self.exit_price is not None and self.exit_date is None:
            raise ValueError("exit_date is required when exit_price is provided")
        if self.exit_date is not None and self.exit_price is None:
            raise ValueError("exit_price is required when exit_date is provided")
        if self.exit_date is not None and self.exit_date < self.entry_date:
            raise ValueError("exit_date must be after entry_date")
        return self


class JournalEntryCreate(JournalEntryBase):
    pass


class JournalEntryUpdate(BaseModel):
    symbol: str | None = Field(default=None, min_length=1, max_length=20)
    direction: str | None = None
    entry_date: datetime | None = None
    entry_price: float | None = Field(default=None, gt=0)
    exit_date: datetime | None = None
    exit_price: float | None = Field(default=None, gt=0)
    quantity: int | None = Field(default=None, gt=0)
    fees: float | None = Field(default=None, ge=0)
    strategy: str | None = Field(default=None, max_length=100)
    setup: str | None = Field(default=None, max_length=100)
    emotion: str | None = Field(default=None, max_length=50)
    notes: str | None = None
    tags: list[str] | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    clear_exit: bool = False

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str | None) -> str | None:
        return value.strip().upper() if value is not None else None

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, value: str | None) -> str | None:
        return _normalize_direction(value) if value is not None else None

    @field_validator("strategy", "setup", "emotion", "notes")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, value: list[str] | None) -> list[str] | None:
        return _normalize_tags(value) if value is not None else None


@router.post("")
def create_journal_entry(
    payload: JournalEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    pnl, pnl_pct = _compute_pnl(payload.direction, payload.entry_price, payload.exit_price, payload.quantity, payload.fees)
    row = JournalEntry(
        user_id=str(current_user.id),
        symbol=payload.symbol,
        direction=payload.direction,
        entry_date=payload.entry_date,
        entry_price=float(payload.entry_price),
        exit_date=payload.exit_date,
        exit_price=float(payload.exit_price) if payload.exit_price is not None else None,
        quantity=int(payload.quantity),
        pnl=pnl,
        pnl_pct=pnl_pct,
        fees=float(payload.fees),
        strategy=payload.strategy,
        setup=payload.setup,
        emotion=payload.emotion,
        notes=payload.notes,
        tags=list(payload.tags or []),
        rating=payload.rating,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"status": "created", "entry": _serialize_entry(row)}


@router.get("")
def list_journal_entries(
    symbol: str | None = Query(default=None),
    strategy: str | None = Query(default=None),
    emotion: str | None = Query(default=None),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    tags: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[dict[str, Any]]]:
    query = db.query(JournalEntry).filter(JournalEntry.user_id == str(current_user.id))
    if symbol:
        query = query.filter(JournalEntry.symbol.ilike(f"%{symbol.strip().upper()}%"))
    if strategy:
        query = query.filter(JournalEntry.strategy.ilike(strategy.strip()))
    if emotion:
        query = query.filter(JournalEntry.emotion.ilike(emotion.strip()))
    if start:
        query = query.filter(JournalEntry.entry_date >= start)
    if end:
        query = query.filter(JournalEntry.entry_date <= end)
    rows = query.order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc()).all()
    tag_filters = _normalize_tags(tags.split(",")) if tags else []
    if tag_filters:
        rows = [row for row in rows if all(tag in (row.tags or []) for tag in tag_filters)]
    return {"entries": [_serialize_entry(row) for row in rows]}


@router.get("/stats")
def get_journal_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    rows = (
        db.query(JournalEntry)
        .filter(JournalEntry.user_id == str(current_user.id))
        .order_by(JournalEntry.exit_date.asc().nullslast(), JournalEntry.entry_date.asc(), JournalEntry.id.asc())
        .all()
    )
    closed_rows = [row for row in rows if row.exit_price is not None and row.pnl is not None]
    win_rows = [row for row in closed_rows if float(row.pnl or 0.0) > 0]
    loss_rows = [row for row in closed_rows if float(row.pnl or 0.0) < 0]
    gross_profit = sum(float(row.pnl or 0.0) for row in win_rows)
    gross_loss = sum(float(row.pnl or 0.0) for row in loss_rows)
    current_streak, best_streak, worst_streak = _compute_streaks(closed_rows)

    by_strategy_raw: dict[str, list[JournalEntry]] = defaultdict(list)
    by_emotion_raw: dict[str, list[JournalEntry]] = defaultdict(list)
    by_day_raw: dict[str, list[JournalEntry]] = defaultdict(list)
    for row in rows:
        if row.strategy:
            by_strategy_raw[row.strategy].append(row)
        if row.emotion:
            by_emotion_raw[row.emotion].append(row)
        bucket_date = row.exit_date or row.entry_date
        by_day_raw[_DAY_NAMES[bucket_date.weekday()]].append(row)

    def avg_pnl(entries: list[JournalEntry]) -> float:
        closed = [entry for entry in entries if entry.pnl is not None]
        return sum(float(entry.pnl or 0.0) for entry in closed) / len(closed) if closed else 0.0

    def win_rate(entries: list[JournalEntry]) -> float:
        closed = [entry for entry in entries if entry.pnl is not None]
        wins = sum(1 for entry in closed if float(entry.pnl or 0.0) > 0)
        return wins / len(closed) * 100.0 if closed else 0.0

    return {
        "total_trades": len(rows),
        "open_trades": sum(1 for row in rows if row.exit_price is None),
        "closed_trades": len(closed_rows),
        "win_rate": win_rate(closed_rows),
        "avg_win_pct": (sum(float(row.pnl_pct or 0.0) for row in win_rows) / len(win_rows)) if win_rows else 0.0,
        "avg_loss_pct": (sum(float(row.pnl_pct or 0.0) for row in loss_rows) / len(loss_rows)) if loss_rows else 0.0,
        "profit_factor": (gross_profit / abs(gross_loss)) if gross_loss < 0 else None,
        "largest_win": max((float(row.pnl or 0.0) for row in closed_rows), default=0.0),
        "largest_loss": min((float(row.pnl or 0.0) for row in closed_rows), default=0.0),
        "expectancy": avg_pnl(closed_rows),
        "current_streak": current_streak,
        "best_streak": best_streak,
        "worst_streak": worst_streak,
        "total_pnl": sum(float(row.pnl or 0.0) for row in closed_rows),
        "avg_pnl": avg_pnl(closed_rows),
        "by_strategy": [
            {"strategy": key, "count": len(entries), "win_rate": win_rate(entries), "avg_pnl": avg_pnl(entries)}
            for key, entries in sorted(by_strategy_raw.items(), key=lambda item: (-len(item[1]), item[0].lower()))
        ],
        "by_day_of_week": [
            {"day": day, "count": len(by_day_raw[day]), "avg_pnl": avg_pnl(by_day_raw[day])}
            for day in _DAY_NAMES
            if day in by_day_raw
        ],
        "by_emotion": [
            {"emotion": key, "count": len(entries), "win_rate": win_rate(entries)}
            for key, entries in sorted(by_emotion_raw.items(), key=lambda item: (-len(item[1]), item[0].lower()))
        ],
    }


@router.get("/equity-curve")
def get_equity_curve(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[dict[str, Any]]]:
    rows = (
        db.query(JournalEntry)
        .filter(JournalEntry.user_id == str(current_user.id), JournalEntry.pnl.isnot(None), JournalEntry.exit_date.isnot(None))
        .order_by(JournalEntry.exit_date.asc(), JournalEntry.id.asc())
        .all()
    )
    cumulative = 0.0
    points: list[dict[str, Any]] = []
    for row in rows:
        cumulative += float(row.pnl or 0.0)
        points.append({"date": row.exit_date.date().isoformat(), "cumulative_pnl": cumulative})
    return {"points": points}


@router.get("/calendar")
def get_journal_calendar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, list[dict[str, Any]]]:
    rows = db.query(JournalEntry).filter(JournalEntry.user_id == str(current_user.id)).all()
    days: dict[str, dict[str, Any]] = {}
    for row in rows:
        bucket_date = (row.exit_date or row.entry_date).date().isoformat()
        if bucket_date not in days:
            days[bucket_date] = {"date": bucket_date, "pnl": 0.0, "trade_count": 0}
        days[bucket_date]["pnl"] += float(row.pnl or 0.0)
        days[bucket_date]["trade_count"] += 1
    return {"days": [days[key] for key in sorted(days)]}


@router.post("/import-csv")
async def import_journal_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text))
    ids: list[int] = []
    for line_no, record in enumerate(reader, start=2):
        try:
            raw_tags = str(record.get("tags") or "").strip()
            payload = JournalEntryCreate(
                symbol=str(record.get("symbol") or ""),
                direction=str(record.get("direction") or ""),
                entry_date=datetime.fromisoformat(str(record.get("entry_date") or "")),
                entry_price=float(record.get("entry_price") or 0),
                exit_date=datetime.fromisoformat(str(record.get("exit_date") or "")) if str(record.get("exit_date") or "").strip() else None,
                exit_price=float(record["exit_price"]) if str(record.get("exit_price") or "").strip() else None,
                quantity=int(float(record.get("quantity") or 0)),
                fees=float(record.get("fees") or 0),
                strategy=str(record.get("strategy") or "").strip() or None,
                setup=str(record.get("setup") or "").strip() or None,
                emotion=str(record.get("emotion") or "").strip() or None,
                notes=str(record.get("notes") or "").strip() or None,
                tags=[part.strip() for part in raw_tags.split(",") if part.strip()],
                rating=int(record["rating"]) if str(record.get("rating") or "").strip() else None,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid CSV row {line_no}: {exc}") from exc

        pnl, pnl_pct = _compute_pnl(payload.direction, payload.entry_price, payload.exit_price, payload.quantity, payload.fees)
        row = JournalEntry(
            user_id=str(current_user.id),
            symbol=payload.symbol,
            direction=payload.direction,
            entry_date=payload.entry_date,
            entry_price=float(payload.entry_price),
            exit_date=payload.exit_date,
            exit_price=float(payload.exit_price) if payload.exit_price is not None else None,
            quantity=int(payload.quantity),
            pnl=pnl,
            pnl_pct=pnl_pct,
            fees=float(payload.fees),
            strategy=payload.strategy,
            setup=payload.setup,
            emotion=payload.emotion,
            notes=payload.notes,
            tags=list(payload.tags or []),
            rating=payload.rating,
        )
        db.add(row)
        db.flush()
        ids.append(int(row.id))

    db.commit()
    return {"status": "imported", "count": len(ids), "ids": ids}


@router.get("/{entry_id}")
def get_journal_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(JournalEntry).filter(JournalEntry.id == entry_id, JournalEntry.user_id == str(current_user.id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return {"entry": _serialize_entry(row)}


@router.put("/{entry_id}")
def update_journal_entry(
    entry_id: int,
    payload: JournalEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(JournalEntry).filter(JournalEntry.id == entry_id, JournalEntry.user_id == str(current_user.id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Journal entry not found")

    data = payload.model_dump(exclude_unset=True)
    for field in ("symbol", "direction", "entry_date", "strategy", "setup", "emotion", "notes", "rating"):
        if field in data:
            setattr(row, field, data[field])
    if "entry_price" in data:
        row.entry_price = float(data["entry_price"])
    if "quantity" in data:
        row.quantity = int(data["quantity"])
    if "fees" in data:
        row.fees = float(data["fees"])
    if "tags" in data:
        row.tags = list(data["tags"] or [])
    if data.get("clear_exit"):
        row.exit_date = None
        row.exit_price = None
    else:
        if "exit_date" in data:
            row.exit_date = data["exit_date"]
        if "exit_price" in data:
            row.exit_price = float(data["exit_price"]) if data["exit_price"] is not None else None

    if row.exit_price is not None and row.exit_date is None:
        raise HTTPException(status_code=400, detail="exit_date is required when exit_price is provided")
    if row.exit_date is not None and row.exit_price is None:
        raise HTTPException(status_code=400, detail="exit_price is required when exit_date is provided")
    if row.exit_date is not None and row.exit_date < row.entry_date:
        raise HTTPException(status_code=400, detail="exit_date must be after entry_date")

    row.pnl, row.pnl_pct = _compute_pnl(row.direction, float(row.entry_price), row.exit_price, int(row.quantity), float(row.fees))
    db.commit()
    db.refresh(row)
    return {"status": "updated", "entry": _serialize_entry(row)}


@router.delete("/{entry_id}")
def delete_journal_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = db.query(JournalEntry).filter(JournalEntry.id == entry_id, JournalEntry.user_id == str(current_user.id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": entry_id}
