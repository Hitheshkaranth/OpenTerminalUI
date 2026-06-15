"""add saved workspace views

Revision ID: 0011_saved_views
Revises: 0008_pit_fundamentals_release
Create Date: 2026-05-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0011_saved_views"
down_revision = "0008_pit_fundamentals_release"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return table_name in set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    if _has_table("saved_views"):
        return
    op.create_table(
        "saved_views",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("scope", sa.String(length=80), nullable=False),
        sa.Column("page", sa.String(length=240), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saved_views_user_id", "saved_views", ["user_id"])
    op.create_index("ix_saved_views_name", "saved_views", ["name"])
    op.create_index("ix_saved_views_scope", "saved_views", ["scope"])
    op.create_index("ix_saved_views_page", "saved_views", ["page"])
    op.create_index("ix_saved_views_created_at", "saved_views", ["created_at"])
    op.create_index("ix_saved_views_updated_at", "saved_views", ["updated_at"])


def downgrade() -> None:
    if _has_table("saved_views"):
        op.drop_table("saved_views")
