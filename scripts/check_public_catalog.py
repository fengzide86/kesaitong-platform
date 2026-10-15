"""Validate/compare exported public product snapshots without network or database access.

Input is the `data` object from the explicitly exported public catalog, not an
admin offer list or an HTTP envelope. No draft activation or price defaults.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(ROOT / "backend"))

from schemas.commercial import IncludedService, PublicCatalogResponse, PublicOffer

MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024


class CatalogValidationError(ValueError):
    """A rejected public artifact, with no file values echoed in diagnostics."""


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise CatalogValidationError("JSON 对象包含重复字段")
        result[key] = value
    return result


def _reject_constant(_value: str) -> None:
    raise CatalogValidationError("JSON 不允许 NaN 或 Infinity")


def _exact_fields(value: dict[str, Any], model: type[PublicCatalogResponse | PublicOffer | IncludedService]) -> None:
    # Use the existing response contract as the only public whitelist. Require
    # all export fields explicitly; do not fill missing fields with defaults.
    if set(value) != set(model.model_fields):
        raise CatalogValidationError("快照字段不符合公开导出白名单；未知或遗漏字段均不可发布")


def validate_snapshot(raw: Any) -> dict[str, Any]:
    try:
        PublicCatalogResponse.model_validate(raw)
    except (ValidationError, TypeError, ValueError, RecursionError) as error:
        # Do not print validation_error input values: a rejected file may
        # contain internal prices, member names or credentials.
        raise CatalogValidationError("快照不符合 PublicCatalogResponse 合同，或包含未知/内部字段") from error
    _exact_fields(raw, PublicCatalogResponse)
    skus: set[str] = set()
    for item in raw["items"]:
        _exact_fields(item, PublicOffer)
        if not isinstance(item["sku"], str) or not item["sku"].strip() or type(item["version"]) is not int or item["version"] < 1:
            raise CatalogValidationError("商品稳定编号与正整数版本必填")
        if item["sku"] in skus:
            raise CatalogValidationError("公开快照包含重复 SKU，不能同时发布多个商品版本")
        skus.add(item["sku"])
        if not isinstance(item["price"], str):
            raise CatalogValidationError("公开价格必须使用精确十进制字符串")
        for service in item["services"]:
            _exact_fields(service, IncludedService)
            if type(service["count"]) is not int or type(service["minutes_per_unit"]) is not int:
                raise CatalogValidationError("服务次数和分钟数必须为 JSON 整数，不接受布尔值或字符串")
    if type(raw["schema_version"]) is not int or raw["schema_version"] != 1:
        raise CatalogValidationError("公开快照 schema_version 不受支持")
    encoded = json.dumps({"items": raw["items"]}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    expected = hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:16]
    if raw["catalog_version"] != expected:
        raise CatalogValidationError("catalog_version 与商品快照内容不匹配，不能使用过期或伪造的目录版本")
    return raw


def load_snapshot(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as stream:
            # One bounded read also handles a file that grows after stat().
            content = stream.read(MAX_SNAPSHOT_BYTES + 1)
        if len(content) > MAX_SNAPSHOT_BYTES:
            raise CatalogValidationError("公开快照超过 2 MiB 文件上限")
        raw = json.loads(content.decode("utf-8-sig"), object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
        raise CatalogValidationError("无法读取有效 UTF-8 JSON 公开快照") from error
    return validate_snapshot(raw)


def compare_snapshots(platform: dict[str, Any], website: dict[str, Any]) -> list[str]:
    validate_snapshot(platform)
    validate_snapshot(website)
    differences: list[str] = []
    for key in ("schema_version", "catalog_version"):
        if platform[key] != website[key]:
            differences.append(key)
    left = {item["sku"]: item for item in platform["items"]}
    right = {item["sku"]: item for item in website["items"]}
    if left.keys() != right.keys():
        differences.append("SKU 集合")
    for sku in left.keys() & right.keys():
        # Every whitelisted field matters, including copy/availability. The
        # comparison is exact and does not reinterpret money or reorder rights.
        for field in PublicOffer.model_fields:
            if left[sku][field] != right[sku][field] and field not in differences:
                differences.append(field)
    return sorted(differences)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="离线核验平台与官网公开商品目录；不会发布、激活或连接线上")
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="核验单个已导出的公开商品快照")
    validate.add_argument("snapshot", type=Path)
    compare = commands.add_parser("compare", help="核验两份快照并要求版本和商品内容完全一致")
    compare.add_argument("platform", type=Path)
    compare.add_argument("website", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "validate":
            snapshot = load_snapshot(args.snapshot)
        else:
            snapshot = load_snapshot(args.platform)
            differences = compare_snapshots(snapshot, load_snapshot(args.website))
            if differences:
                print("目录不一致：" + "、".join(differences), file=sys.stderr)
                return 1
        print(f"公开目录核验通过：schema={snapshot['schema_version']} catalog={snapshot['catalog_version']} items={len(snapshot['items'])}")
        return 0
    except CatalogValidationError as error:
        print(f"公开目录拒绝：{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
