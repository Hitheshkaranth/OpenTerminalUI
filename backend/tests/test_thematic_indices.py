from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.shared.cache import cache
from backend.thematic_indices import routes, service as thm

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _reset_caches():
    thm._themes_cache = None
    try:
        cache._l1_cache.clear()
    except Exception:
        pass
    yield
    try:
        cache._l1_cache.clear()
    except Exception:
        pass


def _payload(start: date, closes: list[float | None], hour: int = 3) -> dict:
    ts = [int(datetime(start.year, start.month, start.day, hour, 45, tzinfo=timezone.utc).timestamp()) + 86400 * i
          for i in range(len(closes))]
    return {"chart": {"result": [{"timestamp": ts, "indicators": {"quote": [{"close": closes}]}}]}}


D0 = date(2026, 1, 5)


# --------------------------------------------------------------------- themes.yaml
def test_themes_yaml_shape():
    themes = thm.load_themes()
    ids = [t["id"] for t in themes]
    assert len(ids) == len(set(ids))
    assert sum(t["market"] == "IN" for t in themes) >= 12 and sum(t["market"] == "US" for t in themes) >= 6
    for t in themes:
        cons = thm._constituents(t)
        assert 6 <= len(cons) <= 15, t["id"]
        assert all(name and name != t["name"] for _sym, name in cons), t["id"]  # members carry their own names
        assert t["benchmark"] in ("^NSEI", "SPY")


def test_indian_constituents_exist_on_nse():
    # QC: the first draft listed SBI (SBIN), BOB (BANKBARODA), BOSCH (BOSCHLTD) and invented tickers.
    master = REPO / "data" / "nse_equity_symbols_all.txt"
    if not master.exists():
        pytest.skip("NSE symbol master not present")
    nse = {s.strip().upper() for s in master.read_text().replace(",", " ").split()}
    bad = {t["id"]: [s for s, _ in thm._constituents(t) if s.upper() not in nse]
           for t in thm.load_themes() if t["market"] == "IN"}
    assert not {k: v for k, v in bad.items() if v}, bad


# --------------------------------------------------------------------- index math
def test_extract_closes_keys_by_calendar_date():
    pts = thm._extract_closes(_payload(D0, [100.0, None, 102.0]))
    assert pts == [(D0, 100.0), (D0 + timedelta(days=2), 102.0)]


def test_equal_weight_index_with_forward_fill():
    a = [(D0, 100.0), (D0 + timedelta(days=1), 110.0), (D0 + timedelta(days=2), 121.0)]
    b = [(D0, 50.0), (D0 + timedelta(days=2), 60.0)]  # missing day 1 → forward-filled at 50
    series, members, warnings = thm.index_from_members([("A", "Alpha", a), ("B", "Beta", b)])
    assert [round(v, 4) for _, v in series] == [100.0, 105.0, 120.5]
    assert [m["name"] for m in members] == ["Alpha", "Beta"]
    assert members[0]["return_1y"] == 21.0 and members[0]["last"] == 121.0
    assert warnings == []


def test_index_base_is_latest_first_date_and_empty_members_warned():
    late = [(D0 + timedelta(days=1), 10.0), (D0 + timedelta(days=2), 11.0)]
    early = [(D0, 100.0), (D0 + timedelta(days=1), 100.0), (D0 + timedelta(days=2), 120.0)]
    series, _members, warnings = thm.index_from_members([("E", "Early", early), ("L", "Late", late), ("X", "None", [])])
    assert series[0][0] == D0 + timedelta(days=1) and series[0][1] == 100.0
    assert round(series[-1][1], 4) == round(100 * (1.2 + 1.1) / 2, 4)
    assert any("X" in w for w in warnings)


def test_benchmark_rebased_on_index_base_date():
    bench = [(D0, 200.0), (D0 + timedelta(days=1), 210.0), (D0 + timedelta(days=2), 231.0)]
    rebased = thm.rebase_benchmark(bench, D0 + timedelta(days=1))
    assert rebased == [(D0 + timedelta(days=1), 100.0), (D0 + timedelta(days=2), 110.0)]


def test_index_returns_windows():
    pts = [(D0 + timedelta(days=i), 100.0 + i) for i in range(30)]
    out = thm.index_returns(pts, {"1m": 21, "1y": None})
    assert out["1y"] == 29.0
    assert out["1m"] == round((129 / 108 - 1) * 100, 2)


# --------------------------------------------------------------------- routes
class _FakeFetcher:
    def __init__(self, missing: tuple[str, ...] = ()):
        self.missing = set(missing)

    async def fetch_history(self, symbol: str, range_str: str, interval: str) -> dict:
        if symbol in self.missing:
            return {"chart": {"result": []}}
        seed = sum(ord(c) for c in symbol) % 7
        # benchmark bars stamped at a different hour than stocks: dates must still align
        hour = 9 if symbol.startswith("^") or symbol == "SPY" else 3
        return _payload(D0, [100.0 * (1 + 0.001 * (i + seed)) for i in range(60)], hour=hour)


def _client(monkeypatch, fetcher) -> TestClient:
    async def _get():
        return fetcher

    monkeypatch.setattr(thm, "get_unified_fetcher", _get)
    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app)


def test_list_and_detail_routes(monkeypatch):
    client = _client(monkeypatch, _FakeFetcher(missing=("BEML",)))
    listing = client.get("/api/themes", params={"market": "IN"}).json()
    assert listing["benchmark"] == "^NSEI" and len(listing["themes"]) >= 12
    defence = next(t for t in listing["themes"] if t["id"] == "defence")
    assert defence["return_1y"] is not None and defence["vs_benchmark_1y"] is not None

    detail = client.get("/api/themes/defence").json()
    assert detail["series"][0]["index"] == 100.0 and detail["series"][0]["benchmark"] == 100.0
    assert all(p["benchmark"] is not None for p in detail["series"])  # no alternating rows
    beml = next(m for m in detail["members"] if m["symbol"] == "BEML")
    assert beml["last"] is None and any("BEML" in w for w in detail["warnings"])


def test_unknown_theme_404(monkeypatch):
    client = _client(monkeypatch, _FakeFetcher())
    assert client.get("/api/themes/not-a-theme").status_code == 404


def test_fetch_theme_data_runs_concurrently(monkeypatch):
    calls: list[str] = []

    class _Slow(_FakeFetcher):
        async def fetch_history(self, symbol, range_str, interval):
            calls.append(symbol)
            await asyncio.sleep(0.01)
            return await super().fetch_history(symbol, range_str, interval)

    data = asyncio.run(thm.fetch_theme_data(_Slow(), "IN", "psu-banks"))
    assert data is not None and len(calls) == 1 + data["constituents"]
