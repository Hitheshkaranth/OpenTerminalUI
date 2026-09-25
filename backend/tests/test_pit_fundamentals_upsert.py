from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.models import FundamentalsPitORM
from backend.services.pit_fundamentals_service import PitFundamentalRecord, upsert_pit_records
from backend.shared.db import Base


def test_upsert_pit_records_dedupes_same_key_within_batch():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        common = dict(
            symbol="AAPL",
            metric="net_income",
            fiscal_period="FY",
            as_of_release_date=date(2024, 11, 1),
            release_date_estimated=False,
            source="fmp",
            market="US",
        )
        records = [PitFundamentalRecord(value=100.0, **common), PitFundamentalRecord(value=101.0, **common)]
        upsert_pit_records(db, records, data_version_id="v1")
        rows = db.query(FundamentalsPitORM).all()
        assert len(rows) == 1
        assert rows[0].value == 101.0
    finally:
        db.close()
