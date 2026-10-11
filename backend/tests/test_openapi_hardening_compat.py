"""Each new hardening contract has a finite, mutation-tested allowlist."""

import copy
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("hardening_compat", ROOT / "scripts/check_openapi_compat.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def extension_contract():
    full = module.load(ROOT / "backend/openapi.json")
    path, method = module.EXTEND_OPERATION
    current = {"paths": {path: {method: copy.deepcopy(full["paths"][path][method])}}, "components": {"schemas": {"AuthCodeExtend": copy.deepcopy(full["components"]["schemas"]["AuthCodeExtend"])}}}
    return {"paths": {}}, current, current["paths"][path][method]


def test_extension_exact_reviewed_contract_passes():
    before, after, _ = extension_contract()
    assert module.compare(before, after) == []


@pytest.mark.parametrize("mutation", ["path", "method", "auth", "optional_body", "wrong_body", "extra_param", "id_type", "bounds", "extra_field", "optional_days", "response", "removed_422"])
def test_extension_exception_does_not_hide_other_api_changes(mutation):
    before, after, operation = extension_contract()
    path, method = module.EXTEND_OPERATION
    model = after["components"]["schemas"]["AuthCodeExtend"]
    if mutation == "path":
        after["paths"]["/api/auth-codes/{code_id}/unreviewed"] = after["paths"].pop(path)
    elif mutation == "method":
        after["paths"][path]["get"] = after["paths"][path].pop(method)
    elif mutation == "auth":
        operation["security"] = []
    elif mutation == "optional_body":
        operation["requestBody"]["required"] = False
    elif mutation == "wrong_body":
        operation["requestBody"]["content"]["application/json"]["schema"]["$ref"] = "#/components/schemas/AuthCodeUpdate"
    elif mutation == "extra_param":
        operation["parameters"].append({"name": "admin", "in": "query", "required": False, "schema": {"type": "boolean"}})
    elif mutation == "id_type":
        operation["parameters"][0]["schema"]["type"] = "string"
    elif mutation == "bounds":
        model["properties"]["days"]["minimum"] = 0
    elif mutation == "extra_field":
        model["properties"]["status"] = {"type": "string"}
    elif mutation == "optional_days":
        model["required"] = []
    elif mutation == "response":
        operation["responses"]["200"]["content"]["application/json"]["schema"] = {"type": "boolean"}
    else:
        del operation["responses"]["422"]
    assert module.compare(before, after)


def staff_contract():
    before = module.load(ROOT / "backend/openapi-baseline.json")
    after = module.load(ROOT / "backend/openapi.json")
    path = "/api/staff/accounts"
    return {"paths": {path: {"get": copy.deepcopy(before["paths"][path]["get"])}}}, {"paths": {path: {"get": copy.deepcopy(after["paths"][path]["get"])}}}


def test_staff_search_is_optional_with_original_pagination():
    before, after = staff_contract()
    assert module.compare(before, after) == []


@pytest.mark.parametrize("mutation", ["required", "default", "type", "length", "page_default", "extra"])
def test_staff_search_allowlist_preserves_bounds_defaults_and_old_page(mutation):
    before, after = staff_contract()
    params = after["paths"]["/api/staff/accounts"]["get"]["parameters"]
    search = next(item for item in params if item["name"] == "q")
    if mutation == "required":
        search["required"] = True
    elif mutation == "page_default":
        next(item for item in params if item["name"] == "page")["schema"]["default"] = 2
    elif mutation == "extra":
        params.append({"name": "unreviewed", "in": "query", "required": False})
    else:
        search["schema"][{"default": "default", "type": "type", "length": "maxLength"}[mutation]] = {"default": "admin", "type": "integer", "length": 101}[mutation]
    assert module.compare(before, after)


@pytest.mark.parametrize("model", ["AuthCodeGenerate", "AuthCodeUpdate", "ProfitPolicyUpdate"])
def test_reviewed_model_validation_is_exact_not_blanket_schema_bypass(model):
    before = {"components": {"schemas": {model: module.load(ROOT / "backend/openapi-baseline.json")["components"]["schemas"][model]}}}
    after = {"components": {"schemas": {model: module.load(ROOT / "backend/openapi.json")["components"]["schemas"][model]}}}
    assert module.compare(before, after) == []
    assert module.compare(before, copy.deepcopy(before)) == []
    after["components"]["schemas"][model]["properties"]["unreviewed"] = {"type": "string"}
    assert module.compare(before, after)


@pytest.mark.parametrize("model,field", [("AuthCodeGenerate", "count"), ("AuthCodeUpdate", "max_devices"), ("ProfitPolicyUpdate", "expected_version")])
def test_reviewed_model_cannot_change_limits_or_optional_fields(model, field):
    full_before = module.load(ROOT / "backend/openapi-baseline.json")
    full_after = module.load(ROOT / "backend/openapi.json")
    before = {"components": {"schemas": {model: copy.deepcopy(full_before["components"]["schemas"][model])}}}
    after = {"components": {"schemas": {model: copy.deepcopy(full_after["components"]["schemas"][model])}}}
    schema = after["components"]["schemas"][model]
    value = schema["properties"][field]
    value.get("anyOf", [value])[0]["minimum"] = 0
    assert module.compare(before, after)
    schema["properties"][field] = copy.deepcopy(full_after["components"]["schemas"][model]["properties"][field])
    schema.setdefault("required", []).append(field)
    assert module.compare(before, after)
