"""Tenant ownership for portfolio/lab records and (symbol, status) lookup indexes.

Adds nullable ``user_id`` (FK users.id) to holdings, tax_lots and watchlist_items and a
nullable ``owner_id`` to the research-lab tables. Existing rows are backfilled to the
oldest admin (falling back to the oldest user) so single-user installs keep their data.
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_tenant_ownership"
down_revision = "0019_baseline_orm_tables"
branch_labels = None
depends_on = None

# table -> (column, has users.id foreign key)
OWNER_COLUMNS = {
    "holdings": ("user_id", True),
    "tax_lots": ("user_id", True),
    "watchlist_items": ("user_id", True),
    "model_experiments": ("owner_id", False),
    "portfolio_definitions": ("owner_id", False),
    "strategy_blends": ("owner_id", False),
    "experiments": ("owner_id", False),
}

COMPOSITE_INDEXES = {
    "alerts": ("ix_alerts_symbol_status", ["symbol", "status"]),
    "virtual_orders": ("ix_virtual_orders_symbol_status", ["symbol", "status"]),
}


def _default_owner_id(bind) -> str | None:
    if not sa.inspect(bind).has_table("users"):
        return None
    row = bind.execute(
        sa.text("SELECT id FROM users WHERE UPPER(CAST(role AS VARCHAR(16))) = 'ADMIN' ORDER BY created_at ASC, id ASC LIMIT 1")
    ).first()
    if row is None:
        row = bind.execute(sa.text("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1")).first()
    return str(row[0]) if row is not None else None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    owner_id = _default_owner_id(bind)

    for table, (column, has_fk) in OWNER_COLUMNS.items():
        if not inspector.has_table(table):
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        index_name = f"ix_{table}_{column}"
        if column not in existing:
            with op.batch_alter_table(table) as batch:
                batch.add_column(sa.Column(column, sa.String(length=36), nullable=True))
                if has_fk:
                    batch.create_foreign_key(f"fk_{table}_{column}_users", "users", [column], ["id"])
        if index_name not in {i["name"] for i in sa.inspect(bind).get_indexes(table)}:
            op.create_index(index_name, table, [column], unique=False)
        if owner_id is not None:
            bind.execute(
                sa.text(f"UPDATE {table} SET {column} = :owner WHERE {column} IS NULL"),
                {"owner": owner_id},
            )

    for table, (name, columns) in COMPOSITE_INDEXES.items():
        if not inspector.has_table(table):
            continue
        if name not in {i["name"] for i in inspector.get_indexes(table)}:
            op.create_index(name, table, columns, unique=False)


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table, (name, _columns) in COMPOSITE_INDEXES.items():
        if inspector.has_table(table) and name in {i["name"] for i in inspector.get_indexes(table)}:
            op.drop_index(name, table_name=table)
    for table, (column, has_fk) in OWNER_COLUMNS.items():
        if not inspector.has_table(table):
            continue
        if column not in {c["name"] for c in inspector.get_columns(table)}:
            continue
        index_name = f"ix_{table}_{column}"
        if index_name in {i["name"] for i in inspector.get_indexes(table)}:
            op.drop_index(index_name, table_name=table)
        with op.batch_alter_table(table) as batch:
            if has_fk:
                batch.drop_constraint(f"fk_{table}_{column}_users", type_="foreignkey")
            batch.drop_column(column)
