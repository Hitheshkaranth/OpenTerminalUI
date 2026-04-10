# TASK: Upgrade Alert System to Multi-Condition with External Delivery

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Zustand frontend, FastAPI + SQLAlchemy backend. Existing alert system: backend model in `backend/models/alert.py`, routes in `backend/api/routes/alerts.py`, evaluator in `backend/alerts/`, store in `frontend/src/store/alertsStore.ts`, page at `frontend/src/pages/Alerts.tsx`. Terminal dark theme. Tests: pytest + Playwright.

## What to Build

### Backend: Extend Alert Model

Modify `backend/models/alert.py` to add fields (keep backward compatibility with existing alerts):

```python
# Add to existing AlertRule model:
conditions = Column(JSON, default=list)  # Array of condition objects
logic = Column(String(5), default="AND")  # AND / OR
delivery_channels = Column(JSON, default=lambda: ["in_app"])  # ["in_app", "webhook", "telegram", "discord"]
delivery_config = Column(JSON, default=dict)  # {webhook_url, telegram_token, telegram_chat_id, discord_webhook_url}
cooldown_minutes = Column(Integer, default=0)
last_triggered_at = Column(DateTime, nullable=True)
expiry_date = Column(DateTime, nullable=True)
max_triggers = Column(Integer, default=0)  # 0 = unlimited
trigger_count = Column(Integer, default=0)
```

Condition object shape:
```json
{
  "field": "price",
  "operator": "above",
  "value": 2500,
  "params": {}
}
```

Supported condition fields and operators:
- `price`: above, below, cross_above, cross_below
- `change_pct`: above, below (intraday % change)
- `volume`: above, spike (volume > N * 20-day avg, N from params.multiplier)
- `rsi_14`: above, below
- `macd_signal`: cross_above, cross_below (MACD crosses signal line)
- `ema_cross`: cross_above, cross_below (params.fast_period, params.slow_period)
- `oi_change`: above, below (F&O open interest change)
- `iv`: above, below (implied volatility)

Create Alembic migration for the new columns.

### Backend: `backend/alerts/delivery.py`

```python
import aiohttp

async def deliver_in_app(db, alert, message):
    """Create notification in notifications table (from Wave 1 agent 4, or just log if not available)."""

async def deliver_webhook(url: str, payload: dict):
    """POST JSON payload to webhook URL. Timeout 10s. Log failures."""
    async with aiohttp.ClientSession() as session:
        await session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10))

async def deliver_telegram(token: str, chat_id: str, message: str):
    """Send message via Telegram Bot API."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    async with aiohttp.ClientSession() as session:
        await session.post(url, json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"})

async def deliver_discord(webhook_url: str, message: str):
    """Send message via Discord webhook."""
    async with aiohttp.ClientSession() as session:
        await session.post(webhook_url, json={"content": message})

async def deliver_alert(alert, message: str, db=None):
    """Route delivery to configured channels."""
    config = alert.delivery_config or {}
    channels = alert.delivery_channels or ["in_app"]

    for channel in channels:
        try:
            if channel == "in_app" and db:
                await deliver_in_app(db, alert, message)
            elif channel == "webhook" and config.get("webhook_url"):
                await deliver_webhook(config["webhook_url"], {"alert_id": alert.id, "symbol": alert.symbol, "message": message})
            elif channel == "telegram" and config.get("telegram_token"):
                await deliver_telegram(config["telegram_token"], config["telegram_chat_id"], message)
            elif channel == "discord" and config.get("discord_webhook_url"):
                await deliver_discord(config["discord_webhook_url"], message)
        except Exception as e:
            print(f"Delivery failed for {channel}: {e}")
```

### Backend: Enhance `backend/alerts/evaluator.py`

Modify the alert evaluation loop to:
1. Load all active alerts
2. For each alert, evaluate ALL conditions
3. Apply AND/OR logic: AND = all must be true, OR = any must be true
4. Check cooldown: skip if `now - last_triggered_at < cooldown_minutes`
5. Check expiry: auto-disable if `expiry_date < now`
6. Check max_triggers: auto-disable if `trigger_count >= max_triggers > 0`
7. On trigger: call `deliver_alert()`, update `last_triggered_at` and `trigger_count`

For indicator-based conditions (RSI, MACD, EMA): fetch the latest indicator value using existing indicator computation from `backend/core/` or `backend/api/routes/indicators.py`.

### Backend Routes

Extend `backend/api/routes/alerts.py`:

```
POST /api/alerts/{id}/test  — Send a test notification through all configured channels
GET  /api/alerts/delivery-options — Returns supported channels with config requirements
```

Existing CRUD routes should handle the new fields transparently.

### Frontend: `frontend/src/components/alerts/AlertBuilder.tsx`

Modal dialog for creating/editing multi-condition alerts:

**Symbol Section**: Symbol search input

**Conditions Section**:
- "Add Condition" button adds a new condition row
- Each row (AlertConditionRow component):
  - Field dropdown: Price | % Change | Volume | RSI(14) | MACD Signal Cross | EMA Cross | OI Change | IV
  - Operator dropdown (changes based on field): Above | Below | Cross Above | Cross Below | Spike
  - Value input (number)
  - Params inputs (shown only for relevant fields): e.g., EMA fast/slow period inputs
  - Remove row button (X)
- Logic toggle between conditions: `AND` / `OR` switch
- Human-readable preview: "Alert when RELIANCE price > 2500 AND RSI(14) > 70"

**Delivery Section**:
- Checkboxes: In-App, Webhook, Telegram, Discord
- Webhook: URL input (shown when checked)
- Telegram: Bot Token + Chat ID inputs (shown when checked)
- Discord: Webhook URL input (shown when checked)
- "Test" button per channel (sends test message)

**Settings Section**:
- Cooldown: number input (minutes), default 0
- Expiry: date picker (optional)
- Max triggers: number input, 0 = unlimited

**Actions**: Save | Cancel

### Frontend: Update AlertsPage

Add tabs: "Active Alerts" | "Alert History" | "Delivery Settings"
- Active tab: existing table + new condition/delivery info columns
- History tab: paginated log (uses existing alert_history if available)
- Delivery Settings: configure default Telegram/Discord/Webhook settings (saved to localStorage)

Replace existing simple alert creation with the new AlertBuilder modal.

### Tests

**Backend** (`backend/tests/test_alerts_v2.py`):
```python
# Test creating alert with multiple conditions
# Test AND logic: all conditions must be true
# Test OR logic: any condition triggers
# Test cooldown: alert doesn't re-trigger within cooldown period
# Test max_triggers: alert auto-disables after N triggers
# Test expiry: expired alert doesn't evaluate
# Test delivery: mock webhook/telegram/discord, verify called on trigger
# Test POST /api/alerts/{id}/test sends test notification
```

**E2E** (`frontend/tests/alerts-v2.spec.ts`):
```typescript
// Navigate to /equity/alerts
// Click create new alert
// Verify AlertBuilder modal opens
// Add symbol "RELIANCE"
// Add condition: Price > 2500
// Click "Add Condition", add: RSI(14) > 70
// Toggle logic to AND
// Check Webhook delivery, enter URL
// Save alert
// Verify alert appears in active list with conditions summary
// Click test button, verify test notification sent
```
