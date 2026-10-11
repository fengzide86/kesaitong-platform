"""Independent-process HTTP checks: never import backend/tests/conftest.py.

Every probe uses a private SQLite file and loopback-only/no Redis. No lifespan,
production configuration, external account, or production database is loaded.
"""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


async def probe(scenario: str) -> dict:
    reservation = None
    if scenario in {"redis-required-offline", "redis-optional-offline"}:
        import socket
        reservation = socket.socket()
        reservation.bind(("127.0.0.1", 0))
        # Bound but not listening: deterministic refused local TCP connection,
        # never connect to a real/user-configured Redis instance.
        os.environ["REDIS_URL"] = f"redis://127.0.0.1:{reservation.getsockname()[1]}/0"
        os.environ["REDIS_REQUIRED"] = "true" if scenario == "redis-required-offline" else "false"
    if scenario == "redis-required-missing":
        os.environ["REDIS_REQUIRED"] = "true"
        try:
            from app.factory import create_app
        except RuntimeError as error:
            assert "拒绝启动" in str(error), str(error)
            return {"scenario": scenario, "startup": "rejected"}
        raise AssertionError("Required Redis configuration must fail closed")
    from slowapi import Limiter
    assert Limiter.limit.__module__ == "slowapi.extension", "Limiter must not be patched"
    from app.factory import create_app
    from database import Base, async_session_maker, engine
    from httpx import ASGITransport, AsyncClient

    app = create_app()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://isolated.test") as client:
            if scenario == "redis-required-offline":
                from core.cache import cache
                from core.rate_limit import limiter
                await cache.init()
                try:
                    statuses = [
                        (await client.get("/api/health/live")).status_code,
                        (await client.get("/api/health/ready")).status_code,
                        (await client.post("/api/staff/auth/login", json={"username": "absent", "password": "fixture-invalid"})).status_code,
                        (await client.post("/api/auth/check")).status_code,
                    ]
                    assert statuses == [200, 503, 503, 503], statuses
                    assert not limiter._in_memory_fallback_enabled
                    return {"scenario": scenario, "statuses": statuses, "memory_fallback": False}
                finally:
                    await cache.close()
            if scenario == "redis-optional-offline":
                statuses = [(await client.post("/api/staff/auth/login", json={"username": "absent", "password": "fixture-invalid"})).status_code for _ in range(6)]
                assert statuses == [401, 401, 401, 401, 401, 429], statuses
                return {"scenario": scenario, "statuses": statuses, "memory_fallback": "explicitly optional only"}
            if scenario in {"staff", "legacy", "verify", "default"}:
                routes = {
                    "staff": ("/api/staff/auth/login", {"username": "absent", "password": "fixture-invalid"}, 5),
                    "legacy": ("/api/auth/admin-login", {"username": "absent", "password": "fixture-invalid"}, 5),
                    "verify": ("/api/auth/verify", {"code": "absent", "device_id": "fixture", "device_name": "fixture"}, 10),
                    "default": ("/api/auth/check", {}, 60),
                }
                path, payload, threshold = routes[scenario]
                statuses = [(await client.post(path, json=payload)).status_code for _ in range(threshold + 1)]
                assert all(code in {200, 401, 403, 404} for code in statuses[:-1]), statuses
                assert statuses[-1] == 429, statuses
                return {"scenario": scenario, "threshold": threshold, "statuses": statuses}
            if scenario == "revocation":
                from core.security import hash_password
                from models import StaffRole, StaffStatus, StaffUser
                from services.staff_service import create_staff_access_token
                async with async_session_maker() as session:
                    actors = [StaffUser(username=name, display_name=name, password_hash=hash_password("Local-fixture-123"),
                                        role=role, status=StaffStatus.ACTIVE, token_version=1, force_password_reset=False)
                              for name, role in (("root-fixture", StaffRole.SUPER_ADMIN),
                                                 ("logout-fixture", StaffRole.SUPPORT),
                                                 ("disabled-fixture", StaffRole.SUPPORT))]
                    session.add_all(actors)
                    await session.commit()
                    headers = [{"Authorization": f"Bearer {create_staff_access_token(actor)}"} for actor in actors]
                    disabled_id = actors[2].id
                statuses = [(await client.get("/api/staff/auth/me", headers=headers[1])).status_code,
                            (await client.post("/api/staff/auth/logout", headers=headers[1])).status_code,
                            (await client.get("/api/staff/auth/me", headers=headers[1])).status_code,
                            (await client.patch(f"/api/staff/accounts/{disabled_id}", json={"status": "disabled"}, headers=headers[0])).status_code,
                            (await client.get("/api/staff/auth/me", headers=headers[2])).status_code]
                assert statuses == [200, 200, 401, 200, 401], statuses
                async with async_session_maker() as session:
                    logout_row = await session.get(StaffUser, actors[1].id)
                    disabled_row = await session.get(StaffUser, disabled_id)
                    assert logout_row.token_version == disabled_row.token_version == 2
                return {"scenario": scenario, "statuses": statuses, "database_token_versions": [2, 2]}
            raise AssertionError(f"Unknown scenario: {scenario}")
    finally:
        await engine.dispose()
        if reservation:
            reservation.close()


class BackendSecurityLiveTests(unittest.TestCase):
    def run_probe(self, scenario: str) -> None:
        with tempfile.TemporaryDirectory(prefix="kst-security-") as directory:
            environment = dict(os.environ)
            for key in tuple(environment):
                if key.startswith(("MYSQL_", "RATELIMIT_", "REDIS_")):
                    environment.pop(key)
            environment.update(APP_ENV="test", DB_TYPE="sqlite", DB_PATH=str(Path(directory) / "fixture.db"),
                               PYTHONPATH=str(ROOT / "backend"), PYTHON_DOTENV_DISABLED="1", DEBUG="false",
                               JWT_SECRET_KEY=secrets.token_urlsafe(48),
                               REDIS_URL="", REDIS_REQUIRED="false", LOG_LEVEL="CRITICAL")
            result = subprocess.run([sys.executable, "-X", "utf8", str(Path(__file__).resolve()), "--probe", scenario],
                                    check=False, cwd=directory, env=environment, capture_output=True,
                                    text=True, encoding="utf-8", timeout=35)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            print(result.stdout.strip().splitlines()[-1])

    def test_staff_login_threshold(self):
        self.run_probe("staff")

    def test_legacy_login_threshold(self):
        self.run_probe("legacy")

    def test_license_login_threshold(self):
        self.run_probe("verify")

    def test_default_route_threshold(self):
        self.run_probe("default")

    def test_logout_and_disable_revoke_database_token_version(self):
        self.run_probe("revocation")

    def test_required_redis_missing_configuration_rejects_startup(self):
        self.run_probe("redis-required-missing")

    def test_required_redis_unavailable_rejects_business_but_keeps_health(self):
        self.run_probe("redis-required-offline")

    def test_explicit_optional_redis_still_limits_in_memory(self):
        self.run_probe("redis-optional-offline")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--probe":
        print(json.dumps(asyncio.run(probe(sys.argv[2]))))
    else:
        unittest.main()
