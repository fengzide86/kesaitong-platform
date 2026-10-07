import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scripts = ['deploy-backend.sh', 'restore-backup.sh']
const readScript = name => fs.readFileSync(path.join(root, 'ops/deploy', name), 'utf8')
let canonicalTemp
let nativeTemp = os.tmpdir()
const shellPath = value => {
  if (process.platform !== 'win32') return value
  // Git/MSYS may mount the native Windows temp directory as /tmp. Fixtures
  // must use that shell's canonical spelling, not assume a /c drive prefix.
  const relative = path.relative(nativeTemp, value)
  if (canonicalTemp && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    return `${canonicalTemp}${relative ? `/${relative.replaceAll('\\', '/')}` : ''}`
  }
  return value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`

function findShell() {
  if (process.platform !== 'win32') return 'bash'
  const git = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true })
  assert.equal(git.status, 0, 'deployment path regressions require Git for Windows Bash')
  const shell = path.resolve(git.stdout.trim(), '../../../usr/bin/sh.exe')
  assert.ok(fs.existsSync(shell), `Git shell not found: ${shell}`)
  return shell
}

const shell = findShell()
function run(source) {
  return spawnSync(shell, ['-c', `export PATH="/usr/bin:$PATH"\nset -eu\n${source}`], {
    encoding: 'utf8', windowsHide: true, timeout: 15000,
  })
}
function succeeds(source) {
  const result = run(source)
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return result.stdout.trim()
}
function rejects(source) {
  const result = run(source)
  assert.notEqual(result.status, null, result.error?.message)
  assert.notEqual(result.status, 0, 'unsafe/missing target must be rejected')
}
if (process.platform === 'win32') {
  nativeTemp = path.resolve(succeeds('cd /tmp && pwd -W'))
  canonicalTemp = '/tmp'
}
function functionBody(source, name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm').exec(source.replaceAll('\r\n', '\n'))
  assert.ok(match, `${name} must remain a testable shell function`)
  return match[0]
}
function fixture() {
  const directory = fs.mkdtempSync(path.join(nativeTemp, 'kst-deployment-paths-'))
  const f = {
    directory,
    legacy: path.join(directory, 'amazon-toolbox'),
    current: path.join(directory, 'kesaitong-platform'),
    outside: path.join(directory, 'outside'),
  }
  fs.mkdirSync(f.current)
  fs.mkdirSync(f.outside)
  return f
}
function link(target, destination) {
  fs.symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
}
function executable(directory) {
  fs.mkdirSync(path.join(directory, 'bin'), { recursive: true })
  const python = path.join(directory, 'bin/python')
  fs.writeFileSync(python, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  fs.chmodSync(python, 0o755)
}
function venvContext(source, f) {
  return `${functionBody(source, 'validate_venv_target')}\nVENV_ROOT=${quote(shellPath(path.join(f.current, 'venvs')))}\nLEGACY_VENV=${quote(shellPath(path.join(f.current, 'backend/.venv')))}\n`
}

for (const name of scripts) {
  const source = readScript(name)
  test(`${name}: shell syntax and exact approved deployment roots`, () => {
    const syntax = spawnSync(shell, ['-n', shellPath(path.join(root, 'ops/deploy', name))], { encoding: 'utf8', windowsHide: true })
    assert.equal(syntax.status, 0, syntax.stderr)
    assert.ok(source.includes('APP_ROOT="$(canonical_deployment_root /opt/amazon-toolbox /opt/kesaitong-platform)"'))
    assert.ok(source.includes('canonical_deployment_root /var/lib/amazon-toolbox /var/lib/kesaitong-platform'))
    assert.ok(source.includes('[[ "${target}" == "${VENV_ROOT}/"* || "${target}" == "${LEGACY_VENV}" ]]'))
    assert.ok(functionBody(source, 'validate_venv_target').includes('readlink -e -- "$1"'))
    assert.ok(functionBody(source, 'atomic_switch_current_venv').includes('readlink -e -- "$1"'))
  })

  test(`${name}: original, migrated, current-only roots work; foreign and dangling roots fail`, () => {
    const f = fixture()
    try {
      const invoke = `${functionBody(source, 'canonical_deployment_root')}\ncanonical_deployment_root ${quote(shellPath(f.legacy))} ${quote(shellPath(f.current))}`
      fs.mkdirSync(f.legacy)
      assert.equal(succeeds(invoke), shellPath(f.legacy))
      fs.rmdirSync(f.legacy)
      assert.equal(succeeds(invoke), shellPath(f.current))
      link(f.current, f.legacy)
      assert.equal(succeeds(invoke), shellPath(f.current))
      fs.unlinkSync(f.legacy)
      link(f.outside, f.legacy)
      rejects(invoke)
      fs.unlinkSync(f.legacy)
      link(path.join(f.directory, 'missing'), f.legacy)
      rejects(invoke)
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }) }
  })

  test(`${name}: canonical venv guard accepts both metadata paths, rejects traversal and link escapes`, () => {
    const f = fixture()
    try {
      link(f.current, f.legacy)
      const release = path.join(f.current, 'venvs/release')
      const legacyVenv = path.join(f.current, 'backend/.venv')
      const sibling = path.join(f.current, 'venvs-other/release')
      for (const directory of [release, legacyVenv, sibling, f.outside]) executable(directory)
      link(f.outside, path.join(f.current, 'venvs/escape'))
      const context = venvContext(source, f)
      for (const target of [release, legacyVenv, path.join(f.legacy, 'venvs/release'), path.join(f.legacy, 'backend/.venv')]) {
        succeeds(`${context}validate_venv_target ${quote(shellPath(target))}`)
      }
      for (const target of [f.outside, sibling, path.join(f.current, 'venvs/escape'), `${f.current}/venvs/../../outside`, path.join(f.current, 'venvs/missing')]) {
        rejects(`${context}validate_venv_target ${quote(shellPath(target))}`)
      }
      fs.mkdirSync(path.join(f.current, 'venvs/no-python'))
      rejects(`${context}validate_venv_target ${quote(shellPath(path.join(f.current, 'venvs/no-python')))}`)
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }) }
  })
}

test('restore-backup.sh: backup guard normalizes legacy input but rejects root, siblings and escapes', () => {
  const source = readScript('restore-backup.sh')
  const f = fixture()
  try {
    link(f.current, f.legacy)
    const backups = path.join(f.current, 'backups')
    const backup = path.join(backups, 'pre-release')
    const sibling = path.join(f.current, 'backups-other/pre-release')
    fs.mkdirSync(backup, { recursive: true })
    fs.mkdirSync(sibling, { recursive: true })
    link(f.outside, path.join(backups, 'escape'))
    const context = `${functionBody(source, 'validate_backup_target')}\nBACKUP_ROOT=${quote(shellPath(backups))}\n`
    for (const target of [backup, path.join(f.legacy, 'backups/pre-release')]) {
      assert.equal(succeeds(`${context}validate_backup_target ${quote(shellPath(target))}\nprintf '%s' "$BACKUP_DIR"`), shellPath(backup))
    }
    for (const target of [backups, sibling, f.outside, path.join(backups, 'escape'), `${backups}/../../outside`, path.join(backups, 'missing')]) {
      rejects(`${context}validate_backup_target ${quote(shellPath(target))}`)
    }
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }) }
})

test('restore-backup.sh: old/new service metadata and old/new saved pointers preserve recovery rules', () => {
  const source = readScript('restore-backup.sh')
  const metadata = /VENV_POINTER_ACTION="keep"\n[\s\S]*?\nfi\n(?=validate_venv_target)/.exec(source.replaceAll('\r\n', '\n'))?.[0]
  assert.ok(metadata, 'restore metadata must be tested before any service or database write')
  const f = fixture()
  try {
    link(f.current, f.legacy)
    const backup = path.join(f.current, 'backups/pre-release')
    fs.mkdirSync(backup, { recursive: true })
    executable(path.join(f.current, 'backend/.venv'))
    const release = path.join(f.current, 'venvs/release')
    executable(release)
    const context = `${venvContext(source, f)}BACKUP_DIR=${quote(shellPath(backup))}\n`
    const inspect = `${metadata}\nvalidate_venv_target "$RESTORE_VENV_DIR"\nprintf '%s' "$VENV_POINTER_ACTION"`
    const service = path.join(backup, 'toolbox-backend.service')
    for (const rootPath of ['/opt/amazon-toolbox', '/opt/kesaitong-platform']) {
      fs.writeFileSync(service, `ExecStart=${rootPath}/backend/.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1\n`)
      assert.equal(succeeds(context + inspect), 'remove')
      fs.writeFileSync(service, `ExecStart=${rootPath}/current-venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1\n`)
      rejects(context + inspect)
    }
    fs.writeFileSync(service, 'ExecStart=/opt/foreign/current-venv/bin/python\n')
    rejects(context + inspect)
    const pointer = path.join(backup, 'current-venv.target')
    for (const target of [release, path.join(f.legacy, 'venvs/release')]) {
      fs.writeFileSync(pointer, `${shellPath(target)}\n`)
      assert.equal(succeeds(context + inspect), 'switch')
    }
    fs.writeFileSync(pointer, `${shellPath(f.outside)}\n`)
    rejects(context + inspect)
    fs.unlinkSync(pointer)
    fs.writeFileSync(`${pointer}.missing`, '')
    assert.equal(succeeds(context + inspect), 'remove')
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }) }
})
