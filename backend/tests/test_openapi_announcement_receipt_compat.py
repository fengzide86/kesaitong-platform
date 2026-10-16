"""The receipt revision exception is limited to its exact reviewed protocol."""
import copy
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("announcement_receipt_compat", ROOT / "scripts/check_openapi_compat.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def contracts(action="read"):
    path = f"/api/announcements/{{announcement_id}}/{action}"
    baseline = module.load(ROOT / "backend/openapi-baseline.json")
    current = module.load(ROOT / "backend/openapi.json")
    before = {"paths": {path: {"post": copy.deepcopy(baseline["paths"][path]["post"])}}}
    after = {"paths": {path: {"post": copy.deepcopy(current["paths"][path]["post"])}},
             "components": {"schemas": {"ReceiptAction": copy.deepcopy(current["components"]["schemas"]["ReceiptAction"])}}}
    return before, after, after["paths"][path]["post"]


@pytest.mark.parametrize("action", ["read", "dismiss"])
def test_only_exact_optional_revision_body_is_reviewed(action):
    before, after, _ = contracts(action)
    assert module.compare(before, after) == []
    assert module.compare(before, copy.deepcopy(before)) == []


@pytest.mark.parametrize("action", ["read", "dismiss"])
@pytest.mark.parametrize("mutation", [
    "required_body", "required_revision", "default_revision", "zero_revision", "string_revision",
    "additional_field", "allow_extra", "wrong_model", "nonnullable_body", "nonnullable_revision",
    "changed_path_type", "removed_auth", "changed_response", "other_content_type",
])
def test_receipt_exception_rejects_every_unreviewed_contract_change(action, mutation):
    before, after, operation = contracts(action)
    body = operation["requestBody"]
    body_schema = body["content"]["application/json"]["schema"]
    model = after["components"]["schemas"]["ReceiptAction"]
    revision = model["properties"]["revision"]
    if mutation == "required_body":
        body["required"] = True
    elif mutation == "required_revision":
        model["required"] = ["revision"]
    elif mutation == "default_revision":
        revision["default"] = 1
    elif mutation == "zero_revision":
        revision["anyOf"][0]["minimum"] = 0
    elif mutation == "string_revision":
        revision["anyOf"][0]["type"] = "string"
    elif mutation == "additional_field":
        model["properties"]["unreviewed"] = {"type": "string"}
    elif mutation == "allow_extra":
        model["additionalProperties"] = True
    elif mutation == "wrong_model":
        body_schema["anyOf"][0]["$ref"] = "#/components/schemas/OtherBody"
    elif mutation == "nonnullable_body":
        body_schema["anyOf"].pop()
    elif mutation == "nonnullable_revision":
        revision["anyOf"].pop()
    elif mutation == "changed_path_type":
        operation["parameters"][0]["schema"]["type"] = "string"
    elif mutation == "removed_auth":
        operation["security"] = []
    elif mutation == "changed_response":
        operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"] = "#/components/schemas/OtherResponse"
    else:
        body["content"]["text/plain"] = body["content"].pop("application/json")
    assert module.compare(before, after)


def test_optional_receipt_body_does_not_allow_changes_on_an_unrelated_endpoint():
    before, after, operation = contracts()
    old = next(iter(before["paths"].values()))["post"]
    before["paths"] = {"/api/unreviewed": {"post": old}}
    after["paths"] = {"/api/unreviewed": {"post": operation}}
    assert module.compare(before, after)
