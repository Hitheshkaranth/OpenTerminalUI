#!/usr/bin/env python3
"""Fail if the declared app version, the git tags and the release tag disagree.

Usage: check_version_sync.py [--tag vX.Y.Z]
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER = r"(\d+\.\d+\.\d+)"
LANDING = rf">v{SEMVER}</(?:span|b)>"
SOURCES = {
    "frontend/src/utils/constants.ts": rf'APP_VERSION = "{SEMVER}"',
    "backend/config/settings.py": rf'(?:app_version: str = |"version", )"{SEMVER}"',
    "backend/config/settings.yaml": rf'^\s*version: "{SEMVER}"',
    "README.md": rf"badge/version-{SEMVER}-",
    "frontend/public/landing/index.html": LANDING,
    "frontend/public/landing/Docs.dc.html": LANDING,
    "frontend/public/landing/Features.dc.html": LANDING,
    "frontend/public/landing/Roadmap.dc.html": LANDING,
}


def as_tuple(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def declared_versions() -> dict[str, set[str]]:
    package = json.loads((ROOT / "frontend/package.json").read_text())
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text())
    found = {
        "frontend/package.json": {package["version"]},
        "frontend/package-lock.json": {lock["version"], lock["packages"][""]["version"]},
    }
    for path, pattern in SOURCES.items():
        found[path] = set(re.findall(pattern, (ROOT / path).read_text(), re.MULTILINE))
    return found


def remote_tags() -> list[str]:
    output = subprocess.check_output(["git", "ls-remote", "--tags", "origin"], cwd=ROOT, text=True)
    return re.findall(rf"refs/tags/v{SEMVER}$", output, re.MULTILINE)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="release tag that must match the declared version")
    args = parser.parse_args()

    version = json.loads((ROOT / "frontend/package.json").read_text())["version"]
    errors = [
        f"{path}: found {sorted(values) or 'no version'}, expected {version}"
        for path, values in declared_versions().items()
        if values != {version}
    ]
    if args.tag and args.tag != f"v{version}":
        errors.append(f"release tag {args.tag} does not match declared version v{version}")
    newer = [tag for tag in remote_tags() if as_tuple(tag) > as_tuple(version)]
    if newer:
        errors.append(f"remote tags newer than declared version {version}: {sorted(newer, key=as_tuple)}")

    for error in errors:
        print(f"version sync: {error}", file=sys.stderr)
    if errors:
        return 1
    print(f"version sync: OK ({version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
