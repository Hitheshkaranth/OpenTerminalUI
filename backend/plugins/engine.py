from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class PluginSpec(BaseModel):
    name: str
    version: str
    description: str
    author: str
    enabled: bool = False
    path: str = ""


class PluginEngine:
    """Central plugin engine that discovers, loads, and executes plugins."""

    HOOKS = {"on_data_fetched", "on_chart_data_requested", "on_order_placed", "on_alert_triggered"}

    def __init__(self, plugins_root: str | None = None) -> None:
        root = plugins_root or os.getenv("OT_PLUGINS_ROOT", "plugins")
        self.plugins_root = Path(root).resolve()
        self._specs: dict[str, PluginSpec] = {}
        self._instances: dict[str, Any] = {}
        self._active_file = Path(os.getenv("OT_PLUGINS_ACTIVE", str(self.plugins_root.parent / "active_plugins.json")))
        self._load_active()

    # ---- persistence (JSON) ----

    def _load_active(self) -> None:
        if not self._active_file.exists():
            return
        try:
            data = json.loads(self._active_file.read_text(encoding="utf-8"))
            names = data.get("active", []) if isinstance(data, dict) else []
            for name in names:
                if name in self._specs:
                    self._specs[name].enabled = True
                    self._instances.setdefault(name, None)
        except Exception:
            pass

    def _save_active(self) -> None:
        active = {n: s.model_dump() for n, s in self._specs.items() if s.enabled}
        self._active_file.parent.mkdir(parents=True, exist_ok=True)
        self._active_file.write_text(json.dumps({"active": active}, indent=2), encoding="utf-8")

    # ---- discovery ----

    def discover_plugins(self, directory: str | Path | None = None) -> list[PluginSpec]:
        root = Path(directory) if directory else self.plugins_root
        if not root.is_dir():
            return []
        for manifest in root.rglob("plugin.yaml"):
            try:
                data = yaml.safe_load(manifest.read_text(encoding="utf-8")) or {}
            except Exception:
                continue
            required = {"name", "version", "author", "description"}
            if not required.issubset(set(data.keys())):
                continue
            spec = PluginSpec(
                name=str(data["name"]),
                version=str(data["version"]),
                description=str(data.get("description", "")),
                author=str(data.get("author", "")),
                path=str(manifest),
            )
            self._specs[spec.name] = spec
        return list(self._specs.values())

    # ---- load ----

    def load_plugin(self, path: str) -> PluginSpec | None:
        manifest = Path(path)
        if not manifest.is_file():
            return None
        try:
            data = yaml.safe_load(manifest.read_text(encoding="utf-8")) or {}
        except Exception:
            return None
        required = {"name", "version", "author", "description"}
        if not required.issubset(set(data.keys())):
            return None
        spec = PluginSpec(
            name=str(data["name"]),
            version=str(data["version"]),
            description=str(data.get("description", "")),
            author=str(data.get("author", "")),
            path=str(manifest),
        )
        self._specs[spec.name] = spec
        return spec

    # ---- activate / deactivate ----

    async def activate_plugin(self, name: str) -> PluginSpec:
        spec = self._specs.get(name)
        if spec is None:
            raise KeyError(f"Plugin not found: {name}")
        spec.enabled = True
        self._save_active()
        return spec

    async def deactivate_plugin(self, name: str) -> PluginSpec:
        spec = self._specs.get(name)
        if spec is None:
            raise KeyError(f"Plugin not found: {name}")
        spec.enabled = False
        if name in self._instances:
            self._instances[name] = None
        self._save_active()
        return spec

    def get_active_plugins(self) -> list[PluginSpec]:
        return [s for s in self._specs.values() if s.enabled]

    # ---- hooks ----

    async def run_plugin_hook(
        self,
        plugin_name: str,
        hook_name: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        if hook_name not in self.HOOKS:
            return {"error": f"Unknown hook: {hook_name}"}
        spec = self._specs.get(plugin_name)
        if spec is None or not spec.enabled:
            return {"error": f"Plugin not loaded or not enabled: {plugin_name}"}
        instance = self._instances.get(plugin_name)
        if instance is None:
            instance = await self._resolve_instance(spec)
            if instance is None:
                return {"error": f"Could not resolve instance for plugin: {plugin_name}"}
        try:
            result = await getattr(instance, hook_name, lambda **kw: None)(**kwargs)
            return {"plugin": plugin_name, "hook": hook_name, "result": result}
        except Exception as exc:
            logger.exception("Plugin hook %s on %s failed", hook_name, plugin_name)
            return {"error": str(exc)}

    async def run_all_hooks(
        self,
        hook_name: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        results: dict[str, Any] = {}
        for spec in self.get_active_plugins():
            results[spec.name] = await self.run_plugin_hook(spec.name, hook_name, **kwargs)
        return results

    # ---- internal helpers ----

    async def _resolve_instance(self, spec: PluginSpec) -> Any:
        try:
            import importlib

            module_name = spec.path  # simplified – use entry_point if present in manifest
            manifest_data = yaml.safe_load(Path(spec.path).read_text(encoding="utf-8")) or {}
            entry_point = manifest_data.get("entry_point")
            if not entry_point:
                return None
            mod = importlib.import_module(entry_point)
            cls = getattr(mod, "PluginImpl", None)
            if cls is None:
                return None
            instance = cls()
            self._instances[spec.name] = instance
            return instance
        except Exception:
            logger.exception("Failed to resolve plugin instance for %s", spec.name)
            return None