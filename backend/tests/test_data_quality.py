import os
os.environ["AUTH_MIDDLEWARE_ENABLED"] = "0"

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_data_quality_lifecycle():
    # 1. Start with an empty or existing dashboard
    r1 = client.get("/api/data-quality/dashboard")
    assert r1.status_code == 200
    data1 = r1.json()
    initial_scans = len(data1.get("scans", []))

    # 2. Add a new scan run
    dataset_req = "test_dataset_alpha_v1"
    r2 = client.post("/api/data-quality/run", json={"dataset_id": dataset_req})
    assert r2.status_code == 200
    res2 = r2.json()
    assert "scan_id" in res2
    assert res2["status"] == "completed"

    # 3. Check dashboard integration
    r3 = client.get("/api/data-quality/dashboard")
    assert r3.status_code == 200
    data3 = r3.json()

    # Scan history should increment or contain our recent scan
    assert len(data3["scans"]) > initial_scans
    latest_scan = data3["scans"][0]
    assert latest_scan["scan_id"] == res2["scan_id"]
    assert latest_scan["dataset_id"] == dataset_req

    # Anomalies might be empty or present
    assert "anomalies" in data3
