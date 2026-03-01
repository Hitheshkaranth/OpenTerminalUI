"""ensure sentiment columns on news_articles

Revision ID: 0005_news_sentiment_columns
Revises: 0004_institutional_risk_ops
Create Date: 2026-02-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_news_sentiment_columns"
down_revision = "0004_institutional_risk_ops"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return table_name in set(sa.inspect(bind).get_table_names())


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    cols = sa.inspect(bind).get_columns(table_name)
    return column_name in {col["name"] for col in cols}


def upgrade() -> None:
    table_name = "news_articles"
    if not _has_table(table_name):
        return

    if not _has_column(table_name, "sentiment_score"):
        op.add_column(table_name, sa.Column("sentiment_score", sa.Float(), nullable=True))
    if not _has_column(table_name, "sentiment_label"):
        op.add_column(table_name, sa.Column("sentiment_label", sa.String(length=16), nullable=True))
    if not _has_column(table_name, "sentiment_confidence"):
        op.add_column(table_name, sa.Column("sentiment_confidence", sa.Float(), nullable=True))


def downgrade() -> None:
    table_name = "news_articles"
    if not _has_table(table_name):
        return

    if _has_column(table_name, "sentiment_confidence"):
        op.drop_column(table_name, "sentiment_confidence")
    if _has_column(table_name, "sentiment_label"):
        op.drop_column(table_name, "sentiment_label")
    if _has_column(table_name, "sentiment_score"):
        op.drop_column(table_name, "sentiment_score")
