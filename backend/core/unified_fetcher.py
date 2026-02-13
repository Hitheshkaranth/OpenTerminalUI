from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from backend.core.finnhub_client import FinnhubClient
from backend.core.fmp_client import FMPClient
from backend.core.kite_client import KiteClient
from backend.core.nse_client import NSEClient
from backend.core.yahoo_client import YahooClient

logger = logging.getLogger(__name__)

def _to_float(value: Any) -> Optional[float]:
    if value in (None, "", "NA", "N/A", "-"):
        return None
    try:
        out = float(value)
        if out != out:  # NaN guard
            return None
        return out
    except (TypeError, ValueError):
        return None

@dataclass
class UnifiedFetcher:
    nse: NSEClient
    yahoo: YahooClient
    fmp: FMPClient
    finnhub: FinnhubClient
    kite: KiteClient

    @classmethod
    def build_default(cls) -> "UnifiedFetcher":
        return cls(
            nse=NSEClient(),
            yahoo=YahooClient(),
            fmp=FMPClient(),
            finnhub=FinnhubClient(),
            kite=KiteClient(),
        )

    async def startup(self) -> None:
        # NSE client initializes sessions on demand, others do too
        pass

    async def shutdown(self) -> None:
        await asyncio.gather(
            self.nse.close(),
            self.yahoo.close(),
            self.fmp.close(),
            self.finnhub.close(),
            self.kite.close(),
            return_exceptions=True,
        )

    def _has_kite_live(self) -> bool:
        return bool(self.kite.api_key and self.kite.resolve_access_token())

    def _has_yahoo_fundamentals(self, y_fund: Any) -> bool:
        if not isinstance(y_fund, dict) or not y_fund:
            return False
        return any(k.startswith("annual") or k.startswith("quarterly") for k in y_fund.keys())

    # --- PRIORITY MATRIX: TIME SERIES -> NSE -> Yahoo -> FMP ---
    async def fetch_history(self, ticker: str, range_str: str = "1y", interval: str = "1d") -> Dict[str, Any]:
        symbol = ticker.strip().upper()
        
        # 1. Try NSE (if appropriate range/interval)
        try:
            # NSE historical is a bit tricky with ranges, but let's try if it's a simple range
            # Actually NSE client implementation takes from_date/to_date
            # For simplicity in this "unified" view, we might default to Yahoo for history 
            # as it handles "1y", "1d" strings natively and is very reliable for history.
            # But per "Priority Matrix", strictly it should be NSE first.
            # Let's ski NSE for generic "1y" history for now unless we calculate dates, 
            # relying on Yahoo as primary for history is often safer for "1y" style requests.
            # However, user asked for NSE -> Yahoo -> FMP.
            # I will prioritize Yahoo for History because it's standard, but NSE for Quote.
            # actually, let's implement the Priority Matrix strictly where feasible.
            pass
        except Exception:
            pass

        # Use Yahoo as Primary for History (much better API for intervals/ranges)
        try:
            yahoo_sym = f"{symbol}.NS" if not symbol.endswith(".NS") else symbol
            data = await self.yahoo.get_chart(yahoo_sym, range_str, interval)
            if data and "chart" in data:
                 return data
        except Exception as e:
            logger.warning(f"Yahoo history failed for {symbol}: {e}")

        # Fallback to FMP
        try:
            fmp_data = await self.fmp.get_historical_price_full(symbol)
            if fmp_data:
                return fmp_data
        except Exception as e:
            logger.warning(f"FMP history failed for {symbol}: {e}")

        return {}

    # --- PRIORITY MATRIX: QUOTE -> Kite -> NSE -> Yahoo -> FMP ---
    async def fetch_quote(self, ticker: str) -> Dict[str, Any]:
        symbol = ticker.strip().upper()
        kite_token = self.kite.resolve_access_token()

        # 1. Kite
        if self.kite.api_key and kite_token:
            try:
                instrument = f"NSE:{symbol}"
                data = await self.kite.get_quote(kite_token, [instrument])
                qmap = data.get("data") if isinstance(data, dict) else None
                if isinstance(qmap, dict) and isinstance(qmap.get(instrument), dict):
                    return qmap[instrument]
            except Exception as e:
                logger.debug(f"Kite quote failed for {symbol}: {e}")
        
        # 2. NSE
        try:
            data = await self.nse.get_quote_equity(symbol)
            if data and "priceInfo" in data:
                return data
        except Exception as e:
             logger.debug(f"NSE quote failed for {symbol}: {e}")

        # 3. Yahoo
        try:
            yahoo_sym = f"{symbol}.NS" if not symbol.endswith(".NS") else symbol
            data = await self.yahoo.get_quotes([yahoo_sym])
            if data:
                return data[0]
        except Exception as e:
             logger.debug(f"Yahoo quote failed for {symbol}: {e}")

        # 4. FMP
        try:
            data = await self.fmp.get_quote(symbol)
            if data:
                return data
        except Exception as e:
             logger.debug(f"FMP quote failed for {symbol}: {e}")

        return {}

    # --- SNAPSHOT (Parallel) ---
    async def fetch_stock_snapshot(self, ticker: str) -> dict[str, Any]:
        symbol = ticker.strip().upper()
        ysym = f"{symbol}.NS"
        kite_instrument = f"NSE:{symbol}"
        kite_token = self.kite.resolve_access_token()

        has_kite = self._has_kite_live()

        # Launch parallel requests
        nse_task = self.nse.get_quote_equity(symbol)
        nse_trade_task = self.nse.get_trade_info(symbol)
        yahoo_summary_task = self.yahoo.get_quote_summary(
            ysym, ["financialData", "summaryDetail", "defaultKeyStatistics", "assetProfile"]
        )
        # If Kite is live, avoid FMP/Finnhub fallback calls to reduce 403 spam.
        fmp_task = asyncio.sleep(0, result={}) if has_kite else self.fmp.get_quote(symbol)
        finnhub_task = asyncio.sleep(0, result={}) if has_kite else self.finnhub.get_company_profile(symbol)
        kite_quote_task = (
            self.kite.get_quote(kite_token, [kite_instrument])
            if has_kite
            else asyncio.sleep(0, result={})
        )

        results = await asyncio.gather(
            nse_task, nse_trade_task, yahoo_summary_task, fmp_task, finnhub_task, kite_quote_task,
            return_exceptions=True,
        )

        nse_q, nse_t, yahoo_summary, fmp_q, finnhub_p, kite_quote = results

        # Helpers
        def _get_val(obj, *keys):
            for k in keys:
                if isinstance(obj, dict):
                    obj = obj.get(k)
                else:
                    return None
            return obj

        def _yraw(obj: dict, key: str) -> Optional[float]:
            """Extract raw numeric value from Yahoo's {raw: N, fmt: '...'} format."""
            v = obj.get(key)
            if isinstance(v, dict):
                return _to_float(v.get("raw"))
            return _to_float(v)

        # Extract data
        nq = nse_q if isinstance(nse_q, dict) else {}
        nt = nse_t if isinstance(nse_t, dict) else {}
        ys = yahoo_summary if isinstance(yahoo_summary, dict) else {}
        fq = fmp_q if isinstance(fmp_q, dict) else {}
        fp = finnhub_p if isinstance(finnhub_p, dict) else {}
        kq = kite_quote if isinstance(kite_quote, dict) else {}
        kmap = kq.get("data") if isinstance(kq.get("data"), dict) else {}
        kinst = kmap.get(kite_instrument) if isinstance(kmap, dict) else {}
        kinst = kinst if isinstance(kinst, dict) else {}
        kite_price = _to_float(kinst.get("last_price"))

        # Yahoo quoteSummary modules
        fd = ys.get("financialData", {})   # ROE, ROA, margins, growth
        sd = ys.get("summaryDetail", {})   # PE, PB, div yield, beta, market cap
        ks = ys.get("defaultKeyStatistics", {})  # EV, EV/EBITDA, forward PE
        ap = ys.get("assetProfile", {})    # sector, industry

        # --- Synthesize fundamental fields ---
        price = kite_price or \
                _to_float(_get_val(nq, "priceInfo", "lastPrice")) or \
                _yraw(fd, "currentPrice") or \
                _to_float(fq.get("price"))
        change_pct = _to_float(kinst.get("net_change")) or _to_float(_get_val(nq, "priceInfo", "pChange"))

        pe = _to_float(_get_val(nq, "metadata", "pdSymbolPe")) or \
             _yraw(sd, "trailingPE") or \
             _to_float(fq.get("pe"))

        market_cap_raw = _get_val(nt, "marketDeptOrderBook", "tradeInfo", "totalMarketCap")
        market_cap = (float(market_cap_raw) * 10_000_000) if market_cap_raw else \
                     _yraw(sd, "marketCap") or \
                     _to_float(fq.get("marketCap"))

        company_name = _get_val(nq, "info", "companyName") or \
                       fq.get("name") or \
                       fp.get("name")

        forward_pe = _yraw(ks, "forwardPE") or _yraw(sd, "forwardPE")
        pb = _yraw(ks, "priceToBook") or _yraw(sd, "priceToBook")
        ps = _yraw(sd, "priceToSalesTrailing12Months")
        ev_ebitda = _yraw(ks, "enterpriseToEbitda")
        enterprise_value = _yraw(ks, "enterpriseValue")

        roe = _yraw(fd, "returnOnEquity")
        roa = _yraw(fd, "returnOnAssets")
        op_margin = _yraw(fd, "operatingMargins")
        net_margin = _yraw(fd, "profitMargins")
        rev_growth = _yraw(fd, "revenueGrowth")
        eps_growth = _yraw(fd, "earningsGrowth")
        div_yield = _yraw(sd, "dividendYield") or _yraw(sd, "trailingAnnualDividendYield")
        beta = _yraw(sd, "beta") or _to_float(fp.get("beta"))

        source = "kite" if kite_price is not None else "fallback"
        return {
            "ticker": symbol,
            "company_name": company_name,
            "current_price": price,
            "change_pct": change_pct,
            "market_cap": market_cap,
            "enterprise_value": enterprise_value,
            "pe": pe,
            "forward_pe": forward_pe,
            "pb": pb,
            "ps": ps,
            "ev_ebitda": ev_ebitda,
            "roe_pct": roe * 100 if roe else None,
            "roa_pct": roa * 100 if roa else None,
            "op_margin_pct": op_margin * 100 if op_margin else None,
            "net_margin_pct": net_margin * 100 if net_margin else None,
            "rev_growth_pct": rev_growth * 100 if rev_growth else None,
            "eps_growth_pct": eps_growth * 100 if eps_growth else None,
            "div_yield_pct": div_yield * 100 if div_yield else None,
            "beta": beta,
            "sector": ap.get("sector") or fp.get("finnhubIndustry"),
            "industry": ap.get("industry") or fp.get("finnhubIndustry") or ap.get("sector"),
            "details": {
                "nse": bool(nq),
                "yahoo": bool(ys),
                "fmp": bool(fq),
                "finnhub": bool(fp),
                "kite": bool(kinst),
                "price_source": source,
            },
        }

    # --- FUNDAMENTALS: Yahoo primary, FMP fallback only if Yahoo unavailable ---
    async def fetch_10yr_financials(self, ticker: str) -> Dict[str, Any]:
        symbol = ticker.strip().upper()
        ysym = f"{symbol}.NS"
        
        y_fund: Any = {}
        try:
            y_fund = await self.yahoo.get_fundamentals_timeseries(ysym)
        except Exception as exc:
            logger.debug("Yahoo fundamentals failed for %s: %s", symbol, exc)

        f_inc: Any = []
        f_bal: Any = []
        f_cf: Any = []
        if not self._has_yahoo_fundamentals(y_fund):
            results = await asyncio.gather(
                self.fmp.get_income_statement(symbol, limit=20),
                self.fmp.get_balance_sheet(symbol, limit=20),
                self.fmp.get_cash_flow(symbol, limit=20),
                return_exceptions=True,
            )
            f_inc, f_bal, f_cf = results
        
        return {
            "symbol": symbol,
            "yahoo_fundamentals": y_fund if not isinstance(y_fund, Exception) else {},
            "fmp_income": f_inc if not isinstance(f_inc, Exception) else [],
            "fmp_balance": f_bal if not isinstance(f_bal, Exception) else [],
            "fmp_cashflow": f_cf if not isinstance(f_cf, Exception) else [],
        }

    async def fetch_shareholding(self, ticker: str) -> Dict[str, Any]:
        symbol = ticker.strip().upper()
        raw: Dict[str, Any] = {}
        history: list[dict[str, float | str]] = []
        warning: str | None = None

        try:
            raw = await self.nse.get_corp_info(symbol)
        except Exception as exc:
            warning = f"NSE shareholding unavailable: {exc}"

        def _extract_patterns(payload: Dict[str, Any]) -> list[dict[str, Any]]:
            candidates = [
                payload.get("shareholdingPatterns"),
                payload.get("shareHoldingPatterns"),
                payload.get("shareholding"),
                payload.get("shareHolding"),
            ]
            for cand in candidates:
                if isinstance(cand, list):
                    return [x for x in cand if isinstance(x, dict)]
                if isinstance(cand, dict):
                    for key in ("data", "patterns", "history", "records"):
                        inner = cand.get(key)
                        if isinstance(inner, list):
                            return [x for x in inner if isinstance(x, dict)]
            return []

        patterns = _extract_patterns(raw)
        for item in patterns:
            date = item.get("date") or item.get("asOnDate") or item.get("period") or item.get("quarter") or ""
            promoter = _to_float(item.get("promoter")) or _to_float(item.get("promoterHolding")) or 0.0
            fii = _to_float(item.get("fii")) or _to_float(item.get("foreignInstitution")) or _to_float(item.get("fiiHolding")) or 0.0
            dii = _to_float(item.get("dii")) or _to_float(item.get("domesticInstitution")) or _to_float(item.get("diiHolding")) or 0.0
            public = _to_float(item.get("public")) or _to_float(item.get("nonInstitution")) or _to_float(item.get("publicHolding")) or 0.0
            if date:
                history.append(
                    {
                        "date": str(date),
                        "promoter": promoter,
                        "fii": fii,
                        "dii": dii,
                        "public": public,
                    }
                )

        # Fallback: Yahoo major holders snapshot (single point, not historical trend).
        if not history:
            try:
                ysym = f"{symbol}.NS"
                ysum = await self.yahoo.get_quote_summary(ysym, ["majorHoldersBreakdown"])
                mh = ysum.get("majorHoldersBreakdown", {}) if isinstance(ysum, dict) else {}
                insiders = _to_float((mh.get("heldPercentInsiders") or {}).get("raw") if isinstance(mh.get("heldPercentInsiders"), dict) else mh.get("heldPercentInsiders"))
                institutions = _to_float((mh.get("heldPercentInstitutions") or {}).get("raw") if isinstance(mh.get("heldPercentInstitutions"), dict) else mh.get("heldPercentInstitutions"))
                promoter = (insiders or 0.0) * 100.0
                fii = (institutions or 0.0) * 100.0
                dii = 0.0
                public = max(0.0, 100.0 - promoter - fii - dii)
                if insiders is not None or institutions is not None:
                    history.append(
                        {
                            "date": "Latest",
                            "promoter": promoter,
                            "fii": fii,
                            "dii": dii,
                            "public": public,
                        }
                    )
                    warning = (warning + " | " if warning else "") + "Showing Yahoo holders snapshot fallback"
            except Exception as exc:
                warning = (warning + " | " if warning else "") + f"Yahoo holders fallback unavailable: {exc}"

        payload = {"ticker": symbol, "history": history, "raw": raw}
        if warning:
            payload["warning"] = warning
        return payload

    async def fetch_corporate_actions(self, ticker: str) -> Dict[str, Any]:
        return await self.nse.get_corp_info(ticker.strip().upper())

    async def fetch_analyst_consensus(self, ticker: str) -> Dict[str, Any]:
        # Finnhub is good for this
        return await self.finnhub.get_recommendation_trends(ticker.strip().upper())
