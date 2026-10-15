"""Offline website handoff checks: no requests, live database or activation."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

from schemas.commercial import PublicOffer

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("check_public_catalog", ROOT / "scripts/check_public_catalog.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


def stamp(items):
    encoded = json.dumps({"items": items}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {"schema_version": 1, "catalog_version": hashlib.sha256(encoded.encode()).hexdigest()[:16], "items": items}


def catalog():
    offer = PublicOffer(sku="isolated-public-test", version=1, name="测试商品", price="12.34", business_line="training",
                        term_type="project_end", allowed_capabilities=["freight.quote"],
                        services=[{"code": "diagnosis", "count": 1}], description="仅测试夹具", availability="consult")
    return stamp([offer.model_dump(mode="json")])


def test_valid_snapshot_and_matching_copy():
    snapshot = catalog()
    assert checker.validate_snapshot(snapshot) == snapshot
    assert checker.compare_snapshots(snapshot, copy.deepcopy(snapshot)) == []


@pytest.mark.parametrize("field,value", [("count", True), ("count", "1"), ("minutes_per_unit", False)])
def test_public_entitlements_do_not_coerce_boolean_or_string_counts(field, value):
    raw = catalog()
    raw["items"][0]["services"][0][field] = value
    with pytest.raises(checker.CatalogValidationError):
        checker.validate_snapshot(stamp(raw["items"]))


@pytest.mark.parametrize("field,value", [
    ("version", 2), ("price", "12.35"), ("allowed_capabilities", []),
    ("services", []), ("availability", "available"), ("description", "不同文案"),
])
def test_each_public_field_change_is_detected(field, value):
    original = catalog()
    changed = copy.deepcopy(original["items"])
    changed[0][field] = value
    assert field in checker.compare_snapshots(original, stamp(changed))


def test_term_change_and_sku_set_are_detected():
    original = catalog()
    changed = copy.deepcopy(original["items"])
    changed[0].update(business_line="service", term_type="service_fulfillment", allowed_capabilities=[])
    assert "term_type" in checker.compare_snapshots(original, stamp(changed))
    changed[0]["sku"] = "another-test"
    assert "SKU 集合" in checker.compare_snapshots(original, stamp(changed))


@pytest.mark.parametrize("location", ["root", "item", "service"])
def test_unknown_sensitive_fields_rejected_without_echo(location):
    raw = catalog()
    target = raw if location == "root" else raw["items"][0] if location == "item" else raw["items"][0]["services"][0]
    target["internal_member_fee"] = "DO-NOT-ECHO-THIS-PRIVATE-VALUE"
    with pytest.raises(checker.CatalogValidationError) as failure:
        checker.validate_snapshot(raw)
    assert "PRIVATE-VALUE" not in str(failure.value)


def test_duplicate_sku_and_version_mismatch_rejected():
    raw = catalog()
    with pytest.raises(checker.CatalogValidationError, match="重复 SKU"):
        checker.validate_snapshot(stamp(raw["items"] * 2))
    raw["items"][0]["price"] = "12.35"
    with pytest.raises(checker.CatalogValidationError, match="catalog_version"):
        checker.validate_snapshot(raw)
    raw = catalog()
    raw["schema_version"] = 2
    with pytest.raises(checker.CatalogValidationError):
        checker.validate_snapshot(raw)


def test_missing_export_fields_and_numeric_money_rejected():
    raw = catalog()
    del raw["items"][0]["description"]
    with pytest.raises(checker.CatalogValidationError, match="白名单"):
        checker.validate_snapshot(raw)
    raw = catalog()
    raw["items"][0]["price"] = 12.34
    with pytest.raises(checker.CatalogValidationError, match="字符串"):
        checker.validate_snapshot(raw)


def test_file_size_duplicate_json_keys_and_nonfinite_rejected(tmp_path):
    path = tmp_path / "snapshot.json"
    path.write_bytes(b" " * (checker.MAX_SNAPSHOT_BYTES + 1))
    with pytest.raises(checker.CatalogValidationError, match="2 MiB"):
        checker.load_snapshot(path)
    path.write_text('{"schema_version":1,"schema_version":1}', encoding="utf-8")
    with pytest.raises(checker.CatalogValidationError, match="重复字段"):
        checker.load_snapshot(path)
    path.write_text('{"items": NaN}', encoding="utf-8")
    with pytest.raises(checker.CatalogValidationError, match="NaN"):
        checker.load_snapshot(path)


def test_cli_exit_codes_and_reject_admin_envelope(tmp_path, capsys):
    left = tmp_path / "platform.json"
    right = tmp_path / "website.json"
    raw = catalog()
    left.write_text(json.dumps(raw), encoding="utf-8")
    right.write_text(json.dumps(raw), encoding="utf-8")
    assert checker.main(["validate", str(left)]) == 0
    assert checker.main(["compare", str(left), str(right)]) == 0
    changed = copy.deepcopy(raw["items"])
    changed[0]["price"] = "12.35"
    right.write_text(json.dumps(stamp(changed)), encoding="utf-8")
    assert checker.main(["compare", str(left), str(right)]) == 1
    right.write_text(json.dumps({"success": True, "data": raw}), encoding="utf-8")
    assert checker.main(["validate", str(right)]) == 2
    assert "拒绝" in capsys.readouterr().err


def test_empty_export_does_not_create_or_activate_products():
    raw = stamp([])
    assert checker.validate_snapshot(raw)["items"] == []
