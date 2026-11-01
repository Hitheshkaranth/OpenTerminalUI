"""Research review states and scheduled fundamental screen observations."""
from alembic import op
import sqlalchemy as sa

revision = "0014_research_review"
down_revision = "0013_agent_execution"
branch_labels = None
depends_on = None


def upgrade():
    metadata = sa.MetaData()
    sa.Table("research_review_states", metadata,
        sa.Column("user_id", sa.String(36), primary_key=True), sa.Column("event_id", sa.String(160), primary_key=True),
        sa.Column("status", sa.String(16), nullable=False), sa.Column("snoozed_until", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False))
    sa.Table("screen_monitor_schedules", metadata,
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("user_id", sa.String(36), nullable=False, index=True),
        sa.Column("screen_id", sa.String(36), nullable=False, index=True), sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False), sa.Column("frequency", sa.String(16), nullable=False),
        sa.Column("next_run_at", sa.DateTime(), nullable=False, index=True), sa.Column("last_run_at", sa.DateTime()),
        sa.Column("lease_until", sa.DateTime()), sa.Column("snapshot", sa.JSON(), nullable=False), sa.Column("error", sa.String(500)),
        sa.Column("revision", sa.Integer(), nullable=False), sa.UniqueConstraint("user_id", "screen_id", name="uq_screen_monitor_owner_screen"))
    sa.Table("screen_monitor_changes", metadata,
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("user_id", sa.String(36), nullable=False, index=True),
        sa.Column("schedule_id", sa.String(36), nullable=False, index=True), sa.Column("symbol", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False), sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("observed_at", sa.DateTime(), nullable=False, index=True))
    metadata.create_all(op.get_bind(), checkfirst=True)


def downgrade():
    for name in ("screen_monitor_changes", "screen_monitor_schedules", "research_review_states"):
        if sa.inspect(op.get_bind()).has_table(name):
            op.drop_table(name)
