import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { assertStageChild, prepareLocalDesktopStage } from '../prepare-local-desktop-stage.mjs'

const roots = []
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'kst-stage-guard-test-'))
  roots.push(root)
  const project = path.join(root, 'source')
  const parent = path.join(root, 'package-staging')
  const candidate = path.join(parent, 'candidate')
  mkdirSync(path.join(project, 'dist', 'assets'), { recursive: true })
  mkdirSync(path.join(project, 'dist-electron', 'electron'), { recursive: true })
  mkdirSync(candidate, { recursive: true })
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'isolated-fixture', version: '1.0.0', dependencies: { runtime: '1' }, devDependencies: { dev: '1' }, scripts: {}, build: {} }))
  writeFileSync(path.join(project, 'package-lock.json'), '{"lockfileVersion":3}')
  writeFileSync(path.join(project, 'dist', 'index.html'), 'new index')
  writeFileSync(path.join(project, 'dist', 'assets', 'app.js'), 'new app')
  writeFileSync(path.join(project, 'dist-electron', 'electron', 'main.cjs'), 'new main')
  const outside = path.join(root, 'outside')
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'keep.txt'), 'untouched')
  return { root, project, parent, candidate, outside, run: () => prepareLocalDesktopStage({ project, parent, candidate }) }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root)
    const relative = path.relative(path.resolve(tmpdir()), resolved)
    if (!relative || path.isAbsolute(relative) || relative.startsWith('..') || !path.basename(resolved).startsWith('kst-stage-guard-test-')) throw new Error('Unsafe temporary cleanup target')
    if (realpathSync(resolved) !== resolved || lstatSync(resolved).isSymbolicLink()) throw new Error('Temporary cleanup root changed')
    // Only this validated, uniquely created test root is removed. Never touch
    // a real package-staging directory or follow junction targets recursively.
    rmSync(resolved, { recursive: true, force: true })
  }
})

test('Windows containment rejects cross-drive absolute relatives, parent, sibling, and UNC escapes', () => {
  const parent = 'D:\\data\\package-staging'
  assert.equal(assertStageChild(parent, 'D:\\data\\package-staging\\candidate', path.win32), 'D:\\data\\package-staging\\candidate')
  for (const candidate of ['C:\\data\\candidate', parent, 'D:\\data\\other', '\\\\server\\share\\candidate', 'relative-candidate']) {
    assert.throws(() => assertStageChild(parent, candidate, path.win32), /explicit child/)
  }
  assert.throws(() => assertStageChild('\\\\server\\share\\package-staging', '\\\\other\\share\\candidate', path.win32), /explicit child/)
})

test('isolated assembly imports safely, copies recursively, and preserves installed runtime directories', () => {
  const test = fixture()
  mkdirSync(path.join(test.candidate, 'node_modules'))
  writeFileSync(path.join(test.candidate, 'node_modules', 'sentinel.txt'), 'keep runtime')
  assert.equal(test.run(), test.candidate)
  assert.equal(readFileSync(path.join(test.candidate, 'dist', 'assets', 'app.js'), 'utf8'), 'new app')
  assert.equal(readFileSync(path.join(test.candidate, 'dist-electron', 'electron', 'main.cjs'), 'utf8'), 'new main')
  assert.deepEqual(JSON.parse(readFileSync(path.join(test.candidate, 'package.json'), 'utf8')), { name: 'isolated-fixture', version: '1.0.0', dependencies: { runtime: '1' } })
  assert.equal(readFileSync(path.join(test.candidate, 'node_modules', 'sentinel.txt'), 'utf8'), 'keep runtime')
  assert.equal(test.run(), test.candidate)
})

test('destination directory junctions at build roots and nested paths fail before writes', () => {
  for (const relative of ['dist', path.join('dist', 'assets')]) {
    const test = fixture()
    const destination = path.join(test.candidate, relative)
    mkdirSync(path.dirname(destination), { recursive: true })
    symlinkSync(test.outside, destination, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(test.run, /symlinks or junctions/)
    assert.deepEqual(readdirSync(test.outside), ['keep.txt'])
    assert.equal(existsSync(path.join(test.candidate, 'package.json')), false)
  }
})

test('stage root, metadata-named, and dangling junctions are rejected during preflight', () => {
  for (const relative of ['', 'package.json', 'package-lock.json', path.join('dist', 'dangling')]) {
    const test = fixture()
    const destination = path.join(test.candidate, relative)
    if (!relative) renameSync(test.candidate, path.join(test.root, 'original-candidate'))
    else mkdirSync(path.dirname(destination), { recursive: true })
    const target = relative.includes('dangling') ? path.join(test.root, 'missing-target') : test.outside
    symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(test.run, /symlinks or junctions/)
    assert.deepEqual(readdirSync(test.outside), ['keep.txt'])
  }
})

test('destination files and metadata hard links cannot overwrite files outside the stage', () => {
  for (const relative of [path.join('dist', 'index.html'), 'package.json', 'package-lock.json']) {
    const test = fixture()
    const destination = path.join(test.candidate, relative)
    mkdirSync(path.dirname(destination), { recursive: true })
    const target = path.join(test.outside, 'keep.txt')
    linkSync(target, destination)
    assert.throws(test.run, /shared hard links/)
    assert.equal(readFileSync(target, 'utf8'), 'untouched')
    assert.equal(existsSync(path.join(test.candidate, 'dist-electron')), false)
  }
})

test('destination file and metadata symbolic links fail without modifying their targets', t => {
  for (const relative of [path.join('dist', 'index.html'), 'package.json', 'package-lock.json']) {
    const test = fixture()
    const destination = path.join(test.candidate, relative)
    mkdirSync(path.dirname(destination), { recursive: true })
    const target = path.join(test.outside, 'keep.txt')
    try { symlinkSync(target, destination, 'file') }
    catch (error) { if (error.code === 'EPERM') { t.skip('File symlinks require Windows Developer Mode or symlink privilege'); return } throw error }
    assert.throws(test.run, /symlinks or junctions/)
    assert.equal(readFileSync(target, 'utf8'), 'untouched')
    assert.equal(existsSync(path.join(test.candidate, 'dist-electron')), false)
  }
})

test('extra old compiled entries are rejected before any existing output is overwritten', () => {
  const test = fixture()
  mkdirSync(path.join(test.candidate, 'dist'))
  writeFileSync(path.join(test.candidate, 'dist', 'index.html'), 'old index')
  writeFileSync(path.join(test.candidate, 'dist', 'obsolete.js'), 'old extra')
  assert.throws(test.run, /stale extra entries/)
  assert.equal(readFileSync(path.join(test.candidate, 'dist', 'index.html'), 'utf8'), 'old index')
  assert.equal(readFileSync(path.join(test.candidate, 'dist', 'obsolete.js'), 'utf8'), 'old extra')
  assert.equal(existsSync(path.join(test.candidate, 'package.json')), false)
})

test('metadata identity conflicts and source junctions fail without changing the stage', () => {
  const test = fixture()
  writeFileSync(path.join(test.candidate, 'package.json'), '{"name":"other","version":"2"}')
  assert.throws(test.run, /different candidate stage/)
  assert.equal(readFileSync(path.join(test.candidate, 'package.json'), 'utf8'), '{"name":"other","version":"2"}')
  const linked = fixture()
  symlinkSync(linked.outside, path.join(linked.project, 'dist', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(linked.run, /symlinks or junctions/)
  assert.deepEqual(readdirSync(linked.candidate), [])
})

test('a staging parent inside compiled source output cannot recursively copy itself', () => {
  const test = fixture()
  const parent = path.join(test.project, 'dist', 'package-staging')
  const candidate = path.join(parent, 'candidate')
  assert.throws(() => prepareLocalDesktopStage({ project: test.project, parent, candidate }), /inside compiled source output/)
  assert.equal(existsSync(parent), false)
})
