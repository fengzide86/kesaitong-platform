"""The policy-template extension keeps the frozen v1 contract narrowly scoped."""

import copy
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("team_policy_compat", ROOT / "scripts/check_openapi_compat.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

TEMPLATE = ("/api/team-ledger/policy-template", "get")
POST_POLICY = ("/api/team-ledger/policies", "post")
PREVIEW = ("/api/team-ledger/settlements/preview", "post")


def contract(key=TEMPLATE):
    current = module.load(ROOT / "backend/openapi.json")
    operation = current["paths"][key[0]][key[1]]
    isolated = {"paths": {key[0]: {key[1]: operation}}, "components": current["components"]}
    assert module.compare({}, isolated) == []
    return isolated, operation, isolated["components"]["schemas"]


def test_real_document_and_each_original_frozen_operation_are_still_accepted():
    baseline = module.load(ROOT / "backend/openapi-baseline.json")
    current = module.load(ROOT / "backend/openapi.json")
    assert module.compare(baseline, current) == []
    reviewed = module.load(ROOT / "backend/openapi-framework-v1.json")
    assert "GET /api/team-ledger/policy-template" not in reviewed["operations"]
    assert "purchased_service_codes" not in reviewed["models"]["PolicyItem-Input"]["properties"]
    for key in module.TEAM_POLICY_EXTENSION_OPERATIONS - {TEMPLATE}:
        original = reviewed["operations"][f"{key[1].upper()} {key[0]}"]
        assert module.is_reviewed_extension_operation(key, original, {"components": {"schemas": reviewed["models"]}})


@pytest.mark.parametrize("key", sorted(module.TEAM_POLICY_EXTENSION_OPERATIONS))
@pytest.mark.parametrize("mutation", ["auth", "query", "new_body"])
def test_every_extended_operation_still_requires_exact_security_parameters_and_body(key, mutation):
    current, operation, _ = contract(key)
    if mutation == "auth":
        operation["security"] = []
    elif mutation == "query":
        operation.setdefault("parameters", []).append({"name": "unreviewed", "in": "query", "required": False, "schema": {"type": "string"}})
    else:
        operation["requestBody"] = {"required": False, "content": {"application/json": {"schema": {"type": "object"}}}}
    assert module.compare({}, current)


@pytest.mark.parametrize("model,key", [
    ("PolicyItem-Input", POST_POLICY), ("PolicyItem-Output", TEMPLATE), ("SettlementLine", PREVIEW),
])
@pytest.mark.parametrize("mutation", ["required", "type", "item_type", "default", "nullable", "extra_field", "loose_model"])
def test_only_the_exact_optional_purchased_service_field_is_allowed(model, key, mutation):
    current, _, models = contract(key)
    definition = models[model]
    field = definition["properties"]["purchased_service_codes"]
    if mutation == "required":
        definition["required"].append("purchased_service_codes")
    elif mutation == "type":
        field["type"] = "string"
    elif mutation == "item_type":
        field["items"]["type"] = "integer"
    elif mutation == "default":
        field["default"] = ["unreviewed"]
    elif mutation == "nullable":
        definition["properties"]["purchased_service_codes"] = {"anyOf": [field, {"type": "null"}]}
    elif mutation == "extra_field":
        definition["properties"]["unreviewed_optional"] = {"type": "string"}
    else:
        definition["additionalProperties"] = True
    assert module.compare({}, current)


@pytest.mark.parametrize("model,key", [("PolicyItem-Input", POST_POLICY), ("PolicyItem-Output", TEMPLATE)])
@pytest.mark.parametrize("mutation", ["array_bound", "code_pattern", "code_min", "code_max", "old_ratio", "old_code"])
def test_field_and_existing_policy_validation_bounds_are_not_relaxed(model, key, mutation):
    current, _, models = contract(key)
    fields = models[model]["properties"]
    if mutation == "array_bound":
        fields["purchased_service_codes"]["maxItems"] = 21
    elif mutation == "code_pattern":
        fields["purchased_service_codes"]["items"]["pattern"] = ".*"
    elif mutation == "code_min":
        fields["purchased_service_codes"]["items"]["minLength"] = 0
    elif mutation == "code_max":
        fields["purchased_service_codes"]["items"]["maxLength"] = 81
    elif mutation == "old_ratio":
        fields["ratio"] = {"type": "number"}
    else:
        fields["code"]["maxLength"] = 81
    assert module.compare({}, current)


@pytest.mark.parametrize("model,key", [("PolicyInput-Input", POST_POLICY), ("PolicyInput-Output", TEMPLATE)])
@pytest.mark.parametrize("mutation", ["extra", "required", "item_ref", "old_bound"])
def test_input_output_aliases_are_exact_frozen_shapes_not_generic_name_exemptions(model, key, mutation):
    current, _, models = contract(key)
    definition = models[model]
    if mutation == "extra":
        definition["properties"]["new_optional"] = {"type": "string"}
    elif mutation == "required":
        definition["required"].remove("name")
    elif mutation == "item_ref":
        definition["properties"]["items"]["items"] = {"type": "object"}
    else:
        definition["properties"]["name"]["maxLength"] = 101
    assert module.compare({}, current)


@pytest.mark.parametrize("mutation", ["extra_response", "wrong_response", "wrapper_extra", "wrapper_required", "wrapper_bool_default", "new_route", "new_method"])
def test_template_get_does_not_allow_extra_routes_or_response_changes(mutation):
    current, operation, models = contract()
    if mutation == "extra_response":
        operation["responses"]["201"] = copy.deepcopy(operation["responses"]["200"])
    elif mutation == "wrong_response":
        operation["responses"]["200"]["content"]["application/json"]["schema"] = {"type": "object"}
    elif mutation == "wrapper_extra":
        models["APIResponse_PolicyInput_"]["properties"]["internal_secret"] = {"type": "string"}
    elif mutation == "wrapper_required":
        models["APIResponse_PolicyInput_"]["required"] = ["data"]
    elif mutation == "wrapper_bool_default":
        models["APIResponse_PolicyInput_"]["properties"]["success"]["default"] = 1
    elif mutation == "new_route":
        current["paths"]["/api/team-ledger/policy-template/unreviewed"] = {"get": copy.deepcopy(operation)}
    else:
        current["paths"][TEMPLATE[0]]["post"] = copy.deepcopy(operation)
    assert module.compare({}, current)
