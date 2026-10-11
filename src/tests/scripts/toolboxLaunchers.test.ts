import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const repository = process.cwd()
const temporaryRoots: string[] = []
const windows = process.platform === 'win32'
const entries = ['开发预览.bat', 'dev-preview.bat', '检查.bat', '仅打包.bat', '一键发布.bat', '官网预览.bat', '官网发布.bat', '联合发布.bat']
const { jointRelease } = await import(/* @vite-ignore */ pathToFileURL(path.join(repository, 'scripts', 'toolbox-cli.mjs')).href)
const { resolvePython } = await import(/* @vite-ignore */ pathToFileURL(path.join(repository, 'scripts', 'run-python.mjs')).href)

function fixture(withDependencies = false): string {
  const base = windows ? 'D:/AmazonToolboxData/launcher-tests' : os.tmpdir()
  mkdirSync(base, { recursive: true })
  const temporary = mkdtempSync(path.join(base, 'kst-launcher-'))
  temporaryRoots.push(temporary)
  const root = path.join(temporary, '中文 路径 & 空格!')
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  for (const file of ['toolbox-cli.mjs', 'toolbox-entry.bat', 'launch-toolbox.ps1', 'with-toolbox-data-root.mjs', 'run-python.mjs']) {
    copyFileSync(path.join(repository, 'scripts', file), path.join(root, 'scripts', file))
  }
  for (const entry of entries) copyFileSync(path.join(repository, entry), path.join(root, entry))
  writeFileSync(path.join(root, 'scripts', 'publish-marketing.mjs'), `
    if (!process.argv.includes('--dry-run')) {
      console.error('Cloudflare configuration missing'); process.exitCode = 17
    }
  `)
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3', scripts: {
    'desktop:verify-installer': 'node -e "require(\'fs\').writeFileSync(\'pack-built.txt\', \'audited fixture\')"',
    'marketing:publish': 'node -e "console.error(\'Cloudflare configuration missing\');process.exit(17)" --',
  } }))
  if (withDependencies) {
    for (const dependency of ['electron', 'vite', 'typescript']) {
      mkdirSync(path.join(root, 'node_modules', dependency), { recursive: true })
      writeFileSync(path.join(root, 'node_modules', dependency, 'package.json'), '{}')
    }
  }
  return root
}

function execute(root: string, args: string[], entry?: string, overrides: NodeJS.ProcessEnv = {}) {
  const environment = { ...process.env, TOOLBOX_NO_PAUSE: '1', TOOLBOX_NODE_EXE: process.execPath,
    TOOLBOX_GH_EXE: '', TOOLBOX_DRY_RUN: '', TOOLBOX_PREVIEW_BACKEND: 'local', TOOLBOX_RELEASE_VERSION: '', ...overrides }
  return entry
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', `call "${path.join(root, entry)}" ${args.join(' ')}`],
      { cwd: os.tmpdir(), env: environment, encoding: 'utf8', timeout: 20_000, windowsVerbatimArguments: true })
    : spawnSync(process.execPath, [path.join(root, 'scripts', 'toolbox-cli.mjs'), ...args],
      { cwd: os.tmpdir(), env: environment, encoding: 'utf8', timeout: 20_000 })
}

afterEach(() => {
  for (const temporary of temporaryRoots.splice(0)) rmSync(temporary, { recursive: true, force: true })
})

describe('KST local launchers and deployment boundaries', () => {
  it.each([['preview', '--dry-run'], ['check', 'full', '--dry-run'], ['pack', '--dry-run'], ['marketing', 'preview', '--dry-run'], ['joint-release', '--dry-run']])(
    'dry-run %s does not install dependencies or build in a path with Chinese, spaces and shell characters', (...args) => {
      const root = fixture()
      const result = execute(root, args)
      expect(result.status, result.stderr).toBe(0)
      expect(existsSync(path.join(root, 'node_modules'))).toBe(false)
      expect(existsSync(path.join(root, 'pack-built.txt'))).toBe(false)
    },
  )

  it('pack uses the installer audit without changing versions or running production release', () => {
    const root = fixture(true)
    const before = readFileSync(path.join(root, 'package.json'), 'utf8')
    const result = execute(root, ['pack'])
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(readFileSync(path.join(root, 'pack-built.txt'), 'utf8')).toBe('audited fixture')
    expect(readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(before)
    expect(result.stdout).not.toContain('git push')
    expect(result.stdout).not.toContain('生产环境，')
  })

  it.each(['--publish', '--skip-verify', '--skip-build'])('pack refuses %s', flag => {
    const root = fixture()
    expect(execute(root, ['pack', flag]).status).toBe(1)
    expect(existsSync(path.join(root, 'node_modules'))).toBe(false)
  })

  it.each(['--skip-verify', '--skip-build'])('production release still refuses %s before dependencies or deployment', flag => {
    const root = fixture()
    const result = execute(root, ['release', '--publish', flag, '--version=1.2.4'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('生产发布禁止')
    expect(existsSync(path.join(root, 'node_modules'))).toBe(false)
  })

  it('propagates marketing publisher configuration errors instead of claiming success', () => {
    const root = fixture()
    const result = execute(root, ['marketing', 'publish', '--dry-run'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Cloudflare configuration missing')
    expect(result.stdout).not.toContain('发布流程完成')
  })

  it('actual joint command stops on account preflight failure before installing dependencies', () => {
    const root = fixture()
    const result = execute(root, ['joint-release', '--version=1.2.3'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Cloudflare configuration missing')
    expect(existsSync(path.join(root, 'node_modules'))).toBe(false)
    expect(existsSync(path.join(root, 'pack-built.txt'))).toBe(false)
    expect(result.stdout).not.toContain('系统发布已完成')
  })

  it.runIf(windows).each([
    ['开发预览.bat', '--dry-run'], ['dev-preview.bat', '--dry-run'], ['检查.bat', 'full --dry-run'],
    ['仅打包.bat', '--dry-run'], ['官网预览.bat', '--dry-run'],
    ['联合发布.bat', '--version=1.2.4 --dry-run'],
  ])('real Windows wrapper %s resolves its own directory and preserves arguments', (entry, argument) => {
    const root = fixture()
    const result = execute(root, argument.split(' '), entry)
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain(root)
    expect(existsSync(path.join(root, 'node_modules'))).toBe(false)
  })

  it.runIf(windows)('one-click production BAT still selects --publish and rejects bypass flags', () => {
    const root = fixture()
    const result = execute(root, ['--skip-verify', '--version=1.2.4'], '一键发布.bat')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stderr).toContain('生产发布禁止')
  })

  it.runIf(windows)('joint-release BAT rejects bypass flags before account or system actions', () => {
    const root = fixture()
    const result = execute(root, ['--skip-build', '--version=1.2.4'], '联合发布.bat')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stderr).toContain('生产发布禁止')
    expect(result.stderr).not.toContain('Cloudflare configuration missing')
    expect(existsSync(path.join(root, 'node_modules'))).toBe(false)
  })

  it.runIf(windows)('real launcher rejects an explicitly invalid Python without falling back', () => {
    const root = fixture()
    const result = execute(root, ['--dry-run'], '开发预览.bat', { TOOLBOX_PYTHON: path.join(root, 'missing-python.exe') })
    expect(result.status).toBe(1)
    expect(`${result.stdout}\n${result.stderr}`).toContain('TOOLBOX_PYTHON')
    expect(result.stdout).not.toContain('预览配置检查通过')
  })

  it.runIf(windows)('real launcher uses a validated explicit Python before a broken local venv', () => {
    const root = fixture()
    const python = resolvePython()
    mkdirSync(path.join(root, 'venv', 'Scripts'), { recursive: true })
    writeFileSync(path.join(root, 'venv', 'Scripts', 'python.exe'), 'broken migrated executable')
    const result = execute(root, ['--dry-run'], '开发预览.bat', { TOOLBOX_PYTHON: python })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain(`[TOOLBOX] Python: ${python}`)
  })

  it.runIf(windows)('website preview does not require a Python installation', () => {
    const root = fixture()
    const result = execute(root, ['--dry-run'], '官网预览.bat', { TOOLBOX_PYTHON: path.join(root, 'missing-python.exe') })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).not.toContain('[TOOLBOX] Python:')
    expect(existsSync(path.join(root, 'node_modules'))).toBe(false)
  })

  it.runIf(windows)('Node discovery skips an invalid first PATH candidate and selects a later Node 22', () => {
    const root = fixture()
    const invalidDirectory = path.join(root, 'invalid-node')
    mkdirSync(invalidDirectory)
    writeFileSync(path.join(invalidDirectory, 'node.exe'), 'broken migrated executable')
    const result = execute(root, ['--dry-run'], '官网预览.bat', {
      TOOLBOX_NODE_EXE: '', TOOLBOX_DATA_ROOT: path.join(root, 'empty-data'),
      PATH: `${invalidDirectory};${path.dirname(process.execPath)};${process.env.PATH || ''}`,
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain(`[TOOLBOX] Node 22: ${process.execPath}`)
  })

  it.runIf(windows)('real launcher rejects an explicitly invalid GitHub CLI instead of using another account tool', () => {
    const root = fixture()
    const result = execute(root, ['--dry-run'], '官网预览.bat', { TOOLBOX_GH_EXE: path.join(root, 'missing-gh.exe') })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('TOOLBOX_GH_EXE')
    expect(existsSync(path.join(root, 'node_modules'))).toBe(false)
  })

  it.runIf(windows)('BAT preserves a quoted argument and the exact CLI failure exit code', () => {
    const root = fixture()
    writeFileSync(path.join(root, 'scripts', 'toolbox-cli.mjs'), `
      console.log('FORWARDED=' + JSON.stringify(process.argv.slice(2)))
      process.exitCode = 37
    `)
    const result = execute(root, ['"payload & spaced!"'], '官网预览.bat')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(37)
    expect(result.stdout).toContain('FORWARDED=["marketing","preview","payload & spaced!"]')
  })

  it.runIf(windows)('build wrapper runs a quoted local .cmd shim and preserves spaced arguments', () => {
    const root = fixture()
    mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true })
    writeFileSync(path.join(root, 'node_modules', '.bin', 'fixture.cmd'), '@echo off\r\nnode "%~dp0../../inspect.cjs" %*\r\n')
    writeFileSync(path.join(root, 'inspect.cjs'), 'require("fs").writeFileSync("observed.json", JSON.stringify({args:process.argv.slice(2),temp:process.env.TEMP,browserGc:process.env.PLAYWRIGHT_SKIP_BROWSER_GC}))')
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'with-toolbox-data-root.mjs'), '--', 'fixture', 'payload & spaced!'], {
      cwd: root, env: { ...process.env, TOOLBOX_DATA_ROOT: path.join(root, 'data') }, encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(JSON.parse(readFileSync(path.join(root, 'observed.json'), 'utf8'))).toEqual({
      args: ['payload & spaced!'], temp: path.join(root, 'data', 'build-tmp'), browserGc: '1',
    })
  })
})

describe('shared Python interpreter selection', () => {
  it('rejects an unusable explicit setting without testing alternatives', () => {
    const probe = vi.fn(() => null)
    expect(() => resolvePython({ environment: { TOOLBOX_PYTHON: 'bad-python' }, probe })).toThrow('never silently replaced')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('prefers a validated explicit setting and skips local environments', () => {
    const probe = vi.fn(() => 'validated-python')
    expect(resolvePython({ environment: { TOOLBOX_PYTHON: 'requested-python' }, probe })).toBe('validated-python')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('skips broken Windows local environments before the existing project data environment', () => {
    const projectRoot = path.resolve('fixture-project')
    const data = path.resolve('fixture-data')
    const fallback = path.join(data, 'venvs', 'amazon-toolbox-test', 'Scripts', 'python.exe')
    const probe = vi.fn((candidate: string) => candidate === fallback ? candidate : null)
    expect(resolvePython({ projectRoot, environment: { TOOLBOX_DATA_ROOT: data }, platform: 'win32', probe })).toBe(fallback)
    expect(probe.mock.calls.map(call => call[0])).toEqual([
      path.join(projectRoot, 'venv', 'Scripts', 'python.exe'),
      path.join(projectRoot, '.venv', 'Scripts', 'python.exe'), fallback,
    ])
  })

  it('retains Linux python3 fallback without probing the Windows project environment', () => {
    const probe = vi.fn((candidate: string) => candidate === 'python3' ? '/usr/bin/python3' : null)
    expect(resolvePython({ environment: {}, platform: 'linux', probe })).toBe('/usr/bin/python3')
    expect(probe.mock.calls).toHaveLength(3)
    expect(probe.mock.calls[2][0]).toBe('python3')
  })

  it('local backend respects the selected interpreter without changing its existing runtime directory', () => {
    const source = readFileSync(path.join(repository, 'backend', 'start.bat'), 'utf8')
    expect(source).toContain('if defined TOOLBOX_PYTHON set "PYTHON=%TOOLBOX_PYTHON%"')
    expect(source).toContain('if not defined TOOLBOX_RUNTIME_DIR set "TOOLBOX_RUNTIME_DIR=%LOCALAPPDATA%\\AmazonToolboxData"')
    expect(source.indexOf('if defined TOOLBOX_PYTHON (')).toBeLessThan(source.indexOf('if not exist "%PYTHON%" ('))
  })
})

describe('joint system and marketing release orchestration', () => {
  function operations() {
    return {
      checkConfig: vi.fn(async () => undefined),
      checkAccount: vi.fn(async () => undefined),
      releaseSystem: vi.fn(async (_args: string[]) => undefined),
      publishWebsite: vi.fn(async () => undefined),
    }
  }

  it('checks account first, preserves version and resume, then publishes the website once', async () => {
    const actions = operations()
    const args = ['--version=1.8.8', '--resume=1.8.8-0123456789ab']
    await jointRelease(args, actions)
    expect(actions.releaseSystem).toHaveBeenCalledWith([...args, '--publish'])
    expect(actions.checkAccount.mock.invocationCallOrder[0]).toBeLessThan(actions.releaseSystem.mock.invocationCallOrder[0])
    expect(actions.releaseSystem.mock.invocationCallOrder[0]).toBeLessThan(actions.publishWebsite.mock.invocationCallOrder[0])
    expect(actions.publishWebsite).toHaveBeenCalledTimes(1)
    expect(actions.checkConfig).not.toHaveBeenCalled()
    expect(args).toEqual(['--version=1.8.8', '--resume=1.8.8-0123456789ab'])
  })

  it('dry-run checks only local marketing configuration and never starts account or release operations', async () => {
    const actions = operations()
    await jointRelease(['--dry-run', '--version', '1.8.8'], actions)
    expect(actions.checkConfig).toHaveBeenCalledOnce()
    expect(actions.checkAccount).not.toHaveBeenCalled()
    expect(actions.releaseSystem).not.toHaveBeenCalled()
    expect(actions.publishWebsite).not.toHaveBeenCalled()
  })

  it('does not change production when marketing account preflight fails', async () => {
    const actions = operations()
    actions.checkAccount.mockRejectedValueOnce(new Error('Cloudflare login expired'))
    await expect(jointRelease(['--version=1.8.8'], actions)).rejects.toThrow('Cloudflare login expired')
    expect(actions.releaseSystem).not.toHaveBeenCalled()
    expect(actions.publishWebsite).not.toHaveBeenCalled()
  })

  it('does not publish the website after a failed system release', async () => {
    const actions = operations()
    actions.releaseSystem.mockRejectedValueOnce(new Error('system release failed'))
    await expect(jointRelease(['--version=1.8.8'], actions)).rejects.toThrow('system release failed')
    expect(actions.publishWebsite).not.toHaveBeenCalled()
  })

  it('reports partial completion and website-only recovery without repeating the system', async () => {
    const actions = operations()
    actions.publishWebsite.mockRejectedValueOnce(new Error('Pages verification failed'))
    await expect(jointRelease(['--version=1.8.8'], actions)).rejects.toThrow('系统已发布完成，但官网发布失败')
    expect(actions.releaseSystem).toHaveBeenCalledTimes(1)
    expect(actions.publishWebsite).toHaveBeenCalledTimes(1)
  })

  it.each(['--skip-verify', '--skip-build', '--skip-verify=true', '--skip-build=false', '--publish', '--version', '--resume', '--version=bad', '--resume=../bad'])('rejects unsafe or malformed %s before any side effects', async flag => {
    const actions = operations()
    await expect(jointRelease([flag], actions)).rejects.toThrow()
    for (const operation of Object.values(actions)) expect(operation).not.toHaveBeenCalled()
  })
})
