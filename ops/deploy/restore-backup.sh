#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/kesaitong-platform}"
BACKUP_ROOT="${APP_ROOT}/backups"
BACKUP_DIR="$(readlink -f "${1:?backup directory is required}")"
BACKEND_DIR="${APP_ROOT}/backend"
DATA_ROOT="${DATA_ROOT:-/var/lib/kesaitong-platform}"
ATTACHMENT_DIR="${DATA_ROOT}/expense-attachments"
VENV_ROOT="${APP_ROOT}/venvs"
CURRENT_VENV="${APP_ROOT}/current-venv"
LEGACY_VENV="${BACKEND_DIR}/.venv"
CURRENT_VENV_LINK_TMP=""
ATTACHMENT_STAGE=""
ATTACHMENT_PREVIOUS="${DATA_ROOT}/.expense-previous.$$"
RESTORE_IN_PROGRESS=0

BACKEND_PERSISTENT_EXCLUDES=(
  '--exclude=/.env'
  '--exclude=/updates/'
  '--exclude=/.updates-staging/'
  '--exclude=/chroma_db/'
  '--exclude=/runtime/'
  '--exclude=/uploads/'
  '--exclude=/logs/'
  '--exclude=/.venv/'
  '--exclude=__pycache__/'
)

require_commands() {
  local missing=()
  local command_name
  for command_name in "$@"; do
    command -v "${command_name}" >/dev/null 2>&1 || missing+=("${command_name}")
  done
  if (( ${#missing[@]} > 0 )); then
    echo "Missing restore tools: ${missing[*]}" >&2
    return 1
  fi
}

validate_venv_target() {
  local target="$1"
  [[ "${target}" == "${VENV_ROOT}/"* || "${target}" == "${LEGACY_VENV}" ]] || {
    echo "Invalid backend venv target: ${target}" >&2
    return 1
  }
  test -x "${target}/bin/python"
}

atomic_switch_current_venv() {
  local target="$1"
  validate_venv_target "${target}"
  [[ ! -e "${CURRENT_VENV}" || -L "${CURRENT_VENV}" ]] || {
    echo "${CURRENT_VENV} must be absent or a symbolic link" >&2
    return 1
  }
  CURRENT_VENV_LINK_TMP="${APP_ROOT}/.current-venv.restore.$$"
  [[ ! -e "${CURRENT_VENV_LINK_TMP}" && ! -L "${CURRENT_VENV_LINK_TMP}" ]] || return 1
  ln -s "${target}" "${CURRENT_VENV_LINK_TMP}"
  mv -Tf "${CURRENT_VENV_LINK_TMP}" "${CURRENT_VENV}"
  CURRENT_VENV_LINK_TMP=""
}

restore_failure() {
  local exit_code=$?
  trap - ERR
  if [[ "${RESTORE_IN_PROGRESS}" -eq 1 ]]; then
    systemctl stop toolbox-backend || true
    echo "Restore failed; toolbox-backend remains stopped. Backup retained at ${BACKUP_DIR}" >&2
    if [[ -n "${ATTACHMENT_PREVIOUS}" && -e "${ATTACHMENT_PREVIOUS}" ]]; then
      echo "Previous attachments retained at ${ATTACHMENT_PREVIOUS}" >&2
    fi
  fi
  if [[ -n "${CURRENT_VENV_LINK_TMP}" ]]; then rm -f "${CURRENT_VENV_LINK_TMP}"; fi
  if [[ -n "${ATTACHMENT_STAGE}" && -d "${ATTACHMENT_STAGE}" ]]; then rm -rf "${ATTACHMENT_STAGE}"; fi
  exit "${exit_code}"
}

[[ "${BACKUP_DIR}" == "${BACKUP_ROOT}/"* ]] || {
  echo "Backup must be inside ${BACKUP_ROOT}" >&2
  exit 1
}
test -d "${BACKUP_DIR}/backend"
test -f "${BACKUP_DIR}/package.json"
test -f "${BACKUP_DIR}/database.sql.gz"
test -f "${BACKUP_DIR}/backend.env"

require_commands chmod chown cp curl grep ln mkdir mktemp mv mysql nginx readlink rm rsync seq sleep systemctl tar

VENV_POINTER_ACTION="keep"
if [[ -f "${BACKUP_DIR}/current-venv.target" ]]; then
  IFS= read -r RESTORE_VENV_DIR <"${BACKUP_DIR}/current-venv.target"
  VENV_POINTER_ACTION="switch"
elif [[ -f "${BACKUP_DIR}/current-venv.target.missing" ]]; then
  RESTORE_VENV_DIR="${LEGACY_VENV}"
  VENV_POINTER_ACTION="remove"
elif [[ -f "${BACKUP_DIR}/toolbox-backend.service" ]]; then
  if grep -Eq 'ExecStart=/opt/(amazon-toolbox|kesaitong-platform)/backend/\.venv/bin/python' \
    "${BACKUP_DIR}/toolbox-backend.service"; then
    RESTORE_VENV_DIR="${LEGACY_VENV}"
    VENV_POINTER_ACTION="remove"
  elif grep -Eq 'ExecStart=/opt/(amazon-toolbox|kesaitong-platform)/current-venv/bin/python' \
    "${BACKUP_DIR}/toolbox-backend.service"; then
    echo "Backup is missing its current-venv target metadata" >&2
    exit 1
  else
    echo "Backup does not identify a restorable backend venv" >&2
    exit 1
  fi
else
  echo "Backup does not contain current-venv metadata" >&2
  exit 1
fi
validate_venv_target "${RESTORE_VENV_DIR}"
RESTORE_VENV_PYTHON="${RESTORE_VENV_DIR}/bin/python"
if [[ "${VENV_POINTER_ACTION}" != "keep" && -e "${CURRENT_VENV}" && ! -L "${CURRENT_VENV}" ]]; then
  echo "${CURRENT_VENV} must be absent or a symbolic link" >&2
  exit 1
fi
if [[ -L "${ATTACHMENT_DIR}" ]]; then
  echo "${ATTACHMENT_DIR} must not be a symbolic link" >&2
  exit 1
fi

"${RESTORE_VENV_PYTHON}" - "${BACKUP_DIR}/backend.env" <<'PY'
import re
import sys
from pathlib import Path

from dotenv import dotenv_values

config = dotenv_values(Path(sys.argv[1]))
required = ("MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE")
missing = [key for key in required if not config.get(key)]
if missing:
    raise RuntimeError(f"database restore configuration missing: {', '.join(missing)}")
for key in required:
    if "\n" in str(config[key]) or "\r" in str(config[key]):
        raise RuntimeError(f"database restore option contains a newline: {key}")
if not str(config["MYSQL_PORT"]).isdigit():
    raise RuntimeError("database restore port must be numeric")
database = str(config["MYSQL_DATABASE"])
if not re.fullmatch(r"[A-Za-z0-9_]+", database):
    raise RuntimeError("database restore name contains unsafe characters")
if database.lower() in {"information_schema", "mysql", "performance_schema", "sys"}:
    raise RuntimeError("database restore schema must be application-owned")
PY

if [[ -f "${BACKUP_DIR}/expense-attachments.tar.gz" ]]; then
  "${RESTORE_VENV_PYTHON}" - "${BACKUP_DIR}/expense-attachments.tar.gz" <<'PY'
import sys
import tarfile
from pathlib import Path, PurePosixPath

archive = Path(sys.argv[1]).resolve(strict=True)
with tarfile.open(archive, "r:gz") as package:
    for member in package.getmembers():
        name = PurePosixPath(member.name)
        if name.is_absolute() or ".." in name.parts or name.parts[:1] != ("expense-attachments",):
            raise RuntimeError(f"unsafe attachment archive member: {member.name}")
        if member.issym() or member.islnk():
            raise RuntimeError(f"attachment archive links are not allowed: {member.name}")
PY
fi
[[ ! -e "${ATTACHMENT_PREVIOUS}" && ! -L "${ATTACHMENT_PREVIOUS}" ]] || {
  echo "Temporary attachment path already exists: ${ATTACHMENT_PREVIOUS}" >&2
  exit 1
}

RESTORE_IN_PROGRESS=1
trap restore_failure ERR
systemctl stop toolbox-backend

rsync -a --delete "${BACKEND_PERSISTENT_EXCLUDES[@]}" \
  "${BACKUP_DIR}/backend/" "${BACKEND_DIR}/"
cp -a "${BACKUP_DIR}/package.json" "${APP_ROOT}/package.json"
cp -a "${BACKUP_DIR}/backend.env" "${BACKEND_DIR}/.env"

if [[ -f "${BACKUP_DIR}/expense-attachments.tar.gz" || -f "${BACKUP_DIR}/expense-attachments.missing" ]]; then
  ATTACHMENT_STAGE="$(mktemp -d "${DATA_ROOT}/.expense-restore.XXXXXX")"
  if [[ -f "${BACKUP_DIR}/expense-attachments.tar.gz" ]]; then
    tar -xzf "${BACKUP_DIR}/expense-attachments.tar.gz" -C "${ATTACHMENT_STAGE}"
  else
    mkdir -p "${ATTACHMENT_STAGE}/expense-attachments"
  fi
  test -d "${ATTACHMENT_STAGE}/expense-attachments"
  if [[ -d "${ATTACHMENT_DIR}" ]]; then mv "${ATTACHMENT_DIR}" "${ATTACHMENT_PREVIOUS}"; fi
  mv "${ATTACHMENT_STAGE}/expense-attachments" "${ATTACHMENT_DIR}"
  rm -rf "${ATTACHMENT_STAGE}"
  ATTACHMENT_STAGE=""
  chown -R toolbox:toolbox "${ATTACHMENT_DIR}"
  chmod 2700 "${ATTACHMENT_DIR}"
fi

"${RESTORE_VENV_PYTHON}" - "${BACKEND_DIR}/.env" "${BACKUP_DIR}/database.sql.gz" <<'PY'
import gzip
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import dotenv_values

config = dotenv_values(Path(sys.argv[1]))
required = ("MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE")
missing = [key for key in required if not config.get(key)]
if missing:
    raise RuntimeError(f"database restore configuration missing: {', '.join(missing)}")

defaults_path = None
try:
    with tempfile.NamedTemporaryFile("w", prefix="toolbox-mysql-", suffix=".cnf", delete=False) as defaults:
        defaults_path = defaults.name
        defaults.write("[client]\n")
        for key, option in (("MYSQL_HOST", "host"), ("MYSQL_PORT", "port"), ("MYSQL_USER", "user"), ("MYSQL_PASSWORD", "password")):
            value = str(config[key])
            if "\n" in value or "\r" in value:
                raise RuntimeError("database option contains a newline")
            escaped = value.replace("\\", "\\\\").replace('"', '\\"')
            defaults.write(f'{option}="{escaped}"\n')
    Path(defaults_path).chmod(0o600)

    database = str(config["MYSQL_DATABASE"])
    if not re.fullmatch(r"[A-Za-z0-9_]+", database):
        raise RuntimeError("database restore name contains unsafe characters")
    if database.lower() in {"information_schema", "mysql", "performance_schema", "sys"}:
        raise RuntimeError("database restore schema must be application-owned")
    mysql = [
        "mysql",
        f"--defaults-extra-file={defaults_path}",
        "--default-character-set=utf8mb4",
    ]

    # Validate the complete compressed stream before changing the live schema.
    # Passing a gzip.GzipFile directly as subprocess stdin is unsafe because
    # Popen consumes its underlying file descriptor and therefore sends the
    # compressed bytes to mysql instead of the decompressed SQL stream.
    with gzip.open(sys.argv[2], "rb") as source:
        while source.read(1024 * 1024):
            pass

    objects = subprocess.run(
        mysql
        + [
            "--batch",
            "--skip-column-names",
            "--raw",
            "--execute=SELECT TABLE_TYPE, HEX(TABLE_NAME) "
            "FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA = DATABASE() "
            "AND TABLE_TYPE IN ('BASE TABLE', 'SYSTEM VERSIONED', 'VIEW') "
            "ORDER BY TABLE_TYPE = 'VIEW' DESC, TABLE_NAME",
            database,
        ],
        stdout=subprocess.PIPE,
        check=True,
    ).stdout.decode("ascii")

    views: list[str] = []
    tables: list[str] = []
    for row in objects.splitlines():
        table_type, encoded_name = row.split("\t", 1)
        name = bytes.fromhex(encoded_name).decode("utf-8")
        identifier = "`" + name.replace("`", "``") + "`"
        if table_type == "VIEW":
            views.append(identifier)
        elif table_type in {"BASE TABLE", "SYSTEM VERSIONED"}:
            tables.append(identifier)
        else:
            raise RuntimeError(f"unexpected database object type: {table_type}")

    reset_sql = ["SET FOREIGN_KEY_CHECKS=0;"]
    if views:
        reset_sql.append(f"DROP VIEW IF EXISTS {', '.join(views)};")
    if tables:
        reset_sql.append(f"DROP TABLE IF EXISTS {', '.join(tables)};")
    reset_sql.append("SET FOREIGN_KEY_CHECKS=1;")
    command = mysql + [database]
    subprocess.run(command, input="\n".join(reset_sql).encode("utf-8"), check=True)
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    assert process.stdin is not None
    stream_error = None
    try:
        try:
            with gzip.open(sys.argv[2], "rb") as source:
                while chunk := source.read(1024 * 1024):
                    process.stdin.write(chunk)
        except BrokenPipeError as error:
            stream_error = error
        finally:
            try:
                process.stdin.close()
            except BrokenPipeError as error:
                stream_error = stream_error or error
    except BaseException:
        if process.poll() is None:
            process.kill()
        process.wait()
        raise
    return_code = process.wait()
    if return_code != 0:
        raise subprocess.CalledProcessError(return_code, command) from stream_error
    if stream_error is not None:
        raise stream_error
finally:
    if defaults_path:
        Path(defaults_path).unlink(missing_ok=True)
PY

for pair in \
  "${BACKUP_DIR}/nginx-amazon-toolbox:/etc/nginx/sites-enabled/amazon-toolbox" \
  "${BACKUP_DIR}/nginx-toolbox-observability.conf:/etc/nginx/conf.d/toolbox-observability.conf" \
  "${BACKUP_DIR}/toolbox-backend.service:/etc/systemd/system/toolbox-backend.service" \
  "${BACKUP_DIR}/release.env:${DATA_ROOT}/release.env" \
  "${BACKUP_DIR}/toolbox-restore-backup:/usr/local/sbin/toolbox-restore-backup"
do
  source_file="${pair%%:*}"
  target_file="${pair#*:}"
  if [[ -f "${source_file}.missing" ]]; then
    rm -f "${target_file}"
  elif [[ -f "${source_file}" ]]; then
    cp -a "${source_file}" "${target_file}"
  fi
done

case "${VENV_POINTER_ACTION}" in
  switch)
    atomic_switch_current_venv "${RESTORE_VENV_DIR}"
    ;;
  remove)
    [[ ! -e "${CURRENT_VENV}" || -L "${CURRENT_VENV}" ]]
    rm -f "${CURRENT_VENV}"
    ;;
  keep)
    ;;
  *)
    echo "Invalid venv pointer action: ${VENV_POINTER_ACTION}" >&2
    false
    ;;
esac

chown -R toolbox:toolbox "${BACKEND_DIR}"
chmod 600 "${BACKEND_DIR}/.env"
systemctl daemon-reload
nginx -t
systemctl start toolbox-backend
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/health/ready | grep -q '"status":"ok"'; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8000/api/health/ready | grep -q '"status":"ok"'
systemctl reload nginx
if [[ -e "${ATTACHMENT_PREVIOUS}" ]]; then rm -rf "${ATTACHMENT_PREVIOUS}"; fi
RESTORE_IN_PROGRESS=0
trap - ERR
echo "restored_backup=${BACKUP_DIR}"
