from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

import pandas as pd

_OPS: dict[str, Callable[[Any, Any], bool]] = {
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


@dataclass(frozen=True)
class Rule:
    field: str
    op: str
    value: Any

    def evaluate(self, row: pd.Series) -> bool:
        if self.op not in _OPS:
            raise ValueError(f"Unsupported operator: {self.op}")
        lhs = row.get(self.field)
        if lhs is None or pd.isna(lhs):
            return False
        try:
            return _OPS[self.op](lhs, self.value)
        except (TypeError, ValueError):
            return False


class ScreenerEngine:
    def __init__(self, dataframe: pd.DataFrame) -> None:
        self.df = dataframe.copy()

    def apply_rules(self, rules: list[Rule]) -> pd.DataFrame:
        if self.df.empty:
            return self.df
        mask = pd.Series([True] * len(self.df), index=self.df.index)
        for rule in rules:
            mask &= self.df.apply(rule.evaluate, axis=1)
        return self.df[mask].copy()

    def rank(self, df: pd.DataFrame, by: str, ascending: bool = False, top_n: int = 25) -> pd.DataFrame:
        if by not in df.columns:
            return df.head(top_n)
        return df.sort_values(by=by, ascending=ascending).head(top_n).copy()
