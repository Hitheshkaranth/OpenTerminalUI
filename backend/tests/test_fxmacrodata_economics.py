"""Offline native service/router tests; values are synthetic fixtures."""
import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fxmacrodata_public import Result, list_operations

from backend.api.routes.economics import get_economic_data_service, router
from backend.services.fxmacrodata_economics import FXMacroDataEconomics


class FixtureClient:
    def execute(self, operation, arguments):
        if operation == "release_calendar":
            return Result(
                operation,
                {
                    "data": [
                        {
                            "name": "Fixture release",
                            "date": "2025-12-01",
                            "announcement_datetime": 1767358800,
                            "event_importance": "high",
                            "source_url": "https://example.org/release",
                        },
                        {"name": "Date only", "date": "2026-01-02"},
                    ]
                },
            )
        return Result(
            operation,
            {
                "value_name": "Fixture indicator",
                "unit": "index",
                "data": [
                    {"date": "2026-01-02", "val": 125.0},
                    {"date": "2026-01-01", "val": 124.0},
                ],
            },
        )


@pytest.mark.parametrize(
    "operation", list_operations(include_mcp=False), ids=lambda operation: operation.name
)
def test_all_operations_produce_typed_native_records(operation):
    service = FXMacroDataEconomics(FixtureClient())
    response = asyncio.run(service.query(operation.name, {}))
    assert response.operation == operation.name
    assert response.status == "available"
    assert response.records and response.data
    descriptor = next(
        item for item in service.operations() if item["name"] == operation.name
    )
    assert descriptor["input_schema"] == operation.input_schema


def test_calendar_uses_release_instant_not_reference_period_date():
    service = FXMacroDataEconomics(FixtureClient())
    events = asyncio.run(service.get_economic_calendar("2026-01-01", "2026-01-04"))
    assert len(events) == 1
    assert events[0]["date"] == "2026-01-02"
    assert events[0]["source_record"]["date"] == "2025-12-01"
    assert events[0]["forecast"] is None
    assert events[0]["actual"] is None
    assert events[0]["timezone"] == "UTC"


def test_macro_values_keep_units_and_source():
    response = asyncio.run(FXMacroDataEconomics(FixtureClient()).get_macro_indicators())
    assert response["us"]["gdp"]["value"] == 125
    assert response["us"]["gdp"]["unit"] == "index"
    assert response["us"]["gdp"]["source_payload"]["value_name"] == "Fixture indicator"


def test_macro_joins_catalogue_units_when_history_has_no_unit():
    class PublicContractClient:
        def execute(self, operation, arguments):
            if operation == "data_catalogue":
                return Result(
                    operation,
                    {
                        "policy_rate": {"name": "Policy rate", "unit": "%"},
                        "gdp": {"name": "GDP", "unit": "USD bn"},
                    },
                )
            return Result(
                operation,
                {
                    "value_name": "Fixture series",
                    "data": [{"date": "2026-01-02", "val": 3.75}],
                },
            )

    result = asyncio.run(
        FXMacroDataEconomics(PublicContractClient()).get_macro_indicators()
    )["us"]
    assert result["policy_rate"]["unit"] == "%"
    assert result["gdp"]["unit"] == "USD bn"
    assert result["gdp"]["catalogue_record"] == {"name": "GDP", "unit": "USD bn"}
    assert "unit" not in result["gdp"]["source_payload"]
    assert result["inflation"]["unit"] == ""


def test_missing_catalogue_does_not_invent_units_or_discard_observations():
    class UnavailableCatalogue:
        def execute(self, operation, arguments):
            if operation == "data_catalogue":
                raise RuntimeError("unavailable")
            return Result(operation, {"data": [{"date": "2026-01-02", "val": 3.75}]})

    result = asyncio.run(
        FXMacroDataEconomics(UnavailableCatalogue()).get_macro_indicators()
    )["us"]
    assert result["policy_rate"]["value"] == 3.75
    assert result["policy_rate"]["unit"] == ""
    assert result["policy_rate"]["catalogue_record"] == {}


def test_nonfinite_observations_are_unavailable():
    class InvalidValues:
        def execute(self, operation, arguments):
            return Result(operation, {"data": [{"val": float("nan")}, {"val": True}]})

    assert (
        asyncio.run(FXMacroDataEconomics(InvalidValues()).get_macro_indicators()) == {}
    )


def test_native_routes_expose_calendar_and_explorer():
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_economic_data_service] = lambda: FXMacroDataEconomics(
        FixtureClient()
    )
    with TestClient(app) as client:
        assert (
            client.get("/api/economics/calendar?from=2026-01-01&to=2026-01-04").json()[
                0
            ]["date"]
            == "2026-01-02"
        )
        operations = client.get("/api/economics/operations").json()
        assert len(operations) == len(list_operations(include_mcp=False))
        assert not any(op["name"].startswith("mcp_") for op in operations)
        assert (
            client.post(
                "/api/economics/query",
                json={"operation": "mcp_subscribe_for_mcp_access", "arguments": {}},
            ).json()["status"]
            == "unavailable"
        )
        result = client.post(
            "/api/economics/query",
            json={"operation": "data_catalogue", "arguments": {"currency": "USD"}},
        )
        assert result.status_code == 200
        assert result.json()["records"][0]["val"] == 125
        assert (
            client.get("/api/economics/calendar?from=invalid&to=2026-01-01").status_code
            == 422
        )


def test_unavailable_is_explicit_never_synthetic():
    class Unavailable:
        def execute(self, *args):
            raise RuntimeError("transport details must remain private")

    service = FXMacroDataEconomics(Unavailable())
    assert asyncio.run(service.get_macro_indicators()) == {}
    with pytest.raises(RuntimeError, match="unavailable"):
        asyncio.run(service.get_economic_calendar("2026-01-01", "2026-01-04"))
    result = asyncio.run(service.query("data_catalogue", {}))
    assert result.status == "unavailable" and result.records == []
    assert "transport details" not in result.model_dump_json()
