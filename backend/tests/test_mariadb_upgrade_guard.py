"""Offline safety checks for the dedicated CI-only historical upgrade probe."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "scripts" / "verify_mariadb_upgrade.py"
spec = importlib.util.spec_from_file_location("verify_mariadb_upgrade", SCRIPT)
assert spec and spec.loader
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

TEST_URL = "mysql+pymysql://toolbox_upgrade_test:test-only@127.0.0.1:3307/toolbox_upgrade_test"
CI = {"CI": "true", "GITHUB_ACTIONS": "true"}


def test_probe_accepts_only_its_disposable_ci_target():
    assert probe.validated_test_url(TEST_URL, CI).database == "toolbox_upgrade_test"


def test_probe_revision_tracks_runtime_and_all_twenty_framework_tables():
    from database import SCHEMA_REVISION
    from models import Base

    assert probe.NEW_REVISION == SCHEMA_REVISION == "20261015_framework_commerce"
    names = probe.framework_tables()
    assert len(names) == len(set(names)) == 20
    assert set(names) <= set(Base.metadata.tables)


def test_framework_probe_checks_migrated_tables_without_repairing_missing_schema(tmp_path):
    import sqlalchemy as sa

    from tests.test_framework_migration import migration

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'probe.db'}")
    try:
        with engine.begin() as connection:
            # Exercise the frozen migration, not metadata.create_all, so schema
            # drift cannot be hidden by the same model used by the assertions.
            migration(connection).upgrade()
            probe.assert_framework_contract(connection)
            connection.execute(sa.text("INSERT INTO team_members (name, active, version, ledger_version) VALUES ('Synthetic', 1, 1, 1)"))
            with pytest.raises(AssertionError, match="team_members"):
                probe.assert_framework_contract(connection)
            probe.assert_framework_contract(connection, empty=False)
            connection.execute(sa.text("DROP TABLE staff_runtime_permissions"))
            with pytest.raises(AssertionError):
                probe.assert_framework_contract(connection, empty=False)
            assert "staff_runtime_permissions" not in sa.inspect(connection).get_table_names()
    finally:
        engine.dispose()


@pytest.mark.parametrize("environment", [{}, {"CI": "true"}, {"GITHUB_ACTIONS": "true"}])
def test_probe_rejects_non_ci_before_connecting(environment):
    with pytest.raises(RuntimeError, match="disposable GitHub"):
        probe.validated_test_url(TEST_URL, environment)


@pytest.mark.parametrize("source,replacement", [
    ("127.0.0.1", "production.example.com"),
    (":3307/", ":3306/"),
    ("/toolbox_upgrade_test", "/toolbox_test"),
    ("toolbox_upgrade_test:", "root:"),
    ("mysql+pymysql", "mysql+aiomysql"),
    ("test-only@", "@"),
])
def test_probe_rejects_shared_or_arbitrary_database(source, replacement):
    with pytest.raises(RuntimeError, match="dedicated loopback"):
        probe.validated_test_url(TEST_URL.replace(source, replacement), CI)


def test_schema_gate_disposes_on_the_same_loop_even_when_gate_rejects(monkeypatch, tmp_path):
    import asyncio
    import types
    from concurrent.futures import ThreadPoolExecutor

    events = []

    async def init_db():
        events.append(("init", asyncio.get_running_loop()))
        raise RuntimeError("expected revision mismatch")

    async def dispose():
        events.append(("dispose", asyncio.get_running_loop()))

    fake_database = types.ModuleType("database")
    fake_database.init_db = init_db
    fake_database.engine = types.SimpleNamespace(dispose=dispose)
    monkeypatch.setitem(__import__("sys").modules, "database", fake_database)

    def fake_run(arguments, cwd, environment, *, succeeds):
        assert cwd == tmp_path / "backend"
        assert environment["APP_ENV"] == "internal"
        assert not succeeds
        with pytest.raises(RuntimeError, match="expected revision mismatch"):
            exec(compile(arguments[2], "schema-gate", "exec"), {})
        return "expected revision mismatch"

    monkeypatch.setattr(probe, "run", fake_run)
    # asyncio.run() clears its thread's current loop. The application probe
    # actually runs in a child process; keep this in-process double off pytest's
    # thread so it cannot clear pytest-asyncio's session-scoped event loop.
    with ThreadPoolExecutor(max_workers=1) as executor:
        executor.submit(probe.schema_gate, tmp_path, {}, succeeds=False).result()
    assert [event[0] for event in events] == ["init", "dispose"]
    assert events[0][1] is events[1][1]
