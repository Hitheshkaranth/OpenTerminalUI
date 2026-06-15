#!/usr/bin/env python
"""Idempotently seed an initial admin user so a fresh install can log in right away.

Reads ``BOOTSTRAP_ADMIN_EMAIL`` / ``BOOTSTRAP_ADMIN_PASSWORD`` from the environment
(or the repo-root ``.env``). Safety rules:

* No-op if **any** user already exists — never clobbers a real deployment.
* No-op if no password is configured — never creates an account with a blank /
  guessable password.

The script always exits 0 so it can run during startup without ever blocking it.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Make the repo importable when this file is run directly (python scripts/seed_admin.py).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.config.env import load_local_env


def main() -> int:
    load_local_env()
    email = (os.getenv("BOOTSTRAP_ADMIN_EMAIL") or "").strip().lower()
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or ""

    if not email or not password:
        print("[seed-admin] BOOTSTRAP_ADMIN_EMAIL/PASSWORD not set; skipping admin seed.")
        return 0

    try:
        from passlib.context import CryptContext

        from backend.models.user import User, UserRole
        from backend.shared.db import Base, SessionLocal, engine
    except Exception as exc:  # pragma: no cover - defensive, never block startup
        print(f"[seed-admin] dependencies unavailable ({exc}); skipping.")
        return 0

    # Make sure the users table exists (idempotent; harmless if migrations already ran).
    try:
        Base.metadata.create_all(bind=engine, tables=[User.__table__])
    except Exception:
        pass

    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            print("[seed-admin] a user already exists; skipping admin seed.")
            return 0
        db.add(
            User(
                email=email,
                hashed_password=pwd_context.hash(password),
                role=UserRole.ADMIN,
            )
        )
        db.commit()
        print(f"[seed-admin] created initial admin account: {email}")
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        print(f"[seed-admin] could not seed admin ({exc}); skipping.")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
