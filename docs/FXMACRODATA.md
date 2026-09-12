# FXMacroData for OpenTerminalUI

The Economic Terminal calendar and macro dashboard consume real FXMacroData USD releases and observations. The Data Explorer displays every supported operation, its parameter schema, a tabular record view and the original response. All displayed calendar times are UTC. Missing data is explicitly unavailable.

The core integration uses [FXMacroData](https://fxmacrodata.com/?utm_source=github&utm_medium=referral&utm_campaign=open_source_integrations&utm_content=openterminalui_readme) always-free public USD endpoints and requires no API key, account or credit card. Public indicator history currently covers the most recent 90 days; catalogue and release-calendar access also work without a key. Optional authenticated coverage follows the API contract.

## Installation

The integration is included in the application dependencies. Install them using the project's normal command:

```sh
python -m pip install -r backend/requirements.txt
```

Public USD data requires no API key. Optional authorization is configured below.

## Use

Optional OPENTERMINALUI_FXMACRODATA_API_KEY (or FXMACRODATA_API_KEY) is loaded by server settings as SecretStr and excluded from settings serialization. It is never sent to the browser. Default dashboard and calendar views cover USD. Other supported currencies and datasets are available in Data Explorer with the required authorization. Unknown importance remains unknown; observation-period dates never substitute for release timestamps; consensus is not replaced by model forecasts. Macro dashboard units come from the public catalogue when indicator history does not carry unit metadata; both original payloads remain available. If metadata is unavailable, the adapter leaves the unit unspecified. This replaces the old economic-service synthetic fallback.

Start with `data_catalogue` and parameters `{"currency":"USD"}`, then `indicator_history` with `{"currency":"USD","indicator":"policy_rate","limit":5}` or `release_calendar` with `{"currency":"USD"}`. Agent tool names have an `fxmacrodata_` prefix. The operation catalogue includes exact required parameters and supported options.

The `data` field preserves the original public response; `records` is an additive table view. Keep source fields, assumed-time flags and timezone offsets when using the data. The API contract distinguishes official forecasts, market consensus and FXMacroData-generated outputs. Historical observation filters do not by themselves establish point-in-time vintage safety. Streaming is bounded by the client; it is not a persistent subscription.

[Public API reference](https://fxmacrodata.com/documentation/reference?utm_source=github&utm_medium=referral&utm_campaign=open_source_integrations&utm_content=openterminalui_docs)

## Coverage

Every documented REST operation and listed hosted MCP tool is available through the native consumer above. Access requirements depend on the operation and currency. MCP tools, non-USD data and other protected datasets may require authorization; they are not required for the public USD baseline.

| Operation | Transport | Native consumer | Status |
| --- | --- | --- | --- |
| `health` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `ping` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `forex` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `intraday_reference_rates` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `fx_sources` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `fx_source_universe` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `data_catalogue` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `release_calendar` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `market_sessions` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `rate_differentials` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `curves` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `financial_prices` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `press_releases` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `risk_sentiment` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `factors` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `event_predictions` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `latest_announcements` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `indicator_history` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `cot` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `latest_commodities` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `commodities` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `announcement_changes` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `stream_events` | GET | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_ping` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_mcp_capabilities` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_mcp_auth_guide` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_subscribe_for_mcp_access` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_data_catalogue` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_risk_sentiment` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_macro_news` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_release_calendar` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_release_calendar_visual_artifact` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_event_predictions` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_latest_announcements` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_announcement_changes` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_press_releases` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_macro_factor` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_fx_reference_sources` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_fx_reference_universe` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_fx_intraday_reference_rates` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_rate_curve` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_rate_differentials` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_latest_commodities` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_forex` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_seasonality` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_indicator_query` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_plot_visual_artifact` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_indicator_visual_artifact` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_forex_visual_artifact` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_commodities_visual_artifact` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_cot_visual_artifact` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_policy_rate_differential_visual_artifact` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_macro_briefing_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_indicator_intel_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_pair_intel_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_macro_heatmap_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_policy_scenario_modeler_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_macro_war_room_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_event_impact_replay_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_quant_scenario_lab_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_known_at_time_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_macro_regime_classifier_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_release_risk_score_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_portfolio_risk_engine_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_fx_trade_setup_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_fx_backtest_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_macro_research_pack_task` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_market_sessions` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_cot_data` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_commodities` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_financial_prices` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |
| `mcp_official_dataset_family` | MCP | `backend/services/fxmacrodata_economics.py` | Implemented |

## Validation

Offline tests exercise every operation's native registration and record consumption plus the target-specific report, regional brief or economics route behavior.

```sh
python -m pytest backend/tests/test_fxmacrodata_economics.py -o addopts= -q -n 8 --dist load
```

These focused tests do not replace the target project's full CI gate. No live credentials or private datasets are fixtures.

## Attribution

Rob Tidball owns FXMacroData and maintains this adapter. Website links identify the provider; campaign parameters distinguish repository documentation visits from integration application visits. API/MCP requests have no campaign parameters, and the adapter sends no click telemetry.
