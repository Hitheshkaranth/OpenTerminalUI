# FXMacroData for OpenTerminalUI

FXMacroData is the **free, no-key tier** of the Economic Terminal's provider chain. A fresh install shows real USD releases and observations without any configuration; keyed providers add richer data on top when configured:

| View | Provider order |
| --- | --- |
| Calendar | Finnhub (key) → FMP (key) → **FXMacroData (free, USD)** → built-in sample data |
| Macro dashboard | FRED (key; US/IN/EU/CN) merged with **FXMacroData (free, US)** → built-in sample data |

Results are cached (calendar 1h, indicators 4h) in `backend/services/economic_data.py`. FXMacroData US indicators are mapped onto the FRED labels (`policy_rate→rate`, `inflation→cpi`) so each concept appears once; FRED wins on overlap. The Data Explorer tab exposes the public **REST** operation catalogue (parameter schema, tabular records, original response). Hosted MCP tools are not exposed. All displayed calendar times are UTC. Missing data is explicitly unavailable.

Note: the public tier's release calendar does not carry actual/forecast/previous values, and indicator history is limited to the recent public window (a few observations). Configure Finnhub/FMP/FRED keys for those.

The core integration uses [FXMacroData](https://fxmacrodata.com/?utm_source=github&utm_medium=referral&utm_campaign=open_source_integrations&utm_content=openterminalui_readme) always-free public USD endpoints and requires no API key, account or credit card. Public indicator history currently covers the most recent 90 days; catalogue and release-calendar access also work without a key. Optional authenticated coverage follows the API contract.

## Installation

The integration is included in the application dependencies. Install them using the project's normal command:

```sh
python -m pip install -r backend/requirements.txt
```

Public USD data requires no API key. Optional authorization is configured below.

## Use

Optional OPENTERMINALUI_FXMACRODATA_API_KEY (or FXMACRODATA_API_KEY) is loaded by server settings as SecretStr and excluded from settings serialization. It is never sent to the browser. Default dashboard and calendar views cover USD. Other supported currencies and datasets are available in Data Explorer with the required authorization. Unknown importance remains unknown; observation-period dates never substitute for release timestamps; consensus is not replaced by model forecasts. Macro dashboard units come from the public catalogue when indicator history does not carry unit metadata; both original payloads remain available. If metadata is unavailable, the adapter leaves the unit unspecified.

Start with `data_catalogue` and parameters `{"currency":"USD"}`, then `indicator_history` with `{"currency":"USD","indicator":"policy_rate","limit":5}` or `release_calendar` with `{"currency":"USD"}`. The operation catalogue includes exact required parameters and supported options.

The `data` field preserves the original public response; `records` is an additive table view. Keep source fields, assumed-time flags and timezone offsets when using the data. The API contract distinguishes official forecasts, market consensus and FXMacroData-generated outputs. Historical observation filters do not by themselves establish point-in-time vintage safety. Streaming is bounded by the client; it is not a persistent subscription.

[Public API reference](https://fxmacrodata.com/documentation/reference?utm_source=github&utm_medium=referral&utm_campaign=open_source_integrations&utm_content=openterminalui_docs)

## Coverage

Every documented public REST operation is available through the Data Explorer (`/api/economics/operations`, `/api/economics/query`). Access requirements depend on the operation and currency; non-USD and other protected datasets may require authorization. Hosted MCP tools are intentionally not exposed.

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

## Validation

Offline tests exercise every operation's native registration and record consumption plus the target-specific report, regional brief or economics route behavior.

```sh
python -m pytest backend/tests/test_fxmacrodata_economics.py -o addopts= -q -n 8 --dist load
```

These focused tests do not replace the target project's full CI gate. No live credentials or private datasets are fixtures.

## Attribution

Rob Tidball owns FXMacroData and maintains this adapter. Website links identify the provider; campaign parameters distinguish repository documentation visits from integration application visits. API/MCP requests have no campaign parameters, and the adapter sends no click telemetry.
