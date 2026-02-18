from __future__ import annotations

from backend.plugins.base import Plugin, PluginContext


class PluginImpl(Plugin):
    name = "unusual_volume_detector"
    version = "0.1.0"

    async def on_init(self, context: PluginContext):
        context.log("Unusual volume detector initialized")

    async def on_bar_close(self, symbol: str, bar: dict):
        return None
