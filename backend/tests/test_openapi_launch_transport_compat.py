"""Frozen OpenAPI gate allows only the named backward-compatible migration."""
import copy
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("openapi_compat", Path(__file__).parents[2] / "scripts/check_openapi_compat.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def contracts(path="/api/tools/launch-grant/verify"):
    baseline = {"paths": {path: {"post": {"parameters": [{"name": "token", "in": "query", "required": True}],
                                         "responses": {"200": {}, "422": {}}}}}}
    current = copy.deepcopy(baseline)
    operation = current["paths"][path]["post"]
    operation["parameters"][0].update(required=False, schema={"anyOf": [{"type": "string"}, {"type": "null"}]})
    operation["requestBody"] = {"content": {"application/json": {"schema": {
        "anyOf": [{"$ref": "#/components/schemas/LaunchGrantVerifyRequest"}, {"type": "null"}],
    }}}}
    current["components"] = {"schemas": {"LaunchGrantVerifyRequest": {
        "properties": {"token": {"type": "string"}}, "required": ["token"],
    }}}
    return baseline, current, operation


@pytest.mark.parametrize("path", ["/api/tools/launch-grant/verify", "/api/tools/launch-token/verify"])
def test_only_named_launch_verifiers_allow_optional_json_plus_preserved_query(path):
    before, after, _ = contracts(path)
    assert module.compare(before, after) == []


def test_identical_unmodified_surface_still_passes():
    before, _, _ = contracts()
    assert module.compare(before, copy.deepcopy(before)) == []


@pytest.mark.parametrize("mutation", ["remove_query", "require_body", "wrong_body_type", "added_parameter", "removed_response"])
def test_migration_does_not_hide_breaking_changes(mutation):
    before, after, operation = contracts()
    if mutation == "remove_query":
        operation["parameters"] = []
    elif mutation == "require_body":
        operation["requestBody"]["required"] = True
    elif mutation == "wrong_body_type":
        after["components"]["schemas"]["LaunchGrantVerifyRequest"]["properties"]["token"]["type"] = "integer"
    elif mutation == "added_parameter":
        operation["parameters"].append({"name": "password", "in": "query", "required": False})
    else:
        del operation["responses"]["422"]
    assert module.compare(before, after)


def test_unrelated_endpoint_cannot_use_launch_exception():
    before, after, _ = contracts("/api/auth/verify")
    assert module.compare(before, after)
