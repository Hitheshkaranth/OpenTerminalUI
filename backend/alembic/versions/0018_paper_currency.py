"""Give paper cash and ledger amounts an explicit base currency."""
from alembic import op
import sqlalchemy as sa

revision = "0018_paper_currency"
down_revision = "0017_news_availability"
branch_labels = None
depends_on = None


def upgrade():
    if not sa.inspect(op.get_bind()).has_table("virtual_portfolios"):
        # Older Alembic-only installs create the paper tables during app bootstrap.
        return
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("virtual_portfolios")}
    if "base_currency" not in columns:
        op.add_column("virtual_portfolios", sa.Column("base_currency", sa.String(3), nullable=False, server_default="INR"))


def downgrade():
    if sa.inspect(op.get_bind()).has_table("virtual_portfolios"):
        columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("virtual_portfolios")}
        if "base_currency" in columns:
            op.drop_column("virtual_portfolios", "base_currency")
