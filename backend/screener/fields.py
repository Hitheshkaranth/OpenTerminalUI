from __future__ import annotations

from dataclasses import dataclass
from difflib import get_close_matches


@dataclass(frozen=True)
class FieldMeta:
    """
    Metadata describing a queryable/filterable field in the stock screener.

    Attributes:
        key (str): Canonical database/DataFrame column key (e.g. 'pe', 'market_cap').
        label (str): User-friendly display label (e.g. 'PE Ratio', 'Market Capitalization').
        category (str): Category grouping (e.g. 'valuation', 'technical', 'profitability').
        description (str): Explanatory description of the metric.
        dtype (str): Data type of the field, 'number' or 'string'. Defaults to 'number'.
        aliases (tuple[str, ...]): Alternative names/shorthands for mapping query inputs.
    """
    key: str
    label: str
    category: str
    description: str
    dtype: str = "number"
    aliases: tuple[str, ...] = ()


FIELD_DEFINITIONS: list[FieldMeta] = [
    FieldMeta("ticker", "Ticker", "market", "Exchange ticker", "string", ("symbol",)),
    FieldMeta("company", "Company", "market", "Company name", "string", ("company name", "name")),
    FieldMeta("sector", "Sector", "market", "Sector classification", "string"),
    FieldMeta("industry", "Industry", "market", "Industry classification", "string"),
    FieldMeta("market_cap", "Market Capitalization", "valuation", "Market cap in crore", aliases=("mcap", "market capitalization")),
    FieldMeta("pe", "PE Ratio", "valuation", "Price to earnings", aliases=("pe ratio", "pe ttm")),
    FieldMeta("pb", "PB Ratio", "valuation", "Price to book", aliases=("pb", "pb ttm", "price to book")),
    FieldMeta("ev_ebitda", "EV/EBITDA", "valuation", "Enterprise value to EBITDA", aliases=("ev to ebitda",)),
    FieldMeta("earnings_yield", "Earnings Yield", "valuation", "E/P in percent", aliases=("ey",)),
    FieldMeta("roe", "ROE", "profitability", "Return on equity", aliases=("roe pct", "roe ttm")),
    FieldMeta("roce", "ROCE", "profitability", "Return on capital employed"),
    FieldMeta("roa", "ROA", "profitability", "Return on assets", aliases=("roa pct",)),
    FieldMeta("opm", "Operating Margin", "profitability", "Operating margin percent", aliases=("op margin", "opm ttm")),
    FieldMeta("net_margin", "Net Margin", "profitability", "Net margin percent", aliases=("net margin pct",)),
    FieldMeta("revenue_growth", "Revenue Growth", "growth", "Revenue growth percent", aliases=("revenue growth", "rev growth pct")),
    FieldMeta("eps_growth", "EPS Growth", "growth", "EPS growth percent", aliases=("eps growth",)),
    FieldMeta("debt_equity", "Debt to Equity", "leverage", "Debt to equity ratio", aliases=("debt to equity", "de ratio", "d/e")),
    FieldMeta("current_ratio", "Current Ratio", "leverage", "Current assets/current liabilities"),
    FieldMeta("fcf", "Free Cash Flow", "cashflow", "Free cash flow", aliases=("free cash flow",)),
    FieldMeta("fcf_yield", "FCF Yield", "cashflow", "Free cash flow yield", aliases=("fcf yield",)),
    FieldMeta("dividend_yield", "Dividend Yield", "income", "Dividend yield percent", aliases=("div yield",)),
    FieldMeta("beta", "Beta", "risk", "Beta vs benchmark"),
    FieldMeta("price", "Price", "market", "Current price", aliases=("current price",)),
    FieldMeta("price_1y_return", "1Y Return", "momentum", "One-year return percent", aliases=("1y return", "one year return")),
    FieldMeta("rsi", "RSI", "technical", "Relative strength index"),
    FieldMeta("volume", "Volume", "technical", "Traded volume"),
    FieldMeta("delivery_pct", "Delivery %", "technical", "Delivery percentage", aliases=("delivery pct",)),
    FieldMeta("promoter_holding", "Promoter holding", "shareholding", "Promoter ownership", aliases=("promoter holding",)),
    FieldMeta("fii_holding_change_qoq", "Change in FII holding", "shareholding", "Quarterly FII holding change", aliases=("change in fii holding", "fii change qoq")),
    FieldMeta("dii_holding_change_qoq", "Change in DII holding", "shareholding", "Quarterly DII holding change", aliases=("change in dii holding", "dii change qoq")),
    FieldMeta("piotroski_f_score", "Piotroski F-Score", "quality", "Piotroski nine-point score", aliases=("f score", "piotroski score")),
    FieldMeta("altman_z_score", "Altman Z-Score", "quality", "Bankruptcy risk score", aliases=("z score",)),
    FieldMeta("quality_score", "Quality Score", "quant", "Composite quality score"),
    FieldMeta("magic_combined_rank", "Magic Combined Rank", "guru", "Greenblatt combined rank", aliases=("combined rank", "magic rank")),
    FieldMeta("filings_growth_score", "Filings Growth Score", "Filings Intelligence", "Filing analysis growth score (0-100)", aliases=("growth score", "growth engine score")),
    FieldMeta("filings_headwind_score", "Filings Headwind Score", "Filings Intelligence", "Filing analysis headwind score (0-100)", aliases=("headwind score", "headwind score")),
    FieldMeta("filings_net_score", "Filings Net Score", "Filings Intelligence", "Filings growth minus headwind score", aliases=("net score", "filings net", "filings net score")),
    FieldMeta("filings_stance", "Filings Stance", "Filings Intelligence", "Overall filing stance", "string", aliases=("stance", "filings stance")),
    FieldMeta("order_book_value", "Order Book", "Filings Intelligence", "Latest extracted order book value", aliases=("order book", "order book value", "orderbook")),
    FieldMeta("implied_growth_pct", "Implied Growth %", "Filings Intelligence", "Reverse-DCF implied growth when already available", aliases=("implied growth",)),
    FieldMeta("adverse_regulatory_flag", "Adverse Regulatory Flag", "Filings Intelligence", "Adverse regulatory headwind finding present", aliases=("adverse regulatory", "regulatory flag", "adverse regulatory flag")),
]


_FIELD_BY_KEY = {field.key: field for field in FIELD_DEFINITIONS}
_ALIAS_TO_KEY: dict[str, str] = {}
for field in FIELD_DEFINITIONS:
    _ALIAS_TO_KEY[field.key.lower()] = field.key
    _ALIAS_TO_KEY[field.label.lower()] = field.key
    for alias in field.aliases:
        _ALIAS_TO_KEY[alias.lower()] = field.key


def list_fields() -> list[dict[str, str]]:
    """
    Retrieves the complete list of available fields as dictionaries.

    Returns:
        list[dict[str, str]]: Serialized field metadata definitions.
    """
    return [
        {
            "key": field.key,
            "label": field.label,
            "category": field.category,
            "description": field.description,
            "dtype": field.dtype,
        }
        for field in FIELD_DEFINITIONS
    ]


def field_aliases() -> dict[str, str]:
    """
    Returns the complete alias mapping lookup dictionary.

    Returns:
        dict[str, str]: Map of lowercased alias/label/key to canonical key.
    """
    return dict(_ALIAS_TO_KEY)


def resolve_field_name(value: str) -> str | None:
    """
    Attempts to match an input string (e.g. alias, typo, or user term) to a canonical key.

    Uses an exact lookup first, and falls back to fuzzy matching (difflib)
    if the similarity meets the 0.84 threshold.

    Args:
        value (str): The raw string to resolve.

    Returns:
        str | None: The canonical field key, or None if no match is found.
    """
    normalized = value.strip().lower()
    if not normalized:
        return None
    direct = _ALIAS_TO_KEY.get(normalized)
    if direct:
        return direct
    candidates = get_close_matches(normalized, _ALIAS_TO_KEY.keys(), n=1, cutoff=0.84)
    if not candidates:
        return None
    return _ALIAS_TO_KEY[candidates[0]]


def has_field(name: str) -> bool:
    """
    Checks if a canonical field key is registered in the definitions.

    Args:
        name (str): The field key.

    Returns:
        bool: True if key is defined, False otherwise.
    """
    return name in _FIELD_BY_KEY
