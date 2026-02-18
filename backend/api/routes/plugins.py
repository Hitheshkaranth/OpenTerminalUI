from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.plugins.loader import plugin_loader

router = APIRouter()


@router.get("/plugins")
def list_plugins() -> dict[str, object]:
    rows = plugin_loader.discover()
    return {
        "items": [
            {
                "id": r.id,
                "name": r.manifest.get("name"),
                "version": r.manifest.get("version"),
                "author": r.manifest.get("author"),
                "description": r.manifest.get("description"),
                "entry_point": r.manifest.get("entry_point"),
                "required_permissions": r.manifest.get("required_permissions") or [],
                "enabled": r.enabled,
            }
            for r in rows
        ]
    }


@router.post("/plugins/{plugin_id}/enable")
async def enable_plugin(plugin_id: str) -> dict[str, object]:
    key = plugin_id.replace("%40", "@")
    try:
        rec = await plugin_loader.enable(key)
    except KeyError:
        raise HTTPException(status_code=404, detail="Plugin not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to enable plugin: {exc}")
    return {"id": rec.id, "enabled": rec.enabled}


@router.post("/plugins/{plugin_id}/disable")
async def disable_plugin(plugin_id: str) -> dict[str, object]:
    key = plugin_id.replace("%40", "@")
    try:
        rec = await plugin_loader.disable(key)
    except KeyError:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return {"id": rec.id, "enabled": rec.enabled}


@router.post("/plugins/{plugin_id}/reload")
async def reload_plugin(plugin_id: str) -> dict[str, object]:
    key = plugin_id.replace("%40", "@")
    try:
        rec = await plugin_loader.reload(key)
    except KeyError:
        raise HTTPException(status_code=404, detail="Plugin not found")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to reload plugin: {exc}")
    return {"id": rec.id, "enabled": rec.enabled}
