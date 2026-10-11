"""Required Redis is readiness; optional cache failures are observable degradation."""
from unittest.mock import AsyncMock

import pytest

from core.cache import cache
from core.config import settings


@pytest.mark.asyncio
@pytest.mark.parametrize("required, expected_status, ready", [(False, 200, True), (True, 503, False)])
async def test_redis_readiness_distinguishes_optional_and_required(client, monkeypatch, required, expected_status, ready):
    monkeypatch.setattr(settings, "REDIS_REQUIRED", required, raising=False)
    monkeypatch.setattr(settings, "REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.setattr(cache, "check_health", AsyncMock(return_value={"status": "error", "error": "connection refused"}), raising=False)
    monkeypatch.setattr("app.factory.check_db_health", AsyncMock(return_value={"status": "ok", "type": "sqlite"}))
    response = await client.get("/api/health/ready")
    assert response.status_code == expected_status
    assert response.json()["status"] == "degraded"
    assert response.json()["ready"] is ready
    assert response.json()["checks"]["redis"]["required"] is required
    assert response.json()["checks"]["database"]["required"] is True


@pytest.mark.asyncio
async def test_required_redis_recovery_restores_readiness_without_restart(client, monkeypatch):
    monkeypatch.setattr(settings, "REDIS_REQUIRED", True, raising=False)
    monkeypatch.setattr(settings, "REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.setattr(cache, "check_health", AsyncMock(side_effect=[{"status": "error", "error": "offline"}, {"status": "ok"}]), raising=False)
    monkeypatch.setattr("app.factory.check_db_health", AsyncMock(return_value={"status": "ok", "type": "sqlite"}))
    failed = await client.get("/api/health/ready")
    recovered = await client.get("/api/health/ready")
    assert failed.status_code == 503
    assert recovered.status_code == 200
    assert recovered.json()["ready"] is True
    assert recovered.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_required_redis_missing_url_is_an_explicit_not_ready_result(client, monkeypatch):
    monkeypatch.setattr(settings, "REDIS_REQUIRED", True)
    monkeypatch.setattr(settings, "REDIS_URL", None)
    monkeypatch.setattr(cache, "redis", None)
    monkeypatch.setattr("app.factory.check_db_health", AsyncMock(return_value={"status": "ok", "type": "sqlite"}))
    response = await client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json()["ready"] is False
    assert response.json()["checks"]["redis"] == {"status": "error", "required": True, "error": "Redis 是必需依赖但未配置"}
