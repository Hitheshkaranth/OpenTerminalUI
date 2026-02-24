from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from backend.models import UserScreenORM


def create_screen(
    db: Session,
    user_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    now = datetime.utcnow()
    row = UserScreenORM(
        id=str(uuid4()),
        user_id=user_id,
        name=str(payload.get("name") or "Untitled Screen"),
        description=str(payload.get("description") or ""),
        query=str(payload.get("query") or ""),
        columns_config=payload.get("columns_config") if isinstance(payload.get("columns_config"), list) else [],
        viz_config=payload.get("viz_config") if isinstance(payload.get("viz_config"), dict) else {},
        is_public=bool(payload.get("is_public", False)),
        upvotes=int(payload.get("upvotes", 0)),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return to_dict(row)


def list_screens(db: Session, user_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(UserScreenORM)
        .filter(UserScreenORM.user_id == user_id)
        .order_by(UserScreenORM.updated_at.desc())
        .all()
    )
    return [to_dict(row) for row in rows]


def update_screen(db: Session, user_id: str, screen_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    row = db.query(UserScreenORM).filter(UserScreenORM.id == screen_id, UserScreenORM.user_id == user_id).first()
    if row is None:
        return None
    if "name" in payload:
        row.name = str(payload["name"])
    if "description" in payload:
        row.description = str(payload["description"])
    if "query" in payload:
        row.query = str(payload["query"])
    if "columns_config" in payload and isinstance(payload.get("columns_config"), list):
        row.columns_config = payload["columns_config"]
    if "viz_config" in payload and isinstance(payload.get("viz_config"), dict):
        row.viz_config = payload["viz_config"]
    if "is_public" in payload:
        row.is_public = bool(payload.get("is_public"))
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return to_dict(row)


def delete_screen(db: Session, user_id: str, screen_id: str) -> bool:
    row = db.query(UserScreenORM).filter(UserScreenORM.id == screen_id, UserScreenORM.user_id == user_id).first()
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def publish_screen(db: Session, user_id: str, screen_id: str) -> dict[str, Any] | None:
    row = db.query(UserScreenORM).filter(UserScreenORM.id == screen_id, UserScreenORM.user_id == user_id).first()
    if row is None:
        return None
    row.is_public = True
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return to_dict(row)


def fork_screen(db: Session, user_id: str, source_id: str) -> dict[str, Any] | None:
    source = db.query(UserScreenORM).filter(UserScreenORM.id == source_id, UserScreenORM.is_public.is_(True)).first()
    if source is None:
        return None
    source.upvotes += 1
    forked = UserScreenORM(
        id=str(uuid4()),
        user_id=user_id,
        name=f"Fork: {source.name}",
        description=source.description,
        query=source.query,
        columns_config=source.columns_config,
        viz_config=source.viz_config,
        is_public=False,
        upvotes=0,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(forked)
    db.commit()
    db.refresh(forked)
    return to_dict(forked)


def list_public_screens(db: Session, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    rows = (
        db.query(UserScreenORM)
        .filter(UserScreenORM.is_public.is_(True))
        .order_by(UserScreenORM.upvotes.desc(), UserScreenORM.updated_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [to_dict(row) for row in rows]


def to_dict(row: UserScreenORM) -> dict[str, Any]:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "name": row.name,
        "description": row.description,
        "query": row.query,
        "columns_config": row.columns_config if isinstance(row.columns_config, list) else [],
        "viz_config": row.viz_config if isinstance(row.viz_config, dict) else {},
        "is_public": bool(row.is_public),
        "upvotes": int(row.upvotes or 0),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
