# API V1

## Equity

### GET `/api/v1/equity/company/{symbol}/performance`

Returns summary performance metrics for a symbol:

- `period_changes_pct`: percent change for `1D`, `1W`, `1M`, `3M`, `6M`, `1Y`
- `max_up_move_pct`: largest daily percent gain over trailing 1Y window
- `max_down_move_pct`: largest daily percent drop over trailing 1Y window
- `day_range`: latest session high/low
- `range_52w`: trailing 52-week high/low

Example response:

```json
{
  "symbol": "RELIANCE",
  "period_changes_pct": {
    "1D": 0.42,
    "1W": 1.71,
    "1M": 3.15,
    "3M": 5.08,
    "6M": 9.22,
    "1Y": 14.93
  },
  "max_up_move_pct": 7.33,
  "max_down_move_pct": -5.04,
  "day_range": {
    "low": 2892.1,
    "high": 2943.7
  },
  "range_52w": {
    "low": 2351.6,
    "high": 3022.0
  }
}
```

### GET `/api/v1/equity/company/{symbol}/promoter-holdings`

Returns promoter/institution/public shareholding history for the symbol.

Example response:

```json
{
  "symbol": "RELIANCE",
  "history": [
    { "date": "2025-Q1", "promoter": 50.1, "fii": 18.9, "dii": 13.8, "public": 17.2 },
    { "date": "2025-Q2", "promoter": 50.2, "fii": 19.1, "dii": 13.7, "public": 17.0 }
  ],
  "warning": null
}
```

### GET `/api/v1/equity/company/{symbol}/delivery-series?interval=1d&range=1y`

Returns derived delivery percentage series aligned with candle history.

Response fields:

- `date`
- `close`
- `volume`
- `delivery_pct`

### GET `/api/v1/equity/company/{symbol}/capex-tracker`

Returns annual capex points with `source`:

- `reported`: pulled from provider financial statements
- `estimated`: derived fallback when reported capex is unavailable

### GET `/api/v1/equity/overview/top-tickers`

Returns top-bar indicators for:

- crude
- gold
- silver

## Indicators

### GET `/api/v1/indicators/registry`

Returns available indicator definitions and default parameter schema.

### POST `/api/v1/indicators/compute`

Computes indicator series for `symbol` with payload:

- `indicator`
- `interval`
- `range`
- `market_type` (`equity` or `fno`)
- `params`

## Crypto

### GET `/api/v1/crypto/search?q=btc`

Searches supported crypto instruments.

### GET `/api/v1/crypto/candles?symbol=BTC-USD&interval=1d&range=1y`

Returns crypto OHLCV candles in the shared chart response format.

## Scripting

### POST `/api/v1/scripting/python/execute`

Executes sandboxed Python code with:

- timeout enforcement (`timeout_seconds`)
- blocked imports (`os`, `sys`, `subprocess`, `socket`, `pathlib`, `shutil`, `ctypes`, `importlib`)

### GET `/api/chart/{ticker}?interval=1d&range=1y&limit=300&cursor=...`

Chart endpoint now supports pagination for candle backfill:

- `limit`: max candles returned for this request
- `cursor`: unix timestamp; returns candles strictly older than cursor
- `meta.pagination.cursor`: next cursor to request older candles
- `meta.pagination.has_more`: whether older candles remain
