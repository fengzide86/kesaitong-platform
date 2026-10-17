"""CI-only upgrade rehearsal from the immutable, released 1.8.8 schema.

Uses a second disposable MariaDB service, never the concurrency or production
database. The target must start empty; only the newly migrated, empty framework
tables are downgraded to exercise rollback guards. No database is dropped.
"""

from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime
from decimal import Decimal
from pathlib import Path, PurePosixPath
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import URL, Connection, make_url
from sqlalchemy.exc import DBAPIError

ROOT = Path(__file__).resolve().parents[1]
BASELINE_COMMIT = "5da800e87c74efa7086c3d6772985f9bfbf29c21"
BASELINE_VERSION = "1.8.8"
OLD_REVISION = "20260816_data_integrity"
PRE_FRAMEWORK_REVISION = "20260922_agency_commission"
NEW_REVISION = "20261017_identity_leases"
TEST_DATABASE = "toolbox_upgrade_test"


def validated_test_url(raw: str, environment: dict[str, str]) -> URL:
    """Fail before connecting unless this is the dedicated CI service."""
    if environment.get("GITHUB_ACTIONS") != "true" or environment.get("CI") != "true":
        raise RuntimeError("Historical migration rehearsal only runs in disposable GitHub Actions services")
    url = make_url(raw)
    if (
        url.drivername != "mysql+pymysql"
        or url.host != "127.0.0.1"
        or url.port != 3307
        or url.database != TEST_DATABASE
        or url.username != "toolbox_upgrade_test"
        or not url.password
        or url.query
    ):
        raise RuntimeError("Migration target must be the dedicated loopback:3307 toolbox_upgrade_test service")
    return url


def run(arguments: list[str], cwd: Path, environment: dict[str, str], *, succeeds: bool = True) -> str:
    result = subprocess.run(arguments, cwd=cwd, env=environment, text=True, capture_output=True, check=False)
    output = result.stdout + result.stderr
    # SQLAlchemy can repeat bound values on errors; the DB password is never
    # part of the report, including unexpected setup/migration failures.
    password = environment.get("MYSQL_PASSWORD", "")
    if password:
        output = output.replace(password, "[test-password]")
    if (result.returncode == 0) != succeeds:
        raise RuntimeError(f"Command did not meet its expected exit status: {arguments[:3]}\n{output}")
    return output


def unpack_baseline(destination: Path) -> None:
    archive = subprocess.run(
        ["git", "archive", BASELINE_COMMIT, "backend", "package.json"],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for member in source.getmembers():
            parts = PurePosixPath(member.name)
            if parts.is_absolute() or ".." in parts.parts or member.issym() or member.islnk():
                raise RuntimeError("Unsafe entry in immutable baseline archive")
            if not (member.isdir() or member.isfile()):
                raise RuntimeError("Unsupported entry in immutable baseline archive")
        source.extractall(destination)  # all entries validated; Python 3.10 compatible
    metadata = json.loads((destination / "package.json").read_text(encoding="utf-8"))
    if metadata["version"] != BASELINE_VERSION:
        raise RuntimeError("Immutable migration baseline version does not match")


def child_environment(url: URL, runtime: Path, source: Path) -> dict[str, str]:
    environment = dict(os.environ)
    environment.update({
        "APP_ENV": "test", "DEBUG": "true", "DB_TYPE": "mysql",
        "MYSQL_HOST": str(url.host), "MYSQL_PORT": str(url.port),
        "MYSQL_DATABASE": str(url.database), "MYSQL_USER": str(url.username),
        "MYSQL_PASSWORD": str(url.password), "PYTHONPATH": str(source / "backend"),
        "TOOLBOX_RUNTIME_DIR": str(runtime), "REDIS_URL": "",
        "AI_SUPPORT_MODE": "rules", "QWEN_API_KEY": "",
        "JWT_SECRET_KEY": "isolated-migration-rehearsal-not-for-production-only",
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    return environment


def revision(connection: Connection) -> str:
    return str(connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one())


def table(connection: Connection, name: str) -> sa.Table:
    return sa.Table(name, sa.MetaData(), autoload_with=connection)


def seed_history(connection: Connection) -> dict[str, list[dict[str, Any]]]:
    """Write real old-schema rows, including every existing internal role."""
    staff = table(connection, "staff_users")
    for index, role in enumerate(("super_admin", "operator", "support"), start=1):
        connection.execute(staff.insert().values(
            id=index, username=f"upgrade-{role}", display_name=f"Historical {role}",
            password_hash="not-a-login-credential", role=role, status="active",
            token_version=7, force_password_reset=False,
        ))
    connection.execute(table(connection, "plans").insert().values(
        id=901, name="Historical validation plan", price=Decimal("199.50"), duration_days=30,
        status="active", sort_order=3, product_type="business",
        entitlements='{"max_devices":3,"seat_limit":5}',
    ))
    connection.execute(table(connection, "orders").insert().values(
        id=902, order_no="MIGRATION-OLD-ORDER", plan_id=901,
        plan_name_snapshot="Historical validation plan", plan_price_snapshot=Decimal("199.50"),
        plan_duration_days_snapshot=30, amount=Decimal("199.50"), status="paid",
        paid_at=datetime(2026, 9, 1, 12, 0), created_by_staff_id=1,
        updated_by_staff_id=1, platform_key="amazon", channel="historical",
    ))
    connection.execute(table(connection, "auth_codes").insert().values(
        id=903, code="MIGRATION-OLD-AUTH", plan_id=901, status="active",
        expires_at=datetime(2030, 9, 1, 12, 0), max_devices=3, seat_limit=5,
        platform_scope="amazon", scene_type="competition",
    ))
    connection.execute(table(connection, "users").insert().values(
        id=904, name="Historical customer", auth_code_id=903,
        device_id="migration-device", total_seats=5, extra_devices=0, is_active=True,
    ))
    connection.execute(sa.text("UPDATE auth_codes SET user_id=904 WHERE id=903"))
    connection.execute(table(connection, "devices").insert().values(
        id=905, auth_code_id=903, device_id="migration-device", device_name="Historical device",
    ))
    return {
        name: [dict(row) for row in connection.execute(sa.select(table(connection, name))).mappings()]
        for name in ("staff_users", "plans", "orders", "auth_codes", "users", "devices")
    }


def assert_history(connection: Connection, snapshots: dict[str, list[dict[str, Any]]]) -> None:
    for name, rows in snapshots.items():
        target = table(connection, name)
        for old in rows:
            current = dict(connection.execute(sa.select(target).where(target.c.id == old["id"])).mappings().one())
            if {key: current[key] for key in old} != old:
                raise AssertionError(f"Historical values changed in {name}")
    for name, fields in {
        "staff_users": ("agency_id",),
        "orders": ("agency_id", "customer_id", "agency_note", "delivery_entitlements_snapshot"),
        "auth_codes": ("agency_id", "customer_id", "order_id"),
    }.items():
        target = table(connection, name)
        ids = [row["id"] for row in snapshots[name]]
        results = connection.execute(sa.select(*(target.c[field] for field in fields)).where(target.c.id.in_(ids)))
        if any(any(value is not None for value in row) for row in results):
            raise AssertionError(f"Historical records were adopted by an agency in {name}")


def expect_constraint(connection: Connection, statement: Any, codes: set[int]) -> None:
    savepoint = connection.begin_nested()
    try:
        connection.execute(statement)
    except DBAPIError as error:
        savepoint.rollback()
        if not error.orig.args or error.orig.args[0] not in codes:
            raise
    else:
        savepoint.rollback()
        raise AssertionError("Expected database constraint was not enforced")


def framework_tables() -> list[str]:
    path = ROOT / "backend/alembic/versions/20261015_framework_commerce.py"
    spec = importlib.util.spec_from_file_location("framework_upgrade_contract", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.TABLES


def assert_framework_contract(connection: Connection, *, empty: bool = True) -> None:
    # Compare the actual migrated database, never repair it with create_all.
    sys.path.insert(0, str(ROOT / "backend"))
    from models import Base

    inspector = sa.inspect(connection)
    names = framework_tables()
    assert len(names) == 20 and len(set(names)) == 20
    assert set(names) <= set(inspector.get_table_names())
    for name in names:
        expected = Base.metadata.tables[name]
        assert {column["name"] for column in inspector.get_columns(name)} == set(expected.columns.keys()), name
        actual_foreign = {(tuple(fk["constrained_columns"]), fk["referred_table"], tuple(fk["referred_columns"]))
                          for fk in inspector.get_foreign_keys(name)}
        expected_foreign = {(tuple(fk.column_keys), next(iter(fk.elements)).column.table.name,
                             tuple(element.column.name for element in fk.elements)) for fk in expected.foreign_key_constraints}
        assert expected_foreign <= actual_foreign, name
        actual_unique = {tuple(item["column_names"]) for item in inspector.get_unique_constraints(name)}
        expected_unique = {tuple(column.name for column in constraint.columns) for constraint in expected.constraints
                           if isinstance(constraint, sa.UniqueConstraint)}
        assert expected_unique <= actual_unique, name
        actual_checks = {item["name"] for item in inspector.get_check_constraints(name)}
        assert {constraint.name for constraint in expected.constraints if isinstance(constraint, sa.CheckConstraint)} <= actual_checks, name
        if empty:
            assert connection.execute(sa.text(f"SELECT COUNT(*) FROM {name}")).scalar_one() == 0, name


def assert_new_contract(connection: Connection) -> None:
    inspector = sa.inspect(connection)
    for name, references in {
        "staff_users": {"agency_id": "agencies"},
        "orders": {"agency_id": "agencies", "customer_id": "agency_customers"},
        "auth_codes": {"agency_id": "agencies", "customer_id": "agency_customers", "order_id": "orders"},
        "agency_customers": {"agency_id": "agencies", "created_by_staff_id": "staff_users"},
        "agency_requests": {"agency_id": "agencies", "customer_id": "agency_customers", "order_id": "orders", "created_by_staff_id": "staff_users", "resolved_by_staff_id": "staff_users"},
    }.items():
        foreign_keys = inspector.get_foreign_keys(name)
        for column, referred_table in references.items():
            if not any(fk["constrained_columns"] == [column] and fk["referred_table"] == referred_table and fk["referred_columns"] == ["id"] for fk in foreign_keys):
                raise AssertionError(f"Missing foreign key: {name}.{column}")
    unique_constraints = inspector.get_unique_constraints("auth_codes")
    if not any(item["name"] == "ux_auth_codes_order_id" and item["column_names"] == ["order_id"] for item in unique_constraints):
        raise AssertionError("One-authorization-per-order constraint is missing")
    agencies = table(connection, "agencies")
    staff = table(connection, "staff_users")
    auth_codes = table(connection, "auth_codes")
    connection.execute(agencies.insert().values(id=906, name="Migration probe agency", status="active"))
    agent = {"id": 907, "username": "upgrade-agent", "display_name": "Migration probe agent", "password_hash": "not-a-login-credential", "role": "agent", "status": "active", "token_version": 1, "force_password_reset": False}
    expect_constraint(connection, staff.insert().values(**agent), {4025, 3819})
    expect_constraint(connection, staff.insert().values(**agent, agency_id=999999), {1452})
    connection.execute(staff.insert().values(**agent, agency_id=906))
    # The upgrade must not adopt paid history into the opt-in commission ledger.
    entries = table(connection, "agency_commission_entries")
    assert connection.execute(sa.select(sa.func.count()).select_from(entries)).scalar_one() == 0
    assert connection.execute(sa.select(agencies.c.commission_rate).where(agencies.c.id == 906)).scalar_one() is None
    expect_constraint(connection, agencies.update().where(agencies.c.id == 906).values(commission_rate=Decimal("1.01")), {4025, 3819})
    commission = {"agency_id": 906, "order_id": 902, "order_no": "MIGRATION-COMMISSION-PROBE", "kind": "accrual", "amount": Decimal("1.00"), "rate_snapshot": Decimal("0.1"), "order_amount_snapshot": Decimal("10.00")}
    connection.execute(entries.insert().values(**commission))
    expect_constraint(connection, entries.insert().values(**commission), {1062})
    expect_constraint(connection, staff.update().where(staff.c.id == 907).values(role="unknown"), {4025, 3819})
    connection.execute(auth_codes.insert().values(id=908, code="MIGRATION-NEW-AUTH", order_id=902))
    expect_constraint(connection, auth_codes.insert().values(id=909, code="MIGRATION-DUPLICATE-AUTH", order_id=902), {1062})
    expect_constraint(connection, auth_codes.insert().values(id=909, code="MIGRATION-BAD-ORDER", order_id=999999), {1452})


def schema_gate(source: Path, environment: dict[str, str], *, succeeds: bool) -> str:
    return run(
        [sys.executable, "-c", ("import asyncio\nfrom database import init_db, engine\n"
         "async def check():\n    try:\n        await init_db()\n"
         "    finally:\n        await engine.dispose()\nasyncio.run(check())\n")],
        source / "backend", {**environment, "APP_ENV": "internal"}, succeeds=succeeds,
    )


def main() -> None:
    url = validated_test_url(os.environ.get("MIGRATION_TEST_URL", ""), dict(os.environ))
    engine = sa.create_engine(url, pool_pre_ping=True)
    report: dict[str, Any] = {"baseline_commit": BASELINE_COMMIT, "baseline_version": BASELINE_VERSION, "old_revision": OLD_REVISION, "new_revision": NEW_REVISION, "checks": []}
    report_path = Path(os.environ["RUNNER_TEMP"]) / "mariadb-upgrade-report.json"
    try:
        with engine.connect() as connection:
            if connection.execute(sa.text("SELECT DATABASE()")).scalar_one() != TEST_DATABASE:
                raise RuntimeError("Connected to an unexpected database")
            if sa.inspect(connection).get_table_names() or sa.inspect(connection).get_view_names():
                raise RuntimeError("Migration test database is not empty; refusing to alter existing data")
        with tempfile.TemporaryDirectory(prefix="kst-historical-upgrade-", dir=os.environ["RUNNER_TEMP"]) as temporary:
            baseline = Path(temporary)
            unpack_baseline(baseline)
            old_env = child_environment(url, baseline / "runtime-old", baseline)
            current_env = child_environment(url, baseline / "runtime-current", ROOT)
            run([sys.executable, "-m", "alembic", "upgrade", "head"], baseline / "backend", old_env)
            with engine.begin() as connection:
                if revision(connection) != OLD_REVISION or "agencies" in sa.inspect(connection).get_table_names():
                    raise AssertionError("The immutable baseline did not produce the historical schema")
                for name in ("staff_users", "orders", "auth_codes"):
                    if "agency_id" in {column["name"] for column in sa.inspect(connection).get_columns(name)}:
                        raise AssertionError("Baseline already contains agency columns; this is not an upgrade test")
                history = seed_history(connection)
            report["checks"].append("immutable_old_schema_and_history_seeded")
            schema_gate(baseline, old_env, succeeds=True)
            rejection = schema_gate(ROOT, current_env, succeeds=False)
            if "required=" + NEW_REVISION not in rejection:
                raise AssertionError("New runtime did not reject the old schema for the expected reason")
            run([sys.executable, "-m", "alembic", "upgrade", "head"], ROOT / "backend", current_env)
            with engine.begin() as connection:
                if revision(connection) != NEW_REVISION:
                    raise AssertionError("New schema revision is missing")
                assert_history(connection, history)
                assert_new_contract(connection)
                assert_framework_contract(connection)
            report["checks"].extend(["historical_values_and_unassigned_ownership_preserved", "foreign_keys_unique_and_agent_role_constraints_enforced"])
            report["checks"].append("framework_20_tables_empty_columns_foreign_keys_unique_checks_verified")
            # The existing SQLAlchemy pool must be disposed in the same event
            # loop used by the async gate; subprocess exit also isolates it.
            schema_gate(ROOT, current_env, succeeds=True)
            rejection = schema_gate(baseline, old_env, succeeds=False)
            if "required=" + OLD_REVISION not in rejection:
                raise AssertionError("Old runtime did not reject the new schema")
            run([sys.executable, "-m", "alembic", "upgrade", "head"], ROOT / "backend", current_env)
            with engine.begin() as connection:
                # This synthetic row must block before *any* framework table is dropped.
                connection.execute(table(connection, "team_members").insert().values(
                    id=910, name="Migration framework sentinel", active=True, version=1, ledger_version=1))
                entries = table(connection, "team_ledger_entries")
                probe = {"bucket": "due", "kind": "allocation", "amount": Decimal(0),
                         "note": "Synthetic constraint probe", "snapshot": "{}", "created_by_staff_id": 1}
                expect_constraint(connection, entries.insert().values(**probe), {4025, 3819})
                expect_constraint(connection, entries.insert().values(**(probe | {"amount": Decimal(1), "bucket": "invalid"})), {4025, 3819})
            rejection = run([sys.executable, "-m", "alembic", "downgrade", OLD_REVISION], ROOT / "backend", current_env, succeeds=False)
            if "Framework or accounting data exists" not in rejection:
                raise AssertionError("Downgrade did not preserve new framework history")
            with engine.begin() as connection:
                assert revision(connection) == NEW_REVISION
                assert_framework_contract(connection, empty=False)
                assert connection.execute(sa.text("SELECT name FROM team_members WHERE id=910")).scalar_one() == "Migration framework sentinel"
                assert_history(connection, history)
                connection.execute(sa.text("DELETE FROM team_members WHERE id=910"))
            # Empty framework tables may be removed, but legacy commission
            # history must remain guarded at its own explicit revision boundary.
            run([sys.executable, "-m", "alembic", "downgrade", PRE_FRAMEWORK_REVISION], ROOT / "backend", current_env)
            with engine.connect() as connection:
                assert revision(connection) == PRE_FRAMEWORK_REVISION
                assert not set(framework_tables()) & set(sa.inspect(connection).get_table_names())
                assert_history(connection, history)
            rejection = run([sys.executable, "-m", "alembic", "downgrade", OLD_REVISION], ROOT / "backend", current_env, succeeds=False)
            if "Commission history exists" not in rejection:
                raise AssertionError("Downgrade did not preserve commission history for the expected reason")
            with engine.connect() as connection:
                if revision(connection) != PRE_FRAMEWORK_REVISION:
                    raise AssertionError("Rejected downgrade changed the revision")
                assert_history(connection, history)
                if connection.execute(sa.text("SELECT COUNT(*) FROM agencies WHERE id=906")).scalar_one() != 1:
                    raise AssertionError("Rejected downgrade removed partner history")
            report["checks"].extend(["runtime_schema_gates_enforced", "repeat_upgrade_and_destructive_downgrade_guard_verified"])
            run([sys.executable, "-m", "alembic", "upgrade", "head"], ROOT / "backend", current_env)
            with engine.connect() as connection:
                assert revision(connection) == NEW_REVISION
                assert_framework_contract(connection)
                assert_history(connection, history)
            schema_gate(ROOT, current_env, succeeds=True)
            report["checks"].append("framework_history_guard_empty_downgrade_and_reupgrade_verified")
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error_type"] = type(error).__name__
        raise
    finally:
        engine.dispose()
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"historical_mariadb_upgrade={report.get('status', 'failed')} report={report_path}")


if __name__ == "__main__":
    main()
