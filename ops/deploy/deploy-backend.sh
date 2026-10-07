#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE_PATH="${1:?archive path is required}"
EXPECTED_VERSION="${2:?expected version is required}"
EXPECTED_COMMIT="${3:?expected commit SHA is required}"
RELEASE_ID="${4:?release id is required}"
CONTROL_PLANE_URL="${5:?control-plane URL is required}"
[[ "${EXPECTED_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Invalid release version" >&2; exit 1; }
[[ "${EXPECTED_COMMIT}" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit SHA" >&2; exit 1; }
[[ "${RELEASE_ID}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid release id" >&2; exit 1; }
[[ "${CONTROL_PLANE_URL}" =~ ^https://[^/[:space:]]+(/[^[:space:]]*)?$ ]] || { echo "Invalid control-plane URL" >&2; exit 1; }
while [[ "${CONTROL_PLANE_URL}" == */ ]]; do CONTROL_PLANE_URL="${CONTROL_PLANE_URL%/}"; done
canonical_deployment_root() {
  local legacy="$1" current="$2" source="$1" resolved
  # Resolve the compatibility link once, before deriving any guarded paths.
  # An unexpected/dangling legacy link must fail, not fall back to another tree.
  if [[ ! -e "${legacy}" && ! -L "${legacy}" ]]; then source="${current}"; fi
  resolved="$(readlink -e -- "${source}")" || return 1
  [[ "${resolved}" == "${legacy}" || "${resolved}" == "${current}" ]] || {
    echo "Invalid deployment root: ${resolved}" >&2
    return 1
  }
  test -d "${resolved}" || return 1
  printf '%s\n' "${resolved}"
}

APP_ROOT="$(canonical_deployment_root /opt/amazon-toolbox /opt/kesaitong-platform)"
BACKEND_DIR="${APP_ROOT}/backend"
VENV_ROOT="${APP_ROOT}/venvs"
CURRENT_VENV="${APP_ROOT}/current-venv"
LEGACY_VENV="${BACKEND_DIR}/.venv"
UPDATE_ROOT="$(canonical_deployment_root /var/lib/amazon-toolbox /var/lib/kesaitong-platform)"
PUBLIC_UPDATES_DIR="${UPDATE_ROOT}/updates"
UPDATE_STAGING_DIR="${UPDATE_ROOT}/.updates-staging"
ATTACHMENT_DIR="${UPDATE_ROOT}/expense-attachments"
RELEASE_ENV="${UPDATE_ROOT}/release.env"
RESTORE_COMMAND="/usr/local/sbin/toolbox-restore-backup"
BACKUP_ROOT="${APP_ROOT}/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/pre-${EXPECTED_VERSION}-${STAMP}"
STAGING_DIR="$(mktemp -d /tmp/toolbox-deploy.XXXXXX)"
VENV_BUILD_DIR=""
VENV_BUILD_MARKER=""
VENV_MARKER_TMP=""
VENV_METADATA_TMP=""
CURRENT_VENV_LINK_TMP=""
DEPLOY_STARTED=0
BACKUP_COMPLETE=0
MIGRATION_STARTED=0

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

cleanup() {
  if [[ -n "${CURRENT_VENV_LINK_TMP}" ]]; then rm -f "${CURRENT_VENV_LINK_TMP}"; fi
  if [[ -n "${VENV_METADATA_TMP}" ]]; then rm -f "${VENV_METADATA_TMP}"; fi
  if [[ -n "${VENV_MARKER_TMP}" ]]; then rm -f "${VENV_MARKER_TMP}"; fi
  if [[ -n "${VENV_BUILD_DIR}" ]]; then
    rm -rf "${VENV_BUILD_DIR}"
    if [[ -n "${VENV_BUILD_MARKER}" ]]; then rm -f "${VENV_BUILD_MARKER}"; fi
  fi
  rm -rf "${STAGING_DIR}"
}

require_commands() {
  local missing=()
  local command_name
  for command_name in "$@"; do
    command -v "${command_name}" >/dev/null 2>&1 || missing+=("${command_name}")
  done
  if (( ${#missing[@]} > 0 )); then
    echo "Missing deployment tools: ${missing[*]}" >&2
    return 1
  fi
}

validate_venv_target() {
  local target
  target="$(readlink -e -- "$1")" || return 1
  [[ "${target}" == "${VENV_ROOT}/"* || "${target}" == "${LEGACY_VENV}" ]] || {
    echo "Invalid backend venv target: ${target}" >&2
    return 1
  }
  test -x "${target}/bin/python"
}

release_venv_is_complete() {
  [[ -d "${VENV_RELEASE_DIR}" && ! -L "${VENV_RELEASE_DIR}" ]] \
    && test -x "${VENV_RELEASE_DIR}/bin/python" \
    && [[ -f "${VENV_METADATA_FILE}" && ! -L "${VENV_METADATA_FILE}" ]] \
    && grep -Fxq "TOOLBOX_VERSION=${EXPECTED_VERSION}" "${VENV_METADATA_FILE}" \
    && grep -Fxq "TOOLBOX_COMMIT_SHA=${EXPECTED_COMMIT}" "${VENV_METADATA_FILE}" \
    && grep -Fxq "TOOLBOX_RELEASE_ID=${RELEASE_ID}" "${VENV_METADATA_FILE}"
}

validate_venv_build_marker() {
  [[ -f "${VENV_BUILD_MARKER}" && ! -L "${VENV_BUILD_MARKER}" ]] \
    && grep -Fxq "TOOLBOX_VERSION=${EXPECTED_VERSION}" "${VENV_BUILD_MARKER}" \
    && grep -Fxq "TOOLBOX_COMMIT_SHA=${EXPECTED_COMMIT}" "${VENV_BUILD_MARKER}" \
    && grep -Fxq "TOOLBOX_RELEASE_ID=${RELEASE_ID}" "${VENV_BUILD_MARKER}"
}

atomic_switch_current_venv() {
  local target
  target="$(readlink -e -- "$1")" || return 1
  validate_venv_target "${target}"
  [[ ! -e "${CURRENT_VENV}" || -L "${CURRENT_VENV}" ]] || {
    echo "${CURRENT_VENV} must be absent or a symbolic link" >&2
    return 1
  }
  CURRENT_VENV_LINK_TMP="${APP_ROOT}/.current-venv.${RELEASE_ID}.$$"
  [[ ! -e "${CURRENT_VENV_LINK_TMP}" && ! -L "${CURRENT_VENV_LINK_TMP}" ]] || {
    echo "Temporary venv link already exists: ${CURRENT_VENV_LINK_TMP}" >&2
    return 1
  }
  ln -s "${target}" "${CURRENT_VENV_LINK_TMP}"
  mv -Tf "${CURRENT_VENV_LINK_TMP}" "${CURRENT_VENV}"
  CURRENT_VENV_LINK_TMP=""
}

restore_current_venv() {
  local target_file="${BACKUP_DIR}/current-venv.target"
  if [[ -f "${target_file}" ]]; then
    local target
    IFS= read -r target <"${target_file}"
    validate_venv_target "${target}"
    atomic_switch_current_venv "${target}"
  elif [[ -f "${target_file}.missing" ]]; then
    [[ ! -e "${CURRENT_VENV}" || -L "${CURRENT_VENV}" ]] || return 1
    rm -f "${CURRENT_VENV}"
  fi
}

restore_file() {
  local backup_file="$1"
  local target_file="$2"
  local missing_marker="${backup_file}.missing"
  if [[ -f "${missing_marker}" ]]; then
    rm -f "${target_file}"
  elif [[ -f "${backup_file}" ]]; then
    cp -a "${backup_file}" "${target_file}"
  fi
}

rollback() {
  local exit_code=$?
  trap - ERR
  if [[ "${DEPLOY_STARTED}" -eq 1 ]]; then
    echo "Deployment failed; restoring ${BACKUP_DIR}" >&2
    if [[ "${MIGRATION_STARTED}" -eq 1 && "${BACKUP_COMPLETE}" -eq 1 ]]; then
      # Once Alembic has started, restoring only the old code can leave the
      # database at a revision the old schema gate rejects. Restore the
      # database, attachments, code and service configuration as one unit.
      bash "${STAGING_DIR}/ops/deploy/restore-backup.sh" "${BACKUP_DIR}" || {
        echo "Automatic database rollback failed; backup retained at ${BACKUP_DIR}" >&2
        cleanup
        exit "${exit_code}"
      }
      cleanup
      exit "${exit_code}"
    fi
    systemctl stop toolbox-backend || true
    rsync -a --delete "${BACKEND_PERSISTENT_EXCLUDES[@]}" \
      "${BACKUP_DIR}/backend/" "${BACKEND_DIR}/"
    cp -a "${BACKUP_DIR}/package.json" "${APP_ROOT}/package.json"
    restore_file "${BACKUP_DIR}/nginx-amazon-toolbox" "/etc/nginx/sites-enabled/amazon-toolbox"
    restore_file "${BACKUP_DIR}/nginx-toolbox-observability.conf" "/etc/nginx/conf.d/toolbox-observability.conf"
    restore_file "${BACKUP_DIR}/toolbox-backend.service" "/etc/systemd/system/toolbox-backend.service"
    restore_file "${BACKUP_DIR}/release.env" "${RELEASE_ENV}"
    restore_file "${BACKUP_DIR}/toolbox-restore-backup" "${RESTORE_COMMAND}"
    restore_current_venv || {
      echo "Automatic venv rollback failed; service remains stopped" >&2
      cleanup
      exit "${exit_code}"
    }
    systemctl daemon-reload || true
    nginx -t && systemctl reload nginx || true
    systemctl start toolbox-backend || true
  fi
  cleanup
  exit "${exit_code}"
}

trap rollback ERR
trap cleanup EXIT
umask 077

require_free_space() {
  local label="$1"
  local path="$2"
  local required_bytes="$3"
  local available_bytes
  available_bytes="$(df -PB1 "${path}" | awk 'NR == 2 {print $4}')"
  if [[ ! "${available_bytes}" =~ ^[0-9]+$ ]]; then
    echo "Unable to determine free space for ${label}: ${path}" >&2
    exit 1
  fi
  if (( available_bytes < required_bytes )); then
    echo "Insufficient disk space for ${label}: required=${required_bytes}, available=${available_bytes}, path=${path}" >&2
    exit 1
  fi
}

require_commands \
  awk bash chmod chown cp curl date df du find grep install ln mkdir mktemp mv \
  mysql mysqldump nginx python3 readlink rm rsync runuser seq sleep stat systemctl \
  tar touch
test -f "${ARCHIVE_PATH}"
test -f "${APP_ROOT}/package.json"
test -f "${BACKEND_DIR}/.env"

HAS_CURRENT_VENV=0
if [[ -L "${CURRENT_VENV}" ]]; then
  ACTIVE_VENV_DIR="$(readlink -f "${CURRENT_VENV}")"
  HAS_CURRENT_VENV=1
elif [[ -e "${CURRENT_VENV}" ]]; then
  echo "${CURRENT_VENV} must be a symbolic link" >&2
  exit 1
else
  ACTIVE_VENV_DIR="${LEGACY_VENV}"
fi
validate_venv_target "${ACTIVE_VENV_DIR}"
ACTIVE_VENV_PYTHON="${ACTIVE_VENV_DIR}/bin/python"
"${ACTIVE_VENV_PYTHON}" - "${BACKEND_DIR}/.env" <<'PY'
import re
import sys
from pathlib import Path

from dotenv import dotenv_values

config = dotenv_values(Path(sys.argv[1]))
required = ("MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE")
missing = [key for key in required if not config.get(key)]
if missing:
    raise RuntimeError(f"database backup configuration missing: {', '.join(missing)}")
for key in required:
    if "\n" in str(config[key]) or "\r" in str(config[key]):
        raise RuntimeError(f"database backup option contains a newline: {key}")
if not str(config["MYSQL_PORT"]).isdigit():
    raise RuntimeError("database backup port must be numeric")
database = str(config["MYSQL_DATABASE"])
if not re.fullmatch(r"[A-Za-z0-9_]+", database):
    raise RuntimeError("database backup name contains unsafe characters")
if database.lower() in {"information_schema", "mysql", "performance_schema", "sys"}:
    raise RuntimeError("database backup schema must be application-owned")
PY

mkdir -p "${BACKUP_ROOT}"
ARCHIVE_METRICS="$(python3 - "${ARCHIVE_PATH}" <<'PY'
import sys
import tarfile
from pathlib import Path, PurePosixPath

archive = Path(sys.argv[1]).resolve(strict=True)
if not archive.is_file():
    raise RuntimeError(f"deployment archive is not a file: {archive}")

unpacked_bytes = 0
with tarfile.open(archive, "r:gz") as package:
    for member in package.getmembers():
        member_path = PurePosixPath(member.name)
        if member_path.is_absolute() or ".." in member_path.parts:
            raise RuntimeError(f"unsafe deployment archive member: {member.name}")
        if member.issym() or member.islnk():
            raise RuntimeError(f"deployment archive links are not allowed: {member.name}")
        unpacked_bytes += max(member.size, 0)

print(archive.stat().st_size, unpacked_bytes)
PY
)"
read -r ARCHIVE_BYTES UNPACKED_BYTES <<<"${ARCHIVE_METRICS}"
CURRENT_BACKEND_BYTES="$(du -sb "${BACKEND_DIR}" | awk '{print $1}')"
ACTIVE_VENV_BYTES="$(du -sb "${ACTIVE_VENV_DIR}" | awk '{print $1}')"
ATTACHMENT_BYTES="$(du -sb "${ATTACHMENT_DIR}" 2>/dev/null | awk '{print $1}' || printf '0')"
DB_BACKUP_RESERVE_BYTES="${DEPLOY_DB_BACKUP_RESERVE_BYTES:-1073741824}"
for value in "${ARCHIVE_BYTES}" "${UNPACKED_BYTES}" "${CURRENT_BACKEND_BYTES}" "${ACTIVE_VENV_BYTES}" "${ATTACHMENT_BYTES}" "${DB_BACKUP_RESERVE_BYTES}"; do
  [[ "${value}" =~ ^[0-9]+$ ]] || { echo "Invalid deployment size metric: ${value}" >&2; exit 1; }
done

# /opt needs room for the code/database backup plus rsync temporary files.
# /tmp needs the archive's full uncompressed size plus extraction overhead.
BACKUP_REQUIRED_BYTES=$((CURRENT_BACKEND_BYTES + ACTIVE_VENV_BYTES + ATTACHMENT_BYTES + ARCHIVE_BYTES + DB_BACKUP_RESERVE_BYTES + 268435456))
STAGING_REQUIRED_BYTES=$((UNPACKED_BYTES + UNPACKED_BYTES / 4 + 134217728))
if [[ "$(stat -c %d "${BACKUP_ROOT}")" == "$(stat -c %d "${STAGING_DIR}")" ]]; then
  require_free_space "backup and archive extraction" "${BACKUP_ROOT}" "$((BACKUP_REQUIRED_BYTES + STAGING_REQUIRED_BYTES))"
else
  require_free_space "deployment backup" "${BACKUP_ROOT}" "${BACKUP_REQUIRED_BYTES}"
  require_free_space "archive extraction" "${STAGING_DIR}" "${STAGING_REQUIRED_BYTES}"
fi

tar -xzf "${ARCHIVE_PATH}" -C "${STAGING_DIR}"
test -f "${STAGING_DIR}/backend/main.py"
test -f "${STAGING_DIR}/package.json"
test -f "${STAGING_DIR}/ops/nginx/amazon-toolbox.conf"
test -f "${STAGING_DIR}/ops/systemd/toolbox-backend.service"
test -f "${STAGING_DIR}/ops/deploy/restore-backup.sh"
test -f "${STAGING_DIR}/backend/requirements.txt"
test -f "${STAGING_DIR}/backend/constraints-py310.txt"
test -f "${STAGING_DIR}/backend/alembic.ini"

# mktemp creates the staging root as root-only under umask 077. The release
# venv is deliberately built as the unprivileged toolbox account, so expose
# only the two dependency manifests and their parent traversal path to that
# account before invoking pip.
chown root:toolbox "${STAGING_DIR}" "${STAGING_DIR}/backend"
chmod 0750 "${STAGING_DIR}" "${STAGING_DIR}/backend"
chown root:toolbox \
  "${STAGING_DIR}/backend/requirements.txt" \
  "${STAGING_DIR}/backend/constraints-py310.txt"
chmod 0640 \
  "${STAGING_DIR}/backend/requirements.txt" \
  "${STAGING_DIR}/backend/constraints-py310.txt"
runuser -u toolbox -- test -r "${STAGING_DIR}/backend/requirements.txt"
runuser -u toolbox -- test -r "${STAGING_DIR}/backend/constraints-py310.txt"
# Application construction mounts this legacy static directory and creates it
# when absent. The Git archive intentionally does not track the empty folder,
# so provide a readable mount point without making staged source writable.
install -d -o root -g toolbox -m 0750 "${STAGING_DIR}/backend/updates"

VENV_RELEASE_DIR="${VENV_ROOT}/${EXPECTED_VERSION}-${RELEASE_ID}-${EXPECTED_COMMIT:0:12}"
VENV_METADATA_FILE="${VENV_RELEASE_DIR}/.toolbox-release"
VENV_BUILD_MARKER="${VENV_ROOT}/.${EXPECTED_VERSION}-${RELEASE_ID}-${EXPECTED_COMMIT:0:12}.building"
install -d -o root -g root -m 0755 "${VENV_ROOT}"
if [[ -e "${VENV_RELEASE_DIR}" || -L "${VENV_RELEASE_DIR}" ]]; then
  [[ -d "${VENV_RELEASE_DIR}" && ! -L "${VENV_RELEASE_DIR}" ]] || {
    echo "Invalid release venv path: ${VENV_RELEASE_DIR}" >&2
    exit 1
  }
  if ! release_venv_is_complete; then
    [[ "${ACTIVE_VENV_DIR}" != "${VENV_RELEASE_DIR}" ]]
    validate_venv_build_marker
    rm -rf "${VENV_RELEASE_DIR}"
  fi
fi
if [[ -e "${VENV_RELEASE_DIR}" ]]; then
  release_venv_is_complete
  # A previous interrupted release may have completed dependency installation
  # before permission normalization. Repair that immutable venv in place so a
  # resume can safely reuse it instead of failing under the toolbox account.
  chown -R root:root "${VENV_RELEASE_DIR}"
  chmod -R a+rX "${VENV_RELEASE_DIR}"
  runuser -u toolbox -- "${VENV_RELEASE_DIR}/bin/python" -m pip check
  if [[ -e "${VENV_BUILD_MARKER}" || -L "${VENV_BUILD_MARKER}" ]]; then
    validate_venv_build_marker
    rm -f "${VENV_BUILD_MARKER}"
  fi
else
  if [[ -e "${VENV_BUILD_MARKER}" || -L "${VENV_BUILD_MARKER}" ]]; then
    validate_venv_build_marker
  else
    VENV_MARKER_TMP="$(mktemp "${VENV_ROOT}/.toolbox-building.XXXXXX")"
    printf 'TOOLBOX_VERSION=%s\nTOOLBOX_COMMIT_SHA=%s\nTOOLBOX_RELEASE_ID=%s\n' \
      "${EXPECTED_VERSION}" "${EXPECTED_COMMIT}" "${RELEASE_ID}" \
      >"${VENV_MARKER_TMP}"
    chown root:root "${VENV_MARKER_TMP}"
    chmod 0600 "${VENV_MARKER_TMP}"
    mv -Tf "${VENV_MARKER_TMP}" "${VENV_BUILD_MARKER}"
    VENV_MARKER_TMP=""
  fi
  VENV_BUILD_DIR="${VENV_RELEASE_DIR}"
  install -d -o toolbox -g toolbox -m 0755 "${VENV_BUILD_DIR}"
  runuser -u toolbox -- python3 -m venv "${VENV_BUILD_DIR}"
  runuser -u toolbox -- "${VENV_BUILD_DIR}/bin/python" -m pip install \
    --disable-pip-version-check --no-cache-dir \
    -c "${STAGING_DIR}/backend/constraints-py310.txt" \
    -r "${STAGING_DIR}/backend/requirements.txt"
  chown -R root:root "${VENV_BUILD_DIR}"
  # umask 077 makes venv subdirectories private while toolbox owns them.
  # Once ownership moves to root, restore read/traverse access for the
  # unprivileged service user while keeping the environment non-writable.
  chmod -R a+rX "${VENV_BUILD_DIR}"
  runuser -u toolbox -- "${VENV_BUILD_DIR}/bin/python" -m pip check
  VENV_METADATA_TMP="$(mktemp "${VENV_RELEASE_DIR}/.toolbox-release.XXXXXX")"
  printf 'TOOLBOX_VERSION=%s\nTOOLBOX_COMMIT_SHA=%s\nTOOLBOX_RELEASE_ID=%s\n' \
    "${EXPECTED_VERSION}" "${EXPECTED_COMMIT}" "${RELEASE_ID}" \
    >"${VENV_METADATA_TMP}"
  chown root:root "${VENV_METADATA_TMP}"
  chmod 0644 "${VENV_METADATA_TMP}"
  mv -Tf "${VENV_METADATA_TMP}" "${VENV_METADATA_FILE}"
  VENV_METADATA_TMP=""
  rm -f "${VENV_BUILD_MARKER}"
  VENV_BUILD_DIR=""
fi
VENV_PYTHON="${VENV_RELEASE_DIR}/bin/python"
test -x "${VENV_PYTHON}"

# A dependency can be importable in the long-lived legacy environment while
# still being absent from requirements.txt. Import the complete application
# with only the new production venv before stopping the live service.
runuser -u toolbox -- "${VENV_PYTHON}" - \
  "${STAGING_DIR}/backend" "${BACKEND_DIR}/.env" <<'PY'
import importlib
import os
import sys
import tempfile
from pathlib import Path

from dotenv import dotenv_values

source_dir = Path(sys.argv[1]).resolve(strict=True)
config = dotenv_values(Path(sys.argv[2]))
for key, value in config.items():
    if value is not None:
        os.environ.setdefault(key, value)
with tempfile.TemporaryDirectory(prefix="toolbox-runtime-probe-") as runtime_dir:
    runtime_root = Path(runtime_dir)
    os.environ["TOOLBOX_RUNTIME_DIR"] = str(runtime_root / "runtime")
    os.environ["UPDATE_RELEASE_DIR"] = str(runtime_root / "updates")
    os.environ["EXPENSE_ATTACHMENT_DIR"] = str(runtime_root / "expense-attachments")
    os.chdir(source_dir)
    sys.path.insert(0, str(source_dir))
    importlib.import_module("main")
PY

mkdir -p "${BACKUP_DIR}/backend"
rsync -a "${BACKEND_PERSISTENT_EXCLUDES[@]}" \
  "${BACKEND_DIR}/" "${BACKUP_DIR}/backend/"
cp -a "${APP_ROOT}/package.json" "${BACKUP_DIR}/package.json"
cp -a "${BACKEND_DIR}/.env" "${BACKUP_DIR}/backend.env"
if [[ "${HAS_CURRENT_VENV}" -eq 1 ]]; then
  printf '%s\n' "${ACTIVE_VENV_DIR}" >"${BACKUP_DIR}/current-venv.target"
else
  touch "${BACKUP_DIR}/current-venv.target.missing"
fi

for pair in \
  "/etc/nginx/sites-enabled/amazon-toolbox:${BACKUP_DIR}/nginx-amazon-toolbox" \
  "/etc/nginx/conf.d/toolbox-observability.conf:${BACKUP_DIR}/nginx-toolbox-observability.conf" \
  "/etc/systemd/system/toolbox-backend.service:${BACKUP_DIR}/toolbox-backend.service" \
  "${RELEASE_ENV}:${BACKUP_DIR}/release.env" \
  "${RESTORE_COMMAND}:${BACKUP_DIR}/toolbox-restore-backup"
do
  source_file="${pair%%:*}"
  backup_file="${pair#*:}"
  if [[ -f "${source_file}" ]]; then
    cp -a "${source_file}" "${backup_file}"
  else
    touch "${backup_file}.missing"
  fi
done

# Freeze writes before taking the attachment and database snapshots. This
# guarantees that a restored expense row never points to a file absent from
# the matching attachment archive.
DEPLOY_STARTED=1
systemctl stop toolbox-backend

# Attachments live outside the replaceable application tree. Snapshot them so
# the database and its referenced files can be restored from the same backup.
if [[ -d "${ATTACHMENT_DIR}" ]]; then
  tar -czf "${BACKUP_DIR}/expense-attachments.tar.gz" \
    -C "${UPDATE_ROOT}" expense-attachments
else
  touch "${BACKUP_DIR}/expense-attachments.missing"
fi

"${ACTIVE_VENV_PYTHON}" - "${BACKEND_DIR}/.env" "${BACKUP_DIR}/database.sql.gz" <<'PY'
import gzip
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import dotenv_values

env_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
config = dotenv_values(env_path)
required = ("MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE")
missing = [key for key in required if not config.get(key)]
if missing:
    raise RuntimeError(f"database backup configuration missing: {', '.join(missing)}")
database = str(config["MYSQL_DATABASE"])
if not re.fullmatch(r"[A-Za-z0-9_]+", database):
    raise RuntimeError("database backup name contains unsafe characters")
if database.lower() in {"information_schema", "mysql", "performance_schema", "sys"}:
    raise RuntimeError("database backup schema must be application-owned")

def quote_option(value: object) -> str:
    text = str(value)
    if "\n" in text or "\r" in text:
        raise RuntimeError("database option contains a newline")
    return '"' + text.replace('\\', '\\\\').replace('"', '\\"') + '"'

defaults_path = None
try:
    with tempfile.NamedTemporaryFile("w", prefix="toolbox-mysqldump-", suffix=".cnf", delete=False) as defaults:
        defaults_path = defaults.name
        defaults.write("[client]\n")
        for key, option in (("MYSQL_HOST", "host"), ("MYSQL_PORT", "port"), ("MYSQL_USER", "user"), ("MYSQL_PASSWORD", "password")):
            defaults.write(f"{option}={quote_option(config[key])}\n")
    os.chmod(defaults_path, 0o600)
    command = [
        "mysqldump",
        f"--defaults-extra-file={defaults_path}",
        "--single-transaction",
        "--quick",
        "--skip-lock-tables",
        database,
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None
    with gzip.open(output_path, "wb") as compressed:
        while chunk := process.stdout.read(1024 * 1024):
            compressed.write(chunk)
    stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
    if process.wait() != 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError(f"database backup failed: {stderr.strip()}")
finally:
    if defaults_path:
        Path(defaults_path).unlink(missing_ok=True)
PY
BACKUP_COMPLETE=1

rsync -a --delete "${BACKEND_PERSISTENT_EXCLUDES[@]}" \
  --exclude='/tests/' \
  "${STAGING_DIR}/backend/" "${BACKEND_DIR}/"
cp -a "${STAGING_DIR}/package.json" "${APP_ROOT}/package.json"
chown -R toolbox:toolbox "${BACKEND_DIR}"
chmod 600 "${BACKEND_DIR}/.env"
# systemd ProtectSystem=strict cannot create a missing ReadWritePaths target.
# Materialize writable application directories before migration and startup.
install -d -o toolbox -g toolbox -m 0700 \
  "${BACKEND_DIR}/updates" \
  "${BACKEND_DIR}/runtime"
runuser -u toolbox -- test -w "${BACKEND_DIR}/updates"
runuser -u toolbox -- test -w "${BACKEND_DIR}/runtime"

# Keep public update artifacts outside the private application tree. Nginx can
# traverse/read only this release directory; the staging area stays private to
# the non-root backend service.
install -d -o toolbox -g www-data -m 0710 "${UPDATE_ROOT}"
install -d -o toolbox -g www-data -m 2750 "${PUBLIC_UPDATES_DIR}"
install -d -o toolbox -g toolbox -m 2700 "${UPDATE_STAGING_DIR}"
install -d -o toolbox -g toolbox -m 2700 "${ATTACHMENT_DIR}"
runuser -u toolbox -- test -w "${ATTACHMENT_DIR}"
if [[ -d "${BACKEND_DIR}/.updates-staging" ]] \
  && ! find "${UPDATE_STAGING_DIR}" -mindepth 2 -maxdepth 2 -name stage.json -print -quit \
    | grep -q .; then
  rsync -a --exclude='.release.lock' \
    "${BACKEND_DIR}/.updates-staging/" "${UPDATE_STAGING_DIR}/"
fi
if [[ ! -f "${PUBLIC_UPDATES_DIR}/latest.yml" && -d "${BACKEND_DIR}/updates" ]]; then
  rsync -a \
    --include='*.exe' \
    --include='*.blockmap' \
    --include='latest.yml' \
    --exclude='*' \
    "${BACKEND_DIR}/updates/" "${PUBLIC_UPDATES_DIR}/"
fi
chown -R toolbox:www-data "${PUBLIC_UPDATES_DIR}"
find "${PUBLIC_UPDATES_DIR}" -type d -exec chmod 2750 {} +
find "${PUBLIC_UPDATES_DIR}" -type f -exec chmod 0640 {} +
chown -R toolbox:toolbox "${UPDATE_STAGING_DIR}"
chmod 2700 "${UPDATE_STAGING_DIR}"

MIGRATION_STARTED=1
(
  cd "${BACKEND_DIR}"
  runuser -u toolbox -- "${VENV_PYTHON}" -m alembic upgrade head
)
atomic_switch_current_venv "${VENV_RELEASE_DIR}"

install -m 0644 "${STAGING_DIR}/ops/nginx/toolbox-observability.conf" \
  /etc/nginx/conf.d/toolbox-observability.conf
install -m 0644 "${STAGING_DIR}/ops/nginx/amazon-toolbox.conf" \
  /etc/nginx/sites-enabled/amazon-toolbox
install -m 0644 "${STAGING_DIR}/ops/systemd/toolbox-backend.service" \
  /etc/systemd/system/toolbox-backend.service
install -o root -g root -m 0750 "${STAGING_DIR}/ops/deploy/restore-backup.sh" \
  "${RESTORE_COMMAND}"
RELEASE_ENV_TMP="$(mktemp "${UPDATE_ROOT}/release.env.XXXXXX")"
printf 'TOOLBOX_COMMIT_SHA=%s\nTOOLBOX_RELEASE_ID=%s\n' \
  "${EXPECTED_COMMIT}" "${RELEASE_ID}" >"${RELEASE_ENV_TMP}"
chown root:toolbox "${RELEASE_ENV_TMP}"
chmod 0640 "${RELEASE_ENV_TMP}"
mv -f "${RELEASE_ENV_TMP}" "${RELEASE_ENV}"
systemctl daemon-reload
nginx -t

systemctl start toolbox-backend
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/health/live \
    | grep -q "\"version\":\"${EXPECTED_VERSION}\""; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8000/api/health/live \
  | grep -q "\"version\":\"${EXPECTED_VERSION}\""
curl -fsS http://127.0.0.1:8000/api/health/live \
  | grep -q "\"commit_sha\":\"${EXPECTED_COMMIT}\""
curl -fsS http://127.0.0.1:8000/api/health/live \
  | grep -q "\"release_id\":\"${RELEASE_ID}\""
curl -fsS http://127.0.0.1:8000/api/health/ready \
  | grep -q '"status":"ok"'

systemctl reload nginx
curl -fsS "${CONTROL_PLANE_URL}/api/health/live" \
  | grep -q "\"version\":\"${EXPECTED_VERSION}\""
if [[ -f "${PUBLIC_UPDATES_DIR}/latest.yml" ]]; then
  for _ in $(seq 1 10); do
    if curl -fsS "${CONTROL_PLANE_URL}/updates/latest.yml" >/dev/null; then
      break
    fi
    sleep 1
  done
  curl -fsS "${CONTROL_PLANE_URL}/updates/latest.yml" >/dev/null
fi

DEPLOY_STARTED=0
rm -f "${ARCHIVE_PATH}"
echo "deployment_version=${EXPECTED_VERSION}"
echo "deployment_commit=${EXPECTED_COMMIT}"
echo "release_id=${RELEASE_ID}"
echo "backup_dir=${BACKUP_DIR}"
