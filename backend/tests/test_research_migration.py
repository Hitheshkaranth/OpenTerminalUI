"""Check the production migration independently from create_all startup behavior."""
from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from backend.shared.db import Base
from backend.research_dossiers.models import ResearchDossier, DossierRevision, ResearchExperiment


def test_migration_matches_models_and_preserves_data_on_repeat(monkeypatch):
    migration = import_module("backend.alembic.versions.0012_research_dossiers")
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        operations = Operations(MigrationContext.configure(conn))
        monkeypatch.setattr(migration, "op", operations)
        migration.upgrade()
        inspector = inspect(conn)
        for model in (ResearchDossier, DossierRevision, ResearchExperiment):
            table = model.__table__
            columns = {c["name"]: c for c in inspector.get_columns(table.name)}
            assert set(columns) == set(table.columns.keys())
            for column in table.columns:
                assert columns[column.name]["nullable"] == column.nullable
                assert str(columns[column.name]["type"]) == str(column.type)
            assert {i["name"] for i in inspector.get_indexes(table.name)} == {i.name for i in table.indexes}
        with Session(bind=conn) as db:
            dossier = ResearchDossier(user_id="owner", symbol="TCS", payload={"title": "Persist me"})
            db.add(dossier)
            db.flush()
            dossier_id = dossier.id
            db.commit()
        migration.upgrade()
        with Session(bind=conn) as db:
            assert db.get(ResearchDossier, dossier_id).payload["title"] == "Persist me"
        migration.downgrade()
        migration.downgrade()
        assert not set(inspect(conn).get_table_names()) & {
            "research_dossiers", "research_dossier_revisions", "research_experiments"}
        migration.upgrade()
        assert inspect(conn).has_table("research_experiments")
    engine.dispose()


def test_complete_database_registry_contains_research_tables():
    import backend.db.models  # noqa: F401
    assert {"research_dossiers", "research_dossier_revisions", "research_experiments"}.issubset(Base.metadata.tables)


def test_migration_sequence_repairs_legacy_agent_runs_and_preserves_history(monkeypatch):
    import sqlalchemy as sa
    from backend.models.agent_memory import AgentRunExecution, AgentRunEvent, AgentToolCheckpoint
    research = import_module("backend.alembic.versions.0012_research_dossiers")
    agent = import_module("backend.alembic.versions.0013_agent_execution")
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        operations = Operations(MigrationContext.configure(conn))
        for migration in (research, agent):
            monkeypatch.setattr(migration, "op", operations)
        operations.create_table("agent_runs", sa.Column("id", sa.String(36), primary_key=True),
                                sa.Column("final", sa.Text(), nullable=True))
        conn.execute(sa.text("INSERT INTO agent_runs (id, final) VALUES ('legacy', 'Preserved research')"))
        research.upgrade()
        agent.upgrade()
        inspector = inspect(conn)
        legacy_columns = {c["name"] for c in inspector.get_columns("agent_runs")}
        assert {"finished_at", "grounding_json"}.issubset(legacy_columns)
        assert conn.execute(sa.text("SELECT final FROM agent_runs WHERE id='legacy'")).scalar() == "Preserved research"
        for model in (AgentRunExecution, AgentRunEvent, AgentToolCheckpoint):
            table = model.__table__
            columns = {c["name"]: c for c in inspector.get_columns(table.name)}
            assert set(columns) == set(table.columns.keys())
            for column in table.columns:
                assert columns[column.name]["nullable"] == column.nullable
                assert str(columns[column.name]["type"]) == str(column.type)
            assert {i["name"] for i in inspector.get_indexes(table.name)} == {i.name for i in table.indexes}
        with Session(bind=conn) as db:
            db.add(AgentRunExecution(run_id="legacy", user_id="owner", spec_json="{}", state="done"))
            db.add(AgentToolCheckpoint(id="checkpoint", run_id="legacy", tool_name="snapshot", args_json="{}", state="done", result_json='{"price":100}'))
            db.commit()
        research.upgrade()
        agent.upgrade()
        with Session(bind=conn) as db:
            assert db.get(AgentRunExecution, "legacy").state == "done"
            assert db.get(AgentToolCheckpoint, "checkpoint").result_json == '{"price":100}'
        agent.downgrade()
        research.downgrade()
        assert inspect(conn).has_table("agent_runs")
        assert conn.execute(sa.text("SELECT final FROM agent_runs WHERE id='legacy'")).scalar() == "Preserved research"
        assert "finished_at" in {c["name"] for c in inspect(conn).get_columns("agent_runs")}
        research.upgrade()
        agent.upgrade()
        assert inspect(conn).has_table("agent_run_events")
    engine.dispose()


def test_startup_repairs_existing_run_table_without_losing_rows(monkeypatch):
    import sqlalchemy as sa
    from backend.shared import db as shared_db
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE agent_runs (id TEXT PRIMARY KEY, final TEXT)"))
        conn.execute(sa.text("INSERT INTO agent_runs VALUES ('old', 'Original answer')"))
    monkeypatch.setattr(shared_db, "engine", engine)
    shared_db._ensure_agent_run_columns()
    shared_db._ensure_agent_run_columns()
    with engine.connect() as conn:
        assert {"grounding_json", "finished_at"}.issubset(c["name"] for c in inspect(conn).get_columns("agent_runs"))
        assert conn.execute(sa.text("SELECT final FROM agent_runs WHERE id='old'")).scalar() == "Original answer"
    engine.dispose()
