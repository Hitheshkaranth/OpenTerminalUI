from __future__ import annotations

import hashlib
import logging
import os
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)


class KiteClient:
    API_BASE_URL = "https://api.kite.trade"
    LOGIN_BASE_URL = "https://kite.trade/connect/login"

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_secret: Optional[str] = None,
        access_token: Optional[str] = None,
        timeout: float = 12.0,
    ) -> None:
        self.api_key = api_key or os.getenv("KITE_API_KEY", "")
        self.api_secret = api_secret or os.getenv("KITE_API_SECRET", "")
        self.access_token = access_token or os.getenv("KITE_ACCESS_TOKEN", "")
        self.timeout = timeout
        self.client: Optional[httpx.AsyncClient] = None

    async def initialize(self) -> None:
        if self.client:
            return

        self.client = httpx.AsyncClient(
            timeout=self.timeout,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            trust_env=False,
            follow_redirects=True,
            headers={"X-Kite-Version": "3"},
        )

    async def close(self) -> None:
        if self.client:
            await self.client.aclose()
            self.client = None

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.api_secret)

    def get_login_url(self, redirect_uri: Optional[str] = None) -> str:
        if not self.api_key:
            return ""
        params: Dict[str, str] = {"api_key": self.api_key, "v": "3"}
        if redirect_uri:
            params["redirect_uri"] = redirect_uri
        return f"{self.LOGIN_BASE_URL}?{urlencode(params)}"

    def _auth_headers(self, access_token: str) -> Dict[str, str]:
        return {"Authorization": f"token {self.api_key}:{access_token}"}

    def resolve_access_token(self, override: Optional[str] = None) -> str:
        return (override or self.access_token or "").strip()

    async def _get(
        self,
        endpoint: str,
        access_token: str,
        params: Optional[Any] = None,
    ) -> Dict[str, Any]:
        if not self.api_key:
            return {}
        if not self.client:
            await self.initialize()

        try:
            response = await self.client.get(
                f"{self.API_BASE_URL}{endpoint}",
                params=params or {},
                headers=self._auth_headers(access_token),
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            logger.error("Kite GET failed for %s: %s", endpoint, exc)
            return {}

    async def create_session(self, request_token: str) -> Dict[str, Any]:
        if not self.is_configured or not request_token:
            return {}
        if not self.client:
            await self.initialize()

        checksum = hashlib.sha256(
            f"{self.api_key}{request_token}{self.api_secret}".encode("utf-8")
        ).hexdigest()
        payload = {
            "api_key": self.api_key,
            "request_token": request_token,
            "checksum": checksum,
        }

        try:
            response = await self.client.post(
                f"{self.API_BASE_URL}/session/token",
                data=payload,
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            logger.error("Kite session creation failed: %s", exc)
            return {}

    async def get_profile(self, access_token: str) -> Dict[str, Any]:
        return await self._get("/user/profile", access_token)

    async def get_ltp(self, access_token: str, instruments: list[str]) -> Dict[str, Any]:
        if not instruments:
            return {}
        params = [("i", ins.strip()) for ins in instruments if ins.strip()]
        return await self._get("/quote/ltp", access_token, params=params)

    async def get_quote(self, access_token: str, instruments: list[str]) -> Dict[str, Any]:
        if not instruments:
            return {}
        params = [("i", ins.strip()) for ins in instruments if ins.strip()]
        return await self._get("/quote", access_token, params=params)
