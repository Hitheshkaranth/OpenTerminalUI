"""add trade journal entries

Revision ID: 0006_trade_journal
Revises: 0005_news_sentiment_columns
Create Date: 2026-04-05
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0006_trade_journal"
down_revision = "0005_news_sentiment_columns"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return table_name in set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    if _has_table("journal_entries"):
        return

    op.create_table(
        "journal_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("symbol", sa.String(length=20), nullable=False),
        sa.Column("direction", sa.String(length=10), nullable=False),
        sa.Column("entry_date", sa.DateTime(), nullable=False),
        sa.Column("entry_price", sa.Float(), nullable=False),
        sa.Column("exit_date", sa.DateTime(), nullable=True),
        sa.Column("exit_price", sa.Float(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("pnl", sa.Float(), nullable=True),
        sa.Column("pnl_pct", sa.Float(), nullable=True),
        sa.Column("fees", sa.Float(), nullable=False, server_default="0"),
        sa.Column("strategy", sa.String(length=100), nullable=True),
        sa.Column("setup", sa.String(length=100), nullable=True),
        sa.Column("emotion", sa.String(length=50), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_journal_entries_user_id", "journal_entries", ["user_id"])
    op.create_index("ix_journal_entries_symbol", "journal_entries", ["symbol"])
    op.create_index("ix_journal_entries_strategy", "journal_entries", ["strategy"])
    op.create_index("ix_journal_entries_setup", "journal_entries", ["setup"])
    op.create_index("ix_journal_entries_emotion", "journal_entries", ["emotion"])
    op.create_index("ix_journal_entries_entry_date", "journal_entries", ["entry_date"])
    op.create_index("ix_journal_entries_exit_date", "journal_entries", ["exit_date"])


def downgrade() -> None:
    if not _has_table("journal_entries"):
        return

    op.drop_index("ix_journal_entries_exit_date", table_name="journal_entries")
    op.drop_index("ix_journal_entries_entry_date", table_name="journal_entries")
    op.drop_index("ix_journal_entries_emotion", table_name="journal_entries")
    op.drop_index("ix_journal_entries_setup", table_name="journal_entries")
    op.drop_index("ix_journal_entries_strategy", table_name="journal_entries")
    op.drop_index("ix_journal_entries_symbol", table_name="journal_entries")
    op.drop_index("ix_journal_entries_user_id", table_name="journal_entries")
    op.drop_table("journal_entries")
