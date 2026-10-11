"""The container check parses business readiness, not only an HTTP status."""
import pytest

from core.healthcheck import healthy_snapshot


@pytest.mark.parametrize("status, ready, db, redis, required, expected", [
    ("ok", True, "ok", "ok", True, True),
    ("ok", True, "ok", "not_configured", False, True),
    ("ok", True, "ok", "not_configured", True, False),
    ("degraded", True, "ok", "error", False, False),
    ("degraded", False, "ok", "error", True, False),
    ("ok", True, "error", "ok", True, False),
])
def test_health_payload_policy(status, ready, db, redis, required, expected):
    assert healthy_snapshot({"status": status, "ready": ready, "checks": {
        "database": {"status": db}, "redis": {"status": redis, "required": required},
    }}) is expected


@pytest.mark.parametrize("payload", [None, [], "ok", {"status": "ok"}, {"status": "ok", "ready": True},
    {"status": "ok", "ready": True, "checks": {"database": [], "redis": []}},
])
def test_missing_or_malformed_contract_fails_closed(payload):
    assert healthy_snapshot(payload) is False
