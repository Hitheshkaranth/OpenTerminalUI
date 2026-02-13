#!/usr/bin/env python3
"""
Demo runner: Generates realistic sample data to showcase the full analyzer.
On your local machine, run: python nse_stock_analyzer.py HAL BEL RELIANCE
This demo uses simulated data since yfinance isn't available here.
"""

import sys
import math
import warnings
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path
from scipy.optimize import minimize

warnings.filterwarnings('ignore')

# Add the analyzer's directory
ANALYZER_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = ANALYZER_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))

# ============================================================
# SIMULATED DATA FOR DEMO
# ============================================================
SAMPLE_STOCKS = {
    'HAL.NS': {
        'name': 'Hindustan Aeronautics Ltd', 'sector': 'Industrials',
        'industry': 'Aerospace & Defense', 'market_cap': 2800000000000,
        'current_price': 4180, 'pe_ratio': 35.2, 'forward_pe': 28.5,
        'pb_ratio': 8.5, 'ev_ebitda': 22.1, 'revenue': 300000000000,
        'ebitda': 66000000000, 'net_income': 42000000000,
        'total_debt': 10000000000, 'total_cash': 60000000000,
        'shares_outstanding': 668000000, 'dividend_yield': 0.008,
        'roe': 0.25, 'profit_margin': 0.14, 'operating_margin': 0.22,
        'gross_margin': 0.35, 'revenue_growth': 0.15, 'earnings_growth': 0.18,
        'beta': 1.15, 'fifty_two_week_high': 5675, 'fifty_two_week_low': 3050,
        'two_hundred_day_avg': 4250, 'fifty_day_avg': 4100,
        'book_value': 492, 'debt_to_equity': 5.2, 'free_cashflow': 35000000000,
        'enterprise_value': 2750000000000,
    },
    'BEL.NS': {
        'name': 'Bharat Electronics Ltd', 'sector': 'Industrials',
        'industry': 'Aerospace & Defense', 'market_cap': 2000000000000,
        'current_price': 275, 'pe_ratio': 42.1, 'forward_pe': 34.2,
        'pb_ratio': 11.2, 'ev_ebitda': 28.3, 'revenue': 220000000000,
        'ebitda': 57200000000, 'net_income': 39600000000,
        'total_debt': 5000000000, 'total_cash': 85000000000,
        'shares_outstanding': 7300000000, 'dividend_yield': 0.007,
        'roe': 0.28, 'profit_margin': 0.18, 'operating_margin': 0.26,
        'gross_margin': 0.42, 'revenue_growth': 0.18, 'earnings_growth': 0.22,
        'beta': 1.05, 'fifty_two_week_high': 342, 'fifty_two_week_low': 185,
        'two_hundred_day_avg': 270, 'fifty_day_avg': 265,
        'book_value': 24.5, 'debt_to_equity': 2.1, 'free_cashflow': 32000000000,
        'enterprise_value': 1920000000000,
    },
    'RELIANCE.NS': {
        'name': 'Reliance Industries Ltd', 'sector': 'Energy',
        'industry': 'Oil & Gas Integrated', 'market_cap': 17500000000000,
        'current_price': 1285, 'pe_ratio': 25.8, 'forward_pe': 22.1,
        'pb_ratio': 2.8, 'ev_ebitda': 12.5, 'revenue': 9500000000000,
        'ebitda': 1710000000000, 'net_income': 678000000000,
        'total_debt': 3200000000000, 'total_cash': 1800000000000,
        'shares_outstanding': 13600000000, 'dividend_yield': 0.003,
        'roe': 0.09, 'profit_margin': 0.071, 'operating_margin': 0.14,
        'gross_margin': 0.28, 'revenue_growth': 0.08, 'earnings_growth': 0.05,
        'beta': 0.85, 'fifty_two_week_high': 1609, 'fifty_two_week_low': 1115,
        'two_hundred_day_avg': 1310, 'fifty_day_avg': 1270,
        'book_value': 459, 'debt_to_equity': 38.5, 'free_cashflow': 450000000000,
        'enterprise_value': 18900000000000,
    },
    'TATAPOWER.NS': {
        'name': 'Tata Power Company Ltd', 'sector': 'Utilities',
        'industry': 'Utilities - Diversified', 'market_cap': 1350000000000,
        'current_price': 422, 'pe_ratio': 38.5, 'forward_pe': 30.2,
        'pb_ratio': 4.8, 'ev_ebitda': 18.2, 'revenue': 620000000000,
        'ebitda': 130200000000, 'net_income': 35000000000,
        'total_debt': 450000000000, 'total_cash': 80000000000,
        'shares_outstanding': 3200000000, 'dividend_yield': 0.005,
        'roe': 0.12, 'profit_margin': 0.056, 'operating_margin': 0.15,
        'gross_margin': 0.32, 'revenue_growth': 0.12, 'earnings_growth': 0.15,
        'beta': 0.95, 'fifty_two_week_high': 495, 'fifty_two_week_low': 330,
        'two_hundred_day_avg': 410, 'fifty_day_avg': 415,
        'book_value': 88, 'debt_to_equity': 120, 'free_cashflow': 25000000000,
        'enterprise_value': 1720000000000,
    },
    'INFY.NS': {
        'name': 'Infosys Ltd', 'sector': 'Technology',
        'industry': 'Information Technology Services', 'market_cap': 7200000000000,
        'current_price': 1735, 'pe_ratio': 27.5, 'forward_pe': 24.8,
        'pb_ratio': 8.2, 'ev_ebitda': 20.1, 'revenue': 1620000000000,
        'ebitda': 437400000000, 'net_income': 261000000000,
        'total_debt': 50000000000, 'total_cash': 350000000000,
        'shares_outstanding': 4150000000, 'dividend_yield': 0.025,
        'roe': 0.32, 'profit_margin': 0.161, 'operating_margin': 0.21,
        'gross_margin': 0.31, 'revenue_growth': 0.06, 'earnings_growth': 0.08,
        'beta': 0.75, 'fifty_two_week_high': 2006, 'fifty_two_week_low': 1358,
        'two_hundred_day_avg': 1780, 'fifty_day_avg': 1720,
        'book_value': 211, 'debt_to_equity': 8.5, 'free_cashflow': 210000000000,
        'enterprise_value': 6900000000000,
    },
}

def generate_price_series(current_price, vol, days=756):
    """Generate realistic GBM price series."""
    np.random.seed(hash(str(current_price)) % 2**31)
    dt = 1/252
    mu = 0.12
    prices = [current_price * 0.7]  # Start ~30% lower for 3yr growth
    for _ in range(days):
        ret = (mu - 0.5 * vol**2) * dt + vol * np.sqrt(dt) * np.random.randn()
        prices.append(prices[-1] * np.exp(ret))
    # Scale so last price matches current
    scale = current_price / prices[-1]
    return [p * scale for p in prices]


# ============================================================
# IMPORT CLASSES FROM ANALYZER (skip yfinance import)
# ============================================================
import importlib, types

# Read the analyzer source, remove yfinance import, and exec it
analyzer_src = (ANALYZER_DIR / 'analyzer.py').read_text(encoding='utf-8')
# Remove yfinance dependency for demo
analyzer_src = analyzer_src.replace("import yfinance as yf\n", "yf = None\n")
# Only grab up to MAIN EXECUTION
analyzer_code = analyzer_src.split("# ============================================================\n# MAIN EXECUTION")[0]
exec(analyzer_code, globals())


# ============================================================
# DEMO RUNNER
# ============================================================
def run_demo(tickers=None):
    if not tickers:
        tickers = ['HAL', 'BEL', 'RELIANCE', 'TATAPOWER', 'INFY']

    print(f"""
╔═══════════════════════════════════════════════════════════╗
║         NSE STOCK INVESTMENT ANALYZER — DEMO              ║
║   Running with simulated data for: {', '.join(tickers):<20s}  ║
╚═══════════════════════════════════════════════════════════╝
    """)

    # Create fetcher with simulated data
    fetcher = NSEDataFetcher(tickers)
    fetcher.tickers = [t.upper().replace('.NS', '') + '.NS' for t in tickers]

    # Populate with sample data
    all_tickers_ns = fetcher.tickers + [fetcher.benchmark]
    dates = pd.bdate_range(end=datetime.now(), periods=756)

    price_dict = {}
    for ticker in fetcher.tickers:
        if ticker in SAMPLE_STOCKS:
            info = SAMPLE_STOCKS[ticker]
            fetcher.data[ticker] = info
            vol = info.get('beta', 1.0) * 0.22
            price_dict[ticker] = generate_price_series(info['current_price'], vol, len(dates))
        else:
            # Generic stock
            fetcher.data[ticker] = {
                'name': ticker.replace('.NS', ''), 'sector': 'Unknown',
                'industry': 'Unknown', 'market_cap': 100000000000,
                'current_price': 500, 'pe_ratio': 25, 'forward_pe': 20,
                'pb_ratio': 3, 'ev_ebitda': 15, 'revenue': 50000000000,
                'ebitda': 10000000000, 'net_income': 5000000000,
                'total_debt': 10000000000, 'total_cash': 8000000000,
                'shares_outstanding': 200000000, 'dividend_yield': 0.01,
                'roe': 0.15, 'profit_margin': 0.10, 'operating_margin': 0.15,
                'gross_margin': 0.30, 'revenue_growth': 0.10, 'earnings_growth': 0.12,
                'beta': 1.0, 'fifty_two_week_high': 650, 'fifty_two_week_low': 380,
                'two_hundred_day_avg': 510, 'fifty_day_avg': 495,
                'book_value': 167, 'debt_to_equity': 25, 'free_cashflow': 4000000000,
                'enterprise_value': 102000000000,
            }
            price_dict[ticker] = generate_price_series(500, 0.25, len(dates))

    # NIFTY 50 benchmark
    price_dict[fetcher.benchmark] = generate_price_series(23500, 0.16, len(dates))

    fetcher.prices = pd.DataFrame(
        {k: v[:len(dates)] for k, v in price_dict.items()},
        index=dates
    )
    fetcher.returns = fetcher.prices.pct_change().dropna()

    print(f"  ✅ Loaded data for {len(fetcher.tickers)} stocks + NIFTY 50 benchmark")

    # Run models
    models = QuantModels(fetcher)

    # Print console summary
    print(f"\n{'='*60}")
    print("  ANALYSIS RESULTS")
    print(f"{'='*60}")

    for ticker in fetcher.tickers:
        info = fetcher.data.get(ticker, {})
        name = info.get('name', ticker)
        price = info.get('current_price', 0)

        betas = models.estimate_factor_betas(ticker)
        er = models.factor_expected_return(betas)
        esg = models.esg_score(ticker)
        tech = models.technical_signals(ticker)
        dcf = models.dcf_valuation(ticker)
        mc = models.monte_carlo_dcf(ticker)

        print(f"\n  ┌─ {name} ({ticker.replace('.NS', '')}) ─────────")
        print(f"  │ CMP: ₹{price:,.0f} | P/E: {info.get('pe_ratio',0):.1f} | ROE: {(info.get('roe',0) or 0)*100:.1f}%")
        print(f"  │ Factor E(R): {er:.1%} | Market Beta: {betas['market']:.2f}")
        print(f"  │ DCF Base Value: ₹{dcf['Base']['intrinsic_value']:,.0f} ({dcf['Base']['upside']:+.1%})")
        print(f"  │ Monte Carlo: Mean ₹{mc['mean']:,.0f} | P(upside): {mc['prob_upside']:.0%}")
        print(f"  │ ESG: {esg['Composite']:.1f}/10 → {esg['Recommendation']}")
        if tech:
            print(f"  │ Momentum: {tech.get('momentum_score','N/A')}/10 | RSI: {tech.get('rsi_14',0):.1f} | {tech.get('trend','')}")
        print(f"  └{'─'*50}")

    # Generate Excel
    timestamp = datetime.now().strftime('%Y%m%d_%H%M')
    ticker_str = '_'.join(t.replace('.NS', '') for t in fetcher.tickers[:5])
    filename = f'NSE_Analysis_{ticker_str}_{timestamp}.xlsx'
    output_path = str(PROJECT_ROOT / filename)

    print(f"\n  Generating Excel report...")
    generator = ExcelReportGenerator(fetcher, models)
    generator.generate(output_path)

    return output_path, filename


if __name__ == '__main__':
    tickers = sys.argv[1:] if len(sys.argv) > 1 else ['HAL', 'BEL', 'RELIANCE', 'TATAPOWER', 'INFY']
    output_path, filename = run_demo(tickers)
    print(f"\n  ✅ DEMO COMPLETE: {filename}")
