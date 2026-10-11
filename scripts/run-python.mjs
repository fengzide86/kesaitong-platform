import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function probePython(candidate, environment) {
  // The executable path may contain Chinese characters. Python's inherited
  // Windows codepage must not disagree with Node's UTF-8 stdout decoding.
  const options = { env: { ...environment, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, encoding: 'utf8', windowsHide: true, timeout: 10_000 }
  const version = spawnSync(candidate, ['--version'], options)
  if (version.error || version.status !== 0 || !/^Python 3\.\d+/.test(`${version.stdout || ''}${version.stderr || ''}`.trim())) return null
  const executable = spawnSync(candidate, ['-c', 'import sys; print(sys.executable)'], options)
  const resolved = (executable.stdout || '').trim()
  return !executable.error && executable.status === 0 && path.isAbsolute(resolved) ? resolved : null
}

export function resolvePython({ projectRoot = root, environment = process.env, platform = process.platform, probe = probePython } = {}) {
  if (environment.TOOLBOX_PYTHON) {
    const explicit = probe(environment.TOOLBOX_PYTHON, environment)
    if (!explicit) throw new Error('TOOLBOX_PYTHON must point to a runnable Python 3 interpreter; explicit settings are never silently replaced.')
    return explicit
  }
  const windows = platform === 'win32'
  const scripts = windows ? 'Scripts' : 'bin'
  const executable = windows ? 'python.exe' : 'python'
  const candidates = ['venv', '.venv'].map(directory => path.join(projectRoot, directory, scripts, executable))
  if (windows) candidates.push(path.join(environment.TOOLBOX_DATA_ROOT || 'D:\\AmazonToolboxData', 'venvs', 'amazon-toolbox-test', 'Scripts', 'python.exe'))
  candidates.push(windows ? 'python' : 'python3')
  for (const candidate of candidates) {
    const resolved = probe(candidate, environment)
    if (resolved) return resolved
  }
  throw new Error('No runnable Python 3 interpreter found. Set TOOLBOX_PYTHON to an existing project environment; no interpreter was installed or changed.')
}

if (process.argv[1] && fs.existsSync(process.argv[1])
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const forwarded = process.argv.slice(2)
    const args = forwarded[0] === '--' ? forwarded.slice(1) : forwarded
    if (!args.length) throw new Error('run-python.mjs requires Python arguments')
    const interpreter = resolvePython()
    if (args.length === 1 && args[0] === '--resolve') {
      process.stdout.write(`${interpreter}\n`)
    } else {
      const result = spawnSync(interpreter, args, { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true })
      if (result.error) throw new Error(`Unable to start Python (${interpreter}): ${result.error.message}`)
      process.exitCode = result.status ?? 1
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exitCode = 1
  }
}
