import asyncio
import os
os.environ["AUTH_MIDDLEWARE_ENABLED"] = "0"

from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app
from backend.shared.cache import cache

client = TestClient(app)

def test_cockpit_summary_schema_and_cache():
    # Ensure cache is clear before test
    asyncio.run(cache.set("openterminalui:cockpit:summary:aggregator", None, ttl=0))
    cache._l1_cache.clear()

    with patch("backend.cockpit.service.logger") as mock_logger:
        # First call (Cache Miss)
        resp1 = client.get("/api/cockpit/summary")
        assert resp1.status_code == 200
        data1 = resp1.json()

        # Verify schema keys
        assert "portfolio_snapshot" in data1
        assert "signal_summary" in data1
        assert "risk_summary" in data1
        assert "events" in data1
        assert "news" in data1

        # Check logs for cache miss
        mock_logger.info.assert_called()
        call_args = mock_logger.info.call_args_list[-1]
        assert call_args[0][0] == "cockpit_summary_request"
        assert call_args[1]["extra"]["cache_hit"] is False

    with patch("backend.cockpit.service.logger") as mock_logger:
        # Second call (Cache Hit)
        resp2 = client.get("/api/cockpit/summary")
        assert resp2.status_code == 200

        # Check logs for cache hit
        mock_logger.info.assert_called()
        call_args = mock_logger.info.call_args_list[-1]
        assert call_args[0][0] == "cockpit_summary_request"
        assert call_args[1]["extra"]["cache_hit"] is True
