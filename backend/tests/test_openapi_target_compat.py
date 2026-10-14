"""Do not weaken the frozen launch surface to admit target configuration."""
import copy
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("target_compat", Path(__file__).parents[2] / "scripts/check_openapi_compat.py")
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def surface(path="/api/tools/{tool_id}/launch-grant"):
    operation = {"parameters": [{"name": "platform_key", "in": "query", "required": True, "schema": {"type": "string"}}], "responses": {"200": {}}}
    before = {"paths": {path: {"post": operation}}}
    after = copy.deepcopy(before)
    after["paths"][path]["post"]["parameters"].extend(
        {"name": name, "in": "query", "required": False, "schema": copy.deepcopy(schema)}
        for name, schema in module.TARGET_OPTIONAL_BINDINGS.items()
    )
    return before, after


@pytest.mark.parametrize("path", ["/api/tools/{tool_id}/launch-grant", "/api/tools/{tool_id}/launch-token"])
def test_reviewed_optional_fields_keep_legacy(path):
    before, after = surface(path)
    assert module.compare(before, after) == []


@pytest.mark.parametrize("mutation", ["required", "default", "extra", "old_field", "bounds"])
def test_any_unreviewed_change_fails(mutation):
    before, after = surface()
    parameters = after["paths"]["/api/tools/{tool_id}/launch-grant"]["post"]["parameters"]
    if mutation == "required":
        parameters[1]["required"] = True
    elif mutation == "default":
        parameters[-1]["schema"]["default"] = 2
    elif mutation == "extra":
        parameters.append({"name": "run_code", "in": "query", "required": False})
    elif mutation == "bounds":
        parameters[-1]["schema"]["maximum"] = 3
    else:
        parameters[0]["schema"]["default"] = "amazon"
    assert module.compare(before, after)


def test_other_route_does_not_gain_exception():
    before, after = surface("/api/other")
    assert module.compare(before, after)


@pytest.mark.parametrize("mutation", ["auth", "extra_query", "optional_body", "extra_route"])
def test_new_target_routes_have_narrow_reviewed_surface(mutation):
    root = Path(__file__).parents[2]
    before = module.load(root / "backend/openapi-baseline.json")
    after = module.load(root / "backend/openapi.json")
    assert module.compare(before, after) == []
    operation = after["paths"]["/api/tools/target-profiles"]["post"]
    if mutation == "auth":
        operation["security"] = []
    elif mutation == "extra_query":
        operation["parameters"] = [{"name": "debug", "in": "query", "required": False}]
    elif mutation == "optional_body":
        operation["requestBody"]["required"] = False
    else:
        after["paths"]["/api/tools/target-profiles/unreviewed"] = {"post": operation}
    assert module.compare(before, after)
