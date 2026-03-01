from __future__ import annotations

import asyncio
import ast
from pathlib import Path
import re
from typing import Any, List, Optional

import pandas as pd
from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from backend.api.deps import fetch_stock_snapshot_coalesced
from backend.core.models import ScreenerRunRequest, ScreenerRunResponse
from backend.core.screener import ScreenerEngine, Rule
from backend.equity.screener_v2 import FactorEngine, FactorSpec
from backend.services.screener_scan_service import FMPScreenerAdapter, NSEScreenerAdapter, merge_scan_rows
from backend.services.materialized_store import load_screener_df, upsert_screener_rows

router = APIRouter()
DATA_DIR = Path(__file__).resolve().parents[3] / "data"


class FactorConfigRequest(BaseModel):
    field: str
    weight: float = Field(default=1.0, ge=0.0, le=10.0)
    higher_is_better: bool = True


class ScreenerV2RunRequest(BaseModel):
    rules: list[Any] = Field(default_factory=list)
    factors: list[FactorConfigRequest] = Field(default_factory=list)
    sort_order: str = "desc"
    limit: int = 50
    universe: str = "nse_eq"
    sector_neutral: bool = False


class ScreenerScanFilter(BaseModel):
    field: str
    op: str
    value: Any

    @field_validator("field")
    @classmethod
    def validate_field(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in SCAN_ALLOWED_FIELDS:
            raise ValueError(f"Unsupported filter field '{value}'.")
        return normalized

    @field_validator("op")
    @classmethod
    def validate_op(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in SCAN_ALLOWED_OPS:
            raise ValueError(f"Unsupported operator '{value}'.")
        return normalized


class ScreenerScanSort(BaseModel):
    field: str
    order: str = "desc"

    @field_validator("field")
    @classmethod
    def validate_sort_field(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in SCAN_ALLOWED_FIELDS:
            raise ValueError(f"Unsupported sort field '{value}'.")
        return normalized

    @field_validator("order")
    @classmethod
    def validate_order(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"asc", "desc"}:
            raise ValueError("Sort order must be 'asc' or 'desc'.")
        return normalized


class ScreenerScanRequest(BaseModel):
    markets: list[str] = Field(default_factory=lambda: ["NSE", "NYSE", "NASDAQ"])
    filters: list[ScreenerScanFilter] = Field(default_factory=list)
    sort: ScreenerScanSort = Field(default_factory=lambda: ScreenerScanSort(field="market_cap", order="desc"))
    limit: int = Field(default=100, ge=1, le=500)
    formula: str | None = None

    @field_validator("markets")
    @classmethod
    def validate_markets(cls, value: list[str]) -> list[str]:
        normalized = []
        for market in value:
            market_upper = str(market).strip().upper()
            if not market_upper:
                continue
            if market_upper not in SCAN_ALLOWED_MARKETS:
                raise ValueError(f"Unsupported market '{market}'.")
            normalized.append(market_upper)
        return normalized or ["NSE", "NYSE", "NASDAQ"]


SCAN_FIELD_MAP: dict[str, list[str]] = {
    "symbol": ["symbol", "ticker"],
    "market_cap": ["market_cap", "mcap"],
    "pe_ratio": ["pe_ratio", "pe"],
    "pb_ratio": ["pb_ratio", "pb_calc", "pb"],
    "ps_ratio": ["ps_ratio", "ps_calc", "ps"],
    "dividend_yield": ["dividend_yield"],
    "revenue_growth_yoy": ["revenue_growth_yoy", "rev_growth_pct"],
    "earnings_growth_yoy": ["earnings_growth_yoy", "eps_growth_pct"],
    "roe": ["roe", "roe_pct"],
    "roa": ["roa", "roa_pct"],
    "debt_to_equity": ["debt_to_equity"],
    "current_ratio": ["current_ratio"],
    "beta": ["beta"],
    "avg_volume_10d": ["avg_volume_10d", "avg_volume"],
    "price_change_1d": ["price_change_1d", "change_pct"],
    "price_change_1w": ["price_change_1w"],
    "price_change_1m": ["price_change_1m"],
    "price_change_3m": ["price_change_3m", "returns_3m"],
    "price_change_6m": ["price_change_6m"],
    "price_change_1y": ["price_change_1y", "returns_1y"],
    "sector": ["sector"],
    "industry": ["industry"],
    "country": ["country", "country_code"],
    "exchange": ["exchange", "market"],
}
SCAN_ALLOWED_FIELDS = set(SCAN_FIELD_MAP.keys())
SCAN_ALLOWED_OPS = {"gte", "gt", "lte", "lt", "eq", "neq", "in", "contains"}
SCAN_ALLOWED_MARKETS = {"NSE", "NYSE", "NASDAQ"}
US_SCREENER_SEED = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOGL",
    "META",
    "TSLA",
    "AVGO",
    "JPM",
    "XOM",
    "LLY",
    "AMD",
    "NFLX",
    "INTC",
    "QCOM",
]


def _normalize_scan_value(row: dict[str, Any], field: str) -> Any:
    keys = SCAN_FIELD_MAP.get(field, [field])
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return None


def _to_num(value: Any) -> float | None:
    try:
        num = float(value)
        if num != num:  # NaN
            return None
        return num
    except Exception:
        return None


def _passes_filter(row: dict[str, Any], filt: ScreenerScanFilter) -> bool:
    left = _normalize_scan_value(row, filt.field)
    op = filt.op.lower().strip()
    right = filt.value
    left_num = _to_num(left)
    right_num = _to_num(right)

    if op in {"gte", "gt", "lte", "lt", "eq", "neq"}:
        if left_num is not None and right_num is not None:
            if op == "gte":
                return left_num >= right_num
            if op == "gt":
                return left_num > right_num
            if op == "lte":
                return left_num <= right_num
            if op == "lt":
                return left_num < right_num
            if op == "eq":
                return left_num == right_num
            return left_num != right_num
        ltxt = str(left or "").strip().upper()
        rtxt = str(right or "").strip().upper()
        if op == "eq":
            return ltxt == rtxt
        if op == "neq":
            return ltxt != rtxt
        return False

    if op == "in":
        if isinstance(right, list):
            universe = {str(v).strip().upper() for v in right}
            return str(left or "").strip().upper() in universe
        return False

    if op == "contains":
        return str(right or "").strip().upper() in str(left or "").strip().upper()

    return True


_TOKEN_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")
_FORMULA_ALLOWED_CMP = (ast.Eq, ast.NotEq, ast.Gt, ast.GtE, ast.Lt, ast.LtE, ast.In, ast.NotIn)
_FORMULA_ALLOWED_BOOL_OP = (ast.And, ast.Or)
_FORMULA_ALLOWED_UNARY_OP = (ast.Not,)
_FORMULA_ALLOWED_BIN_OP = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod)


def _normalize_formula_expr(formula: str) -> str:
    safe = re.sub(r"\bAND\b", " and ", formula, flags=re.IGNORECASE)
    safe = re.sub(r"\bOR\b", " or ", safe, flags=re.IGNORECASE)
    safe = re.sub(r"\bNOT\b", " not ", safe, flags=re.IGNORECASE)
    safe = re.sub(r"\bIN\b", " in ", safe, flags=re.IGNORECASE)
    safe = safe.replace("<>", "!=")
    safe = re.sub(r"(?<![<>=!])=(?!=)", "==", safe)
    return safe


def _formula_node_is_allowed(node: ast.AST) -> bool:
    if isinstance(node, ast.Expression):
        return _formula_node_is_allowed(node.body)
    if isinstance(node, ast.BoolOp):
        if not isinstance(node.op, _FORMULA_ALLOWED_BOOL_OP):
            return False
        return all(_formula_node_is_allowed(v) for v in node.values)
    if isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, _FORMULA_ALLOWED_UNARY_OP):
            return False
        return _formula_node_is_allowed(node.operand)
    if isinstance(node, ast.Compare):
        if not _formula_node_is_allowed(node.left):
            return False
        if not node.ops or any(not isinstance(op, _FORMULA_ALLOWED_CMP) for op in node.ops):
            return False
        return all(_formula_node_is_allowed(c) for c in node.comparators)
    if isinstance(node, ast.BinOp):
        return isinstance(node.op, _FORMULA_ALLOWED_BIN_OP) and _formula_node_is_allowed(node.left) and _formula_node_is_allowed(node.right)
    if isinstance(node, ast.Name):
        return True
    if isinstance(node, ast.Constant):
        return isinstance(node.value, (str, int, float, bool, type(None)))
    if isinstance(node, ast.List):
        return all(_formula_node_is_allowed(e) for e in node.elts)
    if isinstance(node, ast.Tuple):
        return all(_formula_node_is_allowed(e) for e in node.elts)
    return False


def _passes_formula(row: dict[str, Any], formula: str | None) -> bool:
    expr = (formula or "").strip()
    if not expr:
        return True
    safe = _normalize_formula_expr(expr)
    if "__" in safe:
        return False

    vars_map: dict[str, Any] = {}
    for token in set(_TOKEN_RE.findall(expr)):
        upper = token.upper()
        if upper in {"AND", "OR", "NOT", "IN"}:
            continue
        vars_map[token] = _normalize_scan_value(row, token.lower())
        vars_map[upper] = _normalize_scan_value(row, token.lower())

    try:
        parsed = ast.parse(safe, mode="eval")
    except SyntaxError:
        return False
    if not _formula_node_is_allowed(parsed):
        return False
    try:
        compiled = compile(parsed, "<screener-formula>", "eval")
        return bool(eval(compiled, {"__builtins__": {}}, vars_map))
    except Exception:
        return False


async def _hydrate_missing_screener_rows(
    tickers: list[str],
    warnings: list[dict[str, str]],
    refresh_cap: int = 30,
) -> tuple[pd.DataFrame, int]:
    df = load_screener_df(tickers)
    if df.empty:
        stored_tickers: set[str] = set()
    else:
        stored_tickers = set(df["ticker"].astype(str).str.upper())

    missing = [t for t in tickers if t not in stored_tickers]
    if not missing:
        return df, 0

    refresh_batch = missing[:refresh_cap]
    if len(missing) > len(refresh_batch):
        warnings.append(
            {
                "code": "screener_partial_refresh",
                "message": f"Refreshing {len(refresh_batch)} of {len(missing)} missing symbols.",
            }
        )

    sem = asyncio.Semaphore(16)

    async def _fetch_row(sym: str) -> Optional[dict[str, Any]]:
        async with sem:
            try:
                snap = await fetch_stock_snapshot_coalesced(sym)
                if not snap:
                    return None
                return {
                    "ticker": sym,
                    "company_name": snap.get("company_name"),
                    "sector": snap.get("sector"),
                    "industry": snap.get("industry"),
                    "current_price": snap.get("current_price"),
                    "market_cap": snap.get("market_cap"),
                    "pe": snap.get("pe"),
                    "pb_calc": None,
                    "ps_calc": None,
                    "ev_ebitda": None,
                    "roe_pct": None,
                    "roa_pct": None,
                    "op_margin_pct": None,
                    "net_margin_pct": None,
                    "rev_growth_pct": None,
                    "eps_growth_pct": None,
                    "beta": snap.get("beta"),
                    "piotroski_f_score": None,
                    "altman_z_score": None,
                }
            except Exception:
                return None

    fetched = await asyncio.gather(*(_fetch_row(t) for t in refresh_batch))
    rows = [r for r in fetched if r is not None]
    skipped = len(refresh_batch) - len(rows)
    if rows:
        upsert_screener_rows(rows)
        df = load_screener_df(tickers)
    return df, skipped

def _load_universe(universe: str) -> List[str]:
    path = DATA_DIR / ("nse_equity_symbols_eq.txt" if universe == "nse_eq" else "sample_tickers.txt")
    if not path.exists():
        return ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "ITC"]
    try:
        content = path.read_text(encoding="utf-8")
        rows = [x.strip().upper() for x in content.splitlines() if x.strip()]
        return rows[:300]
    except Exception:
        return ["RELIANCE"]

@router.post("/screener/run", response_model=ScreenerRunResponse)
async def run_screener(request: ScreenerRunRequest) -> ScreenerRunResponse:
    all_tickers = _load_universe(request.universe)
    sample_size = min(len(all_tickers), max(50, min(300, request.limit * 8)))
    tickers = all_tickers[:sample_size]

    warnings = []
    skipped = 0

    if sample_size < len(all_tickers):
        warnings.append({
            "code": "screener_sampled_universe",
            "message": f"Screened first {sample_size} symbols from {len(all_tickers)} universe."
        })

    df = load_screener_df(tickers)

    df, newly_skipped = await _hydrate_missing_screener_rows(tickers, warnings, refresh_cap=30)
    skipped += newly_skipped

    if df.empty:
        return ScreenerRunResponse(count=0, rows=[], meta={"warnings": warnings + [{"code": "screener_empty", "message": "No data available."}]})

    engine = ScreenerEngine(df)
    try:
        # Pydantic models usually fields are accessed as attributes, but if using dict fallback...
        # request.rules is likely List[ScreenerRuleRequest]
        # Rule expects (field, op, value)
        rules = [Rule(field=r.field, op=r.op, value=r.value) for r in request.rules]
        filtered = engine.apply_rules(rules)
        ranked = engine.rank(
            filtered,
            by=request.sort_by,
            ascending=(request.sort_order.lower() == "asc"),
            top_n=request.limit
        )

        # Convert to list of dicts, handle NaN
        out_rows = ranked.where(pd.notnull(ranked), None).to_dict(orient="records")
        return ScreenerRunResponse(
            count=len(ranked),
            rows=out_rows,
            meta={"warnings": warnings}
        )
    except Exception as e:
        warnings.append({"code": "screener_error", "message": str(e)})
        return ScreenerRunResponse(count=0, rows=[], meta={"warnings": warnings})


@router.post("/screener/scan")
async def run_multimarket_scan(request: ScreenerScanRequest) -> dict[str, Any]:
    markets = request.markets or ["NSE", "NYSE", "NASDAQ"]

    warnings: list[dict[str, str]] = []

    rows: list[dict[str, Any]] = []
    if "NSE" in markets:
        nse_adapter = NSEScreenerAdapter(
            hydrate_rows=_hydrate_missing_screener_rows,
            load_universe=_load_universe,
            universe_key="nse_eq",
            universe_limit=350,
            refresh_cap=60,
        )
        rows.extend(await nse_adapter.fetch(warnings))

    if "NYSE" in markets or "NASDAQ" in markets:
        us_adapter = FMPScreenerAdapter(
            snapshot_fetcher=fetch_stock_snapshot_coalesced,
            seed_symbols=US_SCREENER_SEED,
            max_concurrency=8,
        )
        rows.extend(await us_adapter.fetch(markets))

    rows = merge_scan_rows(rows)

    filtered: list[dict[str, Any]] = []
    for row in rows:
        if request.filters and not all(_passes_filter(row, f) for f in request.filters):
            continue
        if not _passes_formula(row, request.formula):
            continue
        filtered.append(row)

    sort_field = request.sort.field
    reverse = request.sort.order.lower() != "asc"
    filtered.sort(key=lambda row: _to_num(_normalize_scan_value(row, sort_field)) or float("-inf"), reverse=reverse)

    out = filtered[: request.limit]
    return {
        "count": len(out),
        "rows": out,
        "meta": {
            "markets": markets,
            "warnings": warnings,
        },
    }


@router.post("/screener/run-v2")
async def run_screener_v2(request: ScreenerV2RunRequest) -> dict[str, Any]:
    all_tickers = _load_universe(request.universe)
    sample_size = min(len(all_tickers), max(50, min(400, request.limit * 10)))
    tickers = all_tickers[:sample_size]
    warnings: list[dict[str, str]] = []

    if sample_size < len(all_tickers):
        warnings.append(
            {
                "code": "screener_sampled_universe",
                "message": f"Screened first {sample_size} symbols from {len(all_tickers)} universe.",
            }
        )

    df, _ = await _hydrate_missing_screener_rows(tickers, warnings, refresh_cap=40)
    if df.empty:
        return {"count": 0, "rows": [], "meta": {"warnings": warnings}}

    if request.rules:
        rules = []
        for raw in request.rules:
            if not isinstance(raw, dict):
                continue
            field = str(raw.get("field") or "").strip()
            op = str(raw.get("op") or "").strip()
            value = raw.get("value")
            if not field or not op:
                continue
            rules.append(Rule(field=field, op=op, value=value))
        if rules:
            df = ScreenerEngine(df).apply_rules(rules)

    if df.empty:
        return {"count": 0, "rows": [], "meta": {"warnings": warnings}}

    factors = [
        FactorSpec(name=f.field, weight=float(f.weight), higher_is_better=bool(f.higher_is_better))
        for f in request.factors
    ]
    if not factors:
        factors = [
            FactorSpec("roe_pct", weight=0.35, higher_is_better=True),
            FactorSpec("rev_growth_pct", weight=0.25, higher_is_better=True),
            FactorSpec("eps_growth_pct", weight=0.20, higher_is_better=True),
            FactorSpec("pe", weight=0.20, higher_is_better=False),
        ]

    scored = FactorEngine(df).score(factors, sector_neutral=request.sector_neutral)
    ranked = scored.sort_values(
        "composite_score", ascending=(request.sort_order.lower() == "asc")
    ).head(max(1, min(request.limit, 200)))

    factor_columns = [f"factor_{f.name}_z" for f in factors]
    heatmap = FactorEngine.heatmap_matrix(ranked, factor_columns=factor_columns, top_n=25)
    out_rows = ranked.where(pd.notnull(ranked), None).to_dict(orient="records")
    return {
        "count": len(out_rows),
        "rows": out_rows,
        "meta": {
            "warnings": warnings,
            "factors": [f.__dict__ for f in factors],
            "sector_neutral": request.sector_neutral,
            "heatmap": heatmap,
        },
    }

@router.get("/screener/run-v2")
async def get_run_screener_v2() -> dict[str, Any]:
    return await run_screener_v2(ScreenerV2RunRequest(rules=[], factors=[]))
