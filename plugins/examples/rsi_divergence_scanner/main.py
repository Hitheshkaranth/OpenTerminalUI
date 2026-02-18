from __future__ import annotations

from backend.plugins.base import Plugin, PluginContext


class PluginImpl(Plugin):
    name = "rsi_divergence_scanner"
    version = "0.1.0"

    async def on_init(self, context: PluginContext):
        context.log("RSI divergence scanner initialized")

    async def on_bar_close(self, symbol: str, bar: dict):
        return None
