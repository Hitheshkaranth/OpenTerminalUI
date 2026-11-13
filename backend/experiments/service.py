import subprocess
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from backend.experiments.models import Experiment
from backend.experiments.schemas import ExperimentCreate


def get_git_revision_hash() -> str:
    try:
        rev = subprocess.check_output(['git', 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL)
        return rev.decode('ascii').strip()
    except Exception:
        return "dirty"


def create_experiment(db: Session, request: ExperimentCreate) -> Experiment:
    # This legacy registry saves configuration; no execution engine or dataset
    # is attached. A configuration hash must not masquerade as data provenance.
    code_hash = get_git_revision_hash()

    exp = Experiment(
        name=request.name,
        config_json=request.config,
        data_hash=None,
        code_hash=code_hash,
        metrics_json={},
        tags=["unexecuted", "execution_engine_unavailable"]
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return exp


def get_experiments(db: Session, limit: int = 100, offset: int = 0) -> List[Experiment]:
    return db.query(Experiment).order_by(Experiment.id.desc()).offset(offset).limit(limit).all()


def get_experiment_by_id(db: Session, experiment_id: int) -> Experiment:
    return db.query(Experiment).filter(Experiment.id == experiment_id).first()


def compare_experiments(db: Session, experiment_ids: List[int]) -> Dict[str, Any]:
    exps = db.query(Experiment).filter(Experiment.id.in_(experiment_ids)).all()

    # Create a metrics table
    metrics_table = {}
    for exp in exps:
        metrics_table[f"exp_{exp.id}"] = exp.metrics_json or {}

    # Deltas
    deltas = {}
    if len(exps) == 2:
        m1 = exps[0].metrics_json or {}
        m2 = exps[1].metrics_json or {}

        shared_keys = set(m1.keys()).intersection(m2.keys())
        for k in shared_keys:
            try:
                deltas[k] = float(m2[k]) - float(m1[k])
            except (ValueError, TypeError):
                deltas[k] = None

    return {
        "metrics_table": metrics_table,
        "deltas": deltas
    }


def promote_experiment_to_paper(db: Session, experiment_id: int) -> str:
    exp = get_experiment_by_id(db, experiment_id)
    if not exp:
        raise ValueError("Experiment not found")

    raise NotImplementedError(
        "Paper promotion is unavailable for the legacy experiment registry: "
        "no execution engine is connected and no paper strategy was created."
    )
