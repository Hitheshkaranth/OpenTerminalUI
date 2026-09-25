import pytest
from backend.core.bond_analytics import BondSpec, bond_price, bond_ytm, macaulay_duration, modified_duration, convexity, dv01, current_yield, analytics

def test_bond_par_pricing():
    # A bond priced at its coupon rate trades at par
    spec = BondSpec(coupon_rate=0.05, years_to_maturity=10, frequency=2, face_value=100.0)
    price = bond_price(spec, 0.05)
    assert price == pytest.approx(100.0, abs=1e-4)

def test_bond_ytm_roundtrip():
    # Round-trip: price a bond at ytm=0.06, feed price into bond_ytm -> approx 0.06 (abs=1e-6)
    spec = BondSpec(coupon_rate=0.05, years_to_maturity=10, frequency=2)
    ytm_target = 0.06
    price = bond_price(spec, ytm_target)
    ytm_solved = bond_ytm(spec, price)
    assert ytm_solved == pytest.approx(ytm_target, abs=1e-6)

def test_bond_monotonicity():
    # Yield up => price down (monotonic): bond_price(spec, 0.07) < bond_price(spec, 0.05)
    spec = BondSpec(coupon_rate=0.05, years_to_maturity=10, frequency=2)
    assert bond_price(spec, 0.07) < bond_price(spec, 0.05)

def test_bond_durations():
    # modified_duration < macaulay_duration and both > 0
    spec = BondSpec(coupon_rate=0.05, years_to_maturity=10, frequency=2)
    ytm = 0.05
    mac_dur = macaulay_duration(spec, ytm)
    mod_dur = modified_duration(spec, ytm)
    assert 0 < mod_dur < mac_dur

def test_bond_convexity_dv01():
    # convexity > 0 and dv01 > 0
    spec = BondSpec(coupon_rate=0.05, years_to_maturity=10, frequency=2)
    ytm = 0.05
    assert convexity(spec, ytm) > 0
    assert dv01(spec, ytm) > 0

def test_bond_analytics_aggregator():
    spec = BondSpec(coupon_rate=0.05, years_to_maturity=10, frequency=2)
    res = analytics(spec, ytm=0.05)
    expected_keys = {
        "face_value", "coupon_rate", "years_to_maturity", "frequency", "ytm", "price",
        "macaulay_duration", "modified_duration", "convexity", "dv01", "current_yield"
    }
    assert set(res.keys()) == expected_keys
    assert res["price"] == 100.0
    
    with pytest.raises(ValueError):
        analytics(spec, ytm=0.05, price=100.0)
    with pytest.raises(ValueError):
        analytics(spec)

def test_fractional_maturity_keeps_final_coupon():
    # 0.75y semi-annual bond: coupons at 0.25y and 0.75y plus face at maturity
    spec = BondSpec(coupon_rate=0.05, years_to_maturity=0.75, frequency=2)
    expected = 2.5 / 1.025 ** 0.5 + 102.5 / 1.025 ** 1.5
    assert bond_price(spec, 0.05) == pytest.approx(expected, abs=1e-9)
    assert bond_ytm(spec, expected) == pytest.approx(0.05, abs=1e-6)

def test_current_yield_uses_price_and_ytm_rejects_unsolvable_price():
    spec = BondSpec(coupon_rate=0.05, years_to_maturity=10, frequency=2)
    assert analytics(spec, price=80.0)["current_yield"] == pytest.approx(0.0625, abs=1e-6)
    with pytest.raises(ValueError):
        bond_ytm(spec, -5.0)
