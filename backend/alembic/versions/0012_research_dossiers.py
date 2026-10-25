"""Versioned research dossiers and frozen experiment snapshots.

This schema is intentionally declared here, not imported from current ORM models:
replaying this migration must not acquire columns introduced by a later release.
"""
from alembic import op
import sqlalchemy as sa

revision = "0012_research_dossiers"
down_revision = "0011_saved_views"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name)


def upgrade():
    if not _has_table("research_dossiers"):
        op.create_table(
            "research_dossiers",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("symbol", sa.String(64), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("lock_version", sa.Integer(), nullable=False),
            sa.Column("share_hash", sa.String(64), nullable=True, unique=True),
            sa.Column("shared_snapshot", sa.JSON(), nullable=True),
            sa.Column("monitor_state", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_research_dossiers_user_id", "research_dossiers", ["user_id"])
        op.create_index("ix_research_dossiers_symbol", "research_dossiers", ["symbol"])
    if not _has_table("research_dossier_revisions"):
        op.create_table(
            "research_dossier_revisions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("dossier_id", sa.String(36), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("snapshot", sa.JSON(), nullable=False),
            sa.Column("changes", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("dossier_id", "revision", name="uq_dossier_revision"),
        )
        op.create_index("ix_research_dossier_revisions_dossier_id", "research_dossier_revisions", ["dossier_id"])
    if not _has_table("research_experiments"):
        op.create_table(
            "research_experiments",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("dossier_id", sa.String(36), nullable=True),
            sa.Column("snapshot", sa.JSON(), nullable=False),
            sa.Column("sha256", sa.String(64), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_research_experiments_user_id", "research_experiments", ["user_id"])
        op.create_index("ix_research_experiments_dossier_id", "research_experiments", ["dossier_id"])


def downgrade():
    for name in ("research_experiments", "research_dossier_revisions", "research_dossiers"):
        if _has_table(name):
            op.drop_table(name)
