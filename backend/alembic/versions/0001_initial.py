"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-02-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "holdings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ticker", sa.String(length=32), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("avg_buy_price", sa.Float(), nullable=False),
        sa.Column("buy_date", sa.String(length=16), nullable=False),
    )
    op.create_index("ix_holdings_id", "holdings", ["id"], unique=False)
    op.create_index("ix_holdings_ticker", "holdings", ["ticker"], unique=False)

    op.create_table(
        "watchlist_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("watchlist_name", sa.String(length=64), nullable=False),
        sa.Column("ticker", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_watchlist_items_id", "watchlist_items", ["id"], unique=False)
    op.create_index("ix_watchlist_items_watchlist_name", "watchlist_items", ["watchlist_name"], unique=False)
    op.create_index("ix_watchlist_items_ticker", "watchlist_items", ["ticker"], unique=False)

    op.create_table(
        "alert_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ticker", sa.String(length=32), nullable=False),
        sa.Column("alert_type", sa.String(length=32), nullable=False),
        sa.Column("condition", sa.String(length=32), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=False),
        sa.Column("note", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_alert_rules_id", "alert_rules", ["id"], unique=False)
    op.create_index("ix_alert_rules_ticker", "alert_rules", ["ticker"], unique=False)
    op.create_index("ix_alert_rules_alert_type", "alert_rules", ["alert_type"], unique=False)

    op.create_table(
        "alert_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rule_id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(length=32), nullable=False),
        sa.Column("message", sa.String(length=512), nullable=False),
        sa.Column("triggered_at", sa.String(length=32), nullable=False),
    )
    op.create_index("ix_alert_history_id", "alert_history", ["id"], unique=False)
    op.create_index("ix_alert_history_rule_id", "alert_history", ["rule_id"], unique=False)
    op.create_index("ix_alert_history_ticker", "alert_history", ["ticker"], unique=False)

    op.create_table(
        "future_contracts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("underlying", sa.String(length=64), nullable=False),
        sa.Column("expiry_date", sa.String(length=16), nullable=False),
        sa.Column("exchange", sa.String(length=16), nullable=False),
        sa.Column("tradingsymbol", sa.String(length=64), nullable=False),
        sa.Column("instrument_token", sa.Integer(), nullable=False),
        sa.Column("lot_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tick_size", sa.Float(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.String(length=32), nullable=False),
        sa.UniqueConstraint("exchange", "tradingsymbol", name="uq_future_contract_exchange_symbol"),
    )
    op.create_index("ix_future_contracts_id", "future_contracts", ["id"], unique=False)
    op.create_index("ix_future_contracts_underlying", "future_contracts", ["underlying"], unique=False)
    op.create_index("ix_future_contracts_expiry_date", "future_contracts", ["expiry_date"], unique=False)
    op.create_index("ix_future_contracts_exchange", "future_contracts", ["exchange"], unique=False)
    op.create_index("ix_future_contracts_tradingsymbol", "future_contracts", ["tradingsymbol"], unique=False)
    op.create_index("ix_future_contracts_instrument_token", "future_contracts", ["instrument_token"], unique=False)

    op.create_table(
        "news_articles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=1024), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("summary", sa.String(length=4096), nullable=False, server_default=""),
        sa.Column("image_url", sa.String(length=2048), nullable=False, server_default=""),
        sa.Column("published_at", sa.String(length=40), nullable=False),
        sa.Column("tickers", sa.String(length=2048), nullable=False, server_default="[]"),
        sa.Column("sentiment_score", sa.Float(), nullable=True),
        sa.Column("sentiment_label", sa.String(length=16), nullable=True),
        sa.Column("sentiment_confidence", sa.Float(), nullable=True),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.UniqueConstraint("url", name="uq_news_articles_url"),
    )
    op.create_index("ix_news_articles_id", "news_articles", ["id"], unique=False)
    op.create_index("ix_news_articles_source", "news_articles", ["source"], unique=False)
    op.create_index("ix_news_articles_url", "news_articles", ["url"], unique=False)
    op.create_index("ix_news_articles_published_at", "news_articles", ["published_at"], unique=False)

    op.create_table(
        "backtest_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("request_json", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False, server_default=""),
        sa.Column("logs", sa.Text(), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
    )
    op.create_index("ix_backtest_runs_id", "backtest_runs", ["id"], unique=False)
    op.create_index("ix_backtest_runs_run_id", "backtest_runs", ["run_id"], unique=True)
    op.create_index("ix_backtest_runs_status", "backtest_runs", ["status"], unique=False)

    op.create_table(
        "portfolio_mutual_funds",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("scheme_code", sa.Integer(), nullable=False),
        sa.Column("scheme_name", sa.String(length=256), nullable=False),
        sa.Column("fund_house", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("units", sa.Float(), nullable=False),
        sa.Column("avg_nav", sa.Float(), nullable=False),
        sa.Column("xirr", sa.Float(), nullable=True),
        sa.Column("sip_transactions", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("added_at", sa.String(length=40), nullable=False),
    )
    op.create_index("ix_portfolio_mutual_funds_id", "portfolio_mutual_funds", ["id"], unique=False)
    op.create_index("ix_portfolio_mutual_funds_scheme_code", "portfolio_mutual_funds", ["scheme_code"], unique=False)
    op.create_index("ix_portfolio_mutual_funds_scheme_name", "portfolio_mutual_funds", ["scheme_name"], unique=False)

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("role", sa.Enum("ADMIN", "TRADER", "VIEWER", name="userrole"), nullable=False, server_default="VIEWER"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_login", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_role", "users", ["role"], unique=False)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"], unique=False)
    op.create_index("ix_refresh_tokens_jti", "refresh_tokens", ["jti"], unique=True)
    op.create_index("ix_refresh_tokens_expires_at", "refresh_tokens", ["expires_at"], unique=False)
    op.create_index("ix_refresh_tokens_revoked_at", "refresh_tokens", ["revoked_at"], unique=False)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE INDEX IF NOT EXISTS brin_news_articles_created_at ON news_articles USING BRIN (created_at)")
        op.execute("CREATE INDEX IF NOT EXISTS brin_backtest_runs_created_at ON backtest_runs USING BRIN (created_at)")


def downgrade() -> None:
    for table in [
        "refresh_tokens",
        "users",
        "portfolio_mutual_funds",
        "backtest_runs",
        "news_articles",
        "future_contracts",
        "alert_history",
        "alert_rules",
        "watchlist_items",
        "holdings",
    ]:
        op.drop_table(table)
