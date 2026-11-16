"""Independent capture lifecycle checks: no HTTP and no model inference."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from backend.evaluation import capture


@pytest.fixture
def cases():
    return json.loads(capture.FIXTURES.read_text())[:2]


def arguments(output_dir, **overrides):
    # Deliberately omit new optional CLI attributes: old programmatic callers
    # must retain safe mandatory-preflight defaults.
    values = dict(provider=["openrouter"], model=["current/model:free"], case=[], dry_run=False,
                  output_dir=output_dir, max_steps=4, max_tokens=333, timeout=10)
    values.update(overrides)
    return SimpleNamespace(**values)


def ready(model="current/model:free", **extra):
    return {"ready": True, "status": "ready", "requested_model": model, "selected_model": model,
            "available_free_models": [], "errors": [], **extra}


def blocked(model="current/model:free", status="authentication_failed", **extra):
    return {"ready": False, "status": status, "requested_model": model, "selected_model": None,
            "available_free_models": [], "errors": ["Authentication must be configured before evaluation."], **extra}


@pytest.fixture
def stubs(monkeypatch):
    factory = Mock(side_effect=lambda provider, model: SimpleNamespace(provider=provider, model=model, api_key="INTERNAL_SECRET_NEVER_LOG"))
    preflight = AsyncMock(side_effect=lambda provider, adapter, model, **kwargs: ready(model))
    async def collect(case, adapter, **kwargs):
        return {**deepcopy(case["reference_observation"]), "capture": {"status": "completed", "requested_model": kwargs["model"]},
                "cost_usd": None, "latency_ms": None}
    inference = AsyncMock(side_effect=collect)
    monkeypatch.setattr(capture, "configured_provider", factory)
    monkeypatch.setattr(capture, "provider_preflight", preflight)
    monkeypatch.setattr(capture, "capture_case", inference)
    return SimpleNamespace(factory=factory, preflight=preflight, inference=inference)


@pytest.mark.asyncio
async def test_mandatory_preflight_once_per_target_uses_safe_defaults_for_old_callers(tmp_path, cases, stubs):
    result = await capture.run_capture(arguments(tmp_path, model=["one:free", "two:free"]), cases)
    assert stubs.preflight.await_count == 2
    assert stubs.inference.await_count == 4
    for call in stubs.preflight.await_args_list:
        assert call.kwargs == {"timeout_seconds": 15, "probe": False}
    for run in result["runs"]:
        assert run["preflight_status"] == "ready"
        assert run["evaluated_cases"] == 2
        assert run["summary"]["passed"] == 2
    assert result["production_tools"] is False
    assert result["actions_executed"] is False


@pytest.mark.asyncio
async def test_auth_block_is_not_a_fake_zero_of_two_model_score(tmp_path, cases, stubs):
    stubs.preflight.side_effect = lambda provider, adapter, model, **kwargs: blocked(model)
    result = await capture.run_capture(arguments(tmp_path), cases)
    stubs.inference.assert_not_awaited()
    run, = result["runs"]
    assert run["summary"] is None and run["score"] is None and run["observations"] is None
    assert run["evaluated_cases"] == 0
    assert run["skipped_cases"] == [case["id"] for case in cases]
    assert run["capture_failures"] == 0
    assert not list(tmp_path.glob("*.observations.json"))
    assert not list(tmp_path.glob("*.score.json"))
    assert "INTERNAL_SECRET_NEVER_LOG" not in " ".join(file.read_text() for file in tmp_path.iterdir())


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["authentication_failed", "credentials_missing"])
async def test_provider_auth_failure_cache_blocks_remaining_matrix_models(tmp_path, cases, stubs, status):
    stubs.preflight.side_effect = lambda provider, adapter, model, **kwargs: blocked(model, status=status)
    result = await capture.run_capture(arguments(tmp_path, provider=["gemini"], model=["first", "second"]), cases)
    assert stubs.preflight.await_count == 1
    stubs.inference.assert_not_awaited()
    assert len(result["runs"]) == 2
    second = json.loads(Path(result["runs"][1]["preflight"]).read_text())
    assert second["cache_reused"] is True
    assert second["requested_model"] == "second"
    assert all(run["summary"] is None for run in result["runs"])


@pytest.mark.asyncio
async def test_auth_failure_cache_does_not_block_another_provider(tmp_path, cases, stubs):
    stubs.preflight.side_effect = lambda provider, adapter, model, **kwargs: blocked(model) if provider == "gemini" else ready(model)
    result = await capture.run_capture(arguments(tmp_path, provider=["gemini", "openrouter"]), cases)
    assert stubs.preflight.await_count == 2
    assert stubs.inference.await_count == 2
    assert result["runs"][0]["summary"] is None
    assert result["runs"][1]["summary"]["passed"] == 2


@pytest.mark.asyncio
async def test_replacement_requires_explicit_opt_in_and_selected_model_is_logged(tmp_path, cases, stubs):
    retired, replacement = "retired/model:free", "new/model:free"
    stubs.preflight.side_effect = lambda provider, adapter, model, **kwargs: (
        blocked(model, status="model_unavailable", available_free_models=[replacement]) if model == retired else ready(model))
    result = await capture.run_capture(arguments(tmp_path, model=[retired], resolve_free_model=replacement), cases)
    assert [call.args[2] for call in stubs.preflight.await_args_list] == [retired, replacement]
    assert all(call.kwargs["model"] == replacement for call in stubs.inference.await_args_list)
    run, = result["runs"]
    assert run["requested_model"] == retired
    assert run["selected_model"] == replacement
    assert run["resolution"]["reason"] == "explicit_verified_free_replacement"
    assert run["resolution"]["original_preflight"]["requested_model"] == retired
    observation = json.loads(Path(run["observations"]).read_text())
    assert all(row["capture"]["requested_model"] == replacement for row in observation.values())


@pytest.mark.asyncio
async def test_no_auto_replacement_even_when_free_suggestions_exist(tmp_path, cases, stubs):
    stubs.preflight.side_effect = lambda provider, adapter, model, **kwargs: blocked(model,
        status="model_unavailable", available_free_models=["new/model:free"])
    result = await capture.run_capture(arguments(tmp_path), cases)
    stubs.inference.assert_not_awaited()
    assert stubs.preflight.await_count == 1
    assert result["runs"][0]["selected_model"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("replacement", ["paid/model", "unverified/model:free"])
async def test_paid_or_unverified_replacement_never_runs(tmp_path, cases, stubs, replacement):
    stubs.preflight.side_effect = lambda provider, adapter, model, **kwargs: blocked(model,
        status="model_unavailable", available_free_models=["verified/model:free"])
    result = await capture.run_capture(arguments(tmp_path, resolve_free_model=replacement), cases)
    stubs.inference.assert_not_awaited()
    assert stubs.preflight.await_count == 1
    assert result["runs"][0]["selected_model"] is None


@pytest.mark.asyncio
async def test_replacement_second_preflight_must_be_ready(tmp_path, cases, stubs):
    stubs.preflight.side_effect = [blocked(status="model_unavailable", available_free_models=["new/model:free"]),
                                    blocked("new/model:free", status="tools_unsupported")]
    result = await capture.run_capture(arguments(tmp_path, resolve_free_model="new/model:free"), cases)
    stubs.inference.assert_not_awaited()
    assert result["runs"][0]["preflight_status"] == "tools_unsupported"
    assert result["runs"][0]["summary"] is None


@pytest.mark.asyncio
async def test_dry_run_has_no_preflight_inference_or_output_directory(tmp_path, cases, stubs):
    path = tmp_path / "never-created"
    result = await capture.run_capture(arguments(path, dry_run=True, probe_provider=True), cases)
    stubs.factory.assert_not_called()
    stubs.preflight.assert_not_awaited()
    stubs.inference.assert_not_awaited()
    assert not path.exists()
    assert result["model_network_calls"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("prior", ["manifest.json", ".capture-run.json", "interrupted.observations.json", "interrupted.score.json",
                                  "interrupted.preflight.json", "interrupted.observations.json.tmp"])
async def test_existing_capture_artifacts_are_immutable_even_if_interrupted(tmp_path, cases, stubs, prior):
    artifact = tmp_path / prior
    artifact.write_text('{"prior":"preserve this evidence"}')
    with pytest.raises(ValueError, match="directory|capture"):
        await capture.run_capture(arguments(tmp_path), cases)
    assert artifact.read_text() == '{"prior":"preserve this evidence"}'
    stubs.preflight.assert_not_awaited()
    stubs.inference.assert_not_awaited()


@pytest.mark.asyncio
async def test_progress_goes_to_stderr_and_observations_are_checkpointed_after_each_case(tmp_path, cases, stubs, capsys):
    captured = []
    async def collect(case, adapter, **kwargs):
        if captured:
            files = list(tmp_path.glob("*.observations.json"))
            assert len(files) == 1
            assert list(json.loads(files[0].read_text())) == [captured[0]]
        captured.append(case["id"])
        return {**deepcopy(case["reference_observation"]), "capture": {"status": "completed"}}
    stubs.inference.side_effect = collect
    result = await capture.run_capture(arguments(tmp_path), cases)
    streams = capsys.readouterr()
    assert streams.out == ""
    assert "Checking openrouter" in streams.err
    assert all(f"Running openrouter/current/model:free: {case['id']}" in streams.err for case in cases)
    assert all(f"Captured {case['id']}: completed" in streams.err for case in cases)
    assert len(json.loads(Path(result["runs"][0]["observations"]).read_text())) == 2
    assert not list(tmp_path.glob("*.tmp"))


def test_cli_returns_failed_block_status_without_scores_or_secrets(tmp_path, cases, stubs, capsys):
    fixtures = tmp_path / "fixtures.json"
    fixtures.write_text(json.dumps(cases))
    output = tmp_path / "capture"
    stubs.preflight.side_effect = lambda provider, adapter, model, **kwargs: blocked(model)
    code = capture.main(["--run", "--fixtures", str(fixtures), "--output-dir", str(output),
                         "--provider", "gemini", "--model", "configured-model"])
    assert code == 1
    streams = capsys.readouterr()
    manifest = json.loads(streams.out)
    assert manifest["runs"][0]["summary"] is None
    assert "authentication_failed" in streams.err
    assert "INTERNAL_SECRET_NEVER_LOG" not in streams.out + streams.err
    stubs.inference.assert_not_awaited()


@pytest.mark.asyncio
async def test_authentication_failure_after_catalog_stops_later_cases_and_matrix_targets(tmp_path, cases, stubs):
    async def revoked(case, adapter, **kwargs):
        return {"answer": "", "tool_calls": [], "actions_executed": [], "cost_usd": None,
                "capture": {"status": "provider_error", "errors": ["LLM HTTP 401: authentication failed"]}}
    stubs.inference.side_effect = revoked
    result = await capture.run_capture(arguments(tmp_path, model=["first:free", "second:free"]), cases)
    # A key can be revoked after catalog/auth preflight. Repeating inference on
    # the remaining cases or models is still an avoidable credentials failure.
    assert stubs.inference.await_count == 1
    assert stubs.preflight.await_count == 1
    assert all(run["summary"] is None for run in result["runs"])


def test_cli_preflight_only_checks_credentials_without_case_inference_or_fabricated_score(tmp_path, cases, stubs, capsys):
    fixtures = tmp_path / "fixtures.json"
    fixtures.write_text(json.dumps(cases))
    output = tmp_path / "health"
    assert capture.main(["--preflight-only", "--fixtures", str(fixtures), "--output-dir", str(output),
                         "--provider", "gemini", "--model", "configured-model"]) == 0
    manifest = json.loads(capsys.readouterr().out)
    assert manifest["mode"] == "provider_preflight"
    assert manifest["provider_network_calls"] is True
    assert manifest["model_network_calls"] is False
    assert manifest["case_ids"] == []
    assert manifest["runs"][0]["summary"] is None
    assert manifest["runs"][0]["evaluated_cases"] == 0
    assert manifest["runs"][0]["observations"] is None
    assert len(list(output.glob("*.preflight.json"))) == 1
    assert (output / "manifest.json").exists()
    assert not list(output.glob("*.score.json"))
    stubs.inference.assert_not_awaited()
    assert stubs.preflight.await_args.kwargs["probe"] is False


def test_cli_preflight_only_returns_failure_for_bad_credentials_and_is_mutually_exclusive(tmp_path, cases, stubs, capsys):
    fixtures = tmp_path / "fixtures.json"
    fixtures.write_text(json.dumps(cases))
    stubs.preflight.side_effect = lambda provider, adapter, model, **kwargs: blocked(model)
    assert capture.main(["--preflight-only", "--fixtures", str(fixtures), "--output-dir", str(tmp_path / "bad-key"),
                         "--provider", "gemini", "--model", "configured-model"]) == 1
    output = capsys.readouterr()
    assert "INTERNAL_SECRET_NEVER_LOG" not in output.out + output.err
    assert json.loads(output.out)["runs"][0]["summary"] is None
    stubs.inference.assert_not_awaited()
    for conflicting in ["--run", "--dry-run"]:
        with pytest.raises(SystemExit) as exc:
            capture.main(["--preflight-only", conflicting])
        assert exc.value.code == 2


@pytest.mark.asyncio
async def test_preflight_only_capability_inference_requires_explicit_probe_flag(tmp_path, cases, stubs):
    result = await capture.run_capture(arguments(tmp_path, preflight_only=True, probe_provider=True), cases)
    assert result["model_network_calls"] is True
    assert result["provider_network_calls"] is True
    assert stubs.preflight.await_args.kwargs["probe"] is True
    stubs.inference.assert_not_awaited()
    assert result["runs"][0]["summary"] is None
