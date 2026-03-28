from __future__ import annotations

import logging
import os
import secrets

from backend.config.env import load_local_env

logger = logging.getLogger(__name__)

_ephemeral_secrets: dict[str, str] = {}
_DEV_ENV_NAMES = {"dev", "development", "local", "test", "testing"}


def _runtime_env() -> str:
    load_local_env()
    return (
        os.getenv("OPENTERMINALUI_ENV")
        or os.getenv("APP_ENV")
        or os.getenv("ENV")
        or "development"
    ).strip().lower()


def is_development_env() -> bool:
    return _runtime_env() in _DEV_ENV_NAMES


def resolve_secret(
    *,
    env_var: str,
    component_name: str,
    insecure_defaults: tuple[str, ...] = (),
    secret_bytes: int = 32,
) -> str:
    load_local_env()
    configured = os.getenv(env_var, "").strip()
    if configured and configured not in insecure_defaults:
        return configured

    if is_development_env():
        if env_var not in _ephemeral_secrets:
            _ephemeral_secrets[env_var] = secrets.token_hex(secret_bytes)
            logger.warning(
                "%s is not configured for %s; using an ephemeral development-only secret.",
                env_var,
                component_name,
            )
        return _ephemeral_secrets[env_var]

    raise RuntimeError(
        f"{env_var} must be set for {component_name}; refusing to use an insecure default in "
        f"{_runtime_env()!r} environment."
    )


def get_jwt_secret() -> str:
    return resolve_secret(
        env_var="JWT_SECRET_KEY",
        component_name="JWT signing",
        insecure_defaults=("dev-insecure-secret-key",),
    )


def get_cache_signing_key() -> str:
    return resolve_secret(
        env_var="CACHE_SIGNING_KEY",
        component_name="cache signing",
        insecure_defaults=("openterminalui-dev-cache-key",),
    )


def validate_runtime_secrets() -> None:
    get_jwt_secret()
    get_cache_signing_key()
