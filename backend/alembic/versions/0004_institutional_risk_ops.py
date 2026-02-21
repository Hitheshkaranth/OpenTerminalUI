"""institutional data layer + risk/oms/governance/ops schema

Revision ID: 0004_institutional_risk_ops
Revises: 0003_portfolio_lab
Create Date: 2026-02-21
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_institutional_risk_ops"
down_revision = "0003_portfolio_lab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    def _tables() -> set[str]:
        return set(sa.inspect(bind).get_table_names())

    def _has_table(name: str) -> bool:
        return name in _tables()

    def _has_index(table_name: str, index_name: str) -> bool:
        return index_name in {idx["name"] for idx in sa.inspect(bind).get_indexes(table_name)}

    def _ensure_index(index_name: str, table_name: str, columns: list[str], unique: bool = False) -> None:
        if _has_table(table_name) and not _has_index(table_name, index_name):
            op.create_index(index_name, table_name, columns, unique=unique)

    def _has_column(table_name: str, column_name: str) -> bool:
        return column_name in {col["name"] for col in sa.inspect(bind).get_columns(table_name)}

    def _ensure_column(table_name: str, column: sa.Column) -> None:
        if _has_table(table_name) and not _has_column(table_name, str(column.name)):
            op.add_column(table_name, column)

    def _has_fk(table_name: str, fk_name: str) -> bool:
        return fk_name in {fk.get("name") for fk in sa.inspect(bind).get_foreign_keys(table_name)}

    def _ensure_fk(
        fk_name: str,
        source_table: str,
        referent_table: str,
        local_cols: list[str],
        remote_cols: list[str],
        ondelete: str | None = None,
    ) -> None:
        if bind.dialect.name == "sqlite":
            return
        if _has_table(source_table) and _has_table(referent_table) and not _has_fk(source_table, fk_name):
            op.create_foreign_key(fk_name, source_table, referent_table, local_cols, remote_cols, ondelete=ondelete)

    if not _has_table("data_versions"):
        op.create_table(
            "data_versions",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("description", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("source", sa.String(length=64), nullable=False, server_default="internal"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("metadata_json", sa.JSON(), nullable=False),
        )
    _ensure_index("ix_data_versions_name", "data_versions", ["name"])
    _ensure_index("ix_data_versions_is_active", "data_versions", ["is_active"])
    _ensure_index("ix_data_versions_created_at", "data_versions", ["created_at"])

    if not _has_table("corp_actions"):
        op.create_table(
            "corp_actions",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("action_date", sa.String(length=16), nullable=False),
            sa.Column("action_type", sa.String(length=32), nullable=False),
            sa.Column("factor", sa.Float(), nullable=False, server_default="1"),
            sa.Column("amount", sa.Float(), nullable=True),
            sa.Column("notes", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("data_version_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["data_version_id"], ["data_versions.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("symbol", "action_date", "action_type", name="uq_corp_action_symbol_date_type"),
        )
    _ensure_index("ix_corp_actions_symbol", "corp_actions", ["symbol"])
    _ensure_index("ix_corp_actions_action_date", "corp_actions", ["action_date"])
    _ensure_index("ix_corp_actions_action_type", "corp_actions", ["action_type"])
    _ensure_index("ix_corp_actions_data_version_id", "corp_actions", ["data_version_id"])
    _ensure_index("ix_corp_actions_created_at", "corp_actions", ["created_at"])

    if not _has_table("prices_eod"):
        op.create_table(
            "prices_eod",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("trade_date", sa.String(length=16), nullable=False),
            sa.Column("open", sa.Float(), nullable=False),
            sa.Column("high", sa.Float(), nullable=False),
            sa.Column("low", sa.Float(), nullable=False),
            sa.Column("close", sa.Float(), nullable=False),
            sa.Column("volume", sa.Float(), nullable=False, server_default="0"),
            sa.Column("data_version_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["data_version_id"], ["data_versions.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("symbol", "trade_date", "data_version_id", name="uq_prices_eod_symbol_date_version"),
        )
    _ensure_index("ix_prices_eod_symbol", "prices_eod", ["symbol"])
    _ensure_index("ix_prices_eod_trade_date", "prices_eod", ["trade_date"])
    _ensure_index("ix_prices_eod_data_version_id", "prices_eod", ["data_version_id"])
    _ensure_index("ix_prices_eod_created_at", "prices_eod", ["created_at"])

    if not _has_table("fundamentals_pit"):
        op.create_table(
            "fundamentals_pit",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("metric", sa.String(length=64), nullable=False),
            sa.Column("value", sa.Float(), nullable=False),
            sa.Column("as_of_date", sa.String(length=16), nullable=False),
            sa.Column("effective_from", sa.String(length=16), nullable=True),
            sa.Column("effective_to", sa.String(length=16), nullable=True),
            sa.Column("data_version_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["data_version_id"], ["data_versions.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("symbol", "metric", "as_of_date", "data_version_id", name="uq_fund_pit_symbol_metric_date_version"),
        )
    _ensure_index("ix_fundamentals_pit_symbol", "fundamentals_pit", ["symbol"])
    _ensure_index("ix_fundamentals_pit_metric", "fundamentals_pit", ["metric"])
    _ensure_index("ix_fundamentals_pit_as_of_date", "fundamentals_pit", ["as_of_date"])
    _ensure_index("ix_fundamentals_pit_effective_from", "fundamentals_pit", ["effective_from"])
    _ensure_index("ix_fundamentals_pit_effective_to", "fundamentals_pit", ["effective_to"])
    _ensure_index("ix_fundamentals_pit_data_version_id", "fundamentals_pit", ["data_version_id"])
    _ensure_index("ix_fundamentals_pit_created_at", "fundamentals_pit", ["created_at"])

    if not _has_table("universe_membership"):
        op.create_table(
            "universe_membership",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("universe_id", sa.String(length=64), nullable=False),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("start_date", sa.String(length=16), nullable=False),
            sa.Column("end_date", sa.String(length=16), nullable=True),
            sa.Column("data_version_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["data_version_id"], ["data_versions.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("universe_id", "symbol", "start_date", "data_version_id", name="uq_universe_symbol_start_version"),
        )
    _ensure_index("ix_universe_membership_universe_id", "universe_membership", ["universe_id"])
    _ensure_index("ix_universe_membership_symbol", "universe_membership", ["symbol"])
    _ensure_index("ix_universe_membership_start_date", "universe_membership", ["start_date"])
    _ensure_index("ix_universe_membership_end_date", "universe_membership", ["end_date"])
    _ensure_index("ix_universe_membership_data_version_id", "universe_membership", ["data_version_id"])
    _ensure_index("ix_universe_membership_created_at", "universe_membership", ["created_at"])

    if not _has_table("orders"):
        op.create_table(
            "orders",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("side", sa.String(length=8), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("order_type", sa.String(length=16), nullable=False, server_default="market"),
            sa.Column("limit_price", sa.Float(), nullable=True),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="accepted"),
            sa.Column("rejection_reason", sa.String(length=512), nullable=True),
            sa.Column("meta_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        )
    _ensure_index("ix_orders_user_id", "orders", ["user_id"])
    _ensure_index("ix_orders_symbol", "orders", ["symbol"])
    _ensure_index("ix_orders_side", "orders", ["side"])
    _ensure_index("ix_orders_status", "orders", ["status"])
    _ensure_index("ix_orders_created_at", "orders", ["created_at"])
    _ensure_index("ix_orders_updated_at", "orders", ["updated_at"])

    if not _has_table("fills"):
        op.create_table(
            "fills",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("order_id", sa.String(length=36), nullable=False),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("fill_price", sa.Float(), nullable=False),
            sa.Column("cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        )
    _ensure_index("ix_fills_order_id", "fills", ["order_id"])
    _ensure_index("ix_fills_symbol", "fills", ["symbol"])
    _ensure_index("ix_fills_created_at", "fills", ["created_at"])

    if not _has_table("restricted_list"):
        op.create_table(
            "restricted_list",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("reason", sa.String(length=256), nullable=False, server_default=""),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("symbol", name="uq_restricted_symbol"),
        )
    _ensure_index("ix_restricted_list_symbol", "restricted_list", ["symbol"])
    _ensure_index("ix_restricted_list_active", "restricted_list", ["active"])
    _ensure_index("ix_restricted_list_created_at", "restricted_list", ["created_at"])

    if not _has_table("audit_log"):
        op.create_table(
            "audit_log",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("event_type", sa.String(length=64), nullable=False),
            sa.Column("entity_type", sa.String(length=64), nullable=False),
            sa.Column("entity_id", sa.String(length=64), nullable=True),
            sa.Column("payload_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        )
    _ensure_index("ix_audit_log_user_id", "audit_log", ["user_id"])
    _ensure_index("ix_audit_log_event_type", "audit_log", ["event_type"])
    _ensure_index("ix_audit_log_entity_type", "audit_log", ["entity_type"])
    _ensure_index("ix_audit_log_entity_id", "audit_log", ["entity_id"])
    _ensure_index("ix_audit_log_created_at", "audit_log", ["created_at"])

    if not _has_table("model_registry"):
        op.create_table(
            "model_registry",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("run_id", sa.String(length=36), nullable=True),
            sa.Column("stage", sa.String(length=16), nullable=False, server_default="staging"),
            sa.Column("promoted_at", sa.DateTime(), nullable=True),
            sa.Column("metadata_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["run_id"], ["model_runs.id"], ondelete="SET NULL"),
        )
    _ensure_index("ix_model_registry_name", "model_registry", ["name"])
    _ensure_index("ix_model_registry_run_id", "model_registry", ["run_id"])
    _ensure_index("ix_model_registry_stage", "model_registry", ["stage"])
    _ensure_index("ix_model_registry_promoted_at", "model_registry", ["promoted_at"])
    _ensure_index("ix_model_registry_created_at", "model_registry", ["created_at"])

    if not _has_table("ops_kill_switches"):
        op.create_table(
            "ops_kill_switches",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("scope", sa.String(length=64), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("reason", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("scope", name="uq_kill_switch_scope"),
        )
    _ensure_index("ix_ops_kill_switches_scope", "ops_kill_switches", ["scope"])
    _ensure_index("ix_ops_kill_switches_enabled", "ops_kill_switches", ["enabled"])
    _ensure_index("ix_ops_kill_switches_updated_at", "ops_kill_switches", ["updated_at"])

    _ensure_column("backtest_runs", sa.Column("data_version_id", sa.String(length=36), nullable=True))
    _ensure_column(
        "backtest_runs",
        sa.Column("execution_profile_json", sa.JSON(), nullable=False, server_default="{}"),
    )
    _ensure_index("ix_backtest_runs_data_version_id", "backtest_runs", ["data_version_id"])
    _ensure_fk(
        "fk_backtest_runs_data_version",
        "backtest_runs",
        "data_versions",
        ["data_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    _ensure_column("model_runs", sa.Column("data_version_id", sa.String(length=36), nullable=True))
    _ensure_column("model_runs", sa.Column("code_hash", sa.String(length=128), nullable=True))
    _ensure_column(
        "model_runs",
        sa.Column("execution_profile_json", sa.JSON(), nullable=False, server_default="{}"),
    )
    _ensure_index("ix_model_runs_data_version_id", "model_runs", ["data_version_id"])
    _ensure_index("ix_model_runs_code_hash", "model_runs", ["code_hash"])
    _ensure_fk(
        "fk_model_runs_data_version",
        "model_runs",
        "data_versions",
        ["data_version_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_backtest_runs_data_version", "backtest_runs", type_="foreignkey")
    op.drop_index("ix_backtest_runs_data_version_id", table_name="backtest_runs")
    op.drop_column("backtest_runs", "execution_profile_json")
    op.drop_column("backtest_runs", "data_version_id")

    op.drop_constraint("fk_model_runs_data_version", "model_runs", type_="foreignkey")
    op.drop_index("ix_model_runs_code_hash", table_name="model_runs")
    op.drop_index("ix_model_runs_data_version_id", table_name="model_runs")
    op.drop_column("model_runs", "execution_profile_json")
    op.drop_column("model_runs", "code_hash")
    op.drop_column("model_runs", "data_version_id")

    op.drop_table("ops_kill_switches")
    op.drop_table("model_registry")
    op.drop_table("audit_log")
    op.drop_table("restricted_list")
    op.drop_table("fills")
    op.drop_table("orders")
    op.drop_table("universe_membership")
    op.drop_table("fundamentals_pit")
    op.drop_table("prices_eod")
    op.drop_table("corp_actions")
    op.drop_table("data_versions")
