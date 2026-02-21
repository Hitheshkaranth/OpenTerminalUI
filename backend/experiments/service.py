import subprocess
import hashlib
import uuid
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
    # Deterministic simple hash of the config
    config_str = str(sorted(request.config.items()))
    data_hash = hashlib.md5(config_str.encode("utf-8")).hexdigest()

    code_hash = get_git_revision_hash()

    # Generic dummy metrics for the purpose of the scaffold
    dummy_metrics = {"cagr": 0.15, "sharpe": 1.2, "max_drawdown": 0.05}

    exp = Experiment(
        name=request.name,
        config_json=request.config,
        data_hash=data_hash,
        code_hash=code_hash,
        metrics_json=dummy_metrics,
        tags=[]
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

    # Logic to map experiment config to a paper trading strategy would go here
    # For now, generate a receipt
    receipt_id = f"promoted_{uuid.uuid4().hex[:8]}"
    return receipt_id
