#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROMPTS_DIR = ROOT / "codex-prompts"
FORGE_DIR = ROOT / ".forge"
TASKS_DIR = FORGE_DIR / "tasks"
RESULTS_DIR = FORGE_DIR / "results"
LOCKS_DIR = FORGE_DIR / "locks"
TEMPLATES_DIR = FORGE_DIR / "templates"
CONTRACTS_DIR = FORGE_DIR / "contracts" / "feature-pack4"
STATE_PATH = FORGE_DIR / "state.json"
DEFAULT_MODEL = "gpt-5.4"


@dataclass(frozen=True)
class TaskDef:
    task_id: str
    title: str
    description: str
    prompt_path: Path
    status: str
    assigned_to: str
    task_type: str
    depends_on: list[str]
    locked_files: list[str]
    acceptance_criteria: list[str]
    evidence_paths: list[str]
    wave: int | None = None
    order: int | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.task_id,
            "title": self.title,
            "description": self.description,
            "status": self.status,
            "assigned_to": self.assigned_to,
            "task_type": self.task_type,
            "depends_on": self.depends_on,
            "locked_files": self.locked_files,
            "acceptance_criteria": self.acceptance_criteria,
            "prompt_path": str(self.prompt_path.relative_to(ROOT)),
            "wave": self.wave,
            "order": self.order,
            "evidence_paths": self.evidence_paths,
        }


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_title(content: str, fallback: str) -> str:
    for line in content.splitlines():
        if line.startswith("# TASK:"):
            return line.split(":", 1)[1].strip()
    return fallback


def parse_description(content: str) -> str:
    lines = [line.rstrip() for line in content.splitlines()]
    for idx, line in enumerate(lines):
        if line.startswith("## Project Context"):
            for candidate in lines[idx + 1 :]:
                stripped = candidate.strip()
                if not stripped:
                    continue
                if stripped.startswith("## "):
                    break
                return stripped
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return stripped
    return "Generated from codex wave prompt."


def prompt_type(path: Path) -> str:
    return "test" if path.name == "integration-check.md" else "implement"


def infer_locked_files(content: str) -> list[str]:
    locked: list[str] = []
    for line in content.splitlines():
        stripped = line.strip()
        if "`" not in stripped:
            continue
        parts = stripped.split("`")
        for idx in range(1, len(parts), 2):
            candidate = parts[idx].strip()
            if "/" not in candidate:
                continue
            if candidate.startswith(("backend/", "frontend/", "scripts/", "docs/", "codex-prompts/")):
                locked.append(candidate)
    seen: set[str] = set()
    ordered: list[str] = []
    for item in locked:
        if item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered[:20]


def default_acceptance_criteria(path: Path, title: str) -> list[str]:
    relative = str(path.relative_to(ROOT))
    criteria = [
        f"Execute the prompt in `{relative}` without editing unrelated areas.",
        "Capture the full agent transcript and final response under `.forge/results/<TASK-ID>/`.",
        f"Complete the task scope for `{title}` or report concrete blockers.",
    ]
    if path.name == "integration-check.md":
        criteria.append("Record verification outcomes and failing checks in the task evidence.")
    return criteria


def build_task_defs() -> list[TaskDef]:
    tasks: list[TaskDef] = []
    wave_dirs = sorted(PROMPTS_DIR.glob("wave[0-9]*"))
    previous_wave_qc: str | None = None

    for wave_dir in wave_dirs:
        wave_num = int(wave_dir.name.replace("wave", ""))
        prompt_files = sorted(wave_dir.glob("*.md"))
        for index, prompt_path in enumerate(prompt_files, start=1):
            content = read_text(prompt_path)
            task_id = f"W{wave_num}-{index:02d}-IMPL"
            title = parse_title(content, prompt_path.stem.replace("-", " ").title())
            result_dir = RESULTS_DIR / task_id
            depends_on = [previous_wave_qc] if previous_wave_qc else []
            tasks.append(
                TaskDef(
                    task_id=task_id,
                    title=title,
                    description=parse_description(content),
                    prompt_path=prompt_path,
                    status="pending",
                    assigned_to="codex",
                    task_type=prompt_type(prompt_path),
                    depends_on=depends_on,
                    locked_files=infer_locked_files(content),
                    acceptance_criteria=default_acceptance_criteria(prompt_path, title),
                    evidence_paths=[
                        str((result_dir / "prompt.md").relative_to(ROOT)),
                        str((result_dir / "run.log").relative_to(ROOT)),
                        str((result_dir / "final.md").relative_to(ROOT)),
                        str((result_dir / "meta.json").relative_to(ROOT)),
                    ],
                    wave=wave_num,
                    order=index,
                )
            )

        integration_prompt = PROMPTS_DIR / "integration-check.md"
        integration_result_dir = RESULTS_DIR / f"W{wave_num}-QC"
        tasks.append(
            TaskDef(
                task_id=f"W{wave_num}-QC",
                title=f"Wave {wave_num} Integration Check",
                description="Run the post-wave verification prompt against the repository state.",
                prompt_path=integration_prompt,
                status="pending",
                assigned_to="codex",
                task_type="test",
                depends_on=[f"W{wave_num}-{idx:02d}-IMPL" for idx in range(1, len(prompt_files) + 1)],
                locked_files=["frontend/src/App.tsx", "frontend/src/components/layout/Sidebar.tsx"],
                acceptance_criteria=default_acceptance_criteria(integration_prompt, f"Wave {wave_num} Integration Check"),
                evidence_paths=[
                    str((integration_result_dir / "prompt.md").relative_to(ROOT)),
                    str((integration_result_dir / "run.log").relative_to(ROOT)),
                    str((integration_result_dir / "final.md").relative_to(ROOT)),
                    str((integration_result_dir / "meta.json").relative_to(ROOT)),
                ],
                wave=wave_num,
                order=99,
            )
        )
        previous_wave_qc = f"W{wave_num}-QC"

    return tasks


def ensure_templates() -> None:
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)

    findings = TEMPLATES_DIR / "forge-findings.md"
    if not findings.exists():
        findings.write_text(
            "# Findings - <TASK-ID>\n\n- Summary:\n- Risks:\n- Follow-ups:\n",
            encoding="utf-8",
        )

    checklist = TEMPLATES_DIR / "forge-qc-checklist.md"
    if not checklist.exists():
        checklist.write_text(
            "# QC Checklist\n\n- [ ] Backend imports\n- [ ] Frontend build\n- [ ] Tests reviewed\n- [ ] Regressions recorded\n",
            encoding="utf-8",
        )

    contract = CONTRACTS_DIR / "pack4_program.json"
    if not contract.exists():
        contract.write_text(
            json.dumps(
                {
                    "program": "codex-wave",
                    "generated_at": now_iso(),
                    "source": "codex-prompts",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"program": "codex-wave", "generated_at": now_iso(), "tasks": {}}
    return json.loads(read_text(STATE_PATH))


def save_state(state: dict[str, Any]) -> None:
    FORGE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def init_forge(force: bool = False) -> list[TaskDef]:
    FORGE_DIR.mkdir(parents=True, exist_ok=True)
    TASKS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    LOCKS_DIR.mkdir(parents=True, exist_ok=True)
    ensure_templates()

    tasks = build_task_defs()
    state = load_state()
    existing_status = {
        task_id: task_info.get("status", "pending")
        for task_id, task_info in state.get("tasks", {}).items()
        if isinstance(task_info, dict)
    }

    for task in tasks:
        task_json = task.to_json()
        task_json["status"] = existing_status.get(task.task_id, task.status)
        task_path = TASKS_DIR / f"{task.task_id}.json"
        if force or not task_path.exists():
            task_path.write_text(json.dumps(task_json, indent=2) + "\n", encoding="utf-8")

    state_tasks: dict[str, Any] = {}
    for task in tasks:
        task_path = TASKS_DIR / f"{task.task_id}.json"
        task_payload = json.loads(read_text(task_path))
        state_tasks[task.task_id] = {
            "status": task_payload["status"],
            "wave": task_payload["wave"],
            "title": task_payload["title"],
            "prompt_path": task_payload["prompt_path"],
            "task_type": task_payload["task_type"],
        }

    save_state(
        {
            "program": "codex-wave",
            "generated_at": now_iso(),
            "tasks": state_tasks,
        }
    )
    return tasks


def list_tasks() -> int:
    tasks = init_forge()
    state = load_state()
    by_wave: dict[int, list[TaskDef]] = {}
    for task in tasks:
        if task.wave is None:
            continue
        by_wave.setdefault(task.wave, []).append(task)

    for wave in sorted(by_wave):
        print(f"Wave {wave}")
        for task in sorted(by_wave[wave], key=lambda item: item.order or 0):
            status = state["tasks"].get(task.task_id, {}).get("status", "pending")
            print(f"  {task.task_id:<10} {status:<10} {task.title}")
    return 0


def load_task(task_id: str) -> dict[str, Any]:
    task_path = TASKS_DIR / f"{task_id}.json"
    if not task_path.exists():
        raise FileNotFoundError(f"Task file not found: {task_path}")
    return json.loads(read_text(task_path))


def update_task_state(task_id: str, status: str) -> None:
    task = load_task(task_id)
    task["status"] = status
    task["updated_at"] = now_iso()
    (TASKS_DIR / f"{task_id}.json").write_text(json.dumps(task, indent=2) + "\n", encoding="utf-8")

    state = load_state()
    state.setdefault("tasks", {}).setdefault(task_id, {})
    state["tasks"][task_id].update(
        {
            "status": status,
            "wave": task.get("wave"),
            "title": task.get("title"),
            "prompt_path": task.get("prompt_path"),
            "task_type": task.get("task_type"),
            "updated_at": task["updated_at"],
        }
    )
    state["generated_at"] = now_iso()
    save_state(state)


def make_task_prompt(task: dict[str, Any]) -> str:
    original = read_text(ROOT / task["prompt_path"])
    header = [
        "# Forge Envelope",
        f"Task ID: {task['id']}",
        f"Task Type: {task['task_type']}",
        f"Evidence Dir: .forge/results/{task['id']}",
        "",
        "Execution rules:",
        "- Stay focused on this task's scope.",
        "- Respect existing repository changes.",
        "- Capture any notable verification artifacts under the evidence directory when practical.",
        "- End with a concise completion summary.",
        "",
        "---",
        "",
    ]
    return "\n".join(header) + original


def task_lock_path(task_id: str) -> Path:
    return LOCKS_DIR / f"{task_id}.lock"


def acquire_lock(task_id: str) -> Path:
    path = task_lock_path(task_id)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(f"{os.getpid()}\n")
    return path


def release_lock(path: Path) -> None:
    if path.exists():
        path.unlink()


def run_single_task(task_id: str, model: str, dry_run: bool = False) -> int:
    if not shutil_which("codex"):
        print("`codex` CLI not found in PATH.", file=sys.stderr)
        return 2

    task = load_task(task_id)
    result_dir = RESULTS_DIR / task_id
    result_dir.mkdir(parents=True, exist_ok=True)

    prompt_path = result_dir / "prompt.md"
    run_log = result_dir / "run.log"
    final_path = result_dir / "final.md"
    meta_path = result_dir / "meta.json"

    prompt = make_task_prompt(task)
    prompt_path.write_text(prompt, encoding="utf-8")

    command = [
        "codex",
        "exec",
        "--full-auto",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--cd",
        str(ROOT),
        "--model",
        model,
        "--output-last-message",
        str(final_path),
        "-",
    ]

    if dry_run:
        print(f"[dry-run] {task_id}: {' '.join(command)}")
        return 0

    lock_path = acquire_lock(task_id)
    update_task_state(task_id, "running")
    started_at = now_iso()

    try:
        with run_log.open("w", encoding="utf-8") as log_handle:
            log_handle.write(f"$ {' '.join(command)}\n\n")
            log_handle.flush()
            process = subprocess.run(
                command,
                input=prompt,
                text=True,
                cwd=ROOT,
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                check=False,
            )
        status = "done" if process.returncode == 0 else "failed"
        update_task_state(task_id, status)
        meta_path.write_text(
            json.dumps(
                {
                    "task_id": task_id,
                    "status": status,
                    "started_at": started_at,
                    "finished_at": now_iso(),
                    "returncode": process.returncode,
                    "model": model,
                    "prompt_path": str(prompt_path.relative_to(ROOT)),
                    "log_path": str(run_log.relative_to(ROOT)),
                    "final_path": str(final_path.relative_to(ROOT)),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return process.returncode
    finally:
        release_lock(lock_path)


def shutil_which(binary: str) -> str | None:
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(entry) / binary
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def run_parallel(task_ids: list[str], model: str, max_parallel: int, dry_run: bool = False) -> int:
    failures = 0
    if not task_ids:
        return failures

    with ThreadPoolExecutor(max_workers=max_parallel) as pool:
        futures = {pool.submit(run_single_task, task_id, model, dry_run): task_id for task_id in task_ids}
        while futures:
            done, _ = wait(futures, return_when=FIRST_COMPLETED)
            for future in done:
                task_id = futures.pop(future)
                code = future.result()
                label = "OK" if code == 0 else "FAIL"
                print(f"[{label}] {task_id}")
                if code != 0:
                    failures += 1
    return failures


def task_ids_for_wave(wave: int) -> tuple[list[str], str]:
    impl_ids = [f"W{wave}-{index:02d}-IMPL" for index in range(1, 5)]
    qc_id = f"W{wave}-QC"
    return impl_ids, qc_id


def run_wave(wave: int, model: str, max_parallel: int, dry_run: bool = False) -> int:
    impl_ids, _ = task_ids_for_wave(wave)
    print(f"== Wave {wave} ==")
    return run_parallel(impl_ids, model=model, max_parallel=max_parallel, dry_run=dry_run)


def run_check(wave: int, model: str, dry_run: bool = False) -> int:
    qc_id = f"W{wave}-QC"
    print(f"== Wave {wave} Check ==")
    return run_single_task(qc_id, model=model, dry_run=dry_run)


def run_target(target: str, model: str, max_parallel: int, dry_run: bool = False) -> int:
    init_forge()

    if target == "all":
        failures = 0
        wave_dirs = sorted(PROMPTS_DIR.glob("wave[0-9]*"))
        for wave_dir in wave_dirs:
            wave = int(wave_dir.name.replace("wave", ""))
            failures += run_wave(wave, model=model, max_parallel=max_parallel, dry_run=dry_run)
            qc_code = run_check(wave, model=model, dry_run=dry_run)
            if qc_code != 0:
                failures += 1
        return 0 if failures == 0 else 1

    if target == "check":
        wave_dirs = sorted(PROMPTS_DIR.glob("wave[0-9]*"))
        latest = int(wave_dirs[-1].name.replace("wave", "")) if wave_dirs else 1
        return run_check(latest, model=model, dry_run=dry_run)

    if target.isdigit():
        wave = int(target)
        failures = run_wave(wave, model=model, max_parallel=max_parallel, dry_run=dry_run)
        return 0 if failures == 0 else 1

    if (TASKS_DIR / f"{target}.json").exists():
        return run_single_task(target, model=model, dry_run=dry_run)

    print(f"Unknown target: {target}", file=sys.stderr)
    return 2


def status_command() -> int:
    state = load_state()
    tasks = state.get("tasks", {})
    if not tasks:
        print("Forge state is empty. Run `./scripts/forge init` first.")
        return 0
    for task_id in sorted(tasks):
        info = tasks[task_id]
        print(f"{task_id:<10} {info.get('status', 'pending'):<10} {info.get('title', '')}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Forge runner for codex wave prompts.")
    subparsers = parser.add_subparsers(dest="command")

    init_parser = subparsers.add_parser("init", help="Bootstrap .forge state and tasks from codex-prompts")
    init_parser.add_argument("--force", action="store_true", help="Rewrite generated task files")

    subparsers.add_parser("list", help="List generated Forge tasks by wave")
    subparsers.add_parser("status", help="Show current Forge task state")

    run_parser = subparsers.add_parser("run", help="Run a wave, task, or all waves")
    run_parser.add_argument("target", help="Wave number, task id, `all`, or `check`")
    run_parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Codex model to run (default: {DEFAULT_MODEL})")
    run_parser.add_argument("--max-parallel", type=int, default=4, help="Maximum parallel Codex workers per wave")
    run_parser.add_argument("--dry-run", action="store_true", help="Print commands without launching Codex")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "init":
        tasks = init_forge(force=args.force)
        print(f"Initialized Forge workspace with {len(tasks)} tasks.")
        return 0
    if args.command == "list":
        return list_tasks()
    if args.command == "status":
        return status_command()
    if args.command == "run":
        return run_target(args.target, model=args.model, max_parallel=args.max_parallel, dry_run=args.dry_run)

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
