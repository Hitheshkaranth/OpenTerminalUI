import hashlib
from typing import List
from backend.data_quality.schemas import (
    DataQualityRunResponse,
    DataQualityDashboardResponse,
    AnomalyEvent
)

# In-memory storage of recent scans for the dashboard
_scan_history = []
_anomalies_history = []

def run_quality_scan(dataset_id: str) -> DataQualityRunResponse:
    # Deterministic pseudo-random generation based on dataset_id
    h = hashlib.md5(dataset_id.encode()).hexdigest()
    scan_id = f"dq_scan_{h[:8]}"

    anomalies = []

    # 1. Missing Bars
    if int(h[0], 16) % 3 == 0:
        anomalies.append(AnomalyEvent(
            type="missing_bars",
            description=f"Found {int(h[1], 16) * 2 + 1} missing 1m bars in dataset {dataset_id}"
        ))

    # 2. Duplicates
    if int(h[2], 16) % 4 == 0:
        anomalies.append(AnomalyEvent(
            type="duplicates",
            description=f"Duplicate timestamps detected for {dataset_id} on {int(h[3:5], 16)} rows"
        ))

    # 3. Outliers (Z-score)
    z_score = 3.0 + (int(h[5], 16) / 10.0)
    if z_score > 3.5:
        anomalies.append(AnomalyEvent(
            type="outlier",
            description=f"Price spike detected violating z-score threshold (z={round(z_score, 2)}) in {dataset_id}"
        ))

    # 4. Stale Series
    if int(h[6], 16) % 5 == 0:
        anomalies.append(AnomalyEvent(
            type="stale_data",
            description=f"Last updated timestamp for {dataset_id} is > 48 hours old"
        ))

    global _scan_history, _anomalies_history
    _scan_history.insert(0, {
        "scan_id": scan_id,
        "dataset_id": dataset_id,
        "status": "completed",
        "anomalies_count": len(anomalies)
    })
    _anomalies_history.extend(anomalies)

    # Keep only recent
    _scan_history = _scan_history[:50]
    _anomalies_history = _anomalies_history[:100]

    return DataQualityRunResponse(
        scan_id=scan_id,
        status="completed"
    )

def get_dashboard_summary() -> DataQualityDashboardResponse:
    return DataQualityDashboardResponse(
        scans=_scan_history,
        anomalies=_anomalies_history
    )
