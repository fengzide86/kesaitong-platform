import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

let commandDirectory
function npmCommandDirectory() {
  if (commandDirectory) return commandDirectory
  // npm's own bin/npm.cmd is an installer template, not a usable PATH shim.
  // Use process-owned launchers that always delegate to the validated pair.
  // Nothing is installed in, or overwritten under, a shared Node/npm prefix.
  commandDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kst-npm-command-'))
  for (const name of ['npm', 'npx']) {
    const cliVariable = name === 'npx' ? 'TOOLBOX_NPX_CLI' : 'TOOLBOX_NPM_CLI'
    fs.writeFileSync(path.join(commandDirectory, `${name}.cmd`),
      `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%TOOLBOX_NODE_EXE%" "%${cliVariable}%" %*\r\n`, { flag: 'wx' })
    fs.writeFileSync(path.join(commandDirectory, name),
      `#!/bin/sh\nexec "$TOOLBOX_NODE_EXE" "$${cliVariable}" "$@"\n`, { flag: 'wx', mode: 0o700 })
  }
  const owned = commandDirectory
  process.once('exit', () => { try { fs.rmSync(owned, { recursive: true, force: true }) } catch { /* Windows may still hold a launcher briefly. */ } })
  return commandDirectory
}

export function readToolchainPolicy(projectRoot) {
  const metadata = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  const npmVersion = /^npm@(\d+\.\d+\.\d+)$/.exec(metadata.packageManager || '')?.[1]
  const nodeVersion = fs.readFileSync(path.join(projectRoot, '.node-version'), 'utf8').trim()
  if (!npmVersion || !/^22\.\d+\.\d+$/.test(nodeVersion)) throw new Error('The project must pin exact Node 22 and npm versions.')
  return { npmVersion, nodeVersion }
}

function probeNpm(cli, nodeExecutable, environment) {
  if (!path.isAbsolute(cli) || !fs.existsSync(cli)) return null
  const result = spawnSync(nodeExecutable, [cli, '--version'], {
    env: environment, encoding: 'utf8', timeout: 15000, windowsHide: true,
  })
  return !result.error && result.status === 0 ? result.stdout.trim() : null
}

// Resolve the actual CLI, not a declaration or a possibly unrelated PATH shim.
// No package manager is installed automatically and shared toolchains are untouched.
export function resolveNpm({ projectRoot, environment = process.env, nodeExecutable = process.execPath,
  nodeVersion = process.versions.node, probe = probeNpm } = {}) {
  const policy = readToolchainPolicy(projectRoot)
  if (nodeVersion !== policy.nodeVersion) throw new Error(`Node ${policy.nodeVersion} is required; actual Node is ${nodeVersion}. Set TOOLBOX_NODE_EXE to the pinned runtime.`)
  const dataRoot = environment.TOOLBOX_DATA_ROOT || (process.platform === 'win32' ? 'D:/AmazonToolboxData' : path.join(os.tmpdir(), 'AmazonToolboxData'))
  const candidates = environment.TOOLBOX_NPM_CLI ? [environment.TOOLBOX_NPM_CLI] : [
    environment.npm_execpath,
    path.join(dataRoot, 'toolchains', `npm-${policy.npmVersion}`, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(nodeExecutable), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean)
  for (const candidate of [...new Set(candidates)]) {
    if (probe(candidate, nodeExecutable, environment) === policy.npmVersion) {
      return { ...policy, cli: path.resolve(candidate), nodeExecutable }
    }
  }
  throw new Error(`npm ${policy.npmVersion} is required but no matching CLI was found. Set TOOLBOX_NPM_CLI to its npm-cli.js; an explicit wrong setting is never silently replaced. No toolchain was modified.`)
}

export function npmEnvironment(toolchain, environment = process.env) {
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path') || 'PATH'
  return { ...environment, TOOLBOX_NPM_CLI: toolchain.cli, TOOLBOX_NODE_EXE: toolchain.nodeExecutable,
    TOOLBOX_NPX_CLI: path.join(path.dirname(toolchain.cli), 'npx-cli.js'),
    [pathKey]: [npmCommandDirectory(), path.dirname(toolchain.nodeExecutable), environment[pathKey] || ''].join(path.delimiter) }
}

export function assertActiveToolchain(projectRoot, environment = process.env) {
  const selected = resolveNpm({ projectRoot, environment })
  // Direct `npm run release:policy` must reject a wrong npm even when a correct
  // managed CLI also exists. The launcher selects it; the gate verifies it.
  if (environment.npm_execpath && probeNpm(environment.npm_execpath, process.execPath, environment) !== selected.npmVersion) {
    throw new Error(`This command was started by a different npm; use npm ${selected.npmVersion} or the project launcher.`)
  }
  return selected
}
