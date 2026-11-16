"""Durable, append-only test exposure accounting for Strategy Lab.

An opening is committed BEFORE test computation. An interrupted opening cannot
silently reopen the tests. Completed runs replay their saved result, while a new
run on the same user/dataset records and discloses the earlier exposure count.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from backend.models.agent_strategy_experiment import AgentStrategyExperiment
from backend.shared.db import SessionLocal


def _copy(value: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(value, allow_nan=False))


class StrategyExperimentLog:
    def __init__(self, session_factory: Any = SessionLocal) -> None:
        self.session_factory = session_factory

    @staticmethod
    def _find(db, user_id, run_id, event_kind):
        return db.query(AgentStrategyExperiment).filter_by(user_id=user_id, run_id=run_id, event_kind=event_kind).first()

    def prepare(self, *, user_id: str, run_id: str, dataset_id: str, symbol: str,
                protocol_version: str, manifest: dict[str, Any]) -> dict[str, Any]:
        if not user_id or not run_id:
            raise ValueError("User and run identity are required for experiment accounting")
        identity = dict(user_id=user_id, run_id=run_id, dataset_id=dataset_id, symbol=symbol,
                        protocol_version=protocol_version)
        db = self.session_factory()
        try:
            row = self._find(db, user_id, run_id, "registered")
            if row is None:
                db.add(AgentStrategyExperiment(**identity, event_kind="registered", payload=_copy(manifest)))
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()
                row = self._find(db, user_id, run_id, "registered")
            if row is None or row.dataset_id != dataset_id or row.symbol != symbol or row.protocol_version != protocol_version or row.payload != manifest:
                raise ValueError("This run already has a different immutable dataset/protocol; start a new run")
            opened = self._find(db, user_id, run_id, "tests_opened")
            completed = self._find(db, user_id, run_id, "completed")
            total = self._exposure_count(db, user_id, dataset_id, symbol)
            if completed:
                return {"status": "replay", "experiment_id": row.id, "run_id": run_id,
                        "dataset_id": dataset_id, "recorded_test_exposures": total,
                        "results": _copy(completed.payload), "same_run_replay": True}
            if opened:
                raise ValueError("Tests were already opened for this run without a completed snapshot. Reopening is blocked; a new run must disclose dataset reuse.")
            return {"status": "registered", "experiment_id": row.id, "run_id": run_id,
                    "dataset_id": dataset_id, "prior_test_exposures": total,
                    "prior_overlapping_holdout_exposures": self._overlap_count(db, row), "same_run_replay": False}
        finally:
            db.close()

    @staticmethod
    def _exposure_count(db, user_id, dataset_id, symbol):
        return int(db.query(func.count(AgentStrategyExperiment.id)).filter_by(
            user_id=user_id, dataset_id=dataset_id, symbol=symbol, event_kind="tests_opened").scalar() or 0)

    @staticmethod
    def _overlap_count(db, registered):
        """A revised/extended dataset can still contain dates previously shown."""
        split = registered.payload.get("split", {})
        if not split.get("test_start") or not split.get("test_end"):
            return 0
        start, end = datetime.fromisoformat(split["test_start"]), datetime.fromisoformat(split["test_end"])
        opened_runs = db.query(AgentStrategyExperiment.run_id).filter_by(
            user_id=registered.user_id, symbol=registered.symbol, event_kind="tests_opened")
        prior = db.query(AgentStrategyExperiment.payload).filter(
            AgentStrategyExperiment.user_id == registered.user_id,
            AgentStrategyExperiment.symbol == registered.symbol,
            AgentStrategyExperiment.event_kind == "registered",
            AgentStrategyExperiment.run_id.in_(opened_runs),
        ).all()
        count = 0
        for (payload,) in prior:
            other = payload.get("split", {})
            if other.get("test_start") and other.get("test_end") and (
                datetime.fromisoformat(other["test_start"]) <= end
                and datetime.fromisoformat(other["test_end"]) >= start
            ):
                count += 1
        return count

    def replay_if_completed(self, *, user_id: str, run_id: str) -> dict[str, Any] | None:
        """Replay by identity before fetching new prices; interrupted openings block."""
        db = self.session_factory()
        try:
            row = self._find(db, user_id, run_id, "registered")
            if row is None:
                return None
            completed = self._find(db, user_id, run_id, "completed")
            if completed:
                return {"status": "replay", "experiment_id": row.id, "run_id": run_id,
                        "dataset_id": row.dataset_id, "same_run_replay": True,
                        "recorded_test_exposures": self._exposure_count(db, user_id, row.dataset_id, row.symbol),
                        "results": _copy(completed.payload)}
            if self._find(db, user_id, run_id, "tests_opened") is not None:
                raise ValueError("Tests were already opened for this run without a completed snapshot. Reopening is blocked; a new run must disclose dataset reuse.")
            return None
        finally:
            db.close()

    def open_tests(self, *, user_id: str, run_id: str, selection: dict[str, Any]) -> dict[str, Any]:
        db = self.session_factory()
        try:
            registered = self._find(db, user_id, run_id, "registered")
            if registered is None:
                raise ValueError("Register an immutable experiment before opening tests")
            if self._find(db, user_id, run_id, "tests_opened") is not None:
                raise ValueError("Tests already opened; replay a completed snapshot or start a disclosed new experiment")
            prior = self._exposure_count(db, user_id, registered.dataset_id, registered.symbol)
            metadata = {"prior_test_exposures": prior, "recorded_test_exposures": prior + 1,
                        "prior_overlapping_holdout_exposures": self._overlap_count(db, registered),
                        "selection": _copy(selection), "dataset_id": registered.dataset_id,
                        "protocol_version": registered.protocol_version, "manifest": _copy(registered.payload),
                        "experiment_id": registered.id, "run_id": run_id, "same_run_replay": False,
                        "status": "tests_opened"}
            db.add(AgentStrategyExperiment(
                user_id=user_id, run_id=run_id, dataset_id=registered.dataset_id, symbol=registered.symbol,
                protocol_version=registered.protocol_version, event_kind="tests_opened", payload=_copy(metadata)))
            try:
                db.commit()
            except IntegrityError as exc:
                db.rollback()
                raise ValueError("A concurrent worker already opened this run's tests; recomputation is blocked") from exc
            return metadata
        finally:
            db.close()

    def complete(self, *, user_id: str, run_id: str, results: dict[str, Any]) -> None:
        db = self.session_factory()
        try:
            registered = self._find(db, user_id, run_id, "registered")
            if registered is None or self._find(db, user_id, run_id, "tests_opened") is None:
                raise ValueError("Tests must be durably opened before completion")
            if self._find(db, user_id, run_id, "completed") is not None:
                raise ValueError("Completed experiment snapshots cannot be replaced")
            db.add(AgentStrategyExperiment(
                user_id=user_id, run_id=run_id, dataset_id=registered.dataset_id, symbol=registered.symbol,
                protocol_version=registered.protocol_version, event_kind="completed", payload=_copy(results)))
            db.commit()
        finally:
            db.close()

    def list_events(self, user_id: str, *, limit: int = 100) -> list[dict[str, Any]]:
        db = self.session_factory()
        try:
            rows = db.query(AgentStrategyExperiment).filter_by(user_id=user_id).order_by(
                AgentStrategyExperiment.created_at.desc(), AgentStrategyExperiment.id.desc()).limit(max(1, min(limit, 200))).all()
            return [{"id": row.id, "run_id": row.run_id, "event_kind": row.event_kind,
                     "dataset_id": row.dataset_id, "symbol": row.symbol, "protocol_version": row.protocol_version,
                     "payload": _copy(row.payload), "created_at": row.created_at.isoformat()} for row in rows]
        finally:
            db.close()
