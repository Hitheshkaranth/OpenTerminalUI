from __future__ import annotations

import importlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from backend.shared.db import SessionLocal
from backend.plugins.base import Plugin
from backend.plugins.context import PluginContextImpl

ALLOWED_PERMISSIONS = {"read_quotes", "read_portfolio", "create_alerts", "execute_scripts"}


@dataclass
class PluginRecord:
    id: str
    manifest_path: str
    manifest: dict[str, Any]
    enabled: bool
    instance: Plugin | None = None


class PluginLoader:
    def __init__(self, plugins_root: str = "plugins") -> None:
        root = Path(plugins_root)
        if root.is_absolute():
            self.plugins_root = root
        else:
            cwd_root = (Path.cwd() / root).resolve()
            repo_root = (Path(__file__).resolve().parents[2] / root).resolve()

            def has_manifests(path: Path) -> bool:
                return path.exists() and any(path.rglob("plugin.yaml"))

            if has_manifests(cwd_root):
                self.plugins_root = cwd_root
            elif has_manifests(repo_root):
                self.plugins_root = repo_root
            else:
                # Default to cwd-relative behavior when no manifests exist yet.
                self.plugins_root = cwd_root
        self.records: dict[str, PluginRecord] = {}

    def discover(self) -> list[PluginRecord]:
        self.records = {}
        if not self.plugins_root.exists():
            return []
        for manifest in self.plugins_root.rglob("plugin.yaml"):
            try:
                payload = yaml.safe_load(manifest.read_text(encoding="utf-8")) or {}
            except Exception:
                continue
            if not self._validate_manifest(payload):
                continue
            plugin_id = f"{payload['name']}@{payload['version']}"
            self.records[plugin_id] = PluginRecord(
                id=plugin_id,
                manifest_path=str(manifest),
                manifest=payload,
                enabled=False,
            )
        return list(self.records.values())

    def _validate_manifest(self, m: dict[str, Any]) -> bool:
        required = {"name", "version", "author", "description", "entry_point", "required_permissions"}
        if not required.issubset(set(m.keys())):
            return False
        perms = set(m.get("required_permissions") or [])
        return perms.issubset(ALLOWED_PERMISSIONS)

    async def enable(self, plugin_id: str) -> PluginRecord:
        rec = self.records.get(plugin_id)
        if rec is None:
            raise KeyError("Plugin not found")
        if rec.enabled and rec.instance is not None:
            return rec
        module_name = str(rec.manifest.get("entry_point"))
        mod = importlib.import_module(module_name)
        cls = getattr(mod, "PluginImpl", None)
        if cls is None:
            raise RuntimeError("Plugin entry point missing PluginImpl")
        instance = cls()
        if not isinstance(instance, Plugin):
            raise TypeError("PluginImpl must inherit Plugin")
        permissions = set(rec.manifest.get("required_permissions") or [])
        context = PluginContextImpl(db_factory=SessionLocal, permissions=permissions)
        await instance.on_init(context)  # type: ignore[arg-type]
        rec.instance = instance
        rec.enabled = True
        return rec

    async def disable(self, plugin_id: str) -> PluginRecord:
        rec = self.records.get(plugin_id)
        if rec is None:
            raise KeyError("Plugin not found")
        if rec.instance is not None:
            await rec.instance.on_shutdown()
        rec.instance = None
        rec.enabled = False
        return rec

    async def reload(self, plugin_id: str) -> PluginRecord:
        if plugin_id not in self.records:
            raise KeyError("Plugin not found")
        await self.disable(plugin_id)
        return await self.enable(plugin_id)


plugin_loader = PluginLoader()
