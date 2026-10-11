"""Credential-safe access format applies to HTTPS and legacy HTTP redirect."""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]


def test_access_format_has_paths_without_queries_and_preserves_diagnostics():
    source = (ROOT / "ops/nginx/toolbox-observability.conf").read_text(encoding="utf-8")
    format_body = source.split("log_format toolbox_timing", 1)[1].split(";", 1)[0]
    assert not re.search(r"\$(?:request|request_uri|args|query_string|http_authorization|http_cookie)\b", format_body)
    for variable in ("$request_method", "$uri", "$server_protocol", "$request_id", "$upstream_status", "$request_time"):
        assert variable in format_body


def test_http_and_https_servers_both_override_inherited_raw_access_logs():
    source = (ROOT / "ops/nginx/amazon-toolbox.conf").read_text(encoding="utf-8")
    assert source.count("access_log /var/log/nginx/toolbox_access.log toolbox_timing;") == 2


@pytest.mark.parametrize("path", ["/api/tools/launch-grant/verify", "/api/tools/launch-token/verify"])
def test_only_legacy_credential_routes_reduce_query_echoing_error_details(path):
    source = (ROOT / "ops/nginx/amazon-toolbox.conf").read_text(encoding="utf-8")
    match = re.search(r"location = " + re.escape(path) + r"\s*\{([^}]+)\}", source)
    assert match
    assert "error_log /var/log/nginx/toolbox_launch_error.log crit;" in match.group(1)
    assert "proxy_pass http://127.0.0.1:8000;" in match.group(1)
    assert source.count("error_log /var/log/nginx/toolbox_launch_error.log crit;") == 2
