import pytest
import math
from backend.core.option_greeks import OptionSpec, bs_price, delta, gamma, vega, implied_volatility, greeks

def test_atm_call_price():
    # ATM call price sanity: OptionSpec(spot=100, strike=100, time_to_expiry=1, rate=0.05, volatility=0.2)
    # -> bs_price approx 10.4506 (abs=1e-3)
    spec = OptionSpec(spot=100, strike=100, time_to_expiry=1, rate=0.05, volatility=0.2)
    price = bs_price(spec)
    assert price == pytest.approx(10.4506, abs=1e-3)

def test_put_call_parity():
    # Put-call parity: call_price - put_price approx S*exp(-q*T) - K*exp(-r*T) (abs=1e-6)
    spot = 100
    strike = 100
    T = 1
    r = 0.05
    q = 0.02
    vol = 0.2
    
    call_spec = OptionSpec(spot=spot, strike=strike, time_to_expiry=T, rate=r, volatility=vol, dividend_yield=q, option_type="call")
    put_spec = OptionSpec(spot=spot, strike=strike, time_to_expiry=T, rate=r, volatility=vol, dividend_yield=q, option_type="put")
    
    c = bs_price(call_spec)
    p = bs_price(put_spec)
    
    lhs = c - p
    rhs = spot * math.exp(-q * T) - strike * math.exp(-r * T)
    
    assert lhs == pytest.approx(rhs, abs=1e-6)

def test_greeks_signs():
    # Call delta in (0,1), put delta in (-1,0); gamma>0; vega>0
    spec_call = OptionSpec(spot=100, strike=100, time_to_expiry=1, rate=0.05, volatility=0.2, option_type="call")
    spec_put = OptionSpec(spot=100, strike=100, time_to_expiry=1, rate=0.05, volatility=0.2, option_type="put")
    
    assert 0 < delta(spec_call) < 1
    assert -1 < delta(spec_put) < 0
    assert gamma(spec_call) > 0
    assert vega(spec_call) > 0

def test_iv_roundtrip():
    # implied_volatility round-trip: price a call at vol=0.25, recover ~0.25 via implied_volatility (abs=1e-4)
    vol_target = 0.25
    spec = OptionSpec(spot=100, strike=105, time_to_expiry=0.5, rate=0.03, volatility=vol_target, option_type="call")
    price = bs_price(spec)
    iv = implied_volatility(spec, price)
    assert iv == pytest.approx(vol_target, abs=1e-4)

def test_invalid_option_type():
    # option_type="bogus" raises ValueError
    spec = OptionSpec(spot=100, strike=100, time_to_expiry=1, rate=0.05, volatility=0.2, option_type="bogus")
    with pytest.raises(ValueError):
        bs_price(spec)

def test_iv_rejects_price_outside_bs_range():
    # A call can never be worth more than spot; bisection used to silently return vol=5.0
    spec = OptionSpec(spot=100, strike=100, time_to_expiry=1, rate=0.05, volatility=0.2, option_type="call")
    with pytest.raises(ValueError):
        implied_volatility(spec, 150.0)
