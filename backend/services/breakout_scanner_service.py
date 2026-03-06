from __future__ import annotations

from typing import Any

from backend.breakout_engine.detectors import scan_patterns


class BreakoutScannerService:
    def scan(
        self,
        items: list[dict[str, Any]],
        *,
        patterns: list[str],
        lookback: int = 20,
        min_volume_ratio: float = 1.2,
        min_confidence: float = 0.0,
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for item in items:
            symbol = str(item.get("symbol") or "").strip().upper()
            candles = item.get("candles")
            if not symbol or not isinstance(candles, list):
                continue
            signals = scan_patterns(
                candles,
                patterns,
                lookback=lookback,
                min_volume_ratio=min_volume_ratio,
            )
            filtered = [s for s in signals if float(s.get("confidence") or 0.0) >= min_confidence]
            out.append(
                {
                    "symbol": symbol,
                    "signals": filtered,
                    "triggered_count": sum(1 for s in filtered if bool(s.get("triggered"))),
                }
            )
        out.sort(key=lambda row: row.get("triggered_count", 0), reverse=True)
        return out


_scanner_service: BreakoutScannerService | None = None


def get_breakout_scanner_service() -> BreakoutScannerService:
    global _scanner_service
    if _scanner_service is None:
        _scanner_service = BreakoutScannerService()
    return _scanner_service
