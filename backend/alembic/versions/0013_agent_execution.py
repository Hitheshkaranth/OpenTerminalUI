"""Durable agent requests, event replay and tool checkpoints.

Schema declarations are frozen to this revision. Legacy agent_runs columns are
repaired additively; those columns predate this revision and survive downgrade.
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_agent_execution"
down_revision = "0012_research_dossiers"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade():
    # Some installations created agent_runs before these nullable columns existed.
    # create_all does not alter existing tables, so repair those installations too.
    if _has_table("agent_runs"):
        columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("agent_runs")}
        if "grounding_json" not in columns:
            op.add_column("agent_runs", sa.Column("grounding_json", sa.Text(), nullable=True))
        if "finished_at" not in columns:
            op.add_column("agent_runs", sa.Column("finished_at", sa.DateTime(), nullable=True))
    if not _has_table("agent_run_executions"):
        op.create_table(
            "agent_run_executions",
            sa.Column("run_id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("spec_json", sa.Text(), nullable=False),
            sa.Column("state", sa.String(16), nullable=False),
            sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
            sa.Column("lease_id", sa.String(36), nullable=True),
        )
        op.create_index("ix_agent_run_executions_user_id", "agent_run_executions", ["user_id"])
        op.create_index("ix_agent_run_executions_state", "agent_run_executions", ["state"])
    if not _has_table("agent_run_events"):
        op.create_table(
            "agent_run_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("run_id", sa.String(36), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_agent_run_events_run_id", "agent_run_events", ["run_id"])
    if not _has_table("agent_tool_checkpoints"):
        op.create_table(
            "agent_tool_checkpoints",
            sa.Column("id", sa.String(128), primary_key=True),
            sa.Column("run_id", sa.String(36), nullable=False),
            sa.Column("tool_name", sa.String(128), nullable=False),
            sa.Column("args_json", sa.Text(), nullable=False),
            sa.Column("state", sa.String(16), nullable=False),
            sa.Column("result_json", sa.Text(), nullable=True),
        )
        op.create_index("ix_agent_tool_checkpoints_run_id", "agent_tool_checkpoints", ["run_id"])


def downgrade():
    for table in ("agent_tool_checkpoints", "agent_run_events", "agent_run_executions"):
        if _has_table(table):
            op.drop_table(table)
