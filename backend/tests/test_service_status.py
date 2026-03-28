from __future__ import annotations

from backend.core.service_status import ServiceStatusRegistry


def test_service_status_registry_reports_degraded_for_optional_failures() -> None:
    registry = ServiceStatusRegistry()
    registry.mark_ok("database", required=True)
    registry.mark_degraded("marketdata_hub", required=False, detail="redis down")

    assert registry.overall_status() == "degraded"
    snapshot = registry.snapshot()
    assert snapshot["marketdata_hub"]["detail"] == "redis down"


def test_service_status_registry_reports_error_for_required_failures() -> None:
    registry = ServiceStatusRegistry()
    registry.mark_degraded("database", required=True, detail="migration failed")

    assert registry.overall_status() == "error"
