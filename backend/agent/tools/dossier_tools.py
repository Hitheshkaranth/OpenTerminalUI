"""Read the caller's saved thesis and evidence without changing it."""
from __future__ import annotations

from backend.agent.tools.registry import ToolSpec
from backend.agent.tools.envelope import ok, err
from backend.shared.db import SessionLocal


def dossier_tool_specs(user_id: str) -> list[ToolSpec]:
    async def read(args):
        from fastapi import HTTPException
        from backend.research_dossiers import service
        with SessionLocal() as db:
            try:
                dossier = service.output(service.owned(db, user_id, str(args.get("dossier_id", ""))))
            except HTTPException:
                return err("Research dossier is unavailable", code="not_found")
        return ok(dossier, source="user_research", quality="cached", as_of=dossier.get("updated_at"),
                  note="User-authored thesis and curated evidence; not independently verified market facts.")
    return [ToolSpec(name="get_research_dossier", description="Read the user's saved research dossier, thesis, assumptions, catalysts, invalidation conditions and cited evidence. Use dossier_id from the active screen context before reviewing that thesis.",
                     parameters={"type": "object", "properties": {"dossier_id": {"type": "string"}}, "required": ["dossier_id"]},
                     handler=read, read_only=True)]
