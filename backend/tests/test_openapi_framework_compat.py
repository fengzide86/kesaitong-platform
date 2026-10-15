"""Framework additions are exact contracts, not a prefix-based exemption."""
import copy
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("framework_compat", ROOT / "scripts/check_openapi_compat.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.mark.parametrize("mutation", ["auth", "query", "body_optional", "request_bound", "response_field", "new_route"])
def test_framework_extension_does_not_hide_contract_changes(mutation):
    baseline = module.load(ROOT / "backend/openapi-baseline.json")
    current = module.load(ROOT / "backend/openapi.json")
    assert module.compare(baseline, current) == []
    operation = current["paths"]["/api/commercial/offers"]["post"]
    if mutation == "auth":
        operation["security"] = []
    elif mutation == "query":
        operation["parameters"] = [{"name": "unchecked", "in": "query", "required": False}]
    elif mutation == "body_optional":
        operation["requestBody"]["required"] = False
    elif mutation == "new_route":
        current["paths"]["/api/commercial/unreviewed"] = {"post": copy.deepcopy(operation)}
    elif mutation == "request_bound":
        name = operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].rsplit("/", 1)[-1]
        current["components"]["schemas"][name]["additionalProperties"] = True
    else:
        name = operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].rsplit("/", 1)[-1]
        current["components"]["schemas"][name]["properties"]["internal_secret"] = {"type": "string"}
    assert module.compare(baseline, current)
