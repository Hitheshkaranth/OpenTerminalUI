"""Preserve source news publication availability; legacy rows remain unverified."""
from alembic import op
import sqlalchemy as sa

revision = "0017_news_availability"
down_revision = "0016_strategy_experiments"
branch_labels = None
depends_on = None


def upgrade():
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("news_articles")}
    for column in [sa.Column("source_published_at", sa.String(40), nullable=True),
                   sa.Column("publication_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
                   sa.Column("publication_source", sa.String(32), nullable=True)]:
        if column.name not in existing:
            op.add_column("news_articles", column)


def downgrade():
    for name in ("publication_source", "publication_verified", "source_published_at"):
        op.drop_column("news_articles", name)
