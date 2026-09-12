"""FXMacroData presentation views for the economics terminal."""

from __future__ import annotations

import asyncio
import math
from datetime import date, datetime, timezone
from typing import Any

from fxmacrodata_public import FXMacroDataClient, list_operations
from pydantic import BaseModel, Field

PROVIDER_URL = (
    "https://fxmacrodata.com/?utm_source=openterminalui&utm_medium=integration"
    "&utm_campaign=open_source_integrations&utm_content=app"
)


class OperationResult(BaseModel):
    """Lossless public response with a separate table presentation view."""

    operation: str
    data: Any = None
    records: list[dict[str, Any]] = Field(default_factory=list)
    source_url: str | None = None
    provider_url: str = PROVIDER_URL
    status: str = "available"
    error: str | None = None


def release_instant(row: dict[str, Any]) -> datetime | None:
    """Read an observed release timestamp; never use a reference-period date."""
    value = row.get("announcement_datetime_utc") or row.get("announcement_datetime")
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return datetime.fromtimestamp(value, tz=timezone.utc)
        if isinstance(value, str):
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, OverflowError, OSError):
        return None
    return None


def _rest_operations():
    """Public REST catalogue only; hosted MCP tools (paid tier, subscribe CTA) are not exposed."""
    return list_operations(include_mcp=False)


class FXMacroDataEconomics:
    """Read-only provider using a private host secret and bounded requests."""

    def __init__(self, client: FXMacroDataClient | None = None):
        # An injected client is shared (tests). Otherwise a client is built per
        # call: FXMacroDataClient.execute holds an instance lock for the whole
        # request, so a single shared instance would serialize every request.
        self.client = client

    def _client(self) -> FXMacroDataClient:
        if self.client is not None:
            return self.client
        from backend.config.settings import get_settings

        secret = get_settings().fxmacrodata_api_key
        return FXMacroDataClient(api_key=secret.get_secret_value() if secret else "")

    def operations(self) -> list[dict[str, Any]]:
        return [
            {
                "name": op.name,
                "description": op.description,
                "input_schema": op.input_schema,
                "method": op.method,
            }
            for op in _rest_operations()
        ]

    async def query(self, operation: str, arguments: dict[str, Any]) -> OperationResult:
        if operation not in {op.name for op in _rest_operations()}:
            return OperationResult(
                operation=operation, status="unavailable", error="Unknown operation."
            )
        try:
            result = await asyncio.to_thread(self._client().execute, operation, arguments)
            return OperationResult(**result.as_dict())
        except Exception:
            return OperationResult(
                operation=operation,
                status="unavailable",
                error="FXMacroData could not complete this request.",
            )

    async def get_economic_calendar(
        self, start_date: str, end_date: str
    ) -> list[dict[str, Any]]:
        start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
        if end < start:
            raise ValueError("End date must follow start date.")
        result = await self.query(
            "release_calendar",
            {
                "currency": "USD",
                "start_date": start_date,
                "end_date": end_date,
            },
        )
        if result.status != "available":
            raise RuntimeError("Economic calendar is unavailable.")
        events = []
        for row in result.records:
            instant = release_instant(row)
            if instant is None or not start <= instant.date() <= end:
                continue
            events.append(
                {
                    "date": instant.date().isoformat(),
                    "time": instant.strftime("%H:%M:%S"),
                    "announcement_datetime_utc": instant.isoformat(),
                    "timezone": "UTC",
                    "country": "US",
                    "currency": "USD",
                    "event_name": row.get("name")
                    or row.get("release")
                    or "Economic release",
                    "impact": row.get("event_importance") or "unknown",
                    "actual": row.get("val"),
                    "forecast": row.get("market_consensus"),
                    "previous": row.get("previous_value"),
                    "unit": row.get("unit"),
                    "source_url": row.get("source_url"),
                    "provider_url": PROVIDER_URL,
                    "release_time_assumed": row.get("release_time_assumed", False),
                    "source_record": row,
                }
            )
        return sorted(events, key=lambda event: event["announcement_datetime_utc"])

    async def get_macro_indicators(self) -> dict[str, Any]:
        result = {}
        catalogue_response = await self.query("data_catalogue", {"currency": "USD"})
        catalogue = (
            catalogue_response.data if isinstance(catalogue_response.data, dict) else {}
        )
        for indicator in ("policy_rate", "inflation", "unemployment", "gdp"):
            response = await self.query(
                "indicator_history",
                {
                    "currency": "USD",
                    "indicator": indicator,
                    "limit": 13,
                },
            )
            rows = [
                row
                for row in response.records
                if isinstance(row.get("val"), (float, int))
                and not isinstance(row.get("val"), bool)
                and math.isfinite(row["val"])
            ]
            if not rows:
                continue
            latest = rows[0]
            metadata = response.data if isinstance(response.data, dict) else {}
            catalogue_record = catalogue.get(indicator, {})
            if not isinstance(catalogue_record, dict):
                catalogue_record = {}
            unit = metadata.get("unit") or catalogue_record.get("unit")
            result[indicator] = {
                "value": latest["val"],
                "last_value": rows[1]["val"] if len(rows) > 1 else None,
                "date": latest.get("date", ""),
                "label": metadata.get("value_name")
                or catalogue_record.get("name")
                or indicator,
                "unit": unit if isinstance(unit, str) else "",
                "history": [
                    {"date": row.get("date", ""), "value": row["val"]}
                    for row in reversed(rows)
                ],
                "source_url": latest.get("source_url") or metadata.get("source_url"),
                "source_record": latest,
                "source_payload": response.data,
                "catalogue_record": catalogue_record,
            }
        return {"us": result} if result else {}
