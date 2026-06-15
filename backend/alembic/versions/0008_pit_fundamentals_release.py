"""add PIT fundamental release metadata

Revision ID: 0008_pit_fundamentals_release
Revises: 0007_alerts_v2_delivery
Create Date: 2026-05-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0008_pit_fundamentals_release"
down_revision = "0007_alerts_v2_delivery"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return table_name in set(sa.inspect(bind).get_table_names())


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    columns = sa.inspect(bind).get_columns(table_name)
    return column_name in {column["name"] for column in columns}


def _ensure_index(index_name: str, table_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    indexes = {idx["name"] for idx in sa.inspect(bind).get_indexes(table_name)}
    if index_name not in indexes:
        op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    if not _has_table("fundamentals_pit"):
        return

    additions: list[tuple[str, sa.Column]] = [
        ("fiscal_period", sa.Column("fiscal_period", sa.String(length=32), nullable=False, server_default="")),
        ("release_date_estimated", sa.Column("release_date_estimated", sa.Boolean(), nullable=False, server_default=sa.false())),
        ("source", sa.Column("source", sa.String(length=32), nullable=False, server_default="")),
        ("market", sa.Column("market", sa.String(length=8), nullable=False, server_default="")),
    ]
    for column_name, column in additions:
        if not _has_column("fundamentals_pit", column_name):
            op.add_column("fundamentals_pit", column)

    _ensure_index("ix_fundamentals_pit_fiscal_period", "fundamentals_pit", ["fiscal_period"])
    _ensure_index("ix_fundamentals_pit_release_date_estimated", "fundamentals_pit", ["release_date_estimated"])
    _ensure_index("ix_fundamentals_pit_source", "fundamentals_pit", ["source"])
    _ensure_index("ix_fundamentals_pit_market", "fundamentals_pit", ["market"])


def downgrade() -> None:
    if not _has_table("fundamentals_pit"):
        return
    for index_name in [
        "ix_fundamentals_pit_market",
        "ix_fundamentals_pit_source",
        "ix_fundamentals_pit_release_date_estimated",
        "ix_fundamentals_pit_fiscal_period",
    ]:
        try:
            op.drop_index(index_name, table_name="fundamentals_pit")
        except Exception:
            pass
    for column_name in ["market", "source", "release_date_estimated", "fiscal_period"]:
        if _has_column("fundamentals_pit", column_name):
            op.drop_column("fundamentals_pit", column_name)
