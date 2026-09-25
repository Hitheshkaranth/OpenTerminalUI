from __future__ import annotations
import math
from dataclasses import dataclass

@dataclass(frozen=True)
class BondSpec:
    coupon_rate: float          # annual coupon as decimal, e.g. 0.05 for 5%
    years_to_maturity: float    # e.g. 10
    frequency: int = 2          # coupon payments per year (1,2,4,12)
    face_value: float = 100.0

def _coupon_periods(n: float) -> list[float]:
    """Coupon times in periods, counted back from maturity (n, n-1, ... > 0), so a
    fractional n keeps the final coupon paid at maturity. Equals 1..n for integer n."""
    return [n - k for k in range(math.ceil(n - 1e-9))]

def bond_price(spec: BondSpec, ytm: float) -> float:
    """Price from yield to maturity (ytm as decimal, annualised). Clean when the
    maturity is a whole number of coupon periods; otherwise the full (dirty) price,
    since the first coupon is discounted over a fractional period.
    Discount each coupon and the final face value at ytm/frequency over
    spec.years_to_maturity*spec.frequency periods."""
    n = spec.years_to_maturity * spec.frequency
    coupon = (spec.coupon_rate * spec.face_value) / spec.frequency
    y = ytm / spec.frequency
    
    price = 0.0
    for i in _coupon_periods(n):
        price += coupon / ((1 + y) ** i)
    
    price += spec.face_value / ((1 + y) ** n)
    return price

def bond_ytm(spec: BondSpec, price: float) -> float:
    """Solve yield to maturity from a clean price using bisection on
    bond_price. Search range [-0.5, 2.0], ~100 iterations, tol 1e-8."""
    low = -0.5
    high = 2.0
    if not bond_price(spec, high) <= price <= bond_price(spec, low):
        raise ValueError("Price is outside the range solvable for yield (-50% to 200%).")
    for _ in range(100):
        mid = (low + high) / 2
        if bond_price(spec, mid) > price:
            low = mid
        else:
            high = mid
        if abs(high - low) < 1e-8:
            break
    return (low + high) / 2

def macaulay_duration(spec: BondSpec, ytm: float) -> float:
    """PV-weighted average time (in years) to cash flows."""
    n = spec.years_to_maturity * spec.frequency
    coupon = (spec.coupon_rate * spec.face_value) / spec.frequency
    y = ytm / spec.frequency
    
    weighted_pv = 0.0
    total_pv = 0.0
    for i in _coupon_periods(n):
        t = i / spec.frequency
        pv = coupon / ((1 + y) ** i)
        weighted_pv += t * pv
        total_pv += pv
    
    # Add face value
    pv_face = spec.face_value / ((1 + y) ** n)
    weighted_pv += (n / spec.frequency) * pv_face
    total_pv += pv_face
    
    return weighted_pv / total_pv

def modified_duration(spec: BondSpec, ytm: float) -> float:
    """macaulay_duration / (1 + ytm/frequency)."""
    return macaulay_duration(spec, ytm) / (1 + ytm / spec.frequency)

def convexity(spec: BondSpec, ytm: float) -> float:
    """Standard bond convexity (in years^2)."""
    n = spec.years_to_maturity * spec.frequency
    coupon = (spec.coupon_rate * spec.face_value) / spec.frequency
    y = ytm / spec.frequency
    price = bond_price(spec, ytm)
    
    conv = 0.0
    for i in _coupon_periods(n):
        t = i / spec.frequency
        pv = coupon / ((1 + y) ** i)
        conv += pv * t * (t + 1/spec.frequency)
    
    pv_face = spec.face_value / ((1 + y) ** n)
    t_n = n / spec.frequency
    conv += pv_face * t_n * (t_n + 1/spec.frequency)
    
    return conv / (price * (1 + y)**2)

def dv01(spec: BondSpec, ytm: float) -> float:
    """Dollar value of 1 basis point: price change for a 1bp yield move.
    Return a positive number = abs(price(ytm) - price(ytm+0.0001))."""
    p1 = bond_price(spec, ytm)
    p2 = bond_price(spec, ytm + 0.0001)
    return abs(p1 - p2)

def current_yield(spec: BondSpec, price: float | None = None) -> float:
    """Annual coupon income / price. Without a price, the bond is assumed at par
    (face_value), which reduces to coupon_rate."""
    if not price or price <= 0:
        return spec.coupon_rate
    return (spec.coupon_rate * spec.face_value) / price

def analytics(spec: BondSpec, *, ytm: float | None = None, price: float | None = None) -> dict:
    """Convenience aggregator. Exactly one of ytm/price must be provided.
    If price given, derive ytm via bond_ytm. Return dict with keys:
    face_value, coupon_rate, years_to_maturity, frequency, ytm, price,
    macaulay_duration, modified_duration, convexity, dv01, current_yield.
    Round floats to 6 dp. Raise ValueError if neither/both of ytm,price given."""
    if (ytm is None and price is None) or (ytm is not None and price is not None):
        raise ValueError("Exactly one of ytm or price must be provided.")
    
    if ytm is not None and ytm <= -spec.frequency:
        raise ValueError("ytm must be greater than -frequency.")
    if ytm is None:
        ytm = bond_ytm(spec, price)
    else:
        price = bond_price(spec, ytm)
    
    res = {
        "face_value": spec.face_value,
        "coupon_rate": spec.coupon_rate,
        "years_to_maturity": spec.years_to_maturity,
        "frequency": spec.frequency,
        "ytm": round(ytm, 6),
        "price": round(price, 6),
        "macaulay_duration": round(macaulay_duration(spec, ytm), 6),
        "modified_duration": round(modified_duration(spec, ytm), 6),
        "convexity": round(convexity(spec, ytm), 6),
        "dv01": round(dv01(spec, ytm), 6),
        "current_yield": round(current_yield(spec, price), 6),
    }
    return res
