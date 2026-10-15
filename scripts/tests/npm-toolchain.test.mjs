import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { npmEnvironment, resolveNpm } from '../npm-toolchain.mjs'

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kst-npm-toolchain-'))
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: 'npm@12.2.0' }))
    fs.writeFileSync(path.join(root, '.node-version'), '22.23.3\n')
    run(root)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('the managed matching npm wins over an inherited old npm, without installing anything', () => fixture(root => {
  const managed = path.join(root, 'toolchains', 'npm-12.2.0', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const checked = []
  const result = resolveNpm({ projectRoot: root, nodeVersion: '22.23.3',
    environment: { TOOLBOX_DATA_ROOT: root, npm_execpath: path.join(root, 'old-npm.js') },
    probe(candidate) { checked.push(candidate); return candidate === managed ? '12.2.0' : '10.9.9' } })
  assert.equal(result.cli, managed)
  assert.equal(checked.length, 2)
  assert.deepEqual(fs.readdirSync(root).sort(), ['.node-version', 'package.json'])
}))

test('explicit incorrect npm and wrong Node patch fail closed', () => fixture(root => {
  const explicit = path.join(root, 'requested-npm.js')
  const checked = []
  assert.throws(() => resolveNpm({ projectRoot: root, nodeVersion: '22.23.3', environment: { TOOLBOX_NPM_CLI: explicit },
    probe(candidate) { checked.push(candidate); return '10.9.9' } }), /never silently replaced/)
  assert.deepEqual(checked, [explicit])
  assert.throws(() => resolveNpm({ projectRoot: root, nodeVersion: '22.23.2', environment: {}, probe() { throw new Error('must not probe') } }), /22.23.3 is required/)
}))

test('CI npm_execpath is accepted and nested npm calls use the validated command wrapper', () => fixture(root => {
  const cli = path.join(root, 'global', 'npm', 'bin', 'npm-cli.js')
  const result = resolveNpm({ projectRoot: root, nodeVersion: '22.23.3', environment: { npm_execpath: cli }, probe() { return '12.2.0' } })
  assert.equal(result.cli, cli)
  const env = npmEnvironment(result, { Path: 'existing-path', OTHER: 'kept' })
  assert.equal(env.TOOLBOX_NPM_CLI, cli)
  const shimDirectory = env.Path.split(path.delimiter)[0]
  assert.notEqual(shimDirectory, path.dirname(cli))
  assert.match(fs.readFileSync(path.join(shimDirectory, 'npm.cmd'), 'utf8'), /TOOLBOX_NODE_EXE.*TOOLBOX_NPM_CLI/)
  assert.equal(env.TOOLBOX_NODE_EXE, process.execPath)
  assert.equal(env.OTHER, 'kept')
  assert.equal(env.PATH, undefined)
}))

test('real recursive npm run preserves exact npm/Node and spaced Unicode cwd without changing the global runtime', () => fixture(root => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const selected = resolveNpm({ projectRoot })
  const directory = path.join(root, '中文 项目')
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ scripts: {
    outer: 'npm run inner --silent',
    inner: 'npx --no-install -c "node verify.cjs"',
  } }))
  fs.writeFileSync(path.join(directory, 'verify.cjs'), 'console.log(JSON.stringify({node:process.versions.node,cli:process.env.npm_execpath,agent:process.env.npm_config_user_agent}))')
  const result = spawnSync(selected.nodeExecutable, [selected.cli, 'run', 'outer', '--silent'], {
    cwd: directory, env: npmEnvironment(selected), encoding: 'utf8', windowsHide: true, timeout: 30000,
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const observed = JSON.parse(result.stdout.trim())
  assert.equal(observed.node, selected.nodeVersion)
  assert.equal(path.resolve(observed.cli), selected.cli)
  assert.match(observed.agent, new RegExp(`^npm/${selected.npmVersion.replaceAll('.', '\\.')} `))
}))
