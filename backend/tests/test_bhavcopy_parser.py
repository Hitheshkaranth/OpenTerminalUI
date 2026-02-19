from __future__ import annotations

from backend.bg_services.nse_fno_bhavcopy import parse_bhavcopy_csv


def test_parse_bhavcopy_csv() -> None:
    csv_text = """INSTRUMENT,SYMBOL,EXPIRY_DT,STRIKE_PR,OPTION_TYP,OPEN,HIGH,LOW,CLOSE,SETTLE_PR,CONTRACTS,VAL_INLAKH,OPEN_INT,CHG_IN_OI,TIMESTAMP
FUTSTK,RELIANCE,27-FEB-2026,0,XX,2500,2520,2488,2510,2510,12000,4300.5,100000,5000,19-FEB-2026
"""
    rows = parse_bhavcopy_csv(csv_text)
    assert len(rows) == 1
    row = rows[0]
    assert row["symbol"] == "RELIANCE"
    assert row["trade_date"] == "19-FEB-2026"
    assert row["contracts"] == 12000
