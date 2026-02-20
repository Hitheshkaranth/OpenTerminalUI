"""model lab schema

Revision ID: 0002_model_lab
Revises: 0001_initial
Create Date: 2026-02-19
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_model_lab"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_experiments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("model_key", sa.String(length=120), nullable=False),
        sa.Column("params_json", sa.JSON(), nullable=False),
        sa.Column("universe_json", sa.JSON(), nullable=False),
        sa.Column("benchmark_symbol", sa.String(length=32), nullable=True),
        sa.Column("start_date", sa.String(length=16), nullable=False),
        sa.Column("end_date", sa.String(length=16), nullable=False),
        sa.Column("cost_model_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
    )
    op.create_index("ix_model_experiments_name", "model_experiments", ["name"], unique=False)
    op.create_index("ix_model_experiments_model_key", "model_experiments", ["model_key"], unique=False)
    op.create_index("ix_model_experiments_start_date", "model_experiments", ["start_date"], unique=False)
    op.create_index("ix_model_experiments_end_date", "model_experiments", ["end_date"], unique=False)
    op.create_index("ix_model_experiments_created_at", "model_experiments", ["created_at"], unique=False)

    op.create_table(
        "model_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("backtest_run_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("started_at", sa.String(length=40), nullable=False),
        sa.Column("finished_at", sa.String(length=40), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["experiment_id"], ["model_experiments.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_model_runs_experiment_id", "model_runs", ["experiment_id"], unique=False)
    op.create_index("ix_model_runs_backtest_run_id", "model_runs", ["backtest_run_id"], unique=False)
    op.create_index("ix_model_runs_status", "model_runs", ["status"], unique=False)
    op.create_index("ix_model_runs_started_at", "model_runs", ["started_at"], unique=False)

    op.create_table(
        "model_run_metrics",
        sa.Column("run_id", sa.String(length=36), primary_key=True),
        sa.Column("metrics_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["model_runs.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "model_run_timeseries",
        sa.Column("run_id", sa.String(length=36), primary_key=True),
        sa.Column("series_json", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["model_runs.id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("model_run_timeseries")
    op.drop_table("model_run_metrics")
    op.drop_table("model_runs")
    op.drop_table("model_experiments")
