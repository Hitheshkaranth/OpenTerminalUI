# TASK: Add Custom Formula / Computed Ratio Support to Screener

## Project Context

OpenTerminalUI is a full-stack financial terminal (React 18 + TypeScript + Vite + Tailwind + Zustand frontend, FastAPI + SQLAlchemy backend). The existing screener is at `frontend/src/pages/Screener.tsx` with backend routes in `backend/api/routes/screener.py` and store in `frontend/src/store/screenerStore.ts`. Terminal dark theme using `TerminalPanel`, `TerminalTabs` components from `frontend/src/components/terminal/`. API client in `frontend/src/api/client.ts`. Tests: pytest backend, Playwright E2E.

## What to Build

### Backend: `backend/core/formula_engine.py`

Safe expression evaluator using Python `ast` module (NO `eval`/`exec`):

- Parse expression into AST, walk tree, only allow:
  - `BinOp`: +, -, *, /, **, %
  - `UnaryOp`: -, +
  - `Call`: only whitelisted functions: `abs`, `min`, `max`, `round`, `sqrt`
  - `Num`/`Constant`: numeric literals
  - `Name`: only whitelisted field names (see below)
- Reject everything else (imports, attribute access, subscripts, comprehensions, etc.)
- Available fields (variable names in formulas):
  ```
  pe, pb, ps, ev_ebitda, roe, roa, roce, debt_equity, current_ratio,
  revenue_growth, eps_growth, net_profit_growth, dividend_yield,
  market_cap, price, volume, turnover,
  net_profit_margin, operating_margin, ebitda_margin,
  free_cash_flow, promoter_holding, fii_holding, dii_holding,
  high_52w, low_52w, beta, book_value, face_value
  ```
- `evaluate(formula: str, data: dict) -> float`: evaluate formula with given data dict
- `validate(formula: str) -> tuple[bool, str]`: check if formula is safe, return (valid, error_message)

### Backend Routes

Add to `backend/api/routes/screener.py` (or create `backend/api/routes/custom_screener.py`):

```
POST /api/screener/custom-formula
Body: {
  formula: "pe * pb",
  universe: "nifty200",   # nifty50, nifty100, nifty200, nifty500, all
  sort: "desc",
  limit: 50,
  filter_expr: "market_cap > 10000"  # optional filter
}
Returns: {
  results: [{symbol, name, sector, computed_value, ...all_fields}],
  formula: "pe * pb",
  count: 50
}

GET /api/screener/saved-formulas
Returns: [{id, name, formula, description, created_at}]

POST /api/screener/saved-formulas
Body: {name, formula, description}

DELETE /api/screener/saved-formulas/{id}
```

### Frontend: Enhance `ScreenerPage.tsx`

Add a new tab "Custom Formula" alongside existing screener tabs:

**Formula Editor Panel**:
- Large monospace textarea for formula input (use `font-mono` class)
- Real-time validation: show green checkmark if valid, red error message if invalid
- "Available Fields" collapsible reference panel showing all field names with descriptions
- Example formulas: "pe * pb" (Graham Number proxy), "(roe - 15) * 2 + revenue_growth" (Quality+Growth), "price / high_52w * 100" (52W High %)

**Universe Selector**: dropdown with Nifty 50/100/200/500/All

**Sort Controls**: Sort by computed value (Asc/Desc)

**Results Table**:
- Columns: #, Symbol, Name, Sector, **Computed Value** (highlighted), PE, PB, ROE, Market Cap
- Click row → navigate to `/equity/security/{symbol}`
- Computed Value column header shows the formula

**Saved Formulas**:
- "Save Formula" button → modal with name + description inputs
- "Load Saved" dropdown listing saved formulas
- Delete saved formula option

### Tests

**Backend** (`backend/tests/test_formula_engine.py`):
```python
# Test valid formulas: "pe + pb", "abs(revenue_growth)", "pe * pb / roe"
# Test invalid formulas: "import os", "__import__('os')", "open('file')", "x.y"
# Test division by zero returns None/NaN, not crash
# Test unknown variable name raises error
# Test API endpoint returns computed results sorted correctly
# Test saved formulas CRUD
```

**E2E** (`frontend/tests/custom-formula-screener.spec.ts`):
```typescript
// Navigate to /equity/screener
// Click "Custom Formula" tab
// Type formula "pe * pb" in textarea
// Verify validation shows green checkmark
// Click Run, verify results table appears with Computed Value column
// Type invalid formula "import os", verify error message shown
// Save formula, verify it appears in saved list
```
