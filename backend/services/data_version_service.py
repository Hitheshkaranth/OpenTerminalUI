from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from backend.models import DataVersionORM


def get_active_data_version(db: Session) -> DataVersionORM:
    row = (
        db.query(DataVersionORM)
        .filter(DataVersionORM.is_active.is_(True))
        .order_by(DataVersionORM.created_at.desc())
        .first()
    )
    if row is not None:
        return row
    # bootstrap deterministic default version
    default = DataVersionORM(
        name="default-v1",
        description="Default internal dataset snapshot",
        source="internal",
        is_active=True,
        created_at=datetime.utcnow(),
        metadata_json={"bootstrap": True},
    )
    db.add(default)
    db.commit()
    db.refresh(default)
    return default


def create_data_version(db: Session, name: str, description: str = "", source: str = "internal", activate: bool = True, metadata: dict[str, Any] | None = None) -> DataVersionORM:
    if activate:
        db.query(DataVersionORM).filter(DataVersionORM.is_active.is_(True)).update({"is_active": False}, synchronize_session=False)
    row = DataVersionORM(
        name=name.strip(),
        description=description.strip(),
        source=source.strip() or "internal",
        is_active=bool(activate),
        created_at=datetime.utcnow(),
        metadata_json=metadata or {},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
