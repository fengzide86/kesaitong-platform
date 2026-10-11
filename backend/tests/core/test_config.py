"""Configuration schema tests that do not depend on a developer's local .env values."""
import pytest

from core.config import Settings, settings


def test_runtime_settings_have_valid_network_defaults() -> None:
    assert settings.HOST
    assert 1 <= settings.PORT <= 65535
    assert isinstance(settings.CORS_ORIGINS, list)
    assert settings.APP_ENV in {"internal", "test"}
    assert settings.TOOL_EXECUTION_MODE == "demo"
    assert settings.AI_SUPPORT_MODE == "rules"
    assert settings.BUNDLED_BACKEND_ENABLED is False


def test_security_configuration_uses_supported_types() -> None:
    assert settings.JWT_ALGORITHM == "HS256"
    assert settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES > 0
    assert isinstance(settings.JWT_SECRET_KEY, str)


def test_database_configuration_is_explicit() -> None:
    assert settings.DB_TYPE in {"", "sqlite", "mysql"}
    assert isinstance(settings.DB_PATH, str)
    assert settings.MYSQL_PORT > 0


def test_ai_configuration_has_bounded_retry_values() -> None:
    assert settings.AI_PROVIDER in {"qwen", "openai", "local"}
    assert settings.AI_CHAT_MAX_RETRIES >= 0
    assert settings.AI_CHAT_MAX_HISTORY > 0


def test_environment_override_is_parsed(monkeypatch) -> None:
    monkeypatch.setenv("DEBUG", "true")
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("BUNDLED_BACKEND_ENABLED", "true")
    configured = Settings()
    assert configured.DEBUG is True
    assert configured.APP_ENV == "test"
    assert configured.BUNDLED_BACKEND_ENABLED is True


def test_internal_environment_rejects_implicit_sqlite(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "internal")
    monkeypatch.delenv("DB_TYPE", raising=False)

    with pytest.raises(ValueError, match="DB_TYPE=mysql"):
        Settings()


@pytest.mark.parametrize("environment", ["test", "development"])
def test_non_production_environment_allows_sqlite(monkeypatch, environment: str) -> None:
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("DB_TYPE", "sqlite")
    assert Settings().DB_TYPE == "sqlite"


def test_production_rejects_sqlite_and_unknown_database(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DB_TYPE", "sqlite")
    with pytest.raises(ValueError):
        Settings()
    monkeypatch.setenv("DB_TYPE", "oracle")
    with pytest.raises(ValueError):
        Settings()


@pytest.mark.parametrize("environment, required", [("test", False), ("development", False), ("internal", True), ("production", True)])
def test_redis_required_default_tracks_deployment_role(monkeypatch, environment, required):
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("DB_TYPE", "mysql")
    monkeypatch.setenv("JWT_SECRET_KEY", "isolated-configuration-test-key-32-characters")
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.delenv("REDIS_REQUIRED", raising=False)
    assert Settings().REDIS_REQUIRED is required


@pytest.mark.parametrize("value, required", [("true", True), ("false", False)])
def test_production_optional_redis_is_explicit(monkeypatch, value, required):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DB_TYPE", "mysql")
    monkeypatch.setenv("JWT_SECRET_KEY", "isolated-configuration-test-key-32-characters")
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.setenv("REDIS_REQUIRED", value)
    assert Settings().REDIS_REQUIRED is required


def test_invalid_redis_required_is_not_silently_optional(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DB_TYPE", "sqlite")
    monkeypatch.setenv("REDIS_REQUIRED", "sometimes")
    with pytest.raises(ValueError, match="REDIS_REQUIRED"):
        Settings()


@pytest.mark.parametrize("environment", ["internal", "production"])
def test_production_missing_redis_url_does_not_silently_allow_degradation(monkeypatch, environment):
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("DB_TYPE", "mysql")
    monkeypatch.setenv("JWT_SECRET_KEY", "isolated-configuration-test-key-32-characters")
    monkeypatch.delenv("REDIS_REQUIRED", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    assert Settings().REDIS_REQUIRED is True
