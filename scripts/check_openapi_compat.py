"""Check that the enriched OpenAPI document keeps the frozen HTTP surface."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head"}


def nullable(schema: dict[str, Any]) -> dict[str, Any]:
    return {"anyOf": [schema, {"type": "null"}]}


# Reviewed additions only: omitting every filter retains the frozen behavior.
# In particular source has NO "direct" default: omitted source still means all
# orders. Nullability, enum/pattern and integer bounds are part of this contract.
ADMIN_OPTIONAL_FILTERS: dict[tuple[str, str], dict[str, dict[str, Any]]] = {
    ("/api/agency/licenses", "get"): {"customer_id": nullable({"exclusiveMinimum": 0, "type": "integer"})},
    ("/api/agency/requests", "get"): {"customer_id": nullable({"exclusiveMinimum": 0, "type": "integer"})},
    ("/api/auth-codes", "get"): {
        "keyword": nullable({"maxLength": 200, "type": "string"}),
        "product_type": nullable({"enum": ["consumer", "business"], "type": "string"}),
        "status": nullable({"enum": ["unused", "active", "frozen", "expired", "deleted"], "type": "string"}),
    },
    ("/api/auth-codes/{code_id}", "get"): {"platform_key": nullable({"pattern": "^(amazon|aliexpress)$", "type": "string"})},
    ("/api/feedback", "get"): {"user_id": nullable({"minimum": 1, "type": "integer"})},
    ("/api/feedback/{feedback_id}", "get"): {"platform_key": nullable({"pattern": "^(amazon|aliexpress)$", "type": "string"})},
    ("/api/orders", "get"): {"source": nullable({"enum": ["direct", "agency"], "type": "string"})},
    ("/api/orders/export", "get"): {"source": nullable({"enum": ["direct", "agency"], "type": "string"})},
    ("/api/orders/{order_id}", "get"): {"platform_key": nullable({"type": "string"})},
    ("/api/users", "get"): {
        "platform_key": nullable({"pattern": "^(amazon|aliexpress)$", "type": "string"}),
        "auth_code_id": nullable({"minimum": 1, "type": "integer"}),
    },
    ("/api/users/{user_id}", "get"): {"platform_key": nullable({"pattern": "^(amazon|aliexpress)$", "type": "string"})},
    ("/api/staff/accounts", "get"): {"q": {"type": "string", "maxLength": 100, "default": ""}},
}

# Intentional hardening rejects formerly invalid values. These are not a
# blanket schema exemption: defaults, nullability, properties and bounds must
# match the reviewed shape, or the original untouched model, exactly.
AUTH_STATUS = ["unused", "active", "frozen", "expired", "deleted"]
BOUNDED_CAPACITY = nullable({"type": "integer", "minimum": 1.0, "maximum": 1000.0})
REVIEWED_REQUEST_MODELS = {
    "AuthCodeGenerate": {"type": "object", "properties": {
        "count": {"type": "integer", "minimum": 1.0, "maximum": 1000.0, "default": 1},
        "duration_days": nullable({"type": "integer", "minimum": 1.0, "maximum": 3650.0}),
        "max_devices": BOUNDED_CAPACITY,
        "plan_id": nullable({"type": "integer", "minimum": 1.0}),
        "platform_scope": {**nullable({"type": "string"}), "default": "amazon"},
        "scene_type": {**nullable({"type": "string", "enum": ["competition", "course", "operations"]}), "default": "competition"},
        "seat_limit": BOUNDED_CAPACITY,
    }},
    "AuthCodeUpdate": {"type": "object", "properties": {
        "device_id": nullable({"type": "string", "maxLength": 200}),
        "device_name": nullable({"type": "string", "maxLength": 200}),
        "expires_at": nullable({"type": "string"}),
        "max_devices": BOUNDED_CAPACITY,
        "status": nullable({"type": "string", "enum": AUTH_STATUS}),
    }},
    "ProfitPolicyUpdate": {"type": "object", "additionalProperties": False, "required": ["ratios"], "properties": {
        "ratios": {"$ref": "#/components/schemas/ProfitRatios-Input"},
        "expected_version": nullable({"type": "integer", "minimum": 1.0}),
    }},
}
REVIEWED_REQUEST_ROUTES = {
    ("/api/auth-codes/batch-generate", "post"),
    ("/api/auth-codes/{code_id}", "put"),
    ("/api/profit/policy", "put"),
}
EXTEND_OPERATION = ("/api/auth-codes/{code_id}/extend", "post")
EXTEND_REQUEST_MODEL = {"type": "object", "additionalProperties": False, "required": ["days"], "properties": {
    "days": {"type": "integer", "minimum": 1.0, "maximum": 3650.0},
}}


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def operations(schema: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    result: dict[tuple[str, str], dict[str, Any]] = {}
    for route, path_item in schema.get("paths", {}).items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method in HTTP_METHODS and isinstance(operation, dict):
                result[(route, method)] = operation
    return result


def parameter_signature(operation: dict[str, Any]) -> list[tuple[str, str, bool]]:
    signature: list[tuple[str, str, bool]] = []
    for parameter in operation.get("parameters", []):
        if not isinstance(parameter, dict):
            continue
        signature.append(
            (
                str(parameter.get("name", "")),
                str(parameter.get("in", "")),
                bool(parameter.get("required", False)),
            )
        )
    return sorted(signature)


def schema_without_documentation(value: Any) -> Any:
    """Ignore schema annotations, never default/enum values or property names."""
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key in {"title", "description"}:
            continue
        if key in {"properties", "patternProperties", "$defs", "definitions", "dependentSchemas"} and isinstance(item, dict):
            result[key] = {name: schema_without_documentation(child) for name, child in item.items()}
        elif key in {"anyOf", "allOf", "oneOf", "prefixItems"} and isinstance(item, list):
            result[key] = [schema_without_documentation(child) for child in item]
        elif key in {"items", "additionalProperties", "not", "if", "then", "else", "contains", "propertyNames"}:
            result[key] = schema_without_documentation(item)
        else:
            result[key] = item
    return result


def parameter_contracts(operation: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]] | None:
    parameters = operation.get("parameters", [])
    if not isinstance(parameters, list):
        return None
    result = {}
    for parameter in parameters:
        if not isinstance(parameter, dict) or not isinstance(parameter.get("name"), str) or not isinstance(parameter.get("in"), str):
            return None
        key = (parameter["name"], parameter["in"])
        if key in result:
            return None
        contract = {name: value for name, value in parameter.items() if name not in {"title", "description"}}
        if "schema" in contract:
            contract["schema"] = schema_without_documentation(contract["schema"])
        result[key] = contract
    return result


def same_contract(before: dict[str, Any] | None, after: dict[str, Any] | None) -> bool:
    # JSON booleans are not integers (Python alone considers False == 0).
    return json.dumps(before, sort_keys=True) == json.dumps(after, sort_keys=True)


def is_compatible_admin_context_filters(key: tuple[str, str], before: dict[str, Any], after: dict[str, Any]) -> bool:
    reviewed = ADMIN_OPTIONAL_FILTERS.get(key)
    if reviewed is None:
        return False
    original = parameter_contracts(before)
    candidate = parameter_contracts(after)
    if original is None or candidate is None:
        return False
    if original.keys() == candidate.keys() and all(same_contract(candidate[name], contract) for name, contract in original.items()):
        return True
    # Preserve every old parameter's complete contract, not only its name and
    # required flag. The exception must never mask a changed pagination default.
    if any(not same_contract(candidate.get(name), contract) for name, contract in original.items()):
        return False
    expected = {
        (name, "query"): {"name": name, "in": "query", "required": False, "schema": schema}
        for name, schema in reviewed.items()
    }
    if original.keys() & expected.keys() or candidate.keys() - original.keys() != expected.keys():
        return False
    return all(same_contract(candidate[name], contract) for name, contract in expected.items())


def is_compatible_launch_transport(
    key: tuple[str, str], before: dict[str, Any], after: dict[str, Any], schema: dict[str, Any],
) -> bool:
    """Only the explicit query-to-JSON migration keeps the old HTTP contract.

    Both credentials are optional at the envelope level, but the boundary still
    requires exactly one token. Removing query, requiring JSON or changing any
    other parameter/endpoint continues to fail this frozen-surface gate.
    """
    if key not in {("/api/tools/launch-grant/verify", "post"), ("/api/tools/launch-token/verify", "post")}:
        return False
    if parameter_signature(before) != [("token", "query", True)] or before.get("requestBody"):
        return False
    if parameter_signature(after) != [("token", "query", False)]:
        return False
    body = after.get("requestBody", {})
    if not body or body.get("required", False):
        return False
    body_schema = body.get("content", {}).get("application/json", {}).get("schema", {})
    variants = body_schema.get("anyOf", [body_schema])
    if {"$ref": "#/components/schemas/LaunchGrantVerifyRequest"} not in variants:
        return False
    model = schema.get("components", {}).get("schemas", {}).get("LaunchGrantVerifyRequest", {})
    if model.get("required") != ["token"] or model.get("properties", {}).get("token", {}).get("type") != "string":
        return False
    query = next(parameter for parameter in after["parameters"] if parameter.get("name") == "token")
    query_schema = query.get("schema", {})
    return query_schema.get("type") == "string" or {"type": "string"} in query_schema.get("anyOf", [])


def is_reviewed_extension_operation(key: tuple[str, str], operation: dict[str, Any], schema: dict[str, Any]) -> bool:
    if key != EXTEND_OPERATION:
        return False
    expected_parameters = [{"name": "code_id", "in": "path", "required": True, "schema": {"type": "integer"}}]
    parameters = parameter_contracts(operation)
    expected_body = {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AuthCodeExtend"}}}}
    responses = operation.get("responses", {})
    expected_responses = {code: {"content": {"application/json": {"schema": {"$ref": f"#/components/schemas/{model}"}}}}
                          for code, model in [("200", "AuthCodeResponse"), ("422", "HTTPValidationError")]}
    model = schema.get("components", {}).get("schemas", {}).get("AuthCodeExtend")
    return (
        parameters is not None and len(parameters) == 1
        and same_contract(parameters.get(("code_id", "path")), expected_parameters[0])
        and same_contract(schema_without_documentation(operation.get("requestBody")), expected_body)
        and same_contract({code: schema_without_documentation(value) for code, value in responses.items()}, expected_responses)
        and operation.get("security") == [{"HTTPBearer": []}]
        and same_contract(schema_without_documentation(model), EXTEND_REQUEST_MODEL)
    )


def compare(baseline: dict[str, Any], current: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    baseline_ops = operations(baseline)
    current_ops = operations(current)
    if baseline_ops.keys() != current_ops.keys():
        missing = sorted(baseline_ops.keys() - current_ops.keys())
        added = sorted(key for key in current_ops.keys() - baseline_ops.keys()
                       if not is_reviewed_extension_operation(key, current_ops[key], current))
        if missing:
            errors.append(f"operations removed: {missing}")
        if added:
            errors.append(f"operations added: {added}")
    for key in sorted(baseline_ops.keys() & current_ops.keys()):
        before = baseline_ops[key]
        after = current_ops[key]
        launch_migration = is_compatible_launch_transport(key, before, after, current)
        parameter_compatible = (
            is_compatible_admin_context_filters(key, before, after)
            if key in ADMIN_OPTIONAL_FILTERS
            else parameter_signature(before) == parameter_signature(after)
        )
        if not parameter_compatible and not launch_migration:
            errors.append(f"parameters changed for {key[1].upper()} {key[0]}")
        if bool(before.get("requestBody")) != bool(after.get("requestBody")) and not launch_migration:
            errors.append(f"request body presence changed for {key[1].upper()} {key[0]}")
        if key in REVIEWED_REQUEST_ROUTES and not same_contract(
            schema_without_documentation(before.get("requestBody")), schema_without_documentation(after.get("requestBody")),
        ):
            errors.append(f"reviewed request body changed for {key[1].upper()} {key[0]}")
        before_codes = set(before.get("responses", {}).keys())
        after_codes = set(after.get("responses", {}).keys())
        if not before_codes.issubset(after_codes):
            errors.append(f"response codes removed for {key[1].upper()} {key[0]}")
    old_models = baseline.get("components", {}).get("schemas", {})
    new_models = current.get("components", {}).get("schemas", {})
    for name, reviewed in REVIEWED_REQUEST_MODELS.items():
        if name not in old_models:
            continue
        before_model = schema_without_documentation(old_models[name])
        after_model = schema_without_documentation(new_models.get(name))
        if not same_contract(before_model, after_model) and not same_contract(reviewed, after_model):
            errors.append(f"unreviewed request model change: {name}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, default=Path("backend/openapi-baseline.json"))
    parser.add_argument("--current", type=Path, default=Path("backend/openapi.json"))
    args = parser.parse_args()
    baseline_path = args.baseline if args.baseline.is_absolute() else ROOT / args.baseline
    current_path = args.current if args.current.is_absolute() else ROOT / args.current
    errors = compare(load(baseline_path), load(current_path))
    if errors:
        for error in errors:
            print(f"openapi_compat_error={error}", file=sys.stderr)
        return 1
    print(f"openapi_compatibility=verified operations={len(operations(load(current_path)))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
