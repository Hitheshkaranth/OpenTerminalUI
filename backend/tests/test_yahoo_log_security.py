import asyncio
import logging
from unittest.mock import AsyncMock

import httpx

from backend.core.yahoo_client import YahooClient


def test_quote_summary_error_does_not_log_authenticated_url(caplog):
    request = httpx.Request("GET", "https://query2.finance.yahoo.com/quoteSummary/AAPL?crumb=sentinel-private-crumb")
    response = httpx.Response(403, request=request)
    error = httpx.HTTPStatusError("blocked: " + str(request.url), request=request, response=response)
    client = YahooClient()
    client._ensure_client = AsyncMock()
    client._ensure_crumb = AsyncMock()
    client.client = AsyncMock()
    client.client.get.side_effect = error
    with caplog.at_level(logging.WARNING):
        assert asyncio.run(client.get_quote_summary("AAPL")) == {}
    assert "HTTP 403" in caplog.text
    assert "sentinel-private-crumb" not in caplog.text
    assert "https://" not in caplog.text
