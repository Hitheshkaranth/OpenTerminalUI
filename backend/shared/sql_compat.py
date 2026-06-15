"""Dialect-aware SQL fragment helpers.

Several services build tables with raw ``CREATE TABLE`` / ``ALTER TABLE`` SQL
executed through the shared SQLAlchemy engine. Those statements were originally
written for SQLite and use SQLite-only spellings (``INTEGER PRIMARY KEY
AUTOINCREMENT``, ``BOOLEAN ... DEFAULT 0``) that PostgreSQL rejects.

These helpers return the correct fragment for the active dialect so the same
code path works on both backends. Prefer SQLAlchemy Core / migrations for new
tables; use these only where raw SQL is already in place.
"""

from __future__ import annotations

from sqlalchemy.engine import Connection, Engine

__all__ = [
    "dialect_name",
    "autoincrement_pk",
    "bool_literal",
    "bool_default",
    "timestamp_type",
]


def dialect_name(bind: Engine | Connection) -> str:
    """Return the lowercase dialect name (e.g. ``"sqlite"``, ``"postgresql"``)."""
    return bind.dialect.name


def autoincrement_pk(bind: Engine | Connection, column: str = "id") -> str:
    """Return an auto-incrementing integer primary-key column definition.

    PostgreSQL uses ``SERIAL``; SQLite uses ``INTEGER PRIMARY KEY AUTOINCREMENT``.
    """
    if dialect_name(bind) == "postgresql":
        return f"{column} SERIAL PRIMARY KEY"
    return f"{column} INTEGER PRIMARY KEY AUTOINCREMENT"


def bool_literal(bind: Engine | Connection, value: bool) -> str:
    """Return a boolean literal valid for the active dialect (``TRUE``/``1``)."""
    if dialect_name(bind) == "postgresql":
        return "TRUE" if value else "FALSE"
    return "1" if value else "0"


def bool_default(bind: Engine | Connection, value: bool) -> str:
    """Return a ``BOOLEAN NOT NULL DEFAULT <x>`` column-type fragment."""
    return f"BOOLEAN NOT NULL DEFAULT {bool_literal(bind, value)}"


def timestamp_type(bind: Engine | Connection) -> str:
    """Return the timestamp column type. SQLite accepts ``DATETIME``; PostgreSQL
    needs ``TIMESTAMP``."""
    if dialect_name(bind) == "postgresql":
        return "TIMESTAMP"
    return "DATETIME"
