from __future__ import annotations

import pytest
from fastapi import HTTPException

import backend.main as main


def test_spa_entry_rejects_paths_escaping_frontend_dist(tmp_path, monkeypatch) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html></html>")
    (tmp_path / "secret.env").write_text("KEY=1")
    monkeypatch.setattr(main, "_frontend_dist", dist)

    with pytest.raises(HTTPException) as exc:
        main.spa_entry("../secret.env")
    assert exc.value.status_code == 404
    assert str(main.spa_entry("index.html").path).endswith("index.html")
