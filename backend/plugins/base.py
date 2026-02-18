from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class PluginContext:
    permissions: set[str]
    get_quote: callable
    get_history: callable
    create_alert: callable
    read_portfolio: callable
    log: callable


class Plugin(ABC):
    name: str = ""
    version: str = ""

    @abstractmethod
    async def on_init(self, context: PluginContext): ...

    async def on_tick(self, symbol: str, tick: dict):
        return None

    async def on_bar_close(self, symbol: str, bar: dict):
        return None

    async def on_portfolio_update(self, portfolio: dict):
        return None

    async def on_shutdown(self):
        return None
