"""Persist user-configured agent paper-trade risk limits."""
from alembic import op
import sqlalchemy as sa

revision = "0015_agent_risk_policy"
down_revision = "0014_research_review"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("agent_risk_policies"):
        return
    op.create_table("agent_risk_policies", sa.Column("user_id", sa.String(36), primary_key=True),
                    sa.Column("policy", sa.JSON(), nullable=False))


def downgrade():
    op.drop_table("agent_risk_policies")
