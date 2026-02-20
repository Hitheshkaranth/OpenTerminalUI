from __future__ import annotations

import json
from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes.options import router as options_router


def test_options_chain_mock_provider_integration(mock_adapter_registry, fixtures_dir) -> None:  # noqa: ARG001
    payload = json.loads((fixtures_dir / "options_chain_request.json").read_text(encoding="utf-8"))
    underlying = payload["underlying"]
    provider = payload["provider"]
    expiry = (date.today() + timedelta(days=7)).isoformat()

    app = FastAPI()
    app.include_router(options_router)
    client = TestClient(app)

    resp = client.get(
        f"/api/options/chain/{underlying}",
        params={"provider": provider, "expiry": expiry},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["underlying"] == underlying
    assert data["expiry"] == expiry
    assert data["spot_price"] > 0
    assert isinstance(data["contracts"], list)
    assert len(data["contracts"]) > 20
    assert any(c["option_type"] == "CE" for c in data["contracts"])
    assert any(c["option_type"] == "PE" for c in data["contracts"])
