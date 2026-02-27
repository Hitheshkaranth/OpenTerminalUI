from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FORGE = ROOT / ".forge"
TASKS_DIR = FORGE / "tasks"
TEMPLATES_DIR = FORGE / "templates"
CONTRACTS_DIR = FORGE / "contracts" / "feature-pack4"


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_if_missing(path: Path, content: str) -> bool:
    if path.exists():
        return False
    ensure_parent(path)
    path.write_text(content, encoding="utf-8")
    return True


def default_file_stub(name: str, task_id: str) -> str:
    lower = name.lower()
    if lower.endswith(".txt"):
      return f"# {task_id} - {name}\n\nPending command output.\n"
    if lower.endswith(".json"):
      return json.dumps({"task_id": task_id, "status": "pending", "metrics": {}}, indent=2) + "\n"
    if lower == "findings.md":
      tpl = (TEMPLATES_DIR / "forge-findings.md").read_text(encoding="utf-8")
      return tpl.replace("<TASK-ID>", task_id)
    if lower == "notes.md":
      return f"# Notes - {task_id}\n\n- Initialized evidence folder.\n"
    return f"# {task_id} - {name}\n"


def init_from_task(task_id: str, force: bool = False) -> tuple[list[Path], list[Path]]:
    task_path = TASKS_DIR / f"{task_id}.json"
    if not task_path.exists():
        raise FileNotFoundError(f"Task file not found: {task_path}")

    task = load_json(task_path)
    created: list[Path] = []
    existing: list[Path] = []

    evidence_paths = [Path(p) for p in task.get("evidence_paths", [])]
    if not evidence_paths:
        # Fallback convention
        evidence_paths = [Path(f".forge/results/{task_id}/notes.md")]

    for rel_path in evidence_paths:
        abs_path = ROOT / rel_path
        if abs_path.exists() and not force:
            existing.append(abs_path)
            continue
        if abs_path.exists() and force:
            # preserve if non-empty and force not desired to overwrite silently
            existing.append(abs_path)
            continue
        stub = default_file_stub(abs_path.name, task_id)
        write_if_missing(abs_path, stub)
        created.append(abs_path)

    # Add checklist copy for QC tasks
    if str(task.get("task_type")) == "test":
        checklist_path = ROOT / f".forge/results/{task_id}/qc-checklist.md"
        if not checklist_path.exists():
            checklist = (TEMPLATES_DIR / "forge-qc-checklist.md").read_text(encoding="utf-8")
            write_if_missing(checklist_path, checklist)
            created.append(checklist_path)

    return created, existing


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize Forge Pack 4 evidence folder and stubs for a task.")
    parser.add_argument("task_id", help="Forge task id, e.g. FP4-41A-QC")
    parser.add_argument("--force", action="store_true", help="Reserved; currently does not overwrite existing files")
    args = parser.parse_args()

    # Sanity check program contract exists
    contract_path = CONTRACTS_DIR / "pack4_program.json"
    if not contract_path.exists():
        raise FileNotFoundError(f"Missing Pack 4 contract: {contract_path}")

    created, existing = init_from_task(args.task_id, force=args.force)
    print(f"Initialized evidence for {args.task_id}")
    if created:
        print("Created:")
        for p in created:
            print(f" - {p.relative_to(ROOT)}")
    if existing:
        print("Already exists:")
        for p in existing:
            print(f" - {p.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
