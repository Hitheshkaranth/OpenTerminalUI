# TASK: Build Complete Trade Journal System

## Project Context

OpenTerminalUI is a full-stack financial terminal application.

- **Frontend**: React 18.3.1 + TypeScript + Vite 6 + Tailwind CSS 3.4 + Zustand (state) + TanStack React Query + Recharts
- **Backend**: FastAPI (Python 3.11) + SQLAlchemy ORM + SQLite + Alembic migrations
- **UI Pattern**: Dark terminal aesthetic. Use `TerminalPanel` from `frontend/src/components/terminal/TerminalPanel.tsx`.
- **Tabs pattern**: Use `TerminalTabs` from `frontend/src/components/terminal/TerminalTabs.tsx` for tabbed interfaces.
- **Routing**: React Router 6 in `frontend/src/App.tsx`. Equity routes are children of `<EquityLayout>`.
- **Sidebar**: `frontend/src/components/layout/Sidebar.tsx` — `nav` array of `{label, path, key, hint}`.
- **API client**: `frontend/src/api/client.ts` exports axios instance.
- **Models pattern**: SQLAlchemy models in `backend/models/`. See existing models for patterns (e.g., `backend/models/alert.py`).
- **Alembic**: Migrations in `backend/alembic/versions/`. Config at `backend/alembic.ini`.
- **Tests**: Backend pytest in `backend/tests/`. E2E Playwright in `frontend/tests/`.

## What to Build

### Backend Model: `backend/models/journal.py`

```python
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, JSON, func
from backend.db.base import Base

class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, default=1)
    symbol = Column(String(20), nullable=False)
    direction = Column(String(10), nullable=False)  # LONG or SHORT
    entry_date = Column(DateTime, nullable=False)
    entry_price = Column(Float, nullable=False)
    exit_date = Column(DateTime, nullable=True)
    exit_price = Column(Float, nullable=True)
    quantity = Column(Integer, nullable=False)
    pnl = Column(Float, nullable=True)           # computed
    pnl_pct = Column(Float, nullable=True)        # computed
    fees = Column(Float, default=0)
    strategy = Column(String(100), nullable=True)  # e.g., "breakout", "mean-reversion"
    setup = Column(String(100), nullable=True)     # e.g., "bull-flag", "double-bottom"
    emotion = Column(String(50), nullable=True)    # confident, fearful, greedy, neutral
    notes = Column(Text, nullable=True)
    tags = Column(JSON, default=list)              # free-form tags
    rating = Column(Integer, nullable=True)        # 1-5 self-rating
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

### Backend Migration

Create an Alembic migration file for the `journal_entries` table. Follow the pattern of existing migrations in `backend/alembic/versions/`.

### Backend Routes: `backend/api/routes/journal.py`

```
POST   /api/journal              — Create journal entry (auto-compute PnL if exit_price provided)
GET    /api/journal              — List entries with filters: ?symbol=&strategy=&start=&end=&tags=
GET    /api/journal/{id}         — Get single entry
PUT    /api/journal/{id}         — Update entry (recompute PnL on price changes)
DELETE /api/journal/{id}         — Delete entry

GET    /api/journal/stats        — Aggregate statistics:
  {
    total_trades, open_trades, closed_trades,
    win_rate, avg_win_pct, avg_loss_pct, profit_factor,
    largest_win, largest_loss, expectancy,
    current_streak, best_streak, worst_streak,
    total_pnl, avg_pnl,
    by_strategy: [{strategy, count, win_rate, avg_pnl}],
    by_day_of_week: [{day, count, avg_pnl}],
    by_emotion: [{emotion, count, win_rate}]
  }

GET    /api/journal/equity-curve — Cumulative PnL time series: [{date, cumulative_pnl}]
GET    /api/journal/calendar     — PnL by calendar day: [{date, pnl, trade_count}]

POST   /api/journal/import-csv   — Import trades from CSV upload
```

PnL computation:
- LONG: `(exit_price - entry_price) * quantity - fees`
- SHORT: `(entry_price - exit_price) * quantity - fees`
- `pnl_pct`: `pnl / (entry_price * quantity) * 100`

Register router in `backend/main.py` with prefix `/api/journal`.

### Frontend Page: `frontend/src/pages/TradeJournalPage.tsx`

Route: `/equity/journal`

**Tab 1: "Journal"** (default)
- Card-based list of trades (newest first)
- Each card shows:
  - Left: direction arrow (green up for LONG, red down for SHORT), symbol (bold), strategy badge
  - Center: entry price → exit price, quantity
  - Right: PnL in big text (green if positive, red if negative), PnL%
  - Bottom: date, tags as small badges, emotion emoji, rating stars, notes preview (truncated)
- Click card to expand full details inline
- Filters bar: symbol search, strategy dropdown, date range picker, emotion dropdown
- "Add Trade" button (floating bottom-right) → opens modal form

**Tab 2: "Analytics"**
- Top row of stat cards (2 per row on mobile, 4 per row on desktop):
  - Total Trades | Win Rate (%) | Profit Factor | Avg Win/Loss | Expectancy | Current Streak
  - Use green for positive, red for negative, neutral gray
- Equity curve: Recharts `<LineChart>` with cumulative PnL over time. Green fill when positive, red when negative.
- Calendar heatmap: Grid of days (like GitHub contributions). Each day cell colored green (profit) or red (loss) by intensity. Gray for no trades.
- Performance by Strategy: horizontal bar chart (Recharts `<BarChart>` layout="vertical")
- Performance by Day of Week: vertical bar chart

**Tab 3: "Tags"**
- List of strategies with trade count and win rate
- List of setups with trade count and win rate
- Add/edit/delete tags

**Add/Edit Trade Modal** (`frontend/src/components/journal/JournalEntryForm.tsx`):
- Symbol input (text, required)
- Direction: LONG / SHORT toggle
- Entry Date + Entry Price (required)
- Exit Date + Exit Price (optional — leave empty for open trades)
- Quantity (required)
- Fees (default 0)
- Strategy dropdown (with option to add new)
- Setup dropdown (with option to add new)
- Emotion: radio buttons with emojis (Confident, Fearful, Greedy, Neutral)
- Rating: 1-5 star selector
- Notes: textarea
- Tags: multi-select / free text chips
- "Save" and "Cancel" buttons

### Integration

**App.tsx**: Add `const TradeJournalPage = lazyWithRetry(...)` and route `<Route path="journal" element={<TradeJournalPage />} />`

**Sidebar.tsx**: Add `{ label: "Journal", path: "/equity/journal", key: "J", hint: "Trading" }` after the "Paper" entry.

### Tests

**Backend** (`backend/tests/test_journal.py`):
```python
# Test POST /api/journal creates entry and computes PnL correctly
# Test GET /api/journal returns list, supports symbol filter
# Test GET /api/journal/stats returns valid statistics
# Test GET /api/journal/equity-curve returns time series
# Test GET /api/journal/calendar returns calendar data
# Test PUT /api/journal/{id} updates and recomputes PnL
# Test DELETE /api/journal/{id} removes entry
# Test PnL computation: LONG with profit, LONG with loss, SHORT with profit
```

**E2E** (`frontend/tests/trade-journal.spec.ts`):
```typescript
// Navigate to /equity/journal
// Click "Add Trade" button
// Fill form: symbol=RELIANCE, direction=LONG, entry=2500, exit=2600, qty=10
// Submit and verify trade card appears with correct PnL (+1000)
// Click "Analytics" tab
// Verify equity curve chart renders
// Verify stat cards show updated values
```

## Code Style
- Named exports for all components and pages
- Tailwind classes only, terminal color tokens
- Recharts for all charts (LineChart, BarChart)
- TerminalPanel for section wrappers, TerminalTabs for tab navigation
- TypeScript interfaces for JournalEntry, JournalStats, etc.
- React Query for all API calls, invalidate queries after mutations
