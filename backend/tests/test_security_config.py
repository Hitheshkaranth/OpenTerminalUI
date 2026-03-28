from __future__ import annotations

import pytest

from backend.config import security as security_module


def test_jwt_secret_is_ephemeral_in_development(monkeypatch) -> None:
    monkeypatch.setenv("OPENTERMINALUI_ENV", "development")
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    security_module._ephemeral_secrets.clear()

    secret = security_module.get_jwt_secret()

    assert secret
    assert secret != "dev-insecure-secret-key"


def test_cache_signing_key_fails_fast_in_non_dev(monkeypatch) -> None:
    monkeypatch.setenv("OPENTERMINALUI_ENV", "production")
    monkeypatch.delenv("CACHE_SIGNING_KEY", raising=False)
    security_module._ephemeral_secrets.clear()

    with pytest.raises(RuntimeError, match="CACHE_SIGNING_KEY"):
        security_module.get_cache_signing_key()
