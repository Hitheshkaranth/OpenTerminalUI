from __future__ import annotations

import logging
import os
import secrets

from backend.config.env import load_local_env

logger = logging.getLogger(__name__)

_ephemeral_secrets: dict[str, str] = {}
# Contract C1: only these values count as development. Anything else -- including an
# unset or empty OPENTERMINALUI_ENV -- is treated as production (fail closed).
_DEV_ENV_NAMES = frozenset({"dev", "development", "local", "test"})
_warned_flags: set[str] = set()


def get_app_env() -> str:
    """Return the normalised runtime environment name ("production" when unset)."""
    load_local_env()
    return (os.getenv("OPENTERMINALUI_ENV") or "").strip().lower() or "production"


# Backwards-compatible alias for callers that used the private name.
_runtime_env = get_app_env


def is_development_env() -> bool:
    return get_app_env() in _DEV_ENV_NAMES


def _warn_once(key: str, message: str, *args: object) -> None:
    if key in _warned_flags:
        return
    _warned_flags.add(key)
    logger.warning(message, *args)


def dev_auth_bypass_enabled() -> bool:
    """True when E2E_DEV_AUTH=1 is set AND we are in a development environment."""
    if os.getenv("E2E_DEV_AUTH", "").strip() != "1":
        return False
    if not is_development_env():
        _warn_once(
            "e2e_ignored",
            "E2E_DEV_AUTH=1 is IGNORED in %r environment; authentication is enforced.",
            get_app_env(),
        )
        return False
    _warn_once(
        "e2e_on",
        "SECURITY WARNING: E2E_DEV_AUTH=1 is active -- unauthenticated requests resolve to an "
        "ADMIN dev user. Never run this outside local development/e2e.",
    )
    return True


def auth_middleware_disabled() -> bool:
    """True when AUTH_MIDDLEWARE_ENABLED is off AND we are in a development environment."""
    if os.getenv("AUTH_MIDDLEWARE_ENABLED", "1").strip() == "1":
        return False
    if not is_development_env():
        _warn_once(
            "auth_off_ignored",
            "AUTH_MIDDLEWARE_ENABLED=0 is IGNORED in %r environment; authentication is enforced.",
            get_app_env(),
        )
        return False
    _warn_once(
        "auth_off",
        "SECURITY WARNING: AUTH_MIDDLEWARE_ENABLED=0 -- the JWT auth middleware is disabled. "
        "Never run this outside local development.",
    )
    return True


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
        f"{get_app_env()!r} environment (set OPENTERMINALUI_ENV=development for local use)."
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
    """Fail fast at startup: in non-development envs missing secrets raise RuntimeError."""
    get_jwt_secret()
    get_cache_signing_key()
    # Surface the dev-bypass warnings (or their "ignored" counterparts) once at startup.
    dev_auth_bypass_enabled()
    auth_middleware_disabled()
