"""Generate a deterministic Python constraints file from a pip JSON report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("backend/constraints-py312.txt"),
    )
    args = parser.parse_args()

    report = json.loads(args.report.read_text(encoding="utf-8"))
    installs: list[dict[str, Any]] = report.get("install", [])
    pins = {
        str(item["metadata"]["name"]).lower(): (
            str(item["metadata"]["name"]),
            str(item["metadata"]["version"]),
        )
        for item in installs
        if item.get("metadata", {}).get("name") and item.get("metadata", {}).get("version")
    }
    lines = [
        "# Generated for Python 3.12 from backend/requirements-dev.txt.",
        "# Regenerate from a pip --dry-run JSON report before intentional dependency updates.",
        "",
        *(f"{name}=={version}" for name, version in (pins[key] for key in sorted(pins))),
        "",
    ]
    output = args.output if args.output.is_absolute() else ROOT / args.output
    output.write_text("\n".join(lines), encoding="utf-8")
    print(f"python_constraints=written packages={len(pins)} path={output.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
