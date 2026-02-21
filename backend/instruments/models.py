from sqlalchemy import Column, String, JSON
from backend.db.database import Base

class InstrumentMaster(Base):
    __tablename__ = "instrument_master"

    canonical_id = Column(String, primary_key=True)
    display_symbol = Column(String, index=True)
    type = Column(String)  # e.g., spot, futures, options, crypto
    exchange = Column(String)
    currency = Column(String)
    tick_size = Column(String, nullable=True)
    lot_size = Column(String, nullable=True)
    vendor_mappings_json = Column(JSON, nullable=True)
