# TASK: Build Public REST API with API Key Authentication

## Project Context

OpenTerminalUI — FastAPI backend with SQLAlchemy ORM + SQLite. Auth middleware in `backend/core/auth.py`. Routes in `backend/api/routes/`. Models in `backend/models/`. Alembic migrations. Frontend: React 18 + TypeScript. Settings page at `frontend/src/pages/Settings.tsx`. Tests: pytest + Playwright.

## What to Build

### Backend: API Key Model (`backend/models/api_key.py`)

```python
class APIKey(Base):
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, default=1)
    name = Column(String(100), nullable=False)          # user-given label
    key_prefix = Column(String(10), nullable=False)      # first 8 chars for display
    key_hash = Column(String(256), nullable=False)       # bcrypt/sha256 hash of full key
    permissions = Column(String(20), default="read")     # read, read_write
    is_active = Column(Integer, default=1)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
```

Create Alembic migration.

### Backend: API Key Auth (`backend/core/api_key_auth.py`)

```python
import secrets
import hashlib

def generate_api_key() -> tuple[str, str, str]:
    """Generate API key. Returns (full_key, prefix, hash)."""
    raw = secrets.token_urlsafe(32)
    full_key = f"otui_{raw}"
    prefix = full_key[:12]
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    return full_key, prefix, key_hash

def verify_api_key(provided_key: str, stored_hash: str) -> bool:
    return hashlib.sha256(provided_key.encode()).hexdigest() == stored_hash

async def get_api_key_user(request, db):
    """FastAPI dependency: extract and validate X-API-Key header."""
    key = request.headers.get("X-API-Key")
    if not key:
        raise HTTPException(401, "Missing X-API-Key header")
    # Look up by prefix, then verify hash
    prefix = key[:12]
    api_key = db.query(APIKey).filter(APIKey.key_prefix == prefix, APIKey.is_active == 1).first()
    if not api_key or not verify_api_key(key, api_key.key_hash):
        raise HTTPException(401, "Invalid API key")
    # Update last_used_at
    api_key.last_used_at = func.now()
    db.commit()
    return api_key
```

### Backend: Rate Limiter (`backend/core/rate_limiter.py`)

Simple in-memory rate limiter:
- Dict of `{key_prefix: [timestamps]}`
- 100 requests per minute per key
- Return 429 if exceeded
- Clean up old entries periodically

### Backend: API Key Management Routes (`backend/api/routes/api_keys.py`)

```
POST /api/settings/api-keys
  Body: {name: "My App", permissions: "read"}
  Returns: {id, name, key: "otui_abc...", prefix: "otui_abc...", permissions}
  NOTE: Full key only shown ONCE in this response

GET /api/settings/api-keys
  Returns: [{id, name, prefix, permissions, is_active, last_used_at, created_at}]
  NOTE: Never return full key or hash

DELETE /api/settings/api-keys/{id}
  — Deactivate key (set is_active=0)
```

### Backend: Public API Routes (`backend/api/routes/public_api.py`)

All endpoints require `X-API-Key` header. Prefix: `/api/v1/`

```
GET /api/v1/quote/{symbol}
  Returns: {symbol, price, change, change_pct, volume, high, low, open, prev_close, timestamp}

GET /api/v1/ohlcv/{symbol}?interval=1d&start=2025-01-01&end=2025-12-31
  Returns: {symbol, interval, data: [{date, open, high, low, close, volume}]}

GET /api/v1/fundamentals/{symbol}
  Returns: {symbol, pe, pb, market_cap, roe, debt_equity, revenue_growth, eps, dividend_yield, sector, industry}

GET /api/v1/indicators/{symbol}?indicator=rsi&period=14&interval=1d&limit=100
  Returns: {symbol, indicator, params, data: [{date, value}]}

GET /api/v1/watchlist/{id}
  Returns: {id, name, symbols: [{symbol, price, change_pct}]}

GET /api/v1/portfolio
  Returns: {holdings: [{symbol, quantity, avg_price, current_price, pnl}], total_value, total_pnl}

GET /api/v1/screener/run?preset_id=X
  Returns: {results: [{symbol, name, ...metrics}], count}
```

All responses wrapped in: `{"data": {...}, "meta": {"timestamp": "...", "source": "openterminalui"}}`

Register all routes in `backend/main.py`.

### Frontend: API Key Management UI

Add "API Keys" section to `frontend/src/pages/Settings.tsx`:

- "Generate New API Key" button → modal:
  - Name input
  - Permission select: Read Only / Read & Write
  - "Generate" button
  - Shows full key ONCE with copy button and warning: "Save this key — it won't be shown again"
- Active keys table:
  - Name, Prefix (masked: `otui_abc...`), Permissions, Last Used, Created, Status
  - "Revoke" button per key (with confirmation)
- API documentation link (to FastAPI /docs)

### Tests

**Backend** (`backend/tests/test_public_api.py`):
```python
# Test API key generation returns key starting with "otui_"
# Test valid API key accesses /api/v1/quote/RELIANCE returns data
# Test missing API key returns 401
# Test invalid API key returns 401
# Test revoked key returns 401
# Test rate limiting: 101st request returns 429
# Test all v1 endpoints return valid data shape
# Test response wrapper has "data" and "meta" keys
```

**E2E** (`frontend/tests/api-keys.spec.ts`):
```typescript
// Navigate to /equity/settings
// Find "API Keys" section
// Click "Generate New API Key"
// Enter name "Test Key"
// Verify key is displayed starting with "otui_"
// Verify copy button works
// Close modal, verify key appears in table (masked)
// Click "Revoke", confirm, verify key removed
```
