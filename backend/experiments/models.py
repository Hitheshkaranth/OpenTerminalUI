from sqlalchemy import Column, String, Integer, DateTime, JSON
from backend.db.database import Base
from datetime import datetime, timezone

def _utcnow():
    return datetime.now(timezone.utc)

class Experiment(Base):
    __tablename__ = "experiments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, index=True)
    created_at = Column(DateTime, default=_utcnow)
    config_json = Column(JSON, nullable=True)
    data_hash = Column(String, nullable=True)
    code_hash = Column(String, nullable=True)
    metrics_json = Column(JSON, nullable=True)
    tags = Column(JSON, nullable=True)

class ExperimentArtifact(Base):
    __tablename__ = "experiment_artifacts"

    id = Column(String, primary_key=True)
    experiment_id = Column(Integer, index=True)
    artifact_type = Column(String)
    storage_path = Column(String)
