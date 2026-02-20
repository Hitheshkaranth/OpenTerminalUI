from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import pandas as pd


@dataclass(frozen=True)
class FactorSpec:
    name: str
    weight: float = 1.0
    higher_is_better: bool = True


class FactorEngine:
    """Pandas-based factor scoring with optional sector-neutral normalization."""

    def __init__(self, dataframe: pd.DataFrame) -> None:
        self.df = dataframe.copy()

    @staticmethod
    def _clip_outliers(series: pd.Series, low_q: float = 0.02, high_q: float = 0.98) -> pd.Series:
        s = pd.to_numeric(series, errors="coerce")
        valid = s.dropna()
        if valid.empty:
            return s
        low = valid.quantile(low_q)
        high = valid.quantile(high_q)
        return s.clip(lower=low, upper=high)

    @staticmethod
    def _zscore(series: pd.Series) -> pd.Series:
        s = pd.to_numeric(series, errors="coerce")
        valid = s.dropna()
        if valid.empty:
            return pd.Series(0.0, index=s.index)
        mean = valid.mean()
        std = valid.std(ddof=0)
        if std == 0 or pd.isna(std):
            return pd.Series(0.0, index=s.index)
        z = (s - mean) / std
        return z.fillna(0.0)

    def _factor_z(self, df: pd.DataFrame, spec: FactorSpec, sector_neutral: bool) -> pd.Series:
        if spec.name not in df.columns:
            return pd.Series(0.0, index=df.index)
        clipped = self._clip_outliers(df[spec.name])
        if sector_neutral and "sector" in df.columns:
            z = clipped.groupby(df["sector"]).transform(self._zscore)
            z = pd.to_numeric(z, errors="coerce").fillna(0.0)
        else:
            z = self._zscore(clipped)
        if not spec.higher_is_better:
            z = -z
        return z

    def score(
        self,
        factors: Iterable[FactorSpec],
        *,
        sector_neutral: bool = False,
        min_rows: int = 3,
    ) -> pd.DataFrame:
        df = self.df.copy()
        if df.empty:
            return df

        factor_list = [f for f in factors if f.weight > 0]
        if not factor_list:
            df["composite_score"] = 0.0
            return df

        total_weight = sum(f.weight for f in factor_list)
        if total_weight <= 0:
            df["composite_score"] = 0.0
            return df

        weighted_sum = pd.Series(0.0, index=df.index)
        for spec in factor_list:
            z = self._factor_z(df, spec, sector_neutral=sector_neutral)
            col = f"factor_{spec.name}_z"
            df[col] = z
            weighted_sum = weighted_sum + z * spec.weight

        df["composite_score"] = (weighted_sum / total_weight).fillna(0.0)

        if len(df) >= min_rows:
            df["composite_rank"] = (
                df["composite_score"].rank(method="first", ascending=False).astype(int)
            )
        else:
            df["composite_rank"] = 1
        return df

    @staticmethod
    def heatmap_matrix(
        df: pd.DataFrame,
        factor_columns: list[str],
        symbol_col: str = "ticker",
        top_n: int = 25,
    ) -> list[dict[str, object]]:
        if df.empty:
            return []
        rows = df.sort_values("composite_score", ascending=False).head(top_n)
        out: list[dict[str, object]] = []
        for _, row in rows.iterrows():
            entry = {"id": str(row.get(symbol_col) or "-"), "data": []}
            cells: list[dict[str, object]] = []
            for col in factor_columns:
                val = row.get(col)
                num = float(val) if pd.notna(val) else 0.0
                cells.append({"x": col.replace("factor_", "").replace("_z", ""), "y": num})
            entry["data"] = cells
            out.append(entry)
        return out
