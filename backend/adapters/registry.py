from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from backend.adapters.base import DataAdapter
from backend.adapters.alpaca import AlpacaAdapter
from backend.adapters.crypto import CryptoDataAdapter
from backend.adapters.kite import KiteAdapter
from backend.adapters.mock import MockDataAdapter
from backend.adapters.yahoo import YahooFinanceAdapter
from backend.adapters.us_options_adapter import USOptionsAdapter
from backend.core.failover import FailoverSlot, call_with_failover


@dataclass
class AdapterChain:
    primary: str
    fallback: list[str]


class AdapterRegistry:
    def __init__(self, config_path: Path | None = None, *, failure_threshold: int = 3, cooldown_seconds: int = 30) -> None:
        self.config_path = config_path or (Path(__file__).resolve().parents[2] / "config" / "adapters.yaml")
        self._config = self._load_config()
        self._instances: dict[str, DataAdapter] = {}
        self._slots: dict[str, FailoverSlot] = {}
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self._factory = {
            "alpaca": lambda: AlpacaAdapter(),
            "kite": lambda: KiteAdapter(),
            "yahoo": lambda: YahooFinanceAdapter(),
            "us_options": lambda: USOptionsAdapter(),
            "crypto": lambda: CryptoDataAdapter(),
            "mock": lambda: MockDataAdapter(),
        }

    def _load_config(self) -> dict[str, Any]:
        if not self.config_path.exists():
            return {
                "default": {"primary": "kite", "fallback": ["yahoo"]},
                "exchanges": {
                    "NSE": {"primary": "kite", "fallback": ["yahoo"]},
                    "BSE": {"primary": "kite", "fallback": ["yahoo"]},
                    "NASDAQ": {"primary": "alpaca", "fallback": ["yahoo"]},
                    "NYSE": {"primary": "alpaca", "fallback": ["yahoo"]},
                    "AMEX": {"primary": "alpaca", "fallback": ["yahoo"]},
                    "CRYPTO": {"primary": "crypto", "fallback": ["yahoo"]},
                },
            }
        return yaml.safe_load(self.config_path.read_text(encoding="utf-8")) or {}

    def _chain_for_exchange(self, exchange: str) -> AdapterChain:
        ex = exchange.strip().upper()
        exchanges = self._config.get("exchanges", {})
        row = exchanges.get(ex) or self._config.get("default") or {"primary": "kite", "fallback": ["yahoo"]}
        primary = str(row.get("primary") or "kite").strip().lower()
        fallback = [str(x).strip().lower() for x in (row.get("fallback") or []) if str(x).strip()]
        if ex in {"NASDAQ", "NYSE", "AMEX"}:
            if primary != "alpaca":
                primary = "alpaca"
            if "yahoo" not in fallback:
                fallback.append("yahoo")
        return AdapterChain(primary=primary, fallback=fallback)

    def _instance(self, key: str) -> DataAdapter:
        k = key.strip().lower()
        if k not in self._instances:
            factory = self._factory.get(k)
            if factory is None:
                raise KeyError(f"Unknown adapter: {k}")
            self._instances[k] = factory()
        return self._instances[k]

    def _slot(self, key: str, *, priority: int = 0) -> FailoverSlot:
        k = key.strip().lower()
        if k not in self._slots:
            self._slots[k] = FailoverSlot(name=k, target=self._instance(k), priority=priority)
        return self._slots[k]

    def get_adapter(self, exchange: str) -> DataAdapter:
        chain = self._chain_for_exchange(exchange)
        return self._instance(chain.primary)

    def get_chain(self, exchange: str) -> list[DataAdapter]:
        chain = self._chain_for_exchange(exchange)
        keys = [chain.primary] + chain.fallback
        out = []
        for key in keys:
            try:
                out.append(self._instance(key))
            except KeyError:
                continue
        return out

    def _slots_for_exchange(self, exchange: str) -> list[FailoverSlot]:
        chain = self._chain_for_exchange(exchange)
        keys = [chain.primary] + chain.fallback
        slots: list[FailoverSlot] = []
        for index, key in enumerate(keys):
            try:
                slots.append(self._slot(key, priority=index))
            except KeyError:
                continue
        return slots

    async def invoke(self, exchange: str, method: str, *args: Any, **kwargs: Any) -> Any:
        try:
            return await call_with_failover(
                self._slots_for_exchange(exchange),
                method,
                *args,
                failure_threshold=self.failure_threshold,
                cooldown_seconds=self.cooldown_seconds,
                **kwargs,
            )
        except RuntimeError as exc:
            raise RuntimeError(f"All adapters failed for {exchange}:{method}: {exc}") from exc

    def health_snapshot(self) -> dict[str, dict[str, Any]]:
        snapshot: dict[str, dict[str, Any]] = {}
        keys = set(self._factory)
        for exchange in (self._config.get("exchanges") or {}).values():
            keys.add(str(exchange.get("primary") or "").strip().lower())
            keys.update(str(item).strip().lower() for item in (exchange.get("fallback") or []) if str(item).strip())
        default_row = self._config.get("default") or {}
        keys.add(str(default_row.get("primary") or "").strip().lower())
        keys.update(str(item).strip().lower() for item in (default_row.get("fallback") or []) if str(item).strip())
        for key in sorted(k for k in keys if k):
            try:
                snapshot[key] = self._slot(key).snapshot()
            except KeyError:
                continue
        return snapshot


_registry = AdapterRegistry()


def get_adapter_registry() -> AdapterRegistry:
    return _registry
