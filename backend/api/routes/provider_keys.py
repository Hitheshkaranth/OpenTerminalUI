from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

from backend.api.routes.providers import PROVIDER_ENV_KEYS, _PROVIDER_DEFS, probe_provider
from backend.auth.deps import require_role
from backend.config.env import _workspace_root
from backend.config.settings import get_settings

router = APIRouter()


def _env_path() -> Path:
    """Return the path to the root .env file. Overrideable for testing."""
    return _workspace_root() / ".env"


def mask(value: str) -> str:
    """Mask a secret value.

    Values longer than 6 chars: first 2 + "\\u2026" + last 2 (e.g. "ab\\u2026gh").
    Values 6 chars or fewer: replaced with "\\u2022" * 4.
    Empty / None: returns None.
    """
    if not value:
        return None  # type: ignore[return-value]
    if len(value) <= 6:
        return "\u2022" * 4
    return f"{value[:2]}\u2026{value[-2:]}"


async def _put_provider_keys_impl(values: dict[str, str]) -> dict[str, Any]:
    """Core PUT logic: write .env, set os.environ, return GET shape with flags."""
    env_path = _env_path()
    env_marker = "# managed by Settings \u2192 Data Providers"

    # Read current content
    if env_path.exists():
        content = env_path.read_text(encoding="utf-8")
    else:
        content = ""

    lines = content.splitlines()

    # Find the marker
    marker_idx = None
    for i, line in enumerate(lines):
        if env_marker in line:
            marker_idx = i
            break

    # Split into before-section and after-section
    before_lines = lines[:marker_idx] if marker_idx is not None else list(lines)
    after_lines = lines[marker_idx:] if marker_idx is not None else []

    # Parse existing keys in the after-section (managed section)
    managed_keys: dict[str, int] = {}  # name -> line index in after_lines
    for i, line in enumerate(after_lines):
        stripped = line.strip()
        if stripped and "=" in stripped and not stripped.startswith("#"):
            key, _, _ = stripped.partition("=")
            key = key.strip()
            if key in PROVIDER_ENV_KEYS:
                managed_keys[key] = i

    # Parse existing keys in the before-section (unmanaged)
    unmanaged_keys: dict[str, int] = {}  # name -> line index in before_lines
    for i, line in enumerate(before_lines):
        stripped = line.strip()
        if stripped and "=" in stripped and not stripped.startswith("#"):
            key, _, _ = stripped.partition("=")
            key = key.strip()
            if key in PROVIDER_ENV_KEYS:
                unmanaged_keys[key] = i

    applied_live: list[str] = []
    restart_required: list[str] = []
    live_set = {"KITE_ACCESS_TOKEN", "LM_STUDIO_BASE_URL", "OPENROUTER_API_KEY", "FRED_API_KEY"}

    for name, value in values.items():
        if name in unmanaged_keys:
            # Update in place in before-section
            idx = unmanaged_keys[name]
            if value:
                before_lines[idx] = f"{name}={value}"
            else:
                before_lines[idx] = f"{name}="
        elif name in managed_keys:
            # Update in place in after-section
            idx = managed_keys[name]
            if value:
                after_lines[idx] = f"{name}={value}"
            else:
                after_lines[idx] = f"{name}="
        else:
            # New key \u2014 append to after-section (after marker)
            if value:
                after_lines.append(f"{name}={value}")
            else:
                after_lines.append(f"{name}=")

        # Set or clear os.environ
        if value:
            os.environ[name] = value
            if name in live_set:
                applied_live.append(name)
            else:
                restart_required.append(name)
        else:
            os.environ.pop(name, None)
            restart_required.append(name)

    # Reassemble content
    new_content = "\n".join(before_lines)
    if marker_idx is not None:
        new_content += "\n" + "\n".join(after_lines)
    else:
        # No existing marker — add managed section
        new_content += "\n" + env_marker + "\n" + "\n".join(after_lines)

    # Ensure trailing newline
    if new_content and not new_content.endswith("\n"):
        new_content += "\n"

    # Write atomically: temp file then rename
    tmp_path = env_path.parent / (env_path.name + ".tmp")
    tmp_path.write_text(new_content, encoding="utf-8")
    os.replace(str(tmp_path), str(env_path))

    # Clear settings cache
    get_settings.cache_clear()

    # Now build the GET response shape
    content_after = new_content
    env_key_names = set(PROVIDER_ENV_KEYS.keys())
    env_key_names_in_file: set[str] = set()
    for line in content_after.splitlines():
        stripped = line.strip()
        if stripped and "=" in stripped and not stripped.startswith("#"):
            key, _, val = stripped.partition("=")
            key = key.strip()
            val = val.strip().strip("'").strip('"')
            if key in env_key_names and val:
                env_key_names_in_file.add(key)

    keys_list: list[dict[str, Any]] = []
    for name, provider_id in PROVIDER_ENV_KEYS.items():
        value = os.environ.get(name)
        if value is None or value == "":
            set_status = False
            masked = None
            source = "unset"
        elif name in env_key_names_in_file:
            set_status = True
            masked = mask(value)
            source = "env_file"
        else:
            set_status = True
            masked = mask(value)
            source = "process"

        keys_list.append({
            "name": name,
            "provider": provider_id,
            "set": set_status,
            "masked": masked,
            "source": source,
        })

    return {
        "env_file": str(env_path),
        "keys": keys_list,
        "applied_live": applied_live,
        "restart_required": restart_required,
    }


class PutBody(BaseModel):
    values: dict[str, str]


# ---------------------------------------------------------------------------
# Provider env keys — re-exported from providers.py for convenience
# ---------------------------------------------------------------------------
# PROVIDER_ENV_KEYS: already imported from providers.py above


# ---------------------------------------------------------------------------
# GET /api/settings/provider-keys
# ---------------------------------------------------------------------------
@router.get("/settings/provider-keys", tags=["provider-keys"])
async def get_provider_keys(_auth=Depends(require_role("admin"))) -> dict[str, Any]:  # noqa: ARG001
    """Return the current state of all provider API keys."""
    env_path = _env_path()
    env_key_names = set(PROVIDER_ENV_KEYS.keys())

    # Determine which keys appear in the env file with non-empty values
    env_key_names_in_file: set[str] = set()
    if env_path.exists():
        raw = env_path.read_text(encoding="utf-8")
        for line in raw.splitlines():
            stripped = line.strip()
            if stripped and "=" in stripped and not stripped.startswith("#"):
                key, _, val = stripped.partition("=")
                key = key.strip()
                val = val.strip().strip("'").strip('"')
                if key in env_key_names and val:
                    env_key_names_in_file.add(key)

    keys_list: list[dict[str, Any]] = []
    for name, provider_id in PROVIDER_ENV_KEYS.items():
        value = os.environ.get(name)
        if value is None or value == "":
            set_status = False
            masked = None
            source = "unset"
        elif name in env_key_names_in_file:
            set_status = True
            masked = mask(value)
            source = "env_file"
        else:
            set_status = True
            masked = mask(value)
            source = "process"

        keys_list.append({
            "name": name,
            "provider": provider_id,
            "set": set_status,
            "masked": masked,
            "source": source,
        })

    return {
        "env_file": str(env_path),
        "keys": keys_list,
    }


# ---------------------------------------------------------------------------
# PUT /api/settings/provider-keys
# ---------------------------------------------------------------------------
@router.put("/settings/provider-keys", tags=["provider-keys"])
async def put_provider_keys(body: PutBody, _auth=Depends(require_role("admin"))) -> dict[str, Any]:
    """Update provider API keys. Writes to .env and os.environ."""
    values = body.values

    # Validate values
    for name, value in values.items():
        if "\n" in value or "\r" in value:
            raise HTTPException(status_code=422, detail=f"value for {name} contains newline")
        if len(value) > 512:
            raise HTTPException(status_code=422, detail=f"value for {name} exceeds 512 characters")
    values = {name: value.strip() for name, value in values.items()}

    # Validate names
    for name in values:
        if name not in PROVIDER_ENV_KEYS:
            raise HTTPException(status_code=422, detail=f"unknown key: {name}")

    return await _put_provider_keys_impl(values)


# ---------------------------------------------------------------------------
# POST /api/settings/provider-keys/test/{provider_id}
# ---------------------------------------------------------------------------
class TestResult(BaseModel):
    provider: str
    status: str
    last_error: str | None
    checked_at: str


@router.post("/settings/provider-keys/test/{provider_id}", tags=["provider-keys"])
async def test_provider_key(provider_id: str, _auth=Depends(require_role("admin"))) -> TestResult:  # noqa: ARG001
    """Run a probe for a single provider."""
    # Check if provider_id exists
    known_ids = {pdef["id"] for pdef in _PROVIDER_DEFS}
    if provider_id not in known_ids:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id}")

    result = await probe_provider(provider_id)
    return TestResult(
        provider=result["provider"],
        status=result["status"],
        last_error=result["last_error"],
        checked_at=result["checked_at"],
    )