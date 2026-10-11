"""Container/monitor probe: HTTP 200 alone is not evidence of healthy service."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from typing import Any


def healthy_snapshot(payload: Any) -> bool:
    """Strict operational health; optional degradation still needs an alert.

    /ready can return 200 with ready=true for a deliberately optional cache.
    This probe still fails on degraded status, making that incident visible
    without confusing it with liveness or changing the HTTP routing policy.
    """
    if not isinstance(payload, dict) or payload.get("status") != "ok" or payload.get("ready") is not True:
        return False
    checks = payload.get("checks")
    if not isinstance(checks, dict):
        return False
    database = checks.get("database", {})
    redis = checks.get("redis", {})
    if not isinstance(database, dict) or not isinstance(redis, dict):
        return False
    if database.get("status") != "ok":
        return False
    return bool(redis.get("status") == "ok" or (redis.get("status") == "not_configured" and not redis.get("required")))


def main() -> int:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/api/health/ready", timeout=3) as response:
            payload = json.load(response)
        if healthy_snapshot(payload):
            return 0
        # Only expose a classification, never raw upstream errors/URLs.
        print("readiness=degraded_or_invalid", file=sys.stderr)
    except (OSError, ValueError, urllib.error.URLError):
        print("readiness=unreachable_or_invalid", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
