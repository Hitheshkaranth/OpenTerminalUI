"""Append-only strategy experiment snapshots and repeated-test accounting."""

from alembic import op
import sqlalchemy as sa

revision = "0016_strategy_experiments"
down_revision = "0015_agent_risk_policy"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("agent_strategy_experiments"):
        return
    op.create_table(
        "agent_strategy_experiments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("run_id", sa.String(64), nullable=False),
        sa.Column("event_kind", sa.String(32), nullable=False),
        sa.Column("dataset_id", sa.String(64), nullable=False),
        sa.Column("symbol", sa.String(64), nullable=False),
        sa.Column("protocol_version", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "run_id", "event_kind", name="uq_strategy_experiment_run_event"),
    )
    op.create_index("ix_agent_strategy_experiments_user_id", "agent_strategy_experiments", ["user_id"])
    op.create_index("ix_agent_strategy_experiments_run_id", "agent_strategy_experiments", ["run_id"])
    op.create_index("ix_strategy_experiment_dataset", "agent_strategy_experiments", ["user_id", "dataset_id", "symbol", "event_kind"])


def downgrade():
    op.drop_table("agent_strategy_experiments")
