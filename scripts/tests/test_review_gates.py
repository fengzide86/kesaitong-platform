"""Isolated regression tests for secret and differential-coverage gates."""
import importlib.util
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("comment", ["localhost", "example", "os.getenv", "127.0.0.1", "placeholder"])
def test_unrelated_safe_comment_never_hides_literal(comment):
    audit = load_script("audit_secrets")
    key = "audit-" + "not-real-value"
    assert audit.suspicious_lines(f'api_key = "{key}" # {comment}') == [1]


def test_placeholder_is_value_scoped_and_json_is_covered():
    audit = load_script("audit_secrets")
    assert audit.suspicious_lines('api_key = "replace-with-your-value"') == []
    assert audit.suspicious_lines('{"api_key": "audit-not-real-value", "host": "localhost"}') == [1]
    assert audit.suspicious_lines('api_key = os.getenv("SERVICE_KEY")') == []


def test_new_vue_mjs_and_unicode_paths_are_included(monkeypatch):
    audit = load_script("audit_secrets")
    calls = []
    def git(*args):
        calls.append(args)
        return "src/新文件.vue\0scripts/new.mjs\0data.png\0.env.example\0"
    monkeypatch.setattr(audit, "git", git)
    assert audit.tracked_files() == [".env.example", "scripts/new.mjs", "src/新文件.vue"]
    assert "--others" in calls[0] and "-z" in calls[0]


def test_fixture_allowlist_is_exact_path_and_value():
    audit = load_script("audit_secrets")
    literal = 'api_key = "audit-not-real-value"'
    assert audit.suspicious_lines(literal, "scripts/tests/test_review_gates.py") == []
    assert audit.suspicious_lines(literal, "src/new.vue") == [1]
    other = "another-" + "inert-audit-value"
    assert audit.suspicious_lines(literal + f'; jwt_secret_key = "{other}"',
                                  "scripts/tests/test_review_gates.py") == [1]


def test_constraints_validate_version_not_only_presence(tmp_path):
    gate = load_script("check_python_constraint_closure")
    pinned = tmp_path / "constraints.txt"
    pinned.write_text("some_package==1.2.3\n", encoding="utf-8")
    assert gate.constraint_pins(pinned) == {"some-package": "1.2.3"}


@pytest.mark.parametrize("report_lines,expected", [({}, 1), ({1: 1}, 1), ({1: 1, 2: 1}, 0)])
def test_missing_file_or_changed_statement_fails_closed(tmp_path, monkeypatch, report_lines, expected):
    gate = load_script("check_diff_coverage")
    (tmp_path / "backend").mkdir()
    (tmp_path / "backend/new.py").write_text("first = 1\nsecond = 2\n", encoding="utf-8")
    monkeypatch.setattr(gate, "ROOT", tmp_path)
    monkeypatch.setattr(gate, "changed_lines", lambda *a, **k: {"backend/new.py": {1, 2}})
    monkeypatch.setattr(gate, "executable_lines", lambda p: {"backend/new.py": report_lines} if report_lines else {})
    monkeypatch.setattr(sys, "argv", ["check_diff_coverage.py"])
    assert gate.main() == expected


def test_comments_only_do_not_require_fake_coverage(tmp_path, monkeypatch):
    gate = load_script("check_diff_coverage")
    (tmp_path / "backend").mkdir()
    (tmp_path / "backend/comments.py").write_text("# explanation only\n", encoding="utf-8")
    monkeypatch.setattr(gate, "ROOT", tmp_path)
    monkeypatch.setattr(gate, "changed_lines", lambda *a, **k: {"backend/comments.py": {1}})
    monkeypatch.setattr(gate, "executable_lines", lambda p: {})
    monkeypatch.setattr(sys, "argv", ["check_diff_coverage.py"])
    assert gate.main() == 0


@pytest.mark.parametrize(("quoted", "decoded"), [
    ('"b/backend/\\346\\226\\260.py"', "b/backend/新.py"),
    ('"b/backend/中文\\tline\\n.py"', "b/backend/中文\tline\n.py"),
    ('"b/backend/quote\\\"back\\\\slash.py"', 'b/backend/quote"back\\slash.py'),
    ("b/backend/with spaces.py\t", "b/backend/with spaces.py"),
])
def test_git_c_quoted_paths_decode_utf8_and_special_characters(quoted, decoded):
    assert load_script("check_diff_coverage").decode_git_path(quoted) == decoded


@pytest.mark.parametrize("quoted", ['"unterminated', '"bad\\q.py"', '"bad\\777.py"', '"ok.py"unexpected'])
def test_malformed_quoted_path_fails_closed(quoted):
    with pytest.raises(ValueError):
        load_script("check_diff_coverage").decode_git_path(quoted)


@pytest.mark.parametrize("quote_paths", ["true", "false"])
@pytest.mark.parametrize("working_tree", [False, True])
def test_real_git_special_paths_cannot_escape_coverage(tmp_path, monkeypatch, quote_paths, working_tree):
    """Exercise real Git output, not a fabricated path list or mocked parser."""
    gate = load_script("check_diff_coverage")
    environment = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}

    def git(*arguments):
        return subprocess.run(
            ["git", "-c", "user.name=Isolated Coverage Test", "-c", "user.email=fixture@example.invalid",
             "-c", "commit.gpgsign=false", *arguments], cwd=tmp_path, env=environment,
            check=True, capture_output=True, text=True, encoding="utf-8",
        ).stdout

    git("init", "-q")
    git("config", "core.quotePath", quote_paths)
    (tmp_path / "backend").mkdir()
    (tmp_path / "backend/seed.py").write_text("seed = 1\n", encoding="utf-8")
    git("add", ".")
    git("commit", "-qm", "fixture baseline")
    baseline = git("rev-parse", "HEAD").strip()
    filenames = ["backend/中文.py", "backend/目录 with space/金额 计算.py", "backend/square[1]#%^&.py"]
    if os.name != "nt":
        # Windows forbids these names; Linux CI exercises them through Git too.
        filenames.extend(['backend/quote".py', "backend/tab\tline\n.py", "backend/back\\slash.py"])
    for filename in filenames:
        source = tmp_path / filename
        source.parent.mkdir(exist_ok=True)
        source.write_text("value = 1\n", encoding="utf-8")
    if not working_tree:
        git("add", ".")
        git("commit", "-qm", "fixture changed files")
        raw = git("diff", "--unified=0", f"{baseline}...HEAD", "--", "backend")
        if quote_paths == "true":
            assert '+++ "b/backend/' in raw and "\\" in raw
    monkeypatch.setattr(gate, "ROOT", tmp_path)
    assert gate.changed_lines(baseline, working_tree=working_tree) == {filename: {1} for filename in filenames}

    report = tmp_path / "coverage.xml"
    coverage = ET.Element("coverage")
    ET.ElementTree(coverage).write(report, encoding="utf-8")
    arguments = ["check_diff_coverage.py", "--base", baseline, "--report", str(report)]
    if working_tree:
        arguments.append("--working-tree")
    monkeypatch.setattr(sys, "argv", arguments)
    assert gate.main() == 1  # Empty report must fail for every real path above.
    for filename in filenames:
        entry = ET.SubElement(coverage, "class", filename=filename.removeprefix("backend/"))
        ET.SubElement(ET.SubElement(entry, "lines"), "line", number="1", hits="1")
    ET.ElementTree(coverage).write(report, encoding="utf-8")
    assert gate.main() == 0
    if not working_tree:
        # Existing (not only newly added) quoted paths must retain exact new
        # line numbers. Previously measured line 1 cannot cover new line 2.
        modification_base = git("rev-parse", "HEAD").strip()
        for filename in filenames:
            (tmp_path / filename).write_text("value = 1\nsecond = 2\n", encoding="utf-8")
        git("add", ".")
        git("commit", "-qm", "fixture modified paths")
        assert gate.changed_lines(modification_base) == {filename: {2} for filename in filenames}
        monkeypatch.setattr(sys, "argv", ["check_diff_coverage.py", "--base", modification_base, "--report", str(report)])
        assert gate.main() == 1
        for entry in coverage.findall("class"):
            ET.SubElement(entry.find("lines"), "line", number="2", hits="1")
        ET.ElementTree(coverage).write(report, encoding="utf-8")
        assert gate.main() == 0


def test_hunk_content_does_not_replace_destination_header(tmp_path, monkeypatch):
    gate = load_script("check_diff_coverage")
    from types import SimpleNamespace
    raw = 'diff --git a/backend/one.py b/backend/one.py\n+++ b/backend/one.py\n@@ -0,0 +1,4 @@\n+text = """\n+++ b/backend/fake.py\n+"""\n+value = 1\n'
    monkeypatch.setattr(gate.subprocess, "run", lambda *a, **kw: SimpleNamespace(stdout=raw))
    assert gate.changed_lines("HEAD") == {"backend/one.py": {1, 2, 3, 4}}
