#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE_PATH="${1:?web archive path is required}"
EXPECTED_VERSION="${2:?expected version is required}"
EXPECTED_COMMIT="${3:?expected commit SHA is required}"
RELEASE_ID="${4:?release id is required}"
CONTROL_PLANE_URL="${5:?control plane URL is required}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL%/}"
[[ "${EXPECTED_COMMIT}" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit SHA" >&2; exit 1; }
[[ "${RELEASE_ID}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid release id" >&2; exit 1; }
python3 - "${CONTROL_PLANE_URL}" <<'PY'
import sys
from urllib.parse import urlsplit

parsed = urlsplit(sys.argv[1])
if parsed.scheme != "https" or not parsed.hostname:
    raise RuntimeError("control plane URL must be an absolute HTTPS URL")
if parsed.username or parsed.password or parsed.query or parsed.fragment:
    raise RuntimeError("control plane URL must not contain credentials, query, or fragment")
PY

# Keep this in sync with the Nginx root; legacy paths remain server-side aliases.
WEB_ROOT="/var/lib/kesaitong-platform/web"
RELEASES_DIR="${WEB_ROOT}/releases"
ASSETS_DIR="${WEB_ROOT}/assets"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
CURRENT_LINK="${WEB_ROOT}/current"
STAGING_DIR=""
PUBLIC_VERSION_FILE=""
PREVIOUS_TARGET="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
ACTIVATED=0

cleanup() {
  if [[ -n "${STAGING_DIR}" && -d "${STAGING_DIR}" ]]; then rm -rf "${STAGING_DIR}"; fi
  if [[ -n "${PUBLIC_VERSION_FILE}" ]]; then rm -f "${PUBLIC_VERSION_FILE}"; fi
}

rollback() {
  local exit_code=$?
  trap - ERR
  if [[ "${ACTIVATED}" -eq 1 ]]; then
    if [[ -n "${PREVIOUS_TARGET}" && -d "${PREVIOUS_TARGET}" ]]; then
      ln -sfn "${PREVIOUS_TARGET}" "${WEB_ROOT}/.current-rollback"
      mv -Tf "${WEB_ROOT}/.current-rollback" "${CURRENT_LINK}"
    else
      rm -f "${CURRENT_LINK}"
    fi
  fi
  cleanup
  exit "${exit_code}"
}

trap rollback ERR
trap cleanup EXIT
umask 077

install -d -o toolbox -g www-data -m 0710 "${WEB_ROOT}"
install -d -o toolbox -g www-data -m 2750 "${RELEASES_DIR}"
install -d -o toolbox -g www-data -m 2750 "${ASSETS_DIR}"
STAGING_DIR="$(mktemp -d "${WEB_ROOT}/.stage-${RELEASE_ID}.XXXXXX")"

python3 - "${ARCHIVE_PATH}" <<'PY'
import sys
import tarfile
from pathlib import Path, PurePosixPath

archive = Path(sys.argv[1]).resolve(strict=True)
with tarfile.open(archive, "r:gz") as package:
    for member in package.getmembers():
        name = PurePosixPath(member.name)
        if name.is_absolute() or ".." in name.parts or member.issym() or member.islnk():
            raise RuntimeError(f"unsafe web archive member: {member.name}")
PY

tar -xzf "${ARCHIVE_PATH}" -C "${STAGING_DIR}"
test -f "${STAGING_DIR}/index.html"
test -f "${STAGING_DIR}/web-version.json"
grep -Fq "\"version\":\"${EXPECTED_VERSION}\"" "${STAGING_DIR}/web-version.json"
grep -Fq "\"commitSha\":\"${EXPECTED_COMMIT}\"" "${STAGING_DIR}/web-version.json"

if [[ -d "${RELEASE_DIR}" ]]; then
  diff -qr "${STAGING_DIR}" "${RELEASE_DIR}" >/dev/null || {
    echo "Release id already exists with different files: ${RELEASE_ID}" >&2
    exit 1
  }
else
  mv "${STAGING_DIR}" "${RELEASE_DIR}"
  STAGING_DIR=""
fi
chown -R toolbox:www-data "${RELEASE_DIR}"
find "${RELEASE_DIR}" -type d -exec chmod 2750 {} +
find "${RELEASE_DIR}" -type f -exec chmod 0640 {} +

# Hashed assets are content-addressed and shared across retained releases.
# Keeping old hashes reachable lets an already-open page lazy-load a chunk
# after `current` switches, without forcing a refresh during active editing.
test -d "${RELEASE_DIR}/assets"
rsync -a --ignore-existing "${RELEASE_DIR}/assets/" "${ASSETS_DIR}/"
while IFS= read -r -d '' source_asset; do
  relative_asset="${source_asset#${RELEASE_DIR}/assets/}"
  cmp -s "${source_asset}" "${ASSETS_DIR}/${relative_asset}" || {
    echo "Hashed Web asset collision: ${relative_asset}" >&2
    exit 1
  }
done < <(find "${RELEASE_DIR}/assets" -type f -print0)
chown -R toolbox:www-data "${ASSETS_DIR}"
find "${ASSETS_DIR}" -type d -exec chmod 2750 {} +
find "${ASSETS_DIR}" -type f -exec chmod 0640 {} +

FIRST_HASHED_ASSET_URL="$(python3 - "${RELEASE_DIR}/index.html" "${CONTROL_PLANE_URL}" <<'PY'
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

index_path = Path(sys.argv[1])
control_url = sys.argv[2].rstrip("/") + "/"
control = urlsplit(control_url)
hashed_asset = re.compile(
    r"/assets/(?:[^/?#]+/)*[^/?#]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$",
    re.IGNORECASE,
)


def origin(parsed):
    default_port = 443 if parsed.scheme == "https" else 80
    return parsed.scheme.lower(), (parsed.hostname or "").lower(), parsed.port or default_port


class FirstHashedAsset(HTMLParser):
    def __init__(self):
        super().__init__()
        self.url = None

    def handle_starttag(self, _tag, attrs):
        if self.url:
            return
        for name, value in attrs:
            if name not in {"src", "href"} or not value:
                continue
            candidate = urlsplit(urljoin(control_url, value))
            if origin(candidate) == origin(control) and hashed_asset.search(candidate.path):
                self.url = candidate.geturl()
                return


parser = FirstHashedAsset()
parser.feed(index_path.read_text(encoding="utf-8"))
if not parser.url:
    raise RuntimeError("index.html does not reference a hashed Web asset")
print(parser.url)
PY
)"

ln -sfn "${RELEASE_DIR}" "${WEB_ROOT}/.current-${RELEASE_ID}"
mv -Tf "${WEB_ROOT}/.current-${RELEASE_ID}" "${CURRENT_LINK}"
ACTIVATED=1

test "$(readlink -f "${CURRENT_LINK}")" = "$(readlink -f "${RELEASE_DIR}")"
grep -Fq "\"releaseId\":\"${RELEASE_ID}\"" "${CURRENT_LINK}/web-version.json"

PUBLIC_VERSION_FILE="$(mktemp "${WEB_ROOT}/.public-web-version.XXXXXX")"
PUBLIC_WEB_OK=0
for _ in $(seq 1 10); do
  if curl -fsS --connect-timeout 10 --max-time 30 \
      "${CONTROL_PLANE_URL}/web-version.json?release_id=${RELEASE_ID}" \
      -o "${PUBLIC_VERSION_FILE}" \
    && python3 - "${PUBLIC_VERSION_FILE}" "${EXPECTED_VERSION}" "${EXPECTED_COMMIT}" "${RELEASE_ID}" \
      >/dev/null 2>&1 <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
expected = {
    "version": sys.argv[2],
    "commitSha": sys.argv[3],
    "releaseId": sys.argv[4],
}
if any(payload.get(key) != value for key, value in expected.items()):
    raise RuntimeError("public web-version.json does not match the activated release")
PY
  then
    if curl -fsS --connect-timeout 10 --max-time 30 \
        "${FIRST_HASHED_ASSET_URL}" -o /dev/null; then
      PUBLIC_WEB_OK=1
      break
    fi
  fi
  sleep 1
done
if [[ "${PUBLIC_WEB_OK}" -ne 1 ]]; then
  echo "Public Web activation verification failed; rolling back ${RELEASE_ID}" >&2
  false
fi

ACTIVATED=0
rm -f "${ARCHIVE_PATH}"
echo "web_version=${EXPECTED_VERSION}"
echo "web_commit=${EXPECTED_COMMIT}"
echo "release_id=${RELEASE_ID}"
echo "verified_asset=${FIRST_HASHED_ASSET_URL}"
echo "previous_web_release=${PREVIOUS_TARGET}"
