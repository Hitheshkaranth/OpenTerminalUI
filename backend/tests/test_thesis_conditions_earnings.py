from datetime import datetime, timedelta, timezone
from copy import deepcopy

from backend.tests.test_research_dossiers import api, make, URL
from backend.research_dossiers.conditions import evaluate_conditions, filing_metric_observations
from backend.research_dossiers.models import ResearchDossier

CONDITION = {"id": "margin", "label": "Operating margin stays healthy", "metric": "operating_margin", "operator": "gte", "threshold": 18, "unit": "%", "enabled": True}


def evidence(value=17.4, **kwargs):
    return {"id": "q2", "claim": "Operating margin reported", "metric": "operating_margin", "value": value, "unit": "%", "period": "FY2025 Q2", "published_at": "2025-07-01T00:00:00Z", "quote": f"Operating margin was {value}%.", "source_url": "https://example.com/results", **kwargs}


def test_conditions_unknown_breached_and_conflicting_observations():
    payload = {"thesis_conditions": [CONDITION], "evidence": [evidence()]}
    assert evaluate_conditions(payload)[0]["status"] == "breached"
    assert evaluate_conditions({**payload, "evidence": [evidence(19)]})[0]["status"] == "within_threshold"
    for change in ({"period": None}, {"unit": "basis points"}, {"quote": ""}, {"published_at": None}, {"published_at": "2999-01-01T00:00:00Z"}, {"metric": "gross_margin"}):
        assert evaluate_conditions({**payload, "evidence": [evidence(**change)]})[0]["status"] == "unknown"
    assert evaluate_conditions({**payload, "thesis_conditions": [{**CONDITION, "period": "FY2026 Q2"}]})[0]["status"] == "unknown"
    result = evaluate_conditions({**payload, "evidence": [evidence(), evidence(19, id="other")]})[0]
    assert result["status"] == "unknown"
    assert result["evidence"] is None
    assert len(result["conflicting_evidence"]) == 2


def test_monitor_records_deduplicated_condition_changes_with_source(api):
    client, _, _ = api
    row = make(client, thesis_conditions=[CONDITION], evidence=[evidence(19, id="q1", published_at="2025-04-01T00:00:00Z")])
    path = f"{URL}/{row['id']}"
    first = client.post(path + "/monitor", json={"evidence": [evidence()]}).json()
    change = next(c for c in first["changes"] if c["kind"] == "condition_changed")
    assert change["after"]["status"] == "breached"
    assert change["after"]["previous_value"] == 19
    assert change["after"]["evidence"]["source_url"] == "https://example.com/results"
    repeated = client.post(path + "/monitor", json={"evidence": [evidence(observed_at="2026-01-01T00:00:00Z")]}).json()
    assert repeated["changes"] == []
    assert repeated["dossier"]["thesis"] == row["thesis"]
    assert client.get(path + "/conditions").json()["items"][0]["status"] == "breached"


def test_metric_extraction_only_explicit_reported_values():
    document = {"id": 2, "title": "Results", "period": "FY2025 Q2", "filed_at": "2025-07-01", "source_url": "https://example.com/report"}
    chunk = {"id": 3, "text": "Operating margin was 17.4%. Revenue grew.", "page_start": 2}
    values = filing_metric_observations(CONDITION, chunk, document)
    assert values[0]["value"] == 17.4
    assert values[0]["quote"] == "Operating margin was 17.4%."
    for text in ("We expect operating margin of 19%.", "Operating margin was 17%. Operating margin is 19%.", "Operating margin increased from 17% to 19%."):
        assert filing_metric_observations(CONDITION, {**chunk, "text": text}, document) == []


def review():
    return {"id": "review-q2", "period": "FY2025 Q2", "expected_report_date": "2025-07-01", "metrics": [{"metric": "operating_margin", "label": "Operating margin", "unit": "%", "expected": 19, "guidance_low": 18, "guidance_high": 20}], "notes": "Watch utilization"}


def test_earnings_preserves_forecast_and_adds_comparable_actuals(api):
    client, state, _ = api
    row = make(client, thesis_conditions=[CONDITION])
    path = f"{URL}/{row['id']}"
    saved = client.post(path + "/earnings-reviews", json={"expected_revision": 1, "review": review()})
    assert saved.status_code == 200, saved.text
    baseline = saved.json()["earnings_reviews"][0]
    assert baseline["recorded_at"]
    assert baseline["reviewed_at"] is None
    outcome = deepcopy(baseline)
    outcome["metrics"][0].update({"actual": 17.4, "source_url": "https://example.com/results", "quote": "Operating margin was 17.4%.", "published_at": "2025-07-01T00:00:00Z"})
    response = client.post(path + "/earnings-reviews", json={"expected_revision": 2, "review": outcome})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["earnings_reviews"][0]["recorded_at"] == baseline["recorded_at"]
    assert data["earnings_reviews"][0]["metrics"][0]["expected"] == 19
    assert data["condition_status"][0]["status"] == "breached"
    assert data["evidence"][0]["period"] == "FY2025 Q2"
    assert data["thesis"] == row["thesis"]
    bad = deepcopy(outcome)
    bad["metrics"][0]["expected"] = 17.4
    assert client.post(path + "/earnings-reviews", json={"expected_revision": 3, "review": bad}).status_code == 422
    assert client.post(path + "/earnings-reviews", json={"expected_revision": 1, "review": outcome}).status_code == 409
    state["user"] = "someone-else"
    assert client.post(path + "/earnings-reviews", json={"expected_revision": 3, "review": outcome}).status_code == 404
    assert client.get(path + "/conditions").status_code == 404


def test_earnings_missing_sources_invalid_guidance_and_duplicate_conditions_rejected(api):
    client, _, _ = api
    row = make(client)
    path = f"{URL}/{row['id']}"
    missing = review()
    missing["metrics"][0]["actual"] = 17
    assert client.post(path + "/earnings-reviews", json={"expected_revision": 1, "review": missing}).status_code == 422
    invalid = review()
    invalid["metrics"][0]["guidance_high"] = 17
    assert client.post(path + "/earnings-reviews", json={"expected_revision": 1, "review": invalid}).status_code == 422
    assert client.patch(path, json={"thesis_conditions": [CONDITION, CONDITION]}).status_code == 422
    assert client.patch(path, json={"earnings_reviews": []}).status_code == 422


def test_new_filing_extracts_condition_observation_and_not_forecast(api):
    from backend.filings_rag.store import add_document
    from backend.filings_rag.models import FilingDocumentORM
    client, _, Session = api
    row = make(client, market="IN", thesis_conditions=[CONDITION])
    with Session() as db:
        document = add_document(db, symbol="TCS", market="IN", doc_type="annual_report", title="Q2 results", period="FY2025 Q2", source="upload", source_url="https://example.com/results", filed_at="2025-07-01", pages=["Operating margin was 17.4%. We expect operating margin of 20% next year."])
        db.query(FilingDocumentORM).filter_by(id=document["id"]).update({"created_at": datetime.now(timezone.utc) + timedelta(seconds=1)})
        db.commit()
    result = client.post(f"{URL}/{row['id']}/monitor", json={}).json()
    # Two candidate values in a chunk are ambiguous, so neither is guessed.
    assert result["dossier"]["condition_status"][0]["status"] == "unknown"
    with Session() as db:
        document = add_document(db, symbol="TCS", market="IN", doc_type="annual_report", title="Reported Q2", period="FY2025 Q2", source="upload", source_url="https://example.com/reported", filed_at="2025-07-02", pages=["Operating margin was 17.4%. Revenue increased."])
        db.query(FilingDocumentORM).filter_by(id=document["id"]).update({"created_at": datetime.now(timezone.utc) + timedelta(seconds=1)})
        db.commit()
    result = client.post(f"{URL}/{row['id']}/monitor", json={}).json()
    assert result["dossier"]["condition_status"][0]["status"] == "breached"
    assert result["dossier"]["condition_status"][0]["evidence"]["quote"] == "Operating margin was 17.4%."


def test_earnings_reference_uses_existing_results_and_citations(api, monkeypatch):
    from backend.results_tracker import service as results
    from backend.filings_rag import knowledge
    client, _, _ = api
    row = make(client)
    async def history(symbol, quarters):
        return {"quarters": [{"period": "FY2025 Q2", "eps": 2.4}], "currency": "USD"}
    async def guidance(db, symbol, use_llm):
        assert use_llm is False
        return {"guidance": [{"metric": "Margin", "period": "FY2025", "status": "new", "statement": "We expect 18%", "citation": {"quote": "We expect 18%", "source_url": "https://example.com/guidance"}}]}
    monkeypatch.setattr(results, "build_history", history)
    monkeypatch.setattr(knowledge, "build_knowledge", guidance)
    data = client.get(f"{URL}/{row['id']}/earnings-context").json()
    assert data["results"]["quarters"][0]["eps"] == 2.4
    assert data["guidance"][0]["quote"] == "We expect 18%"
    assert data["guidance"][0]["source_url"] == "https://example.com/guidance"


def test_latest_fiscal_period_wins_over_later_published_old_period():
    newest = evidence(19, id="q3", period="FY2025 Q3", published_at="2025-10-01T00:00:00Z")
    restated_old = evidence(12, id="q2-restated", period="FY2025 Q2", published_at="2025-11-01T00:00:00Z")
    result = evaluate_conditions({"thesis_conditions": [CONDITION], "evidence": [newest, restated_old]})[0]
    assert result["value"] == 19
    assert result["status"] == "within_threshold"
    incomparable = {**restated_old, "period": "2025-06-30"}
    result = evaluate_conditions({"thesis_conditions": [CONDITION], "evidence": [newest, incomparable]})[0]
    assert result["status"] == "unknown"
    assert "cannot be ordered" in result["reason"]


def test_future_actuals_rejected_and_review_dates_are_server_owned(api):
    client, _, _ = api
    row = make(client)
    draft = review()
    draft["metrics"][0].update(actual=18, source_url="https://example.com/results", quote="Operating margin was 18%", published_at="2999-01-01T00:00:00Z")
    assert client.post(f"{URL}/{row['id']}/earnings-reviews", json={"review": draft, "expected_revision": 1}).status_code == 422
    draft = review()
    draft["recorded_at"] = "2000-01-01T00:00:00Z"
    draft["reviewed_at"] = "2000-01-01T00:00:00Z"
    result = client.post(f"{URL}/{row['id']}/earnings-reviews", json={"review": draft, "expected_revision": 1}).json()
    assert result["earnings_reviews"][0]["recorded_at"] != draft["recorded_at"]
    assert result["earnings_reviews"][0]["reviewed_at"] is None


def _include_inbox(client, Session):
    from backend.research_inbox.routes import router as inbox_router
    from backend.research_inbox.models import ResearchReviewState
    from backend.screen_monitoring.models import ScreenSchedule, ScreenChange
    from backend.shared.db import Base
    Base.metadata.create_all(Session.kw["bind"])
    client.app.include_router(inbox_router)


def test_manual_observation_immediately_enters_inbox_without_monitor(api):
    client, _, Session = api
    _include_inbox(client, Session)
    row = make(client, thesis_conditions=[CONDITION])
    path = f"{URL}/{row['id']}"
    result = client.patch(path, json={"expected_revision": 1, "evidence": [evidence()]}).json()
    assert result["condition_status"][0]["status"] == "breached"
    inbox = client.get("/api/research/inbox").json()
    assert len(inbox["items"]) == 1
    assert inbox["items"][0]["kind"] == "thesis"
    assert inbox["items"][0]["priority"] == "high"
    assert inbox["items"][0]["changes"][0]["after"]["evidence"]["quote"] == "Operating margin was 17.4%."
    client.post(path + "/monitor", json={"evidence": []})
    assert len(client.get("/api/research/inbox").json()["items"]) == 1


def test_source_download_parse_monitor_inbox_and_review_round_trip(api, monkeypatch):
    from backend.filings_rag import sources
    from backend.filings_rag.models import FilingDocumentORM
    client, state, Session = api
    _include_inbox(client, Session)
    monkeypatch.setenv("FILINGS_WATCH_ENABLED", "1")
    calls = []
    async def downloaded_document(symbol, limit=5):
        calls.append(symbol)
        return [{"title": "Published Q2 results", "doc_type": "quarterly_filing", "period": "FY2025 Q2", "filed_at": "2025-07-01", "source": "sec", "source_url": "https://example.com/q2", "content_type": "text/html", "data": b"<html><body><p>Operating margin was 17.4%.</p><p>Revenue increased.</p></body></html>"}]
    monkeypatch.setattr(sources, "sec_documents", downloaded_document)
    row = make(client, symbol="AAPL", market="US", monitoring_enabled=True, source_fetch_enabled=True, thesis_conditions=[CONDITION])
    path = f"{URL}/{row['id']}"
    result = client.post(path + "/monitor", json={})
    assert result.status_code == 200, result.text
    dossier = result.json()["dossier"]
    assert dossier["source_fetch"]["imported"] == 1
    assert dossier["condition_status"][0]["status"] == "breached"
    with Session() as db:
        assert db.query(FilingDocumentORM).count() == 1
    inbox = client.get("/api/research/inbox").json()
    event = inbox["items"][0]
    condition = next(c for c in event["changes"] if c["kind"] == "condition_changed")
    assert condition["after"]["evidence"]["source_url"] == "https://example.com/q2"
    assert condition["after"]["evidence"]["page"] == 1
    assert client.patch(f"/api/research/inbox/events/{event['id']}", json={"status": "reviewed"}).status_code == 200
    assert client.get("/api/research/inbox").json()["items"][0]["bucket"] == "reviewed"
    assert client.get(path).json()["thesis"] == row["thesis"]
    repeated = client.post(path + "/monitor", json={}).json()
    assert repeated["changes"] == []
    assert repeated["dossier"]["source_fetch"]["duplicates"] == 1
    state["user"] = "other"
    assert client.get("/api/research/inbox").json()["items"] == []
    assert calls == ["AAPL", "AAPL"]


def test_source_fetch_is_explicit_and_honors_server_disable(api, monkeypatch):
    from backend.filings_rag import sources
    client, _, _ = api
    calls = []
    async def no_documents(symbol, limit=5):
        calls.append(symbol)
        return []
    monkeypatch.setattr(sources, "sec_documents", no_documents)
    row = make(client, source_fetch_enabled=True)
    path = f"{URL}/{row['id']}/monitor"
    monkeypatch.setenv("FILINGS_WATCH_ENABLED", "0")
    assert client.post(path, json={}).json()["dossier"]["source_fetch"]["status"] == "disabled"
    assert calls == []
    monkeypatch.setenv("FILINGS_WATCH_ENABLED", "1")
    assert client.post(path, json={}).json()["dossier"]["source_fetch"]["status"] == "unconfirmed"
    assert calls == ["TCS"]
