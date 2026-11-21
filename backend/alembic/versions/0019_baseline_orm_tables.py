"""Baseline every ORM table that earlier migrations never created.

Until now these tables only existed via Base.metadata.create_all at app start.
Each create is guarded so installs that already have them (created by the old
bootstrap) upgrade cleanly. Generated from Base.metadata; kept explicit on purpose
(migrations must not import ORM models).
"""
from alembic import op
import sqlalchemy as sa

revision = "0019_baseline_orm_tables"
down_revision = "0018_paper_currency"
branch_labels = None
depends_on = None

# Dependency order (parents before children).
BASELINE_TABLES = (
    'agent_messages',
    'agent_notes',
    'agent_runs',
    'agent_signals',
    'agent_threads',
    'business_metric_points',
    'experiment_artifacts',
    'experiments',
    'filing_analyses',
    'filing_documents',
    'filing_knowledge',
    'filings_watch_events',
    'filings_watch_settings',
    'insider_trades',
    'instrument_master',
    'nse_fno_bhavcopy',
    'portfolio_backtest_jobs',
    'research_items',
    'saved_formulas',
    'tax_lots',
    'user_layouts',
    'value_chain_snapshots',
    'agent_proposals',
    'alerts',
    'api_keys',
    'chart_drawings',
    'chart_templates',
    'filing_chunks',
    'portfolios',
    'research_autopilot_hypotheses',
    'scan_presets',
    'user_screens',
    'virtual_portfolios',
    'watchlists',
    'alert_triggers',
    'portfolio_holdings',
    'portfolio_transactions',
    'research_autopilot_runs',
    'scan_alert_rules',
    'scan_runs',
    'virtual_orders',
    'virtual_positions',
    'scan_results',
    'virtual_trades',
)


def upgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    def _has(name: str) -> bool:
        return name in existing

    if not _has('agent_messages'):
        op.create_table('agent_messages',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('thread_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('run_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_agent_messages_role'), 'agent_messages', ['role'], unique=False)
        op.create_index(op.f('ix_agent_messages_thread_id'), 'agent_messages', ['thread_id'], unique=False)
        op.create_index(op.f('ix_agent_messages_user_id'), 'agent_messages', ['user_id'], unique=False)

    if not _has('agent_notes'):
        op.create_table('agent_notes',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=True),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('source', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_agent_notes_kind'), 'agent_notes', ['kind'], unique=False)
        op.create_index(op.f('ix_agent_notes_symbol'), 'agent_notes', ['symbol'], unique=False)
        op.create_index(op.f('ix_agent_notes_user_id'), 'agent_notes', ['user_id'], unique=False)

    if not _has('agent_runs'):
        op.create_table('agent_runs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('thread_id', sa.String(length=36), nullable=True),
        sa.Column('mode', sa.String(length=32), nullable=False),
        sa.Column('prompt', sa.Text(), nullable=False),
        sa.Column('final', sa.Text(), nullable=True),
        sa.Column('grounding_json', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_agent_runs_status'), 'agent_runs', ['status'], unique=False)
        op.create_index(op.f('ix_agent_runs_thread_id'), 'agent_runs', ['thread_id'], unique=False)
        op.create_index(op.f('ix_agent_runs_user_id'), 'agent_runs', ['user_id'], unique=False)

    if not _has('agent_signals'):
        op.create_table('agent_signals',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('run_id', sa.String(length=64), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('persona', sa.String(length=32), nullable=False),
        sa.Column('signal', sa.String(length=16), nullable=False),
        sa.Column('confidence', sa.Integer(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('price_at_signal', sa.Float(), nullable=True),
        sa.Column('created_at', sa.String(length=40), nullable=False),
        sa.Column('evaluated_at', sa.String(length=40), nullable=True),
        sa.Column('horizon_days', sa.Integer(), nullable=True),
        sa.Column('realized_return_pct', sa.Float(), nullable=True),
        sa.Column('benchmark_return_pct', sa.Float(), nullable=True),
        sa.Column('correct', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_agent_signals_persona'), 'agent_signals', ['persona'], unique=False)
        op.create_index(op.f('ix_agent_signals_run_id'), 'agent_signals', ['run_id'], unique=False)
        op.create_index(op.f('ix_agent_signals_signal'), 'agent_signals', ['signal'], unique=False)
        op.create_index(op.f('ix_agent_signals_symbol'), 'agent_signals', ['symbol'], unique=False)
        op.create_index(op.f('ix_agent_signals_user_id'), 'agent_signals', ['user_id'], unique=False)

    if not _has('agent_threads'):
        op.create_table('agent_threads',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=256), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_agent_threads_user_id'), 'agent_threads', ['user_id'], unique=False)

    if not _has('business_metric_points'):
        op.create_table('business_metric_points',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(length=32), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('key', sa.String(length=120), nullable=False),
        sa.Column('label', sa.String(length=200), nullable=False),
        sa.Column('unit', sa.String(length=40), nullable=True),
        sa.Column('category', sa.String(length=32), nullable=True),
        sa.Column('dimension', sa.String(length=32), nullable=True),
        sa.Column('name', sa.String(length=200), nullable=True),
        sa.Column('period', sa.String(length=40), nullable=True),
        sa.Column('value', sa.Float(), nullable=True),
        sa.Column('share_pct', sa.Float(), nullable=True),
        sa.Column('document_id', sa.String(length=64), nullable=True),
        sa.Column('page_start', sa.Integer(), nullable=True),
        sa.Column('page_end', sa.Integer(), nullable=True),
        sa.Column('section', sa.String(length=160), nullable=True),
        sa.Column('quote', sa.Text(), nullable=True),
        sa.Column('title', sa.String(length=300), nullable=True),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index('idx_biz_symbol_kind', 'business_metric_points', ['symbol', 'kind'], unique=False)
        op.create_index(op.f('ix_business_metric_points_key'), 'business_metric_points', ['key'], unique=False)
        op.create_index(op.f('ix_business_metric_points_kind'), 'business_metric_points', ['kind'], unique=False)
        op.create_index(op.f('ix_business_metric_points_symbol'), 'business_metric_points', ['symbol'], unique=False)

    if not _has('experiment_artifacts'):
        op.create_table('experiment_artifacts',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('experiment_id', sa.Integer(), nullable=True),
        sa.Column('artifact_type', sa.String(), nullable=True),
        sa.Column('storage_path', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_experiment_artifacts_experiment_id'), 'experiment_artifacts', ['experiment_id'], unique=False)

    if not _has('experiments'):
        op.create_table('experiments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('config_json', sa.JSON(), nullable=True),
        sa.Column('data_hash', sa.String(), nullable=True),
        sa.Column('code_hash', sa.String(), nullable=True),
        sa.Column('metrics_json', sa.JSON(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_experiments_name'), 'experiments', ['name'], unique=False)

    if not _has('filing_analyses'):
        op.create_table('filing_analyses',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(length=32), nullable=False),
        sa.Column('engine', sa.String(length=16), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_filing_analyses_symbol'), 'filing_analyses', ['symbol'], unique=False)

    if not _has('filing_documents'):
        op.create_table('filing_documents',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(length=32), nullable=False),
        sa.Column('market', sa.String(length=16), nullable=False),
        sa.Column('doc_type', sa.String(length=32), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('period', sa.String(length=40), nullable=True),
        sa.Column('source', sa.String(length=16), nullable=False),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('filed_at', sa.String(length=32), nullable=True),
        sa.Column('pages', sa.Integer(), nullable=False),
        sa.Column('chunks', sa.Integer(), nullable=False),
        sa.Column('chars', sa.Integer(), nullable=False),
        sa.Column('sha256', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('symbol', 'sha256', name='uq_filing_documents_symbol_sha')
        )
        op.create_index(op.f('ix_filing_documents_symbol'), 'filing_documents', ['symbol'], unique=False)

    if not _has('filing_knowledge'):
        op.create_table('filing_knowledge',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(length=32), nullable=False),
        sa.Column('engine', sa.String(length=16), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_filing_knowledge_symbol'), 'filing_knowledge', ['symbol'], unique=False)

    if not _has('filings_watch_events'):
        op.create_table('filings_watch_events',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=32), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('action_url', sa.String(length=500), nullable=True),
        sa.Column('at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_filings_watch_events_at'), 'filings_watch_events', ['at'], unique=False)
        op.create_index(op.f('ix_filings_watch_events_kind'), 'filings_watch_events', ['kind'], unique=False)
        op.create_index(op.f('ix_filings_watch_events_symbol'), 'filings_watch_events', ['symbol'], unique=False)
        op.create_index(op.f('ix_filings_watch_events_user_id'), 'filings_watch_events', ['user_id'], unique=False)

    if not _has('filings_watch_settings'):
        op.create_table('filings_watch_settings',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('settings', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_filings_watch_settings_user')
        )
        op.create_index(op.f('ix_filings_watch_settings_user_id'), 'filings_watch_settings', ['user_id'], unique=False)

    if not _has('insider_trades'):
        op.create_table('insider_trades',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(length=32), nullable=False),
        sa.Column('insider_name', sa.String(length=128), nullable=False),
        sa.Column('insider_title', sa.String(length=128), nullable=True),
        sa.Column('transaction_type', sa.String(length=32), nullable=False),
        sa.Column('shares', sa.Integer(), nullable=False),
        sa.Column('price', sa.Float(), nullable=True),
        sa.Column('value', sa.Float(), nullable=True),
        sa.Column('date', sa.DateTime(), nullable=False),
        sa.Column('filing_date', sa.DateTime(), nullable=False),
        sa.Column('source', sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_insider_trades_date'), 'insider_trades', ['date'], unique=False)
        op.create_index(op.f('ix_insider_trades_filing_date'), 'insider_trades', ['filing_date'], unique=False)
        op.create_index(op.f('ix_insider_trades_id'), 'insider_trades', ['id'], unique=False)
        op.create_index(op.f('ix_insider_trades_symbol'), 'insider_trades', ['symbol'], unique=False)

    if not _has('instrument_master'):
        op.create_table('instrument_master',
        sa.Column('canonical_id', sa.String(), nullable=False),
        sa.Column('display_symbol', sa.String(), nullable=True),
        sa.Column('type', sa.String(), nullable=True),
        sa.Column('exchange', sa.String(), nullable=True),
        sa.Column('currency', sa.String(), nullable=True),
        sa.Column('tick_size', sa.String(), nullable=True),
        sa.Column('lot_size', sa.String(), nullable=True),
        sa.Column('vendor_mappings_json', sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint('canonical_id')
        )
        op.create_index(op.f('ix_instrument_master_display_symbol'), 'instrument_master', ['display_symbol'], unique=False)

    if not _has('nse_fno_bhavcopy'):
        op.create_table('nse_fno_bhavcopy',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trade_date', sa.String(length=16), nullable=False),
        sa.Column('instrument', sa.String(length=16), nullable=False),
        sa.Column('symbol', sa.String(length=32), nullable=False),
        sa.Column('expiry_date', sa.String(length=16), nullable=False),
        sa.Column('strike_price', sa.Float(), nullable=False),
        sa.Column('option_type', sa.String(length=8), nullable=False),
        sa.Column('open_price', sa.Float(), nullable=False),
        sa.Column('high_price', sa.Float(), nullable=False),
        sa.Column('low_price', sa.Float(), nullable=False),
        sa.Column('close_price', sa.Float(), nullable=False),
        sa.Column('settle_price', sa.Float(), nullable=False),
        sa.Column('contracts', sa.Integer(), nullable=False),
        sa.Column('value_lakh', sa.Float(), nullable=False),
        sa.Column('open_interest', sa.Integer(), nullable=False),
        sa.Column('change_in_oi', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('trade_date', 'symbol', 'expiry_date', 'option_type', 'strike_price', name='uq_nse_fno_bhavcopy_key')
        )
        op.create_index(op.f('ix_nse_fno_bhavcopy_expiry_date'), 'nse_fno_bhavcopy', ['expiry_date'], unique=False)
        op.create_index(op.f('ix_nse_fno_bhavcopy_id'), 'nse_fno_bhavcopy', ['id'], unique=False)
        op.create_index(op.f('ix_nse_fno_bhavcopy_instrument'), 'nse_fno_bhavcopy', ['instrument'], unique=False)
        op.create_index(op.f('ix_nse_fno_bhavcopy_symbol'), 'nse_fno_bhavcopy', ['symbol'], unique=False)
        op.create_index(op.f('ix_nse_fno_bhavcopy_trade_date'), 'nse_fno_bhavcopy', ['trade_date'], unique=False)

    if not _has('portfolio_backtest_jobs'):
        op.create_table('portfolio_backtest_jobs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column('request_json', sa.JSON(), nullable=True),
        sa.Column('result_json', sa.JSON(), nullable=True),
        sa.Column('error', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_portfolio_backtest_jobs_id'), 'portfolio_backtest_jobs', ['id'], unique=False)

    if not _has('research_items'):
        op.create_table('research_items',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('source', sa.String(length=32), nullable=False),
        sa.Column('external_id', sa.String(length=128), nullable=False),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('authors', sa.Text(), nullable=False),
        sa.Column('abstract', sa.Text(), nullable=False),
        sa.Column('url', sa.String(length=512), nullable=False),
        sa.Column('categories', sa.Text(), nullable=False),
        sa.Column('published_at', sa.String(length=32), nullable=False),
        sa.Column('full_text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_research_items_external_id'), 'research_items', ['external_id'], unique=True)
        op.create_index(op.f('ix_research_items_source'), 'research_items', ['source'], unique=False)

    if not _has('saved_formulas'):
        op.create_table('saved_formulas',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('formula', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_saved_formulas_created_at'), 'saved_formulas', ['created_at'], unique=False)
        op.create_index(op.f('ix_saved_formulas_id'), 'saved_formulas', ['id'], unique=False)
        op.create_index(op.f('ix_saved_formulas_name'), 'saved_formulas', ['name'], unique=False)

    if not _has('tax_lots'):
        op.create_table('tax_lots',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('ticker', sa.String(length=32), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('remaining_quantity', sa.Float(), nullable=False),
        sa.Column('buy_price', sa.Float(), nullable=False),
        sa.Column('buy_date', sa.String(length=16), nullable=False),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_tax_lots_buy_date'), 'tax_lots', ['buy_date'], unique=False)
        op.create_index(op.f('ix_tax_lots_id'), 'tax_lots', ['id'], unique=False)
        op.create_index(op.f('ix_tax_lots_ticker'), 'tax_lots', ['ticker'], unique=False)

    if not _has('user_layouts'):
        op.create_table('user_layouts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_key', sa.String(length=64), nullable=False),
        sa.Column('layouts_json', sa.JSON(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_key', name='uq_user_layouts_user_key')
        )
        op.create_index(op.f('ix_user_layouts_updated_at'), 'user_layouts', ['updated_at'], unique=False)
        op.create_index(op.f('ix_user_layouts_user_key'), 'user_layouts', ['user_key'], unique=False)

    if not _has('value_chain_snapshots'):
        op.create_table('value_chain_snapshots',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('engine', sa.String(length=16), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('symbol', name='uq_value_chain_snapshot_symbol')
        )
        op.create_index(op.f('ix_value_chain_snapshots_symbol'), 'value_chain_snapshots', ['symbol'], unique=False)

    if not _has('agent_proposals'):
        op.create_table('agent_proposals',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('run_id', sa.String(length=36), nullable=True),
        sa.Column('type', sa.String(length=32), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('summary', sa.String(length=256), nullable=False),
        sa.Column('rationale', sa.String(length=512), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('decided_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_agent_proposals_run_id'), 'agent_proposals', ['run_id'], unique=False)
        op.create_index(op.f('ix_agent_proposals_status'), 'agent_proposals', ['status'], unique=False)
        op.create_index(op.f('ix_agent_proposals_type'), 'agent_proposals', ['type'], unique=False)
        op.create_index(op.f('ix_agent_proposals_user_id'), 'agent_proposals', ['user_id'], unique=False)

    if not _has('alerts'):
        op.create_table('alerts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('condition_type', sa.String(length=32), nullable=False),
        sa.Column('parameters', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('triggered_at', sa.DateTime(), nullable=True),
        sa.Column('cooldown_seconds', sa.Integer(), nullable=False),
        sa.Column('conditions', sa.JSON(), nullable=False),
        sa.Column('logic', sa.String(length=5), nullable=False),
        sa.Column('delivery_channels', sa.JSON(), nullable=False),
        sa.Column('delivery_config', sa.JSON(), nullable=False),
        sa.Column('cooldown_minutes', sa.Integer(), nullable=False),
        sa.Column('last_triggered_at', sa.DateTime(), nullable=True),
        sa.Column('expiry_date', sa.DateTime(), nullable=True),
        sa.Column('max_triggers', sa.Integer(), nullable=False),
        sa.Column('trigger_count', sa.Integer(), nullable=False),
        sa.Column('last_triggered_value', sa.Float(), nullable=True),
        sa.Column('last_notification_error', sa.String(length=512), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_alerts_condition_type'), 'alerts', ['condition_type'], unique=False)
        op.create_index(op.f('ix_alerts_status'), 'alerts', ['status'], unique=False)
        op.create_index(op.f('ix_alerts_symbol'), 'alerts', ['symbol'], unique=False)
        op.create_index(op.f('ix_alerts_user_id'), 'alerts', ['user_id'], unique=False)

    if not _has('api_keys'):
        op.create_table('api_keys',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('key_prefix', sa.String(length=12), nullable=False),
        sa.Column('key_hash', sa.String(length=256), nullable=False),
        sa.Column('permissions', sa.String(length=20), nullable=False),
        sa.Column('is_active', sa.Integer(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_api_keys_key_prefix'), 'api_keys', ['key_prefix'], unique=False)
        op.create_index(op.f('ix_api_keys_user_id'), 'api_keys', ['user_id'], unique=False)

    if not _has('chart_drawings'):
        op.create_table('chart_drawings',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('tool_type', sa.String(length=32), nullable=False),
        sa.Column('coordinates', sa.JSON(), nullable=False),
        sa.Column('style', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_chart_drawings_symbol'), 'chart_drawings', ['symbol'], unique=False)
        op.create_index(op.f('ix_chart_drawings_tool_type'), 'chart_drawings', ['tool_type'], unique=False)
        op.create_index(op.f('ix_chart_drawings_user_id'), 'chart_drawings', ['user_id'], unique=False)

    if not _has('chart_templates'):
        op.create_table('chart_templates',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('layout_config', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_chart_templates_name'), 'chart_templates', ['name'], unique=False)
        op.create_index(op.f('ix_chart_templates_user_id'), 'chart_templates', ['user_id'], unique=False)

    if not _has('filing_chunks'):
        op.create_table('filing_chunks',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('document_id', sa.Integer(), nullable=False),
        sa.Column('symbol', sa.String(length=32), nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('page_start', sa.Integer(), nullable=False),
        sa.Column('page_end', sa.Integer(), nullable=False),
        sa.Column('section', sa.String(length=160), nullable=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['filing_documents.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_filing_chunks_document_id'), 'filing_chunks', ['document_id'], unique=False)
        op.create_index(op.f('ix_filing_chunks_symbol'), 'filing_chunks', ['symbol'], unique=False)

    if not _has('portfolios'):
        op.create_table('portfolios',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('benchmark_symbol', sa.String(length=32), nullable=True),
        sa.Column('currency', sa.String(length=8), nullable=False),
        sa.Column('starting_cash', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_portfolios_benchmark_symbol'), 'portfolios', ['benchmark_symbol'], unique=False)
        op.create_index(op.f('ix_portfolios_created_at'), 'portfolios', ['created_at'], unique=False)
        op.create_index(op.f('ix_portfolios_name'), 'portfolios', ['name'], unique=False)
        op.create_index(op.f('ix_portfolios_user_id'), 'portfolios', ['user_id'], unique=False)

    if not _has('research_autopilot_hypotheses'):
        op.create_table('research_autopilot_hypotheses',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('statement', sa.Text(), nullable=False),
        sa.Column('spec_json', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=24), nullable=False),
        sa.Column('verdict_json', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_research_autopilot_hypotheses_created_at'), 'research_autopilot_hypotheses', ['created_at'], unique=False)
        op.create_index(op.f('ix_research_autopilot_hypotheses_status'), 'research_autopilot_hypotheses', ['status'], unique=False)
        op.create_index(op.f('ix_research_autopilot_hypotheses_user_id'), 'research_autopilot_hypotheses', ['user_id'], unique=False)

    if not _has('scan_presets'):
        op.create_table('scan_presets',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('universe', sa.String(length=64), nullable=False),
        sa.Column('timeframe', sa.String(length=16), nullable=False),
        sa.Column('liquidity_gate_json', sa.JSON(), nullable=False),
        sa.Column('rules_json', sa.JSON(), nullable=False),
        sa.Column('ranking_json', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_scan_presets_created_at'), 'scan_presets', ['created_at'], unique=False)
        op.create_index(op.f('ix_scan_presets_name'), 'scan_presets', ['name'], unique=False)
        op.create_index(op.f('ix_scan_presets_universe'), 'scan_presets', ['universe'], unique=False)
        op.create_index(op.f('ix_scan_presets_updated_at'), 'scan_presets', ['updated_at'], unique=False)
        op.create_index(op.f('ix_scan_presets_user_id'), 'scan_presets', ['user_id'], unique=False)

    if not _has('user_screens'):
        op.create_table('user_screens',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('query', sa.Text(), nullable=False),
        sa.Column('columns_config', sa.JSON(), nullable=False),
        sa.Column('viz_config', sa.JSON(), nullable=False),
        sa.Column('is_public', sa.Boolean(), nullable=False),
        sa.Column('upvotes', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_user_screens_created_at'), 'user_screens', ['created_at'], unique=False)
        op.create_index(op.f('ix_user_screens_is_public'), 'user_screens', ['is_public'], unique=False)
        op.create_index(op.f('ix_user_screens_name'), 'user_screens', ['name'], unique=False)
        op.create_index(op.f('ix_user_screens_updated_at'), 'user_screens', ['updated_at'], unique=False)
        op.create_index(op.f('ix_user_screens_user_id'), 'user_screens', ['user_id'], unique=False)

    if not _has('virtual_portfolios'):
        op.create_table('virtual_portfolios',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('base_currency', sa.String(length=3), nullable=False),
        sa.Column('initial_capital', sa.Float(), nullable=False),
        sa.Column('current_cash', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_virtual_portfolios_is_active'), 'virtual_portfolios', ['is_active'], unique=False)
        op.create_index(op.f('ix_virtual_portfolios_user_id'), 'virtual_portfolios', ['user_id'], unique=False)

    if not _has('watchlists'):
        op.create_table('watchlists',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('symbols_json', sa.JSON(), nullable=False),
        sa.Column('column_config_json', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_watchlists_name'), 'watchlists', ['name'], unique=False)
        op.create_index(op.f('ix_watchlists_user_id'), 'watchlists', ['user_id'], unique=False)

    if not _has('alert_triggers'):
        op.create_table('alert_triggers',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('alert_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('condition_type', sa.String(length=32), nullable=False),
        sa.Column('triggered_value', sa.Float(), nullable=True),
        sa.Column('context', sa.JSON(), nullable=False),
        sa.Column('triggered_at', sa.DateTime(), nullable=False),
        sa.Column('is_read', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['alert_id'], ['alerts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_alert_triggers_alert_id'), 'alert_triggers', ['alert_id'], unique=False)
        op.create_index(op.f('ix_alert_triggers_condition_type'), 'alert_triggers', ['condition_type'], unique=False)
        op.create_index(op.f('ix_alert_triggers_is_read'), 'alert_triggers', ['is_read'], unique=False)
        op.create_index(op.f('ix_alert_triggers_symbol'), 'alert_triggers', ['symbol'], unique=False)
        op.create_index(op.f('ix_alert_triggers_triggered_at'), 'alert_triggers', ['triggered_at'], unique=False)
        op.create_index(op.f('ix_alert_triggers_user_id'), 'alert_triggers', ['user_id'], unique=False)

    if not _has('portfolio_holdings'):
        op.create_table('portfolio_holdings',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('portfolio_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('shares', sa.Float(), nullable=False),
        sa.Column('cost_basis_per_share', sa.Float(), nullable=False),
        sa.Column('purchase_date', sa.String(length=16), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('lot_id', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['portfolio_id'], ['portfolios.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('portfolio_id', 'symbol', 'lot_id', name='uq_portfolio_holding_portfolio_symbol_lot')
        )
        op.create_index(op.f('ix_portfolio_holdings_created_at'), 'portfolio_holdings', ['created_at'], unique=False)
        op.create_index(op.f('ix_portfolio_holdings_portfolio_id'), 'portfolio_holdings', ['portfolio_id'], unique=False)
        op.create_index(op.f('ix_portfolio_holdings_symbol'), 'portfolio_holdings', ['symbol'], unique=False)

    if not _has('portfolio_transactions'):
        op.create_table('portfolio_transactions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('portfolio_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('type', sa.String(length=16), nullable=False),
        sa.Column('shares', sa.Float(), nullable=False),
        sa.Column('price', sa.Float(), nullable=False),
        sa.Column('date', sa.String(length=16), nullable=False),
        sa.Column('fees', sa.Float(), nullable=False),
        sa.Column('lot_id', sa.String(length=64), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['portfolio_id'], ['portfolios.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_portfolio_transactions_created_at'), 'portfolio_transactions', ['created_at'], unique=False)
        op.create_index(op.f('ix_portfolio_transactions_date'), 'portfolio_transactions', ['date'], unique=False)
        op.create_index(op.f('ix_portfolio_transactions_portfolio_id'), 'portfolio_transactions', ['portfolio_id'], unique=False)
        op.create_index(op.f('ix_portfolio_transactions_symbol'), 'portfolio_transactions', ['symbol'], unique=False)
        op.create_index(op.f('ix_portfolio_transactions_type'), 'portfolio_transactions', ['type'], unique=False)

    if not _has('research_autopilot_runs'):
        op.create_table('research_autopilot_runs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('hypothesis_id', sa.String(length=36), nullable=True),
        sa.Column('user_id', sa.String(length=36), nullable=True),
        sa.Column('status', sa.String(length=24), nullable=False),
        sa.Column('result_json', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['hypothesis_id'], ['research_autopilot_hypotheses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_research_autopilot_runs_created_at'), 'research_autopilot_runs', ['created_at'], unique=False)
        op.create_index(op.f('ix_research_autopilot_runs_hypothesis_id'), 'research_autopilot_runs', ['hypothesis_id'], unique=False)
        op.create_index(op.f('ix_research_autopilot_runs_status'), 'research_autopilot_runs', ['status'], unique=False)
        op.create_index(op.f('ix_research_autopilot_runs_user_id'), 'research_autopilot_runs', ['user_id'], unique=False)

    if not _has('scan_alert_rules'):
        op.create_table('scan_alert_rules',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('preset_id', sa.String(length=36), nullable=True),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('setup_type', sa.String(length=64), nullable=False),
        sa.Column('trigger_level', sa.Float(), nullable=False),
        sa.Column('invalidation_level', sa.Float(), nullable=True),
        sa.Column('near_trigger_pct', sa.Float(), nullable=False),
        sa.Column('dedupe_minutes', sa.Integer(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('last_event_type', sa.String(length=32), nullable=True),
        sa.Column('last_event_at', sa.DateTime(), nullable=True),
        sa.Column('meta_json', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['preset_id'], ['scan_presets.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_scan_alert_rules_created_at'), 'scan_alert_rules', ['created_at'], unique=False)
        op.create_index(op.f('ix_scan_alert_rules_enabled'), 'scan_alert_rules', ['enabled'], unique=False)
        op.create_index(op.f('ix_scan_alert_rules_preset_id'), 'scan_alert_rules', ['preset_id'], unique=False)
        op.create_index(op.f('ix_scan_alert_rules_setup_type'), 'scan_alert_rules', ['setup_type'], unique=False)
        op.create_index(op.f('ix_scan_alert_rules_symbol'), 'scan_alert_rules', ['symbol'], unique=False)
        op.create_index(op.f('ix_scan_alert_rules_updated_at'), 'scan_alert_rules', ['updated_at'], unique=False)
        op.create_index(op.f('ix_scan_alert_rules_user_id'), 'scan_alert_rules', ['user_id'], unique=False)

    if not _has('scan_runs'):
        op.create_table('scan_runs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('preset_id', sa.String(length=36), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=False),
        sa.Column('finished_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('meta_json', sa.JSON(), nullable=False),
        sa.Column('summary_json', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['preset_id'], ['scan_presets.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_scan_runs_finished_at'), 'scan_runs', ['finished_at'], unique=False)
        op.create_index(op.f('ix_scan_runs_preset_id'), 'scan_runs', ['preset_id'], unique=False)
        op.create_index(op.f('ix_scan_runs_started_at'), 'scan_runs', ['started_at'], unique=False)
        op.create_index(op.f('ix_scan_runs_status'), 'scan_runs', ['status'], unique=False)
        op.create_index(op.f('ix_scan_runs_user_id'), 'scan_runs', ['user_id'], unique=False)

    if not _has('virtual_orders'):
        op.create_table('virtual_orders',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('portfolio_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('side', sa.String(length=8), nullable=False),
        sa.Column('order_type', sa.String(length=16), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('limit_price', sa.Float(), nullable=True),
        sa.Column('sl_price', sa.Float(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('fill_price', sa.Float(), nullable=True),
        sa.Column('fill_time', sa.DateTime(), nullable=True),
        sa.Column('slippage_bps', sa.Float(), nullable=False),
        sa.Column('commission', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('signal_metadata', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['portfolio_id'], ['virtual_portfolios.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_virtual_orders_order_type'), 'virtual_orders', ['order_type'], unique=False)
        op.create_index(op.f('ix_virtual_orders_portfolio_id'), 'virtual_orders', ['portfolio_id'], unique=False)
        op.create_index(op.f('ix_virtual_orders_side'), 'virtual_orders', ['side'], unique=False)
        op.create_index(op.f('ix_virtual_orders_status'), 'virtual_orders', ['status'], unique=False)
        op.create_index(op.f('ix_virtual_orders_symbol'), 'virtual_orders', ['symbol'], unique=False)

    if not _has('virtual_positions'):
        op.create_table('virtual_positions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('portfolio_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('avg_entry_price', sa.Float(), nullable=False),
        sa.Column('side', sa.String(length=8), nullable=False),
        sa.ForeignKeyConstraint(['portfolio_id'], ['virtual_portfolios.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('portfolio_id', 'symbol', name='uq_virtual_position_portfolio_symbol')
        )
        op.create_index(op.f('ix_virtual_positions_portfolio_id'), 'virtual_positions', ['portfolio_id'], unique=False)
        op.create_index(op.f('ix_virtual_positions_symbol'), 'virtual_positions', ['symbol'], unique=False)

    if not _has('scan_results'):
        op.create_table('scan_results',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('run_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('setup_type', sa.String(length=64), nullable=False),
        sa.Column('score', sa.Float(), nullable=False),
        sa.Column('signal_ts', sa.DateTime(), nullable=True),
        sa.Column('levels_json', sa.JSON(), nullable=False),
        sa.Column('features_json', sa.JSON(), nullable=False),
        sa.Column('explain_json', sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(['run_id'], ['scan_runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('run_id', 'symbol', 'setup_type', name='uq_scan_result_run_symbol_setup')
        )
        op.create_index(op.f('ix_scan_results_run_id'), 'scan_results', ['run_id'], unique=False)
        op.create_index(op.f('ix_scan_results_score'), 'scan_results', ['score'], unique=False)
        op.create_index(op.f('ix_scan_results_setup_type'), 'scan_results', ['setup_type'], unique=False)
        op.create_index(op.f('ix_scan_results_symbol'), 'scan_results', ['symbol'], unique=False)

    if not _has('virtual_trades'):
        op.create_table('virtual_trades',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('order_id', sa.String(length=36), nullable=False),
        sa.Column('portfolio_id', sa.String(length=36), nullable=False),
        sa.Column('symbol', sa.String(length=64), nullable=False),
        sa.Column('side', sa.String(length=8), nullable=False),
        sa.Column('quantity', sa.Float(), nullable=False),
        sa.Column('price', sa.Float(), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('pnl_realized', sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(['order_id'], ['virtual_orders.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['portfolio_id'], ['virtual_portfolios.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_virtual_trades_order_id'), 'virtual_trades', ['order_id'], unique=False)
        op.create_index(op.f('ix_virtual_trades_portfolio_id'), 'virtual_trades', ['portfolio_id'], unique=False)
        op.create_index(op.f('ix_virtual_trades_side'), 'virtual_trades', ['side'], unique=False)
        op.create_index(op.f('ix_virtual_trades_symbol'), 'virtual_trades', ['symbol'], unique=False)
        op.create_index(op.f('ix_virtual_trades_timestamp'), 'virtual_trades', ['timestamp'], unique=False)


def downgrade():
    # Only drop tables this revision owns; reverse dependency order.
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for name in reversed(BASELINE_TABLES):
        if name in existing:
            op.drop_table(name)
