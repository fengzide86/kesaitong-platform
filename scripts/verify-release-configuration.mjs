import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8')
const requireText = (filename, patterns) => {
  const source = read(filename)
  const missing = patterns.filter(pattern => !source.includes(pattern))
  if (missing.length) throw new Error(`${filename} is missing release invariants: ${missing.join(', ')}`)
}
const requireCount = (filename, pattern, minimum) => {
  const source = read(filename)
  const count = source.split(pattern).length - 1
  if (count < minimum) throw new Error(`${filename} must contain ${pattern} at least ${minimum} times (found ${count})`)
}
const rejectText = (filename, patterns) => {
  const source = read(filename)
  const forbidden = patterns.filter(pattern => source.includes(pattern))
  if (forbidden.length) throw new Error(`${filename} contains forbidden release patterns: ${forbidden.join(', ')}`)
}
const requireOrder = (filename, patterns) => {
  const source = read(filename)
  let cursor = -1
  for (const pattern of patterns) {
    const next = source.indexOf(pattern, cursor + 1)
    if (next < 0) throw new Error(`${filename} is missing ordered release invariant: ${pattern}`)
    cursor = next
  }
}
const expectedPersistentExcludes = [
  '--exclude=/.env',
  '--exclude=/updates/',
  '--exclude=/.updates-staging/',
  '--exclude=/chroma_db/',
  '--exclude=/runtime/',
  '--exclude=/uploads/',
  '--exclude=/logs/',
  '--exclude=/.venv/',
  '--exclude=__pycache__/',
]
const requirePersistentExcludes = filename => {
  const source = read(filename)
  const block = /BACKEND_PERSISTENT_EXCLUDES=\(\s*([\s\S]*?)\s*\)/.exec(source)?.[1]
  if (!block) throw new Error(`${filename} must define BACKEND_PERSISTENT_EXCLUDES`)
  const actual = [...block.matchAll(/^\s*'([^']+)'\s*$/gm)].map(match => match[1])
  if (JSON.stringify(actual) !== JSON.stringify(expectedPersistentExcludes)) {
    throw new Error(`${filename} has an unsafe persistent rsync exclude set: ${actual.join(', ')}`)
  }
}

const metadata = JSON.parse(read('package.json'))
if (!metadata.scripts?.['verify:release']) throw new Error('package.json must expose verify:release')
if (metadata.scripts?.['release:mariadb-gate'] !== 'node scripts/verify-release-mariadb-gate.mjs') {
  throw new Error('package.json must expose the guarded release:mariadb-gate')
}
if (!metadata.scripts['verify:release'].includes('npm run release:mariadb-gate')) {
  throw new Error('verify:release must include release:mariadb-gate')
}
if (metadata.scripts['verify:release'].includes('npm run test:mariadb:required')) {
  throw new Error('verify:release must route MariaDB through release:mariadb-gate')
}
if (!metadata.scripts['verify:release'].includes('npm run test:e2e:real')) {
  throw new Error('verify:release must execute isolated actual-backend journeys')
}
requireText('.github/workflows/test.yml', ['Real backend C B Admin journeys', 'node scripts/prepare-nsis-upgrade.mjs', 'test-results/nsis/**'])
requireCount('.github/workflows/test.yml', 'name: local-renderer-dist', 3)
rejectText('.github/workflows/test.yml', ['name: web-dist', 'Build web bundle'])
requireText('scripts/toolbox-cli.mjs', ["'Real backend C B Admin journeys'"])
requireText('package.json', ['node scripts/bundle-electron-preload.mjs'])
if (!metadata.scripts['test:coverage'].startsWith('npm run electron:compile && ')) {
  throw new Error('test:coverage must build the current sandbox preload before testing it')
}

requireText('.gitattributes', [
  '*.sh text eol=lf',
  'ops/** text eol=lf',
])
requireText('scripts/toolbox-cli.mjs', [
  "run('npm', ['run', 'verify:release'],",
  "['prepared', 'backend_deployed', 'desktop_published', 'verified']",
  'const RELEASE_SCHEMA_VERSION = 2',
  'validateReleaseState(state, releaseId)',
  'await verifyRetiredWeb(baseUrl)',
  'await verifyRetiredWeb(state.controlUrl)',
  'await verifyDesktopDownloadRange(state)',
  "'archive'",
  "'--format=tar.gz'",
  "output('tar', ['-xOf', archive, shellScript])",
  '提交归档的 Linux 脚本包含 CRLF',
  "gitOutput(['rev-parse', 'origin/main'])",
  "gitOutput(['ls-remote', '--tags', 'origin', 'refs/tags/v*'])",
  "'--hostname', 'github.com'",
  'check.head_sha !== commitSha',
  "path.join(directory, 'production-release.lock')",
  "process.env.ProgramData || 'C:\\\\ProgramData'",
  'acquireProductionReleaseLock(',
  'acquireRemoteReleaseLease(state, connection)',
  'assertRemoteReleaseLease(state, connection)',
  'releaseRemoteReleaseLease(state, connection)',
  "const REMOTE_PRODUCTION_LEASE = '/var/lib/amazon-toolbox/release-control/production.lease'",
  'const REMOTE_PRODUCTION_LEASE_GUARD = `${REMOTE_PRODUCTION_LEASE}.guard`',
  'remoteLeaseGuardedCommand(state, deployCommand)',
  'remoteLeaseGuardedCommand(state, publishCommand)',
  'current_session=',
  'flock -x 9',
  'verifyResumeCheckpoints(state)',
  'verifyArtifactRecord(state.artifacts.backend)',
  "'ops/deploy/retire-web.py'",
  "'ops/web-retired/sw.js'",
  "gitOutput(['show-ref', '--verify', '--hash', `refs/tags/${tag}`])",
  'lockedPreflight = await productionPreflight(',
  'artifactsPrepared: false',
  'controlUrl: preflight.controlUrl',
  'leaseToken: crypto.randomUUID()',
  '/current-venv/bin/python',
  'TOOLBOX_CI_ATTESTED_SHA',
  "ciAttestedSha !== state.commitSha",
  "parsed.protocol !== 'https:'",
  '生产发布禁止 --skip-verify 和 --skip-build',
])
requireCount('scripts/toolbox-cli.mjs', 'shellQuote(state.releaseId), shellQuote(state.controlUrl)', 1)
requireCount('scripts/toolbox-cli.mjs', 'remoteLeaseGuardedCommand(state, deployCommand)', 1)
requireCount('scripts/toolbox-cli.mjs', 'await verifyRetiredWeb(baseUrl)', 2)
rejectText('scripts/toolbox-cli.mjs', [
  '.venv/bin/python scripts/publish_update.py',
  'deploy-web.sh',
  "run('npm', ['run', 'build:web'])",
  'function createWebArtifact(',
  'function publishWeb(',
])
requireText('scripts/verify-release-mariadb-gate.mjs', [
  "const headSha = commandOutput('git', ['rev-parse', 'HEAD'])",
  "attestedSha === headSha",
  "commandOutput('gh', [",
  "'--hostname', 'github.com'",
  'MariaDB migrations and concurrency',
  "required.conclusion === 'success'",
  'required.head_sha === commitSha',
  "delete environment.TOOLBOX_CI_ATTESTED_SHA",
  "'npm run test:mariadb:required'",
])
requireText('backend/Dockerfile', ['constraints-py310.txt', '-c /tmp/requirements/constraints-py310.txt'])
requireText('backend/requirements.txt', ['httpx==0.27.2'])
rejectText('backend/requirements-dev.txt', ['httpx=='])
requireText('backend/constraints-py310.txt', [
  'async-timeout==5.0.1',
  'exceptiongroup==1.3.1',
])
requireText('backend/start.bat', ['"%PYTHON%" -c "import main"'])
requireText('scripts/check_python_constraint_closure.py', [
  'installed distributions missing exact constraints',
  'BOOTSTRAP_DISTRIBUTIONS',
])
requireText('.github/workflows/test.yml', [
  'Verify production dependency closure in a clean venv',
  '-r backend/requirements.txt',
  '-m pip check',
  'scripts/check_python_constraint_closure.py',
  "-c 'import aiomysql, alembic, httpx, main, pymysql'",
])
requireText('compose.yaml', [
  'EXPENSE_ATTACHMENT_DIR: /var/lib/amazon-toolbox/expense-attachments',
  'toolbox_expense_attachments:/var/lib/amazon-toolbox/expense-attachments',
])
requireText('ops/systemd/toolbox-backend.service', [
  'EnvironmentFile=-/var/lib/amazon-toolbox/release.env',
  'Environment=TOOLBOX_RUNTIME_DIR=/opt/amazon-toolbox/backend/runtime',
  'ReadWritePaths=-/var/lib/amazon-toolbox/expense-attachments',
  'ReadWritePaths=-/opt/amazon-toolbox/backend/runtime',
  'ReadWritePaths=-/opt/amazon-toolbox/backend/chroma_db',
  'ExecStart=/opt/amazon-toolbox/current-venv/bin/python',
])
requireText('ops/nginx/amazon-toolbox.conf', [
  'location ^~ /api/',
  'https://kesaitong.top/#',
  'location = /web-version.json',
  'location /updates/',
  'location = /sw.js',
  'return 410',
])
rejectText('ops/nginx/amazon-toolbox.conf', [
  'root /var/lib/amazon-toolbox/web/current;',
  'try_files $uri $uri/ /index.html',
])
if (fs.existsSync(path.join(root, 'ops/deploy/deploy-web.sh'))) throw new Error('Retired Web publisher must not remain executable in the repository')
requireText('ops/deploy/deploy-backend.sh', [
  '"${STAGING_DIR}/ops/deploy/retire-web.py"',
  '--control-plane-url "${CONTROL_PLANE_URL}" --install-policy',
  '"${UPDATE_ROOT}/web-retirement.json"',
  '"${UPDATE_ROOT}/web-retired/nginx.conf"',
  'BACKUP_COMPLETE=1',
  'MIGRATION_STARTED=1',
  'restore-backup.sh',
  'CONTROL_PLANE_URL="${5:?control-plane URL is required}"',
  'VENV_RELEASE_DIR="${VENV_ROOT}/${EXPECTED_VERSION}-${RELEASE_ID}-${EXPECTED_COMMIT:0:12}"',
  'VENV_BUILD_MARKER="${VENV_ROOT}/.${EXPECTED_VERSION}-${RELEASE_ID}-${EXPECTED_COMMIT:0:12}.building"',
  'VENV_MARKER_TMP="$(mktemp "${VENV_ROOT}/.toolbox-building.XXXXXX")"',
  'mv -Tf "${VENV_METADATA_TMP}" "${VENV_METADATA_FILE}"',
  'atomic_switch_current_venv "${VENV_RELEASE_DIR}"',
  'current-venv.target',
  'mv -Tf',
  '"${ACTIVE_VENV_PYTHON}" - "${BACKEND_DIR}/.env"',
  'database backup schema must be application-owned',
  '"${CONTROL_PLANE_URL}/api/health/live"',
  'chown root:toolbox "${STAGING_DIR}" "${STAGING_DIR}/backend"',
  'chmod 0750 "${STAGING_DIR}" "${STAGING_DIR}/backend"',
  'runuser -u toolbox -- test -r "${STAGING_DIR}/backend/requirements.txt"',
  'runuser -u toolbox -- test -r "${STAGING_DIR}/backend/constraints-py310.txt"',
  'install -d -o root -g toolbox -m 0750 "${STAGING_DIR}/backend/updates"',
  'chmod -R a+rX "${VENV_BUILD_DIR}"',
  'runuser -u toolbox -- "${VENV_BUILD_DIR}/bin/python" -m pip check',
  'chmod -R a+rX "${VENV_RELEASE_DIR}"',
  'runuser -u toolbox -- "${VENV_RELEASE_DIR}/bin/python" -m pip check',
  'with tempfile.TemporaryDirectory(prefix="toolbox-runtime-probe-") as runtime_dir:',
  'os.environ["UPDATE_RELEASE_DIR"] = str(runtime_root / "updates")',
  'os.environ["EXPENSE_ATTACHMENT_DIR"] = str(runtime_root / "expense-attachments")',
  'importlib.import_module("main")',
  '"${BACKEND_DIR}/runtime"',
  'runuser -u toolbox -- test -w "${BACKEND_DIR}/runtime"',
])
requireText('ops/deploy/restore-backup.sh', [
  '"${DATA_ROOT}/web-retirement.json"',
  '"${DATA_ROOT}/web-retired/nginx.conf"',
  'trap restore_failure ERR',
  'Restore failed; toolbox-backend remains stopped.',
  '"${RESTORE_VENV_PYTHON}" - "${BACKEND_DIR}/.env"',
  "ExecStart=/opt/amazon-toolbox/backend/.venv/bin/python",
  'database restore schema must be application-owned',
  'DROP VIEW IF EXISTS',
  'DROP TABLE IF EXISTS',
  'current-venv.target',
  'mv -Tf',
  'process = subprocess.Popen(command, stdin=subprocess.PIPE)',
  'while chunk := source.read(1024 * 1024):',
])
requireCount('ops/deploy/deploy-backend.sh', '"${BACKEND_PERSISTENT_EXCLUDES[@]}"', 3)
requireCount('ops/deploy/restore-backup.sh', '"${BACKEND_PERSISTENT_EXCLUDES[@]}"', 1)
requirePersistentExcludes('ops/deploy/deploy-backend.sh')
requirePersistentExcludes('ops/deploy/restore-backup.sh')
requireOrder('ops/deploy/deploy-backend.sh', [
  'require_commands \\',
  '"${ACTIVE_VENV_PYTHON}" - "${BACKEND_DIR}/.env"',
  'tar -xzf "${ARCHIVE_PATH}" -C "${STAGING_DIR}"',
  'runuser -u toolbox -- test -r "${STAGING_DIR}/backend/constraints-py310.txt"',
  'install -d -o root -g toolbox -m 0750 "${STAGING_DIR}/backend/updates"',
  'VENV_BUILD_MARKER="${VENV_ROOT}/.${EXPECTED_VERSION}-${RELEASE_ID}-${EXPECTED_COMMIT:0:12}.building"',
  '# Freeze writes before taking the attachment and database snapshots.',
])
requireOrder('ops/deploy/deploy-backend.sh', [
  'chown -R root:root "${VENV_BUILD_DIR}"',
  'chmod -R a+rX "${VENV_BUILD_DIR}"',
  'runuser -u toolbox -- "${VENV_BUILD_DIR}/bin/python" -m pip check',
  'VENV_PYTHON="${VENV_RELEASE_DIR}/bin/python"',
  'importlib.import_module("main")',
  'mkdir -p "${BACKUP_DIR}/backend"',
  'DEPLOY_STARTED=1',
])
requireOrder('ops/deploy/deploy-backend.sh', [
  'chown -R toolbox:toolbox "${BACKEND_DIR}"',
  '"${BACKEND_DIR}/runtime"',
  'runuser -u toolbox -- test -w "${BACKEND_DIR}/runtime"',
  'MIGRATION_STARTED=1',
  'systemctl start toolbox-backend',
])
requireOrder('ops/deploy/deploy-backend.sh', [
  'MIGRATION_STARTED=1',
  'atomic_switch_current_venv "${VENV_RELEASE_DIR}"',
])
requireOrder('ops/deploy/restore-backup.sh', [
  'require_commands chmod',
  '"${RESTORE_VENV_PYTHON}" - "${BACKUP_DIR}/backend.env"',
  'RESTORE_IN_PROGRESS=1',
  'trap restore_failure ERR',
])
requireOrder('ops/deploy/restore-backup.sh', [
  '# Validate the complete compressed stream before changing the live schema.',
  'with gzip.open(sys.argv[2], "rb") as source:',
  'objects = subprocess.run(',
  'DROP VIEW IF EXISTS',
  'DROP TABLE IF EXISTS',
  'process = subprocess.Popen(command, stdin=subprocess.PIPE)',
  'while chunk := source.read(1024 * 1024):',
])
rejectText('ops/deploy/deploy-backend.sh', ['https://8.130.113.104'])
rejectText('ops/deploy/restore-backup.sh', [
  "trap 'systemctl start toolbox-backend || true' EXIT",
  'subprocess.run(command, stdin=source',
])
rejectText('ops/systemd/toolbox-backend.service', ['ExecStart=/opt/amazon-toolbox/backend/.venv/bin/python'])

// The existing frontend/production release gate runs these real filesystem
// regressions as well as static invariants, including migrated compatibility
// roots and directory/symbolic-link escapes. No deployment script is executed.
execFileSync(process.execPath, ['--test', path.join(root, 'scripts/tests/deployment-paths.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
execFileSync(process.execPath, ['--test', path.join(root, 'scripts/tests/release-retirement.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
execFileSync(process.execPath, ['--test', path.join(root, 'scripts/tests/retirement-worker.test.mjs')], {
  cwd: root,
  stdio: 'inherit',
})
execFileSync(process.execPath, [path.join(root, 'scripts/run-python.mjs'), 'scripts/tests/test_web_retirement.py', '-v'], {
  cwd: root,
  stdio: 'inherit',
})

process.stdout.write('release_configuration=verified\n')
