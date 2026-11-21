#!/usr/bin/env python
"""Idempotently seed an initial admin user so a fresh install can log in right away.

Reads ``BOOTSTRAP_ADMIN_EMAIL`` / ``BOOTSTRAP_ADMIN_PASSWORD`` from the environment
(or the repo-root ``.env``). Safety rules:

* No-op if **any** user already exists — never clobbers a real deployment.
* No-op if no password is configured — never creates an account with a blank /
  guessable password.

Exit status: 0 when the admin was created or seeding was skipped (no credentials,
or a user already exists — including a concurrent replica winning the race);
non-zero on a real error (missing dependencies, schema or database failure), so the
container entrypoint fails loudly instead of starting with no way to log in.
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
        from sqlalchemy.exc import IntegrityError
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[seed-admin] ERROR: dependencies unavailable ({exc}).", file=sys.stderr)
        return 1

    # Make sure the users table exists (idempotent; harmless if migrations already ran).
    try:
        Base.metadata.create_all(bind=engine, tables=[User.__table__])
    except Exception as exc:
        print(f"[seed-admin] ERROR: could not ensure users table ({exc}).", file=sys.stderr)
        return 1

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
    except IntegrityError:
        # Another process (e.g. a second replica) seeded concurrently: already exists.
        db.rollback()
        print("[seed-admin] admin already exists (concurrent seed); skipping.")
        return 0
    except Exception as exc:
        db.rollback()
        print(f"[seed-admin] ERROR: could not seed admin ({exc}).", file=sys.stderr)
        return 1
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
