from __future__ import annotations

from fastapi import FastAPI

def register_api_routers(app: FastAPI) -> None:
    from backend.api.routes.options import router as options_router

    app.include_router(options_router)


def __getattr__(name: str):
    if name == "options_router":
        from backend.api.routes.options import router as options_router

        return options_router
    raise AttributeError(name)


__all__ = ["register_api_routers", "options_router"]
