"""extend alerts for multi-condition delivery

Revision ID: 0007_alerts_v2_delivery
Revises: 0006_notifications, 0006_trade_journal
Create Date: 2026-04-05
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0007_alerts_v2_delivery"
down_revision = ("0006_notifications", "0006_trade_journal")
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return table_name in set(sa.inspect(bind).get_table_names())


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    columns = sa.inspect(bind).get_columns(table_name)
    return column_name in {column["name"] for column in columns}


def upgrade() -> None:
    if not _has_table("alerts"):
        return

    additions: list[tuple[str, sa.Column]] = [
        ("conditions", sa.Column("conditions", sa.JSON(), nullable=False, server_default="[]")),
        ("logic", sa.Column("logic", sa.String(length=5), nullable=False, server_default="AND")),
        ("delivery_channels", sa.Column("delivery_channels", sa.JSON(), nullable=False, server_default='["in_app"]')),
        ("delivery_config", sa.Column("delivery_config", sa.JSON(), nullable=False, server_default="{}")),
        ("cooldown_minutes", sa.Column("cooldown_minutes", sa.Integer(), nullable=False, server_default="0")),
        ("last_triggered_at", sa.Column("last_triggered_at", sa.DateTime(), nullable=True)),
        ("expiry_date", sa.Column("expiry_date", sa.DateTime(), nullable=True)),
        ("max_triggers", sa.Column("max_triggers", sa.Integer(), nullable=False, server_default="0")),
        ("trigger_count", sa.Column("trigger_count", sa.Integer(), nullable=False, server_default="0")),
    ]

    for column_name, column in additions:
        if _has_column("alerts", column_name):
            continue
        op.add_column("alerts", column)


def downgrade() -> None:
    if not _has_table("alerts"):
        return

    for column_name in [
        "trigger_count",
        "max_triggers",
        "expiry_date",
        "last_triggered_at",
        "cooldown_minutes",
        "delivery_config",
        "delivery_channels",
        "logic",
        "conditions",
    ]:
        if _has_column("alerts", column_name):
            op.drop_column("alerts", column_name)
