from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


class ScheduleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    screen_id: str = Field(min_length=1, max_length=36)
    universe: Literal["nse_500", "all_nse", "nifty_50", "nifty_500", "sp_500", "nasdaq_100", "us_all"] = "nse_500"
    market: Literal["IN", "US"] = "IN"
    frequency: Literal["daily", "weekly"] = "daily"
    enabled: bool = True
    max_age_hours: int = Field(default=168, ge=1, le=2160)


class SchedulePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool | None = None
    frequency: Literal["daily", "weekly"] | None = None
