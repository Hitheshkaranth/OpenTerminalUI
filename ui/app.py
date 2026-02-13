from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import streamlit as st
import yaml

from core.alerts import AlertRule, append_alert_log, evaluate_alert_rule
from core.backtester import BacktestConfig, backtest_momentum_rotation
from core.data_fetcher import MarketDataFetcher
from core.normalizer import normalize_snapshot
from core.peers import build_peer_comparison
from core.ratios import compute_ratios
from core.screener import Rule, ScreenerEngine
from core.valuation import (
    DcfInputs,
    DcfStage,
    build_sensitivity_table,
    multi_stage_fcff_dcf,
    reverse_dcf_implied_growth,
    run_dcf_scenarios,
)


ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"
ALERT_LOG_PATH = ROOT / "data" / "processed" / "alerts_log.csv"


def _load_screener_presets() -> dict:
    path = CONFIG_DIR / "screeners.yaml"
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _parse_tickers(raw: str) -> list[str]:
    parts = [p.strip().upper() for p in raw.replace(",", " ").split()]
    return list(dict.fromkeys([p for p in parts if p]))


def _build_rules(preset_name: str, custom_pe: float | None, custom_roe: float | None) -> list[Rule]:
    presets = _load_screener_presets()
    rules: list[Rule] = []
    for spec in presets.get(preset_name, {}).get("rules", []):
        rules.append(Rule(field=spec["field"], op=spec["op"], value=spec["value"]))
    if custom_pe is not None:
        rules.append(Rule(field="pe", op="<=", value=float(custom_pe)))
    if custom_roe is not None:
        rules.append(Rule(field="roe_pct", op=">=", value=float(custom_roe)))
    return rules


@st.cache_data(ttl=1800, show_spinner=False)
def _fetch_universe_cached(tickers: tuple[str, ...]) -> pd.DataFrame:
    fetcher = MarketDataFetcher()
    rows = []
    for t in tickers:
        try:
            snap = fetcher.fetch_fundamental_snapshot(t)
            rows.append(compute_ratios(normalize_snapshot(snap)))
        except Exception as exc:
            rows.append({"ticker": t, "error": str(exc)})
    return pd.DataFrame(rows)


def _safe_float(v, fallback: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return fallback


def _render_screener_tab(df: pd.DataFrame, preset_name: str, max_pe: float, min_roe: float, top_n: int) -> None:
    st.subheader("Screener Results")
    engine = ScreenerEngine(df)
    rules = _build_rules(preset_name, max_pe, min_roe)
    screened = engine.apply_rules(rules)
    ranked = engine.rank(screened, by="roe_pct", ascending=False, top_n=int(top_n))

    st.success(f"Universe: {len(df)} | Matched: {len(screened)} | Showing: {len(ranked)}")
    st.dataframe(ranked, use_container_width=True)

    if not ranked.empty and "ticker" in ranked.columns and "roe_pct" in ranked.columns:
        chart_df = ranked[["ticker", "roe_pct"]].dropna().set_index("ticker")
        if not chart_df.empty:
            st.caption("ROE ranking of screened names")
            st.bar_chart(chart_df)

    numeric_cols = [c for c in ranked.columns if pd.api.types.is_numeric_dtype(ranked[c])]
    if len(numeric_cols) >= 2 and "ticker" in ranked.columns:
        x_col, y_col = st.columns(2)
        with x_col:
            x_metric = st.selectbox("Scatter X-axis", numeric_cols, index=0, key="scr_x")
        with y_col:
            y_metric = st.selectbox("Scatter Y-axis", numeric_cols, index=min(1, len(numeric_cols) - 1), key="scr_y")
        scatter_df = ranked[["ticker", x_metric, y_metric]].dropna().set_index("ticker")
        if not scatter_df.empty:
            st.scatter_chart(scatter_df, x=x_metric, y=y_metric)

    csv = ranked.to_csv(index=False).encode("utf-8")
    st.download_button(
        label="Export Results CSV",
        data=csv,
        file_name="screener_results.csv",
        mime="text/csv",
    )


def _render_valuation_tab(df: pd.DataFrame) -> None:
    st.subheader("Valuation Models")
    tickers = sorted(df.get("ticker", pd.Series(dtype=str)).dropna().astype(str).unique().tolist())
    if not tickers:
        st.info("No valid tickers available for valuation.")
        return

    sel_ticker = st.selectbox("Ticker for valuation", tickers, key="val_ticker")
    row = df[df["ticker"] == sel_ticker].iloc[0]

    revenue = _safe_float(row.get("revenue_ttm"), 0.0)
    net_margin = _safe_float(row.get("profit_margin"), 0.08)
    implied_fcf = revenue * net_margin if revenue > 0 else _safe_float(row.get("market_cap"), 0.0) * 0.03
    current_price = _safe_float(row.get("current_price"), 0.0)
    market_cap = _safe_float(row.get("market_cap"), 0.0)
    shares_outstanding = (market_cap / current_price) if current_price > 0 else None
    net_debt = _safe_float(row.get("net_debt"), 0.0)

    c1, c2, c3, c4 = st.columns(4)
    with c1:
        years = st.number_input("Forecast years", min_value=3, max_value=15, value=5, step=1)
    with c2:
        growth = st.number_input("FCF growth %", min_value=-20.0, max_value=60.0, value=10.0, step=0.5)
    with c3:
        discount = st.number_input("Discount rate %", min_value=1.0, max_value=30.0, value=12.0, step=0.5)
    with c4:
        terminal_growth = st.number_input("Terminal growth %", min_value=0.0, max_value=8.0, value=4.0, step=0.25)

    try:
        dcf = multi_stage_fcff_dcf(
            DcfInputs(
                base_fcf=implied_fcf,
                stages=[DcfStage(years=int(years), growth_rate=growth / 100, discount_rate=discount / 100)],
                terminal_growth=terminal_growth / 100,
                net_debt=net_debt,
                shares_outstanding=shares_outstanding,
            )
        )
    except Exception as exc:
        st.error(f"Valuation could not be computed: {exc}")
        return

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Enterprise Value", f"{dcf['enterprise_value']:,.0f}")
    m2.metric("Equity Value", f"{dcf['equity_value']:,.0f}")
    m3.metric("Intrinsic / Share", "N/A" if dcf["per_share_value"] is None else f"{dcf['per_share_value']:.2f}")
    if current_price > 0 and dcf["per_share_value"] is not None:
        upside = (dcf["per_share_value"] / current_price - 1) * 100
        m4.metric("Upside / Downside", f"{upside:+.2f}%")
    else:
        m4.metric("Upside / Downside", "N/A")

    proj = dcf["projection_df"]
    if not proj.empty:
        st.caption("Projected FCF and PV profile")
        plot_df = proj.set_index("year")[["fcf", "pv_fcf"]]
        st.line_chart(plot_df)

    st.markdown("### Scenario Analysis")
    bull_col, base_col, bear_col = st.columns(3)
    with bull_col:
        bull_growth = st.number_input("Bull growth %", value=14.0, key="bull_g")
        bull_disc = st.number_input("Bull discount %", value=10.0, key="bull_d")
        bull_tg = st.number_input("Bull terminal %", value=4.5, key="bull_t")
    with base_col:
        base_growth = st.number_input("Base growth %", value=10.0, key="base_g")
        base_disc = st.number_input("Base discount %", value=12.0, key="base_d")
        base_tg = st.number_input("Base terminal %", value=4.0, key="base_t")
    with bear_col:
        bear_growth = st.number_input("Bear growth %", value=5.0, key="bear_g")
        bear_disc = st.number_input("Bear discount %", value=14.0, key="bear_d")
        bear_tg = st.number_input("Bear terminal %", value=3.0, key="bear_t")

    scenarios = run_dcf_scenarios(
        base_fcf=implied_fcf,
        years=int(years),
        net_debt=net_debt,
        shares_outstanding=shares_outstanding,
        bull=(bull_growth / 100, bull_disc / 100, bull_tg / 100),
        base=(base_growth / 100, base_disc / 100, base_tg / 100),
        bear=(bear_growth / 100, bear_disc / 100, bear_tg / 100),
    )
    st.dataframe(scenarios, use_container_width=True)
    if "per_share_value" in scenarios.columns:
        st.bar_chart(scenarios.set_index("scenario")[["per_share_value"]])

    st.markdown("### Sensitivity Table (Discount vs Terminal Growth)")
    disc_range = [max((discount / 100) + x, 0.02) for x in (-0.02, -0.01, 0.0, 0.01, 0.02)]
    tg_range = [max((terminal_growth / 100) + x, 0.0) for x in (-0.01, -0.005, 0.0, 0.005, 0.01)]
    sensitivity = build_sensitivity_table(
        base_fcf=implied_fcf,
        years=int(years),
        growth_rate=growth / 100,
        discount_rates=disc_range,
        terminal_growth_rates=tg_range,
        net_debt=net_debt,
        shares_outstanding=shares_outstanding,
    )
    st.dataframe(sensitivity, use_container_width=True)

    st.markdown("### Reverse DCF")
    if market_cap > 0:
        implied_growth = reverse_dcf_implied_growth(
            target_equity_value=market_cap,
            base_fcf=implied_fcf,
            years=int(years),
            discount_rate=discount / 100,
            terminal_growth=terminal_growth / 100,
            net_debt=net_debt,
        )
        if implied_growth is not None:
            st.info(f"Implied growth (to justify current market cap): {implied_growth * 100:.2f}% CAGR")


def _render_peer_tab(df: pd.DataFrame) -> None:
    st.subheader("Peer & Industry Comparison")
    tickers = sorted(df.get("ticker", pd.Series(dtype=str)).dropna().astype(str).unique().tolist())
    if not tickers:
        st.info("No valid tickers available for peer analysis.")
        return
    sel = st.selectbox("Target ticker", tickers, key="peer_ticker")
    peer_df = build_peer_comparison(df, sel)
    if peer_df.empty:
        st.warning("Could not build peer comparison for selected ticker.")
        return

    st.dataframe(peer_df, use_container_width=True)
    vis_df = peer_df[["metric", "target_value", "peer_median"]].copy().set_index("metric")
    st.caption("Target vs peer median by metric")
    st.bar_chart(vis_df)

    pct_df = peer_df[["metric", "target_percentile"]].dropna().set_index("metric")
    if not pct_df.empty:
        st.caption("Percentile rank of target within peer set")
        st.line_chart(pct_df)


def _fmt_pct(v: float) -> str:
    return f"{v * 100:.2f}%"


def _render_phase3_tab(df: pd.DataFrame) -> None:
    st.subheader("Backtesting & Alerting")
    bt_tab, al_tab = st.tabs(["Backtesting Engine", "Alerting System"])

    with bt_tab:
        valid_df = df[df.get("error").isna()] if "error" in df.columns else df
        tickers = sorted(valid_df.get("ticker", pd.Series(dtype=str)).dropna().astype(str).unique().tolist())
        if not tickers:
            st.info("No valid tickers available for backtesting.")
        else:
            c1, c2, c3 = st.columns(3)
            with c1:
                start_dt = st.date_input("Start date", value=date(2020, 1, 1), key="bt_start")
            with c2:
                end_dt = st.date_input("End date", value=date.today(), key="bt_end")
            with c3:
                rebalance = st.selectbox("Rebalance", options=["W-FRI", "M", "Q"], index=1, key="bt_reb")
            c4, c5, c6, c7 = st.columns(4)
            with c4:
                lookback = st.number_input("Lookback days", min_value=20, max_value=252, value=63, step=1)
            with c5:
                top_n = st.number_input("Top N", min_value=1, max_value=min(50, len(tickers)), value=min(5, len(tickers)))
            with c6:
                tx_cost_bps = st.number_input("Transaction cost (bps)", min_value=0.0, max_value=200.0, value=10.0)
            with c7:
                benchmark = st.text_input("Benchmark", value="^NSEI")

            if st.button("Run Backtest"):
                with st.spinner("Running momentum backtest..."):
                    try:
                        result = backtest_momentum_rotation(
                            tickers=tickers,
                            start=start_dt.isoformat(),
                            end=end_dt.isoformat(),
                            config=BacktestConfig(
                                lookback_days=int(lookback),
                                rebalance_freq=str(rebalance),
                                top_n=int(top_n),
                                transaction_cost_bps=float(tx_cost_bps),
                                benchmark=benchmark.strip() or "^NSEI",
                            ),
                        )
                        st.session_state["phase3_backtest"] = result
                    except Exception as exc:
                        st.error(f"Backtest failed: {exc}")

            if "phase3_backtest" in st.session_state:
                result = st.session_state["phase3_backtest"]
                summary = result["summary"]
                s = summary["strategy"]
                b = summary["benchmark"]
                m1, m2, m3 = st.columns(3)
                m1.metric("Strategy Total Return", _fmt_pct(s["total_return"]))
                m2.metric("Strategy CAGR", _fmt_pct(s["cagr"]))
                m3.metric("Alpha vs Benchmark", _fmt_pct(summary["alpha_total_return"]))
                m4, m5, m6 = st.columns(3)
                m4.metric("Strategy Sharpe", f"{s['sharpe']:.2f}")
                m5.metric("Strategy Max Drawdown", _fmt_pct(s["max_drawdown"]))
                m6.metric("Benchmark CAGR", _fmt_pct(b["cagr"]))

                curve = result["equity_curve"]
                if not curve.empty:
                    st.caption("Equity Curve")
                    st.line_chart(curve)
                holdings = result["holdings"]
                if not holdings.empty:
                    st.caption("Rebalance Holdings Log")
                    st.dataframe(holdings, use_container_width=True)
                    st.download_button(
                        "Export Holdings Log CSV",
                        data=holdings.to_csv(index=False).encode("utf-8"),
                        file_name="backtest_holdings_log.csv",
                        mime="text/csv",
                    )

    with al_tab:
        numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
        if "ticker" not in df.columns or not numeric_cols:
            st.info("No numeric screener fields available for alerting.")
            return
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            rule_name = st.text_input("Rule name", value="Custom Alert")
        with c2:
            field = st.selectbox("Field", options=numeric_cols)
        with c3:
            op = st.selectbox("Operator", options=[">", "<", ">=", "<=", "==", "!="], index=0)
        with c4:
            default_threshold = float(pd.to_numeric(df[field], errors="coerce").median())
            threshold = st.number_input("Threshold", value=default_threshold)
        sev = st.selectbox("Severity", options=["low", "medium", "high"], index=1)

        if st.button("Run Alert Check"):
            alerts = evaluate_alert_rule(
                df,
                AlertRule(
                    name=rule_name.strip() or "Custom Alert",
                    field=field,
                    op=op,
                    threshold=float(threshold),
                    severity=sev,
                ),
            )
            st.session_state["phase3_alerts"] = alerts

        alerts_df = st.session_state.get("phase3_alerts", pd.DataFrame())
        if isinstance(alerts_df, pd.DataFrame):
            if alerts_df.empty:
                st.info("No alerts triggered for current rule.")
            else:
                st.success(f"Triggered alerts: {len(alerts_df)}")
                st.dataframe(alerts_df, use_container_width=True)
                if st.button("Append To Alert Log"):
                    append_alert_log(alerts_df, ALERT_LOG_PATH)
                    st.success(f"Saved to {ALERT_LOG_PATH}")

        if ALERT_LOG_PATH.exists():
            st.caption("Alert Log History")
            hist = pd.read_csv(ALERT_LOG_PATH)
            st.dataframe(hist.tail(200), use_container_width=True)


def main() -> None:
    st.set_page_config(page_title="Fundamental Screener", layout="wide")
    st.title("Fundamental Analysis Stock Screener")
    st.caption("Stage 3: Screener + Valuation + Peer Comparison + Backtesting + Alerting")

    col1, col2 = st.columns([3, 2])
    with col1:
        ticker_text = st.text_area(
            "Tickers (space or comma separated)",
            value="RELIANCE TCS INFY HDFCBANK ICICIBANK LT",
            height=90,
        )
    with col2:
        presets = _load_screener_presets()
        preset_names = list(presets.keys()) or ["value"]
        preset_name = st.selectbox("Preset", options=preset_names)
        top_n = st.number_input("Top N", min_value=1, max_value=200, value=25, step=1)

    st.subheader("Screening Overrides")
    c1, c2 = st.columns(2)
    with c1:
        max_pe = st.number_input("Max P/E", min_value=0.0, value=25.0, step=1.0)
    with c2:
        min_roe = st.number_input("Min ROE %", min_value=0.0, value=12.0, step=1.0)

    run = st.button("Fetch Data And Run Stage 3 Views")
    if run:
        tickers = _parse_tickers(ticker_text)
        if not tickers:
            st.error("Please provide at least one ticker.")
            return
        with st.spinner("Fetching fundamentals and computing ratios..."):
            st.session_state["stage2_df"] = _fetch_universe_cached(tuple(tickers))

    if "stage2_df" not in st.session_state:
        st.info("Run the fetch step to view Screener, Valuation, and Peer tabs.")
        return

    df = st.session_state["stage2_df"]
    tabs = st.tabs(["Screener", "Valuation", "Peer Comparison", "Backtesting & Alerts"])
    with tabs[0]:
        _render_screener_tab(df, preset_name, max_pe, min_roe, int(top_n))
    with tabs[1]:
        _render_valuation_tab(df)
    with tabs[2]:
        _render_peer_tab(df)
    with tabs[3]:
        _render_phase3_tab(df)


if __name__ == "__main__":
    main()
