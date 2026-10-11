"""Logging must preserve diagnosis without persisting credentials."""
import json
import logging

import pytest

from core.logging import HumanReadableFormatter, StructuredFormatter


@pytest.mark.parametrize("formatter", [StructuredFormatter(), HumanReadableFormatter()])
@pytest.mark.parametrize("message", [
    "request POST /api/tools/launch-grant/verify?token=private-grant-value status=200",
    "Authorization: Bearer private-bearer-value",
    "Authorization: Basic private-basic-value",
    "Redis failed: redis://operator:private-redis-password@localhost:6379/0",
    "password=private-password-value operation=login",
    "JWT_SECRET_KEY=private-jwt-value operation=startup",
    'password="synthetic prefix remaining-private-suffix" operation=login',
    "password='synthetic prefix remaining-private-suffix' operation=login",
    'password="synthetic \\"escaped\\" remaining-private-suffix" operation=login',
    "api-key=remaining-private-suffix operation=startup",
    "更新授权码: private-auth-code-value",
])
def test_messages_redact_secrets_but_keep_diagnostic_action(formatter, message):
    record = logging.LogRecord("control.auth", logging.WARNING, __file__, 1, message, (), None)
    rendered = formatter.format(record)
    assert "private-" not in rendered
    assert "control.auth" in rendered
    assert "WARNING" in rendered


def test_structured_extra_data_recursively_masks_only_credential_fields():
    record = logging.LogRecord("control.auth", logging.INFO, __file__, 1, "launch.verify", (), None)
    record.extra_data = {
        "auth_code_id": 42, "error_code": "GRANT_REJECTED", "request_id": "diagnostic-rid",
        "token": "private-grant-value", "nested": [{"password": "private-password-value"}],
        "headers": {"Authorization": "Bearer private-bearer-value", "Cookie": "private-cookie-value"},
        "JWT_SECRET_KEY": "private-jwt-value", "MYSQL_PASSWORD": "private-db-value", "X-Api-Key": "private-api-value",
    }
    rendered = StructuredFormatter().format(record)
    assert "private-" not in rendered
    payload = json.loads(rendered)
    assert payload["data"]["auth_code_id"] == 42
    assert payload["data"]["error_code"] == "GRANT_REJECTED"
    assert payload["data"]["request_id"] == "diagnostic-rid"
    # Do not mutate a business object when rendering a log record.
    assert record.extra_data["token"] == "private-grant-value"


@pytest.mark.parametrize("formatter", [StructuredFormatter(), HumanReadableFormatter()])
def test_exception_details_are_redacted_without_losing_exception_type(formatter):
    try:
        raise ConnectionError("redis://operator:private-redis-password@localhost:6379/0 connection refused")
    except ConnectionError:
        import sys
        record = logging.LogRecord("cache", logging.ERROR, __file__, 1, "Redis ping failed", (), sys.exc_info())
    rendered = formatter.format(record)
    assert "private-redis-password" not in rendered
    assert "ConnectionError" in rendered
    assert "connection refused" in rendered
