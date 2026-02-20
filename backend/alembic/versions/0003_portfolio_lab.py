"""portfolio lab schema

Revision ID: 0003_portfolio_lab
Revises: 0002_model_lab
Create Date: 2026-02-20
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_portfolio_lab"
down_revision = "0002_model_lab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portfolio_definitions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("universe_json", sa.JSON(), nullable=False),
        sa.Column("benchmark_symbol", sa.String(length=32), nullable=True),
        sa.Column("start_date", sa.String(length=16), nullable=False),
        sa.Column("end_date", sa.String(length=16), nullable=False),
        sa.Column("rebalance_frequency", sa.String(length=16), nullable=False, server_default="WEEKLY"),
        sa.Column("weighting_method", sa.String(length=16), nullable=False, server_default="EQUAL"),
        sa.Column("constraints_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
    )
    op.create_index("ix_portfolio_definitions_name", "portfolio_definitions", ["name"], unique=False)
    op.create_index("ix_portfolio_definitions_start_date", "portfolio_definitions", ["start_date"], unique=False)
    op.create_index("ix_portfolio_definitions_end_date", "portfolio_definitions", ["end_date"], unique=False)
    op.create_index("ix_portfolio_definitions_rebalance_frequency", "portfolio_definitions", ["rebalance_frequency"], unique=False)
    op.create_index("ix_portfolio_definitions_weighting_method", "portfolio_definitions", ["weighting_method"], unique=False)
    op.create_index("ix_portfolio_definitions_created_at", "portfolio_definitions", ["created_at"], unique=False)

    op.create_table(
        "strategy_blends",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("strategies_json", sa.JSON(), nullable=False),
        sa.Column("blend_method", sa.String(length=32), nullable=False, server_default="WEIGHTED_SUM_RETURNS"),
        sa.Column("created_at", sa.String(length=40), nullable=False),
    )
    op.create_index("ix_strategy_blends_name", "strategy_blends", ["name"], unique=False)
    op.create_index("ix_strategy_blends_blend_method", "strategy_blends", ["blend_method"], unique=False)
    op.create_index("ix_strategy_blends_created_at", "strategy_blends", ["created_at"], unique=False)

    op.create_table(
        "portfolio_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("portfolio_id", sa.String(length=36), nullable=False),
        sa.Column("blend_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("started_at", sa.String(length=40), nullable=False),
        sa.Column("finished_at", sa.String(length=40), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["portfolio_id"], ["portfolio_definitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blend_id"], ["strategy_blends.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_portfolio_runs_portfolio_id", "portfolio_runs", ["portfolio_id"], unique=False)
    op.create_index("ix_portfolio_runs_blend_id", "portfolio_runs", ["blend_id"], unique=False)
    op.create_index("ix_portfolio_runs_status", "portfolio_runs", ["status"], unique=False)
    op.create_index("ix_portfolio_runs_started_at", "portfolio_runs", ["started_at"], unique=False)

    op.create_table(
        "portfolio_run_metrics",
        sa.Column("run_id", sa.String(length=36), primary_key=True),
        sa.Column("metrics_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["portfolio_runs.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "portfolio_run_timeseries",
        sa.Column("run_id", sa.String(length=36), primary_key=True),
        sa.Column("series_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["portfolio_runs.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "portfolio_run_matrices",
        sa.Column("run_id", sa.String(length=36), primary_key=True),
        sa.Column("matrices_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["portfolio_runs.id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("portfolio_run_matrices")
    op.drop_table("portfolio_run_timeseries")
    op.drop_table("portfolio_run_metrics")
    op.drop_table("portfolio_runs")
    op.drop_table("strategy_blends")
    op.drop_table("portfolio_definitions")
