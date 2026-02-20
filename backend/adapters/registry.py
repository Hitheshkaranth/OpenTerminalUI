from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from backend.adapters.base import DataAdapter
from backend.adapters.crypto import CryptoDataAdapter
from backend.adapters.kite import KiteAdapter
from backend.adapters.mock import MockDataAdapter
from backend.adapters.yahoo import YahooFinanceAdapter


@dataclass
class AdapterChain:
    primary: str
    fallback: list[str]


class AdapterRegistry:
    def __init__(self, config_path: Path | None = None) -> None:
        self.config_path = config_path or (Path(__file__).resolve().parents[2] / "config" / "adapters.yaml")
        self._config = self._load_config()
        self._instances: dict[str, DataAdapter] = {}
        self._factory = {
            "kite": lambda: KiteAdapter(),
            "yahoo": lambda: YahooFinanceAdapter(),
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
                    "NASDAQ": {"primary": "yahoo", "fallback": []},
                    "NYSE": {"primary": "yahoo", "fallback": []},
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
        return AdapterChain(primary=primary, fallback=fallback)

    def _instance(self, key: str) -> DataAdapter:
        k = key.strip().lower()
        if k not in self._instances:
            factory = self._factory.get(k)
            if factory is None:
                raise KeyError(f"Unknown adapter: {k}")
            self._instances[k] = factory()
        return self._instances[k]

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


_registry = AdapterRegistry()


def get_adapter_registry() -> AdapterRegistry:
    return _registry
