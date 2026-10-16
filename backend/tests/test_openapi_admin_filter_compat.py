"""The frozen gate permits only the reviewed optional admin context filters."""
import copy
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("openapi_admin_compat", ROOT / "scripts/check_openapi_compat.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PATHS = [
    "/api/agency/licenses", "/api/agency/requests", "/api/auth-codes", "/api/auth-codes/{code_id}",
    "/api/feedback", "/api/feedback/{feedback_id}", "/api/orders", "/api/orders/export",
    "/api/orders/{order_id}", "/api/users", "/api/users/{user_id}",
]


def contracts(path):
    baseline = module.load(ROOT / "backend/openapi-baseline.json")
    current = module.load(ROOT / "backend/openapi.json")
    before = {"paths": {path: {"get": copy.deepcopy(baseline["paths"][path]["get"])}}}
    after = {"paths": {path: {"get": copy.deepcopy(current["paths"][path]["get"])}}}
    return before, after, after["paths"][path]["get"]


@pytest.mark.parametrize("path", PATHS)
def test_reviewed_optional_filter_preserves_each_real_baseline_contract(path):
    before, after, _ = contracts(path)
    assert module.compare(before, after) == []


def test_the_whole_current_document_still_preserves_the_frozen_surface():
    assert module.compare(module.load(ROOT / "backend/openapi-baseline.json"), module.load(ROOT / "backend/openapi.json")) == []


@pytest.mark.parametrize("path", PATHS)
def test_unmodified_original_operation_is_still_compatible(path):
    before, _, _ = contracts(path)
    assert module.compare(before, copy.deepcopy(before)) == []


@pytest.mark.parametrize("mutation", [
    "require_new", "wrong_location", "remove_original", "require_original", "old_default",
    "old_type", "old_limit", "additional_parameter", "new_default", "new_type",
    "new_enum", "new_nullability", "new_request_body", "removed_response", "duplicate_parameter", "old_default_bool", "nonboolean_required",
])
def test_order_filter_exception_cannot_hide_other_contract_changes(mutation):
    before, after, operation = contracts("/api/orders")
    params = operation["parameters"]
    source = next(parameter for parameter in params if parameter["name"] == "source")
    page = next(parameter for parameter in params if parameter["name"] == "page")
    if mutation == "require_new":
        source["required"] = True
    elif mutation == "wrong_location":
        source["in"] = "header"
    elif mutation == "remove_original":
        params.remove(page)
    elif mutation == "require_original":
        page["required"] = True
    elif mutation == "old_default":
        page["schema"]["default"] = 2
    elif mutation == "old_default_bool":
        page["schema"]["default"] = True
    elif mutation == "nonboolean_required":
        source["required"] = 0
    elif mutation == "old_type":
        page["schema"]["type"] = "string"
    elif mutation == "old_limit":
        page["schema"]["minimum"] = 2
    elif mutation == "additional_parameter":
        params.append({"in": "query", "name": "unreviewed", "required": False, "schema": {"type": "string"}})
    elif mutation == "new_default":
        source["schema"]["default"] = "direct"
    elif mutation == "new_type":
        source["schema"]["anyOf"][0]["type"] = "integer"
    elif mutation == "new_enum":
        source["schema"]["anyOf"][0]["enum"].append("anything")
    elif mutation == "new_nullability":
        source["schema"]["anyOf"].pop()
    elif mutation == "new_request_body":
        operation["requestBody"] = {"content": {"application/json": {"schema": {"type": "object"}}}}
    elif mutation == "removed_response":
        del operation["responses"]["422"]
    else:
        params.append(copy.deepcopy(source))
    assert module.compare(before, after)


def test_default_change_cannot_pass_even_when_no_filter_is_added():
    before, _, _ = contracts("/api/orders")
    after = copy.deepcopy(before)
    after["paths"]["/api/orders"]["get"]["parameters"][0]["schema"]["default"] = 2
    assert module.compare(before, after)


@pytest.mark.parametrize("path,field,mutation", [
    ("/api/users", "platform_key", {"pattern": ".*"}),
    ("/api/agency/licenses", "customer_id", {"exclusiveMinimum": -1}),
    ("/api/feedback", "user_id", {"minimum": 0}),
])
def test_filter_validation_constraints_are_part_of_the_reviewed_contract(path, field, mutation):
    before, after, operation = contracts(path)
    next(parameter for parameter in operation["parameters"] if parameter["name"] == field)["schema"]["anyOf"][0].update(mutation)
    assert module.compare(before, after)


@pytest.mark.parametrize("path", ["/api/orders", "/api/feedback"])
@pytest.mark.parametrize("mutation", ["required", "limit", "default", "type", "nonnullable", "removed"])
def test_order_and_feedback_keyword_contract_is_exact(path, mutation):
    before, after, operation = contracts(path)
    keyword = next(parameter for parameter in operation["parameters"] if parameter["name"] == "keyword")
    if mutation == "required":
        keyword["required"] = True
    elif mutation == "limit":
        keyword["schema"]["anyOf"][0]["maxLength"] = 201
    elif mutation == "default":
        keyword["schema"]["default"] = "sample"
    elif mutation == "type":
        keyword["schema"]["anyOf"][0]["type"] = "integer"
    elif mutation == "nonnullable":
        keyword["schema"]["anyOf"].pop()
    else:
        operation["parameters"].remove(keyword)
    assert module.compare(before, after)


def test_only_nonsemantic_documentation_annotations_may_differ():
    before, after, operation = contracts("/api/users")
    for parameter in operation["parameters"]:
        parameter["description"] = "Updated documentation"
        parameter["schema"]["title"] = "Updated title"
        parameter["schema"]["description"] = "Updated documentation"
    operation["parameters"].reverse()
    assert module.compare(before, after) == []


def test_documentation_normalization_does_not_drop_real_property_names_or_default_values():
    original = {"title": "schema title", "description": "schema description", "type": "object",
                "properties": {"title": {"type": "string", "title": "field title"}},
                "default": {"title": "actual default", "description": "actual default text"}}
    normalized = module.schema_without_documentation(original)
    assert normalized["properties"] == {"title": {"type": "string"}}
    assert normalized["default"] == original["default"]


@pytest.mark.parametrize("other_path,method", [("/api/unreviewed", "get"), ("/api/orders", "post")])
def test_same_filter_shape_on_other_operations_is_not_a_blanket_exception(other_path, method):
    before, after, operation = contracts("/api/orders")
    old = before["paths"]["/api/orders"]["get"]
    before["paths"] = {other_path: {method: old}}
    after["paths"] = {other_path: {method: operation}}
    assert module.compare(before, after)


def live_auth_code_contracts():
    # Inspect the real route without writing generated files; the release owner
    # regenerates the shared OpenAPI artifacts after all concurrent edits finish.
    from main import app

    path = "/api/auth-codes"
    before, _, _ = contracts(path)
    operation = copy.deepcopy(app.openapi()["paths"][path]["get"])
    return before, {"paths": {path: {"get": operation}}}, operation


def test_real_authorization_list_adds_exactly_the_three_reviewed_optional_filters():
    before, after, operation = live_auth_code_contracts()
    original = module.parameter_contracts(before["paths"]["/api/auth-codes"]["get"])
    current = module.parameter_contracts(operation)
    assert current.keys() - original.keys() == {
        ("keyword", "query"), ("product_type", "query"), ("status", "query"),
    }
    assert module.compare(before, after) == []


@pytest.mark.parametrize("field", ["keyword", "product_type", "status"])
@pytest.mark.parametrize("mutation", ["missing", "required", "default", "nonnullable", "wrong_location"])
def test_authorization_filter_exception_rejects_incomplete_or_changed_new_filters(field, mutation):
    before, after, operation = live_auth_code_contracts()
    params = operation["parameters"]
    parameter = next(item for item in params if item["name"] == field)
    if mutation == "missing":
        params.remove(parameter)
    elif mutation == "required":
        parameter["required"] = True
    elif mutation == "default":
        parameter["schema"]["default"] = {"keyword": "sample", "product_type": "consumer", "status": "active"}[field]
    elif mutation == "nonnullable":
        parameter["schema"]["anyOf"].pop()
    else:
        parameter["in"] = "header"
    assert module.compare(before, after)


@pytest.mark.parametrize("field,constraint,value", [
    ("keyword", "maxLength", 201),
    ("keyword", "type", "integer"),
    ("product_type", "enum", ["consumer", "business", "other"]),
    ("status", "enum", ["unused", "active", "frozen", "expired"]),
])
def test_authorization_filter_validation_is_exact(field, constraint, value):
    before, after, operation = live_auth_code_contracts()
    parameter = next(item for item in operation["parameters"] if item["name"] == field)
    parameter["schema"]["anyOf"][0][constraint] = value
    assert module.compare(before, after)


@pytest.mark.parametrize("field,value", [("page", 2), ("page_size", 50), ("include_deleted", True)])
def test_authorization_filters_never_change_existing_defaults(field, value):
    before, after, operation = live_auth_code_contracts()
    next(item for item in operation["parameters"] if item["name"] == field)["schema"]["default"] = value
    assert module.compare(before, after)


@pytest.mark.parametrize("mutation", ["extra", "missing_original", "duplicate"])
def test_authorization_filter_exception_does_not_allow_other_parameter_edits(mutation):
    before, after, operation = live_auth_code_contracts()
    params = operation["parameters"]
    if mutation == "extra":
        params.append({"name": "unreviewed", "in": "query", "required": False, "schema": {"type": "string"}})
    elif mutation == "missing_original":
        params.remove(next(item for item in params if item["name"] == "platform_key"))
    else:
        params.append(copy.deepcopy(next(item for item in params if item["name"] == "keyword")))
    assert module.compare(before, after)
