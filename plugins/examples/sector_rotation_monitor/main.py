from __future__ import annotations

from backend.plugins.base import Plugin, PluginContext


class PluginImpl(Plugin):
    name = "sector_rotation_monitor"
    version = "0.1.0"

    async def on_init(self, context: PluginContext):
        context.log("Sector rotation monitor initialized")

    async def on_tick(self, symbol: str, tick: dict):
        return None
