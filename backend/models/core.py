from __future__ import annotations

import enum
from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from backend.shared.db import Base


class Holding(Base):
    __tablename__ = "holdings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(32), index=True)
    quantity: Mapped[float] = mapped_column(Float)
    avg_buy_price: Mapped[float] = mapped_column(Float)
    buy_date: Mapped[str] = mapped_column(String(16))


class TaxLot(Base):
    __tablename__ = "tax_lots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(32), index=True)
    quantity: Mapped[float] = mapped_column(Float)
    remaining_quantity: Mapped[float] = mapped_column(Float)
    buy_price: Mapped[float] = mapped_column(Float)
    buy_date: Mapped[str] = mapped_column(String(16), index=True)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    watchlist_name: Mapped[str] = mapped_column(String(64), index=True)
    ticker: Mapped[str] = mapped_column(String(32), index=True)


class AlertRuleORM(Base):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(32), index=True)
    alert_type: Mapped[str] = mapped_column(String(32), index=True)
    condition: Mapped[str] = mapped_column(String(32))
    threshold: Mapped[float] = mapped_column(Float)
    note: Mapped[str] = mapped_column(String(256), default="")
    created_at: Mapped[str] = mapped_column(String(32), default=lambda: datetime.utcnow().isoformat())


class AlertHistoryORM(Base):
    __tablename__ = "alert_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    rule_id: Mapped[int] = mapped_column(Integer, index=True)
    ticker: Mapped[str] = mapped_column(String(32), index=True)
    message: Mapped[str] = mapped_column(String(512))
    triggered_at: Mapped[str] = mapped_column(String(32), default=lambda: datetime.utcnow().isoformat())


class FutureContract(Base):
    __tablename__ = "future_contracts"
    __table_args__ = (
        UniqueConstraint("exchange", "tradingsymbol", name="uq_future_contract_exchange_symbol"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    underlying: Mapped[str] = mapped_column(String(64), index=True)
    expiry_date: Mapped[str] = mapped_column(String(16), index=True)
    exchange: Mapped[str] = mapped_column(String(16), index=True)
    tradingsymbol: Mapped[str] = mapped_column(String(64), index=True)
    instrument_token: Mapped[int] = mapped_column(Integer, index=True)
    lot_size: Mapped[int] = mapped_column(Integer, default=0)
    tick_size: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[str] = mapped_column(String(32), default=lambda: datetime.utcnow().isoformat())


class NewsArticle(Base):
    __tablename__ = "news_articles"
    __table_args__ = (
        UniqueConstraint("url", name="uq_news_articles_url"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source: Mapped[str] = mapped_column(String(128), index=True)
    title: Mapped[str] = mapped_column(String(1024))
    url: Mapped[str] = mapped_column(String(2048), index=True)
    summary: Mapped[str] = mapped_column(String(4096), default="")
    image_url: Mapped[str] = mapped_column(String(2048), default="")
    published_at: Mapped[str] = mapped_column(String(40), index=True)
    tickers: Mapped[str] = mapped_column(String(2048), default="[]")
    sentiment_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    sentiment_label: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sentiment_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat())


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    request_json: Mapped[str] = mapped_column(Text)
    result_json: Mapped[str] = mapped_column(Text, default="")
    logs: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    data_version_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("data_versions.id", ondelete="SET NULL"), nullable=True, index=True)
    execution_profile_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat())
    updated_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat())


class ModelExperiment(Base):
    __tablename__ = "model_experiments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(160), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    model_key: Mapped[str] = mapped_column(String(120), index=True)
    params_json: Mapped[dict] = mapped_column(JSON, default=dict)
    universe_json: Mapped[dict] = mapped_column(JSON, default=dict)
    benchmark_symbol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    start_date: Mapped[str] = mapped_column(String(16), index=True)
    end_date: Mapped[str] = mapped_column(String(16), index=True)
    cost_model_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat(), index=True)


class ModelRun(Base):
    __tablename__ = "model_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    experiment_id: Mapped[str] = mapped_column(String(36), ForeignKey("model_experiments.id", ondelete="CASCADE"), index=True)
    backtest_run_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    started_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat(), index=True)
    finished_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_version_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("data_versions.id", ondelete="SET NULL"), nullable=True, index=True)
    code_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    execution_profile_json: Mapped[dict] = mapped_column(JSON, default=dict)


class ModelRunMetrics(Base):
    __tablename__ = "model_run_metrics"

    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("model_runs.id", ondelete="CASCADE"), primary_key=True)
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)


class ModelRunTimeseries(Base):
    __tablename__ = "model_run_timeseries"

    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("model_runs.id", ondelete="CASCADE"), primary_key=True)
    series_json: Mapped[dict] = mapped_column(JSON, default=dict)


class RebalanceFrequency(str, enum.Enum):
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"


class WeightingMethod(str, enum.Enum):
    EQUAL = "EQUAL"
    VOL_TARGET = "VOL_TARGET"
    RISK_PARITY = "RISK_PARITY"


class BlendMethod(str, enum.Enum):
    WEIGHTED_SUM_SIGNALS = "WEIGHTED_SUM_SIGNALS"
    WEIGHTED_SUM_RETURNS = "WEIGHTED_SUM_RETURNS"


class PortfolioDefinition(Base):
    __tablename__ = "portfolio_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(160), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    universe_json: Mapped[dict] = mapped_column(JSON, default=dict)
    benchmark_symbol: Mapped[str | None] = mapped_column(String(32), nullable=True)
    start_date: Mapped[str] = mapped_column(String(16), index=True)
    end_date: Mapped[str] = mapped_column(String(16), index=True)
    rebalance_frequency: Mapped[str] = mapped_column(String(16), default=RebalanceFrequency.WEEKLY.value, index=True)
    weighting_method: Mapped[str] = mapped_column(String(16), default=WeightingMethod.EQUAL.value, index=True)
    constraints_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat(), index=True)


class StrategyBlend(Base):
    __tablename__ = "strategy_blends"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(160), index=True)
    strategies_json: Mapped[list] = mapped_column(JSON, default=list)
    blend_method: Mapped[str] = mapped_column(String(32), default=BlendMethod.WEIGHTED_SUM_RETURNS.value, index=True)
    created_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat(), index=True)


class PortfolioRun(Base):
    __tablename__ = "portfolio_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    portfolio_id: Mapped[str] = mapped_column(String(36), ForeignKey("portfolio_definitions.id", ondelete="CASCADE"), index=True)
    blend_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("strategy_blends.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    started_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat(), index=True)
    finished_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class PortfolioRunMetrics(Base):
    __tablename__ = "portfolio_run_metrics"

    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("portfolio_runs.id", ondelete="CASCADE"), primary_key=True)
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)


class PortfolioRunTimeseries(Base):
    __tablename__ = "portfolio_run_timeseries"

    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("portfolio_runs.id", ondelete="CASCADE"), primary_key=True)
    series_json: Mapped[dict] = mapped_column(JSON, default=dict)


class PortfolioRunMatrices(Base):
    __tablename__ = "portfolio_run_matrices"

    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("portfolio_runs.id", ondelete="CASCADE"), primary_key=True)
    matrices_json: Mapped[dict] = mapped_column(JSON, default=dict)


class NseFnoBhavcopy(Base):
    __tablename__ = "nse_fno_bhavcopy"
    __table_args__ = (
        UniqueConstraint("trade_date", "symbol", "expiry_date", "option_type", "strike_price", name="uq_nse_fno_bhavcopy_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    trade_date: Mapped[str] = mapped_column(String(16), index=True)
    instrument: Mapped[str] = mapped_column(String(16), index=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    expiry_date: Mapped[str] = mapped_column(String(16), index=True)
    strike_price: Mapped[float] = mapped_column(Float, default=0.0)
    option_type: Mapped[str] = mapped_column(String(8), default="")
    open_price: Mapped[float] = mapped_column(Float, default=0.0)
    high_price: Mapped[float] = mapped_column(Float, default=0.0)
    low_price: Mapped[float] = mapped_column(Float, default=0.0)
    close_price: Mapped[float] = mapped_column(Float, default=0.0)
    settle_price: Mapped[float] = mapped_column(Float, default=0.0)
    contracts: Mapped[int] = mapped_column(Integer, default=0)
    value_lakh: Mapped[float] = mapped_column(Float, default=0.0)
    open_interest: Mapped[int] = mapped_column(Integer, default=0)
    change_in_oi: Mapped[int] = mapped_column(Integer, default=0)


class PortfolioMutualFundHolding(Base):
    __tablename__ = "portfolio_mutual_funds"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    scheme_code: Mapped[int] = mapped_column(Integer, index=True)
    scheme_name: Mapped[str] = mapped_column(String(256), index=True)
    fund_house: Mapped[str] = mapped_column(String(128), default="")
    category: Mapped[str] = mapped_column(String(128), default="")
    units: Mapped[float] = mapped_column(Float)
    avg_nav: Mapped[float] = mapped_column(Float)
    xirr: Mapped[float | None] = mapped_column(Float, nullable=True)
    sip_transactions: Mapped[str] = mapped_column(Text, default="[]")
    added_at: Mapped[str] = mapped_column(String(40), default=lambda: datetime.utcnow().isoformat())


class AlertConditionType(str, enum.Enum):
    PRICE_ABOVE = "price_above"
    PRICE_BELOW = "price_below"
    PCT_CHANGE = "pct_change"
    VOLUME_SPIKE = "volume_spike"
    INDICATOR_CROSSOVER = "indicator_crossover"
    CUSTOM_EXPRESSION = "custom_expression"


class AlertStatus(str, enum.Enum):
    ACTIVE = "active"
    TRIGGERED = "triggered"
    EXPIRED = "expired"
    PAUSED = "paused"
    DELETED = "deleted"


class AlertORM(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    condition_type: Mapped[AlertConditionType] = mapped_column(String(32), index=True)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[AlertStatus] = mapped_column(String(16), index=True, default=AlertStatus.ACTIVE.value)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cooldown_seconds: Mapped[int] = mapped_column(Integer, default=0)
    last_triggered_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_notification_error: Mapped[str | None] = mapped_column(String(512), nullable=True)


class AlertTriggerORM(Base):
    __tablename__ = "alert_triggers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    alert_id: Mapped[str] = mapped_column(String(36), ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    condition_type: Mapped[str] = mapped_column(String(32), index=True)
    triggered_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class ScanPresetORM(Base):
    __tablename__ = "scan_presets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    universe: Mapped[str] = mapped_column(String(64), index=True)
    timeframe: Mapped[str] = mapped_column(String(16), default="1d")
    liquidity_gate_json: Mapped[dict] = mapped_column(JSON, default=dict)
    rules_json: Mapped[list] = mapped_column(JSON, default=list)
    ranking_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ScanRunORM(Base):
    __tablename__ = "scan_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    preset_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scan_presets.id", ondelete="SET NULL"), nullable=True, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="running", index=True)
    meta_json: Mapped[dict] = mapped_column(JSON, default=dict)
    summary_json: Mapped[dict] = mapped_column(JSON, default=dict)


class ScanResultORM(Base):
    __tablename__ = "scan_results"
    __table_args__ = (UniqueConstraint("run_id", "symbol", "setup_type", name="uq_scan_result_run_symbol_setup"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("scan_runs.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    setup_type: Mapped[str] = mapped_column(String(64), index=True)
    score: Mapped[float] = mapped_column(Float, default=0.0, index=True)
    signal_ts: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    levels_json: Mapped[dict] = mapped_column(JSON, default=dict)
    features_json: Mapped[dict] = mapped_column(JSON, default=dict)
    explain_json: Mapped[dict] = mapped_column(JSON, default=dict)


class ScanAlertRuleORM(Base):
    __tablename__ = "scan_alert_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    preset_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scan_presets.id", ondelete="SET NULL"), nullable=True, index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    setup_type: Mapped[str] = mapped_column(String(64), index=True)
    trigger_level: Mapped[float] = mapped_column(Float, default=0.0)
    invalidation_level: Mapped[float | None] = mapped_column(Float, nullable=True)
    near_trigger_pct: Mapped[float] = mapped_column(Float, default=0.003)
    dedupe_minutes: Mapped[int] = mapped_column(Integer, default=15)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    last_event_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    meta_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class UserScreenORM(Base):
    __tablename__ = "user_screens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    query: Mapped[str] = mapped_column(Text, default="")
    columns_config: Mapped[list] = mapped_column(JSON, default=list)
    viz_config: Mapped[dict] = mapped_column(JSON, default=dict)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    upvotes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class DataVersionORM(Base):
    __tablename__ = "data_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(128), index=True)
    description: Mapped[str] = mapped_column(String(512), default="")
    source: Mapped[str] = mapped_column(String(64), default="internal")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class CorpActionORM(Base):
    __tablename__ = "corp_actions"
    __table_args__ = (UniqueConstraint("symbol", "action_date", "action_type", name="uq_corp_action_symbol_date_type"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    action_date: Mapped[str] = mapped_column(String(16), index=True)
    action_type: Mapped[str] = mapped_column(String(32), index=True)
    factor: Mapped[float] = mapped_column(Float, default=1.0)
    amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(String(512), default="")
    data_version_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("data_versions.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class PriceEodORM(Base):
    __tablename__ = "prices_eod"
    __table_args__ = (UniqueConstraint("symbol", "trade_date", "data_version_id", name="uq_prices_eod_symbol_date_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    trade_date: Mapped[str] = mapped_column(String(16), index=True)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float, default=0.0)
    data_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("data_versions.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class FundamentalsPitORM(Base):
    __tablename__ = "fundamentals_pit"
    __table_args__ = (UniqueConstraint("symbol", "metric", "as_of_date", "data_version_id", name="uq_fund_pit_symbol_metric_date_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    metric: Mapped[str] = mapped_column(String(64), index=True)
    value: Mapped[float] = mapped_column(Float)
    as_of_date: Mapped[str] = mapped_column(String(16), index=True)
    effective_from: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    effective_to: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    data_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("data_versions.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class UniverseMembershipORM(Base):
    __tablename__ = "universe_membership"
    __table_args__ = (UniqueConstraint("universe_id", "symbol", "start_date", "data_version_id", name="uq_universe_symbol_start_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    universe_id: Mapped[str] = mapped_column(String(64), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    start_date: Mapped[str] = mapped_column(String(16), index=True)
    end_date: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    data_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("data_versions.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class OmsOrderORM(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    side: Mapped[str] = mapped_column(String(8), index=True)
    quantity: Mapped[float] = mapped_column(Float)
    order_type: Mapped[str] = mapped_column(String(16), default="market")
    limit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="accepted", index=True)
    rejection_reason: Mapped[str | None] = mapped_column(String(512), nullable=True)
    meta_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class OmsFillORM(Base):
    __tablename__ = "fills"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    quantity: Mapped[float] = mapped_column(Float)
    fill_price: Mapped[float] = mapped_column(Float)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class RestrictedListORM(Base):
    __tablename__ = "restricted_list"
    __table_args__ = (UniqueConstraint("symbol", name="uq_restricted_symbol"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    reason: Mapped[str] = mapped_column(String(256), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class AuditLogORM(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ModelRegistryORM(Base):
    __tablename__ = "model_registry"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(160), index=True)
    run_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("model_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    stage: Mapped[str] = mapped_column(String(16), default="staging", index=True)
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class OpsKillSwitchORM(Base):
    __tablename__ = "ops_kill_switches"
    __table_args__ = (UniqueConstraint("scope", name="uq_kill_switch_scope"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    scope: Mapped[str] = mapped_column(String(64), index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reason: Mapped[str] = mapped_column(String(512), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class VirtualSide(str, enum.Enum):
    LONG = "long"
    SHORT = "short"
    BUY = "buy"
    SELL = "sell"


class VirtualOrderType(str, enum.Enum):
    MARKET = "market"
    LIMIT = "limit"
    SL = "sl"


class VirtualOrderStatus(str, enum.Enum):
    PENDING = "pending"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class VirtualPortfolio(Base):
    __tablename__ = "virtual_portfolios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128), default="Paper Portfolio")
    initial_capital: Mapped[float] = mapped_column(Float)
    current_cash: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class VirtualPosition(Base):
    __tablename__ = "virtual_positions"
    __table_args__ = (
        UniqueConstraint("portfolio_id", "symbol", name="uq_virtual_position_portfolio_symbol"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    portfolio_id: Mapped[str] = mapped_column(String(36), ForeignKey("virtual_portfolios.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    avg_entry_price: Mapped[float] = mapped_column(Float, default=0.0)
    side: Mapped[str] = mapped_column(String(8), default=VirtualSide.LONG.value)


class VirtualOrder(Base):
    __tablename__ = "virtual_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    portfolio_id: Mapped[str] = mapped_column(String(36), ForeignKey("virtual_portfolios.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    side: Mapped[str] = mapped_column(String(8), index=True)
    order_type: Mapped[str] = mapped_column(String(16), default=VirtualOrderType.MARKET.value, index=True)
    quantity: Mapped[float] = mapped_column(Float)
    limit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    sl_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default=VirtualOrderStatus.PENDING.value, index=True)
    fill_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    fill_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    slippage_bps: Mapped[float] = mapped_column(Float, default=5.0)
    commission: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    signal_metadata: Mapped[dict] = mapped_column(JSON, default=dict)


class VirtualTrade(Base):
    __tablename__ = "virtual_trades"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    order_id: Mapped[str] = mapped_column(String(36), ForeignKey("virtual_orders.id", ondelete="CASCADE"), index=True)
    portfolio_id: Mapped[str] = mapped_column(String(36), ForeignKey("virtual_portfolios.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    side: Mapped[str] = mapped_column(String(8), index=True)
    quantity: Mapped[float] = mapped_column(Float)
    price: Mapped[float] = mapped_column(Float)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    pnl_realized: Mapped[float | None] = mapped_column(Float, nullable=True)


class ChartDrawing(Base):
    __tablename__ = "chart_drawings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    tool_type: Mapped[str] = mapped_column(String(32), index=True)
    coordinates: Mapped[dict] = mapped_column(JSON, default=dict)
    style: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChartTemplate(Base):
    __tablename__ = "chart_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    layout_config: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PortfolioORM(Base):
    __tablename__ = "portfolios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    benchmark_symbol: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    starting_cash: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class PortfolioHoldingORM(Base):
    __tablename__ = "portfolio_holdings"
    __table_args__ = (
        UniqueConstraint("portfolio_id", "symbol", "lot_id", name="uq_portfolio_holding_portfolio_symbol_lot"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    portfolio_id: Mapped[str] = mapped_column(String(36), ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    shares: Mapped[float] = mapped_column(Float, default=0.0)
    cost_basis_per_share: Mapped[float] = mapped_column(Float, default=0.0)
    purchase_date: Mapped[str] = mapped_column(String(16), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    lot_id: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class PortfolioTransactionORM(Base):
    __tablename__ = "portfolio_transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    portfolio_id: Mapped[str] = mapped_column(String(36), ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(64), index=True)
    type: Mapped[str] = mapped_column(String(16), index=True)  # buy|sell|dividend
    shares: Mapped[float] = mapped_column(Float, default=0.0)
    price: Mapped[float] = mapped_column(Float, default=0.0)
    date: Mapped[str] = mapped_column(String(16), index=True)
    fees: Mapped[float] = mapped_column(Float, default=0.0)
    lot_id: Mapped[str] = mapped_column(String(64), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class UserLayoutORM(Base):
    __tablename__ = "user_layouts"
    __table_args__ = (UniqueConstraint("user_key", name="uq_user_layouts_user_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_key: Mapped[str] = mapped_column(String(64), index=True)
    layouts_json: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
