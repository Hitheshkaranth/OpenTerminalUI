class MockKiteConnect:
    def quote(self, instruments):
        return {i: {"last_price": 100.0, "net_change": 0.5} for i in instruments}
