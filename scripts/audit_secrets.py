"""Audit tracked files (and optionally Git history) without printing secret values."""
from __future__ import annotations

import argparse
import ipaddress
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

PATTERNS = [
    re.compile(r"(?i)(?:server_password|ssh_password)['\"]?\s*[:=]\s*['\"](?P<value>[^'\"]{6,})['\"]"),
    re.compile(r"(?i)(?:mysql_password|jwt_secret_key|api_key)['\"]?\s*[:=]\s*['\"](?P<value>[^'\"]{8,})['\"]"),
    re.compile(r"(?i)authorization['\"]?\s*[:=]\s*['\"]?bearer\s+(?P<value>[a-z0-9._-]{20,})"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"https?://\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[^\s'\"<>`;，；）]*)"),
]
# Only the matched value can be a placeholder, never an unrelated comment or
# another field on its line. No blanket exemption for test files or Vue files.
PLACEHOLDER_VALUE = re.compile(r"(?i)(?:replace[-_]with[-_][a-z0-9_-]+|your_[a-z0-9_-]+|example[-_][a-z0-9_-]+|placeholder|test[-_](?:secret|key|password|token)(?:[-_][a-z0-9_-]+)?)\Z")
AUDITED_SUFFIXES = {
    ".py", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".vue", ".html",
    ".json", ".yml", ".yaml", ".env", ".bat", ".ps1", ".sh", ".toml", ".txt", ".md",
}
KNOWN_EXPIRED_HISTORY_PATHS = {"admin_token.txt"}
APPROVED_PUBLIC_ENDPOINTS = (
    "https://8.130.113.104",
    "http://8.130.113.104:*",  # Existing development CSP, not an account endpoint.
)
DOCUMENTATION_NETWORKS = tuple(ipaddress.ip_network(value) for value in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"))
# Reviewed inert test values only, scoped to their exact source file. An actual
# secret elsewhere on the same line/file still fails; no wildcard path skips.
APPROVED_TEST_VALUES = {
    "backend/tests/core/test_logging_redaction.py": {"private-bearer-value", "private-jwt-value", "private-db-value"},
    "scripts/verify_mariadb_upgrade.py": {"isolated-migration-rehearsal-not-for-production-only"},
    "scripts/tests/test_review_gates.py": {"audit-not-real-value"},
}


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True, encoding="utf-8", errors="replace")


def suspicious_lines(content: str, file: str = "") -> list[int]:
    hits = []
    for number, line in enumerate(content.splitlines(), 1):
        suspicious = False
        for pattern in PATTERNS:
            for match in pattern.finditer(line):
                value = match.groupdict().get("value")
                if value and PLACEHOLDER_VALUE.fullmatch(value):
                    continue
                if value and value in APPROVED_TEST_VALUES.get(file.replace("\\", "/"), set()):
                    continue
                if match.group().startswith(("http://", "https://")):
                    try:
                        endpoint = urlsplit(match.group())
                    except ValueError:
                        suspicious = True
                        continue
                    if endpoint.hostname in {"127.0.0.1", "localhost"}:
                        continue
                    try:
                        if any(ipaddress.ip_address(endpoint.hostname or "") in network for network in DOCUMENTATION_NETWORKS):
                            continue
                    except ValueError:
                        pass
                    if f"{endpoint.scheme}://{endpoint.netloc}" in APPROVED_PUBLIC_ENDPOINTS:
                        continue
                suspicious = True
        if suspicious:
            hits.append(number)
    return hits


def tracked_files() -> list[str]:
    files = set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0"))
    return sorted(file for file in files if file and (
        Path(file).suffix.lower() in AUDITED_SUFFIXES or Path(file).name.startswith(".env")
    ))


def audit_revision(revision: str, files: list[str]) -> list[tuple[str, int]]:
    findings = []
    for file in files:
        try:
            content = git("show", f"{revision}:{file}") if revision != "WORKTREE" else Path(file).read_text(encoding="utf-8", errors="replace")
        except (subprocess.CalledProcessError, OSError):
            continue
        findings.extend((file, line) for line in suspicious_lines(content, file))
    return findings


def audit_history_revision(revision: str) -> list[tuple[str, int]]:
    expression = (
        r"(server_password|ssh_password|mysql_password|jwt_secret_key|api_key)"
        r"[[:space:]]*=[[:space:]]*['\"][^'\"]{6,}['\"]"
        r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"
        r"|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY"
    )
    command = [
        "git", "grep", "-n", "-I", "-i", "-E", expression, revision, "--",
        *(f"*{suffix}" for suffix in sorted(AUDITED_SUFFIXES)), ".env*",
    ]
    result = subprocess.run(command, text=True, encoding="utf-8", errors="replace", capture_output=True)
    findings = []
    for raw in result.stdout.splitlines():
        try:
            _commit, file, line, content = raw.split(":", 3)
        except ValueError:
            continue
        if file.startswith(".clinerules/") or file in KNOWN_EXPIRED_HISTORY_PATHS:
            continue
        if not suspicious_lines(content, file):
            continue
        findings.append((file, int(line)))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", action="store_true")
    args = parser.parse_args()
    files = tracked_files()
    findings = [("WORKTREE", *hit) for hit in audit_revision("WORKTREE", files)]
    if args.history:
        unique_history = {}
        for revision in git("rev-list", "--all").splitlines():
            for file, line in audit_history_revision(revision):
                unique_history.setdefault((file, line), revision)
        findings.extend((revision, file, line) for (file, line), revision in unique_history.items())

    for revision, file, line in findings:
        print(f"{revision[:12]} {file}:{line}")
    print(f"secret_findings={len(findings)}")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
