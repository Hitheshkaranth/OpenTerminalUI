from __future__ import annotations

from pathlib import Path


def export_placeholder(output_dir: str = "reports") -> Path:
    path = Path(output_dir)
    path.mkdir(parents=True, exist_ok=True)
    out = path / "placeholder.txt"
    out.write_text("Export service scaffold ready", encoding="utf-8")
    return out
