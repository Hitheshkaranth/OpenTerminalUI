from __future__ import annotations

from backend.api.routes import stream


def test_ws_quotes_route_registered() -> None:
    assert stream.router is not None
