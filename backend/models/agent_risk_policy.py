"""User-configured policy for approval-gated agent paper trades."""
from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.shared.db import Base


class AgentRiskPolicy(Base):
    __tablename__ = "agent_risk_policies"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    policy: Mapped[dict] = mapped_column(JSON, nullable=False)
