# TASK: Build Data Quality Monitoring Dashboard

## Project Context

OpenTerminalUI — React 18 + TypeScript + Vite + Tailwind + Recharts frontend, FastAPI + SQLAlchemy backend. Ops dashboard at `frontend/src/pages/OpsDashboard.tsx`. Background services in `backend/bg_services/`. Data adapters in `backend/adapters/` (Yahoo, FMP, NSE, Finnhub, Kite). Health route at `backend/api/routes/health.py`. Terminal dark theme. Tests: pytest + Playwright.

## What to Build

### Backend: `backend/core/data_quality.py`

```python
import time
from collections import defaultdict

class DataQualityMonitor:
    """Track data feed health metrics."""

    def __init__(self):
        self._fetch_log: dict[str, list] = defaultdict(list)  # source -> [{timestamp, latency_ms, success, error}]
        self._max_log_size = 1000

    def record_fetch(self, source: str, latency_ms: float, success: bool, error: str = None):
        """Record a data fetch attempt."""
        self._fetch_log[source].append({
            "timestamp": time.time(),
            "latency_ms": latency_ms,
            "success": success,
            "error": error
        })
        if len(self._fetch_log[source]) > self._max_log_size:
            self._fetch_log[source] = self._fetch_log[source][-self._max_log_size:]

    def get_source_health(self, source: str, window_minutes: int = 60) -> dict:
        """Get health metrics for a data source."""
        cutoff = time.time() - (window_minutes * 60)
        recent = [f for f in self._fetch_log[source] if f["timestamp"] > cutoff]
        if not recent:
            return {"status": "unknown", "requests": 0}

        successes = sum(1 for f in recent if f["success"])
        total = len(recent)
        latencies = [f["latency_ms"] for f in recent if f["success"]]

        return {
            "status": "healthy" if successes / total > 0.95 else "degraded" if successes / total > 0.8 else "unhealthy",
            "requests": total,
            "success_rate": round(successes / total * 100, 1),
            "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0,
            "p95_latency_ms": round(sorted(latencies)[int(len(latencies) * 0.95)] if latencies else 0, 1),
            "error_count": total - successes,
            "last_success": max((f["timestamp"] for f in recent if f["success"]), default=None),
            "last_error": next((f["error"] for f in reversed(recent) if not f["success"]), None),
        }

    def get_all_sources_health(self) -> dict:
        return {source: self.get_source_health(source) for source in self._fetch_log}

# Singleton
data_quality_monitor = DataQualityMonitor()
```

Integrate `data_quality_monitor.record_fetch()` calls into the adapter layer:
- In each adapter's fetch method, wrap the actual HTTP call with timing and success/failure tracking
- Add calls in Yahoo, FMP, NSE, Finnhub adapters (just a few lines each)

### Backend: Data Gap Detection

```python
async def detect_data_gaps(symbol: str, interval: str = "1d", days: int = 30) -> list:
    """Detect missing bars in OHLCV data."""
    # Fetch data, check for date gaps (missing trading days)
    # Return: [{expected_date, gap_type: "missing"|"stale"}]
```

### Backend Routes: `backend/api/routes/data_quality.py`

```
GET /api/ops/data-quality
  Returns: {
    overall_status: "healthy"|"degraded"|"unhealthy",
    sources: {
      "yahoo": {status, success_rate, avg_latency_ms, p95_latency_ms, error_count, last_success, last_error},
      "nse": {...},
      "fmp": {...},
      "finnhub": {...}
    },
    summary: {total_requests_1h, overall_success_rate, avg_latency}
  }

GET /api/ops/data-quality/latency-history?source=yahoo&minutes=60
  Returns: {
    source,
    series: [{timestamp, latency_ms}]
  }

GET /api/ops/data-quality/gaps?symbol=RELIANCE&interval=1d&days=30
  Returns: {
    symbol, gaps: [{date, gap_type}], total_gaps
  }
```

Register in `backend/main.py`.

### Frontend: Add "Data Quality" Tab to OpsDashboard

In `frontend/src/pages/OpsDashboard.tsx`, add a "Data Quality" tab:

1. **Source Health Cards** (one per data source):
   - Source name (Yahoo, NSE, FMP, Finnhub)
   - Status badge: green "Healthy" / amber "Degraded" / red "Unhealthy"
   - Success rate: percentage with color
   - Avg latency: ms value
   - Last error: truncated error message (if any)
   - Requests in last hour: count

2. **Latency Chart** (Recharts line chart):
   - Source selector tabs
   - Line chart of latency over last 60 minutes
   - P95 reference line (dashed)
   - Color: green when below threshold, red when above

3. **Error Log** (bottom):
   - Scrollable list of recent errors across all sources
   - Each entry: timestamp, source, error message
   - Filter by source

4. **Data Gap Checker** (side panel):
   - Symbol input
   - "Check" button → shows gap list for that symbol
   - Gap count and dates

### Tests

**Backend** (`backend/tests/test_data_quality.py`):
```python
# Test DataQualityMonitor records fetches correctly
# Test health status: >95% success = healthy, 80-95% = degraded, <80% = unhealthy
# Test latency calculation is correct
# Test GET /api/ops/data-quality returns all sources
# Test gap detection finds missing dates
```

**E2E** (`frontend/tests/data-quality.spec.ts`):
```typescript
// Navigate to /equity/ops
// Click "Data Quality" tab
// Verify source health cards render (at least 1 source)
// Verify status badges are colored correctly
// Verify latency chart renders
```
