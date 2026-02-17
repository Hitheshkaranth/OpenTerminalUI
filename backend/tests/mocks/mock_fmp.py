class MockFMPClient:
    async def get_quote(self, symbol: str):
        return {"symbol": symbol, "price": 100.0}

    async def _get(self, endpoint: str, params=None):
        return []
