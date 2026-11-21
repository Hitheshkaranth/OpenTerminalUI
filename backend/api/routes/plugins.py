from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from backend.auth.deps import require_role

from backend.plugins.loader import plugin_loader

router = APIRouter()
logger = logging.getLogger(__name__)


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
async def enable_plugin(plugin_id: str, _auth=Depends(require_role("admin"))) -> dict[str, object]:  # noqa: ARG001
    key = plugin_id.replace("%40", "@")
    try:
        rec = await plugin_loader.enable(key)
    except KeyError:
        raise HTTPException(status_code=404, detail="Plugin not found")
    except Exception as exc:
        logger.exception("Failed to enable plugin %s", plugin_id)
        raise HTTPException(status_code=400, detail="Failed to enable plugin") from exc
    return {"id": rec.id, "enabled": rec.enabled}


@router.post("/plugins/{plugin_id}/disable")
async def disable_plugin(plugin_id: str, _auth=Depends(require_role("admin"))) -> dict[str, object]:  # noqa: ARG001
    key = plugin_id.replace("%40", "@")
    try:
        rec = await plugin_loader.disable(key)
    except KeyError:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return {"id": rec.id, "enabled": rec.enabled}


@router.post("/plugins/{plugin_id}/reload")
async def reload_plugin(plugin_id: str, _auth=Depends(require_role("admin"))) -> dict[str, object]:  # noqa: ARG001
    key = plugin_id.replace("%40", "@")
    try:
        rec = await plugin_loader.reload(key)
    except KeyError:
        raise HTTPException(status_code=404, detail="Plugin not found")
    except Exception as exc:
        logger.exception("Failed to reload plugin %s", plugin_id)
        raise HTTPException(status_code=400, detail="Failed to reload plugin") from exc
    return {"id": rec.id, "enabled": rec.enabled}
