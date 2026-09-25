from __future__ import annotations
from dataclasses import dataclass
import math

@dataclass(frozen=True)
class OptionSpec:
    spot: float
    strike: float
    time_to_expiry: float       # years
    rate: float                 # risk-free rate, decimal
    volatility: float           # decimal, e.g. 0.2 for 20%
    dividend_yield: float = 0.0
    option_type: str = "call"   # "call" or "put"

def _norm_cdf(x: float) -> float:
    """Cumulative distribution function for the standard normal distribution."""
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0

def _norm_pdf(x: float) -> float:
    """Probability density function for the standard normal distribution."""
    return math.exp(-0.5 * x**2) / math.sqrt(2.0 * math.pi)

def _d1_d2(spec: OptionSpec) -> tuple[float, float]:
    if spec.time_to_expiry <= 0 or spec.volatility <= 0:
        return 0.0, 0.0
    d1 = (math.log(spec.spot / spec.strike) + (spec.rate - spec.dividend_yield + 0.5 * spec.volatility**2) * spec.time_to_expiry) / (spec.volatility * math.sqrt(spec.time_to_expiry))
    d2 = d1 - spec.volatility * math.sqrt(spec.time_to_expiry)
    return d1, d2

def bs_price(spec: OptionSpec) -> float:
    if spec.option_type not in ("call", "put"):
        raise ValueError("option_type must be 'call' or 'put'")
    
    if spec.time_to_expiry <= 0:
        if spec.option_type == "call":
            return max(0.0, spec.spot - spec.strike)
        else:
            return max(0.0, spec.strike - spec.spot)
            
    if spec.volatility <= 0:
         # Deterministic case
         fwd = spec.spot * math.exp((spec.rate - spec.dividend_yield) * spec.time_to_expiry)
         disc = math.exp(-spec.rate * spec.time_to_expiry)
         if spec.option_type == "call":
             return max(0.0, fwd - spec.strike) * disc
         else:
             return max(0.0, spec.strike - fwd) * disc

    d1, d2 = _d1_d2(spec)
    if spec.option_type == "call":
        return spec.spot * math.exp(-spec.dividend_yield * spec.time_to_expiry) * _norm_cdf(d1) - spec.strike * math.exp(-spec.rate * spec.time_to_expiry) * _norm_cdf(d2)
    else:
        return spec.strike * math.exp(-spec.rate * spec.time_to_expiry) * _norm_cdf(-d2) - spec.spot * math.exp(-spec.dividend_yield * spec.time_to_expiry) * _norm_cdf(-d1)

def delta(spec: OptionSpec) -> float:
    if spec.option_type not in ("call", "put"):
        raise ValueError("option_type must be 'call' or 'put'")
    if spec.time_to_expiry <= 0 or spec.volatility <= 0:
        if spec.option_type == "call":
            return 1.0 if spec.spot > spec.strike else 0.0
        else:
            return -1.0 if spec.spot < spec.strike else 0.0
            
    d1, _ = _d1_d2(spec)
    if spec.option_type == "call":
        return math.exp(-spec.dividend_yield * spec.time_to_expiry) * _norm_cdf(d1)
    else:
        return -math.exp(-spec.dividend_yield * spec.time_to_expiry) * _norm_cdf(-d1)

def gamma(spec: OptionSpec) -> float:
    if spec.time_to_expiry <= 0 or spec.volatility <= 0:
        return 0.0
    d1, _ = _d1_d2(spec)
    return math.exp(-spec.dividend_yield * spec.time_to_expiry) * _norm_pdf(d1) / (spec.spot * spec.volatility * math.sqrt(spec.time_to_expiry))

def vega(spec: OptionSpec) -> float:
    """Vega: per 1.00 change in vol (NOT per 1%)."""
    if spec.time_to_expiry <= 0 or spec.volatility <= 0:
        return 0.0
    d1, _ = _d1_d2(spec)
    return spec.spot * math.exp(-spec.dividend_yield * spec.time_to_expiry) * _norm_pdf(d1) * math.sqrt(spec.time_to_expiry)

def theta(spec: OptionSpec) -> float:
    """Theta: per YEAR (annual)."""
    if spec.option_type not in ("call", "put"):
        raise ValueError("option_type must be 'call' or 'put'")
    if spec.time_to_expiry <= 0 or spec.volatility <= 0:
        return 0.0
    d1, d2 = _d1_d2(spec)
    term1 = - (spec.spot * spec.volatility * math.exp(-spec.dividend_yield * spec.time_to_expiry) * _norm_pdf(d1)) / (2 * math.sqrt(spec.time_to_expiry))
    
    if spec.option_type == "call":
        term2 = spec.dividend_yield * spec.spot * math.exp(-spec.dividend_yield * spec.time_to_expiry) * _norm_cdf(d1)
        term3 = - spec.rate * spec.strike * math.exp(-spec.rate * spec.time_to_expiry) * _norm_cdf(d2)
        return term1 + term2 + term3
    else:
        term2 = - spec.dividend_yield * spec.spot * math.exp(-spec.dividend_yield * spec.time_to_expiry) * _norm_cdf(-d1)
        term3 = spec.rate * spec.strike * math.exp(-spec.rate * spec.time_to_expiry) * _norm_cdf(-d2)
        return term1 + term2 + term3

def rho(spec: OptionSpec) -> float:
    """Rho: per 1.00 change in rate."""
    if spec.option_type not in ("call", "put"):
        raise ValueError("option_type must be 'call' or 'put'")
    if spec.time_to_expiry <= 0 or spec.volatility <= 0:
        return 0.0
    _, d2 = _d1_d2(spec)
    if spec.option_type == "call":
        return spec.strike * spec.time_to_expiry * math.exp(-spec.rate * spec.time_to_expiry) * _norm_cdf(d2)
    else:
        return -spec.strike * spec.time_to_expiry * math.exp(-spec.rate * spec.time_to_expiry) * _norm_cdf(-d2)

def greeks(spec: OptionSpec) -> dict:
    """Return dict: price, delta, gamma, vega, theta, rho, d1, d2.
    Round to 6 dp."""
    d1, d2 = _d1_d2(spec)
    return {
        "price": round(bs_price(spec), 6),
        "delta": round(delta(spec), 6),
        "gamma": round(gamma(spec), 6),
        "vega": round(vega(spec), 6),
        "theta": round(theta(spec), 6),
        "rho": round(rho(spec), 6),
        "d1": round(d1, 6),
        "d2": round(d2, 6)
    }

def implied_volatility(spec: OptionSpec, market_price: float) -> float:
    """Solve implied vol via bisection on bs_price over vol in [1e-4, 5.0],
    ~100 iterations, tol 1e-6. spec.volatility is ignored as the seed.
    Raise ValueError on non-positive market_price."""
    if market_price <= 0:
        raise ValueError("market_price must be positive")
    
    low = 1e-4
    high = 5.0

    def _price_at(vol: float) -> float:
        return bs_price(OptionSpec(
            spot=spec.spot,
            strike=spec.strike,
            time_to_expiry=spec.time_to_expiry,
            rate=spec.rate,
            volatility=vol,
            dividend_yield=spec.dividend_yield,
            option_type=spec.option_type
        ))

    # Outside [price(low), price(high)] the bisection would just pin to a bound.
    if not _price_at(low) <= market_price <= _price_at(high):
        raise ValueError("market_price is outside the Black-Scholes range for vol in [0.0001, 5.0]")

    for _ in range(100):
        mid = (low + high) / 2
        if _price_at(mid) < market_price:
            low = mid
        else:
            high = mid
        if abs(high - low) < 1e-6:
            break
    return (low + high) / 2
