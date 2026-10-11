"""Require changed executable Python lines to meet a coverage threshold."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from coverage.parser import PythonParser

ROOT = Path(__file__).resolve().parents[1]
HUNK = re.compile(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def decode_git_path(value: str) -> str:
    """Decode Git's C-quoted UTF-8 path, including octal bytes and controls.

    Turning off core.quotePath is insufficient: quotes, backslashes and control
    characters are still quoted. Do not treat literal backslashes in POSIX file
    names as directory separators.
    """
    if not value.startswith('"'):
        # A tab terminates an unquoted patch filename; literal tabs are quoted.
        return value.partition("\t")[0]
    decoded = bytearray()
    escapes = {"a": 7, "b": 8, "t": 9, "n": 10, "v": 11, "f": 12, "r": 13, '"': 34, "\\": 92}
    index = 1
    while index < len(value):
        character = value[index]
        if character == '"':
            if value[index + 1:] not in {"", "\t"}:
                raise ValueError("Unexpected data after a quoted Git path")
            return decoded.decode("utf-8")
        if character != "\\":
            decoded.extend(character.encode("utf-8"))
            index += 1
            continue
        index += 1
        if index >= len(value):
            break
        character = value[index]
        if character in escapes:
            decoded.append(escapes[character])
            index += 1
        elif character in "01234567":
            octal = value[index:index + 3]
            if len(octal) != 3 or any(digit not in "01234567" for digit in octal) or int(octal, 8) > 255:
                raise ValueError("Invalid octal byte in Git path")
            decoded.append(int(octal, 8))
            index += 3
        else:
            raise ValueError("Unknown escape in Git path")
    raise ValueError("Unterminated quoted Git path")


def changed_lines(base: str, *, working_tree: bool = False) -> dict[str, set[int]]:
    diff_target = base if working_tree else f"{base}...HEAD"
    result = subprocess.run(
        ["git", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--unified=0",
         "--src-prefix=a/", "--dst-prefix=b/", diff_target, "--", "backend"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
    )
    current: str | None = None
    in_hunk = False
    lines: dict[str, set[int]] = {}
    for raw in result.stdout.splitlines():
        if raw.startswith("diff --git "):
            current = None
            in_hunk = False
            continue
        if not in_hunk and raw.startswith("+++ "):
            path = decode_git_path(raw[4:])
            if path == "/dev/null":
                current = None
            elif path.startswith("b/backend/"):
                current = path[2:]
            else:
                raise ValueError("Unexpected destination path in backend diff")
            continue
        match = HUNK.match(raw)
        if not match:
            continue
        in_hunk = True
        start = int(match.group(1))
        count = int(match.group(2) or "1")
        if count:
            if current is None:
                raise ValueError("Changed lines have no readable destination path")
            lines.setdefault(current, set()).update(range(start, start + count))
    if working_tree:
        untracked = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard", "-z", "--", "backend"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="strict",
        )
        for filename in untracked.stdout.split("\0"):
            path = ROOT / filename
            if path.suffix == ".py" and path.is_file():
                line_count = len(path.read_text(encoding="utf-8").splitlines())
                lines.setdefault(filename, set()).update(range(1, line_count + 1))
    return lines


def executable_lines(report: Path) -> dict[str, dict[int, int]]:
    root = ET.parse(report).getroot()
    result: dict[str, dict[int, int]] = {}
    for class_node in root.findall(".//class"):
        filename = class_node.get("filename") or ""
        if os.name == "nt":
            filename = filename.replace("\\", "/")
        if not filename:
            continue
        if not filename.startswith("backend/"):
            filename = f"backend/{filename}"
        result[filename] = {
            int(line.get("number", "0")): int(line.get("hits", "0"))
            for line in class_node.findall("./lines/line")
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="HEAD^")
    parser.add_argument("--report", type=Path, default=Path("backend/coverage.xml"))
    parser.add_argument("--threshold", type=float, default=80.0)
    parser.add_argument(
        "--working-tree",
        action="store_true",
        help="compare the current tracked working tree to --base (local verification)",
    )
    args = parser.parse_args()

    report = args.report if args.report.is_absolute() else ROOT / args.report
    changed = changed_lines(args.base, working_tree=args.working_tree)
    coverage = executable_lines(report)
    total = covered = 0
    missed: list[str] = []
    missing_measurements: list[str] = []
    for filename, changed_file_lines in sorted(changed.items()):
        if not filename.endswith(".py") or "/tests/" in filename or "/alembic/versions/" in filename:
            continue
        source = ROOT / filename
        if not source.is_file():
            # Deleted files produce no new-side lines. An enumerated file that
            # vanished or was misparsed must not silently leave the denominator.
            print(f"missing_changed_source={filename}", file=sys.stderr)
            return 1
        syntax = PythonParser(filename=str(source), exclude=r"#\s*pragma:\s*no\s*cover")
        syntax.parse_source()
        expected = changed_file_lines & syntax.statements
        measured = coverage.get(filename, {})
        missing_measurements.extend(f"{filename}:{number}" for number in sorted(expected - measured.keys()))
        for line_number in sorted(expected):
            total += 1
            if measured.get(line_number, 0) > 0:
                covered += 1
            else:
                missed.append(f"{filename}:{line_number}")
    percent = 100.0 if total == 0 else covered * 100.0 / total
    print(f"python_diff_coverage={percent:.2f}% covered={covered} executable_changed={total}")
    if missing_measurements:
        for item in missing_measurements[:50]:
            print(f"missing_coverage_measurement={item}", file=sys.stderr)
        return 1
    if percent < args.threshold:
        for item in missed[:50]:
            print(f"uncovered_changed_line={item}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
