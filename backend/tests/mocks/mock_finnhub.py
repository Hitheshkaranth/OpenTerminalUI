class MockFinnhubClient:
    async def get_company_news(self, symbol: str, limit: int = 30):
        return [{"headline": f"{symbol} headline", "url": "https://example.com", "datetime": 0}]
