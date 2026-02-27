from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TASKS_DIR = ROOT / ".forge" / "tasks"

REQUIRED_KEYS = {
    "id",
    "title",
    "description",
    "status",
    "assigned_to",
    "task_type",
    "depends_on",
    "locked_files",
    "acceptance_criteria",
}


def load_tasks() -> dict[str, dict]:
    tasks: dict[str, dict] = {}
    for path in TASKS_DIR.glob("FP4-*.json"):
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        tasks[str(data.get("id") or path.stem)] = data
    return tasks


def main() -> int:
    tasks = load_tasks()
    if not tasks:
        print("No FP4 tasks found.")
        return 1

    errors: list[str] = []

    for task_id, task in tasks.items():
        missing = sorted(REQUIRED_KEYS - set(task.keys()))
        if missing:
            errors.append(f"{task_id}: missing keys {missing}")

        if not isinstance(task.get("acceptance_criteria"), list) or not task.get("acceptance_criteria"):
            errors.append(f"{task_id}: acceptance_criteria must be a non-empty list")

        for dep in task.get("depends_on", []):
            if isinstance(dep, str) and dep.startswith("FP4-") and dep not in tasks:
                errors.append(f"{task_id}: dependency {dep} not found")

    # Check IMPL/QC pairing (best-effort)
    impl_tasks = [tid for tid, t in tasks.items() if str(t.get("task_type")) == "implement"]
    qc_tasks = set(tid for tid, t in tasks.items() if str(t.get("task_type")) == "test")
    for impl in impl_tasks:
        stem = impl.replace("-IMPL-BE", "").replace("-IMPL-FE", "").replace("-IMPL", "")
        expected_qc = f"{stem}-QC"
        if expected_qc not in qc_tasks and not impl.endswith("-000"):
            errors.append(f"{impl}: missing paired QC task ({expected_qc})")

    if errors:
        print("Forge Pack 4 task lint failed:")
        for err in errors:
            print(f" - {err}")
        return 2

    print(f"Forge Pack 4 task lint passed ({len(tasks)} tasks).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
