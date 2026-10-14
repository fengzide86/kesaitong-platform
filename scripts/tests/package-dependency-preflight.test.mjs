import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import preflight from '../verify-package-dependency-tree.cjs'

const metadata = { name: 'candidate', version: '1.8.16', dependencies: { updater: '^1.0.0' } }
const valid = () => ({ name: 'candidate', version: '1.8.16', dependencies: {
  updater: { version: '1.0.0', path: '/node_modules/updater', dependencies: { 'fs-extra': { version: '10.1.0', path: '/node_modules/fs-extra' } } },
} })
const result = tree => ({ status: 0, stdout: JSON.stringify(tree) })

test('a complete runtime graph passes without ignoring a nonzero package-manager status', () => {
  assert.deepEqual(preflight.verifyTreeResult(metadata, result(valid())), { rootDependencies: 1, graphEntries: 2 })
  assert.throws(() => preflight.verifyTreeResult(metadata, { ...result(valid()), status: 1 }), /no partial tree/)
})

test('the actual missing fs-extra shape, root mismatch and truncated output fail before packaging', () => {
  const tree = valid()
  tree.dependencies.updater.dependencies['fs-extra'] = { missing: true, problems: ['missing: fs-extra'] }
  assert.throws(() => preflight.verifyTreeResult(metadata, result(tree)), /incomplete/)
  assert.throws(() => preflight.verifyTreeResult(metadata, result({ ...valid(), version: '1.8.15' })), /identity/)
  assert.throws(() => preflight.verifyTreeResult(metadata, { status: 0, stdout: '{' }), /truncated/)
  assert.throws(() => preflight.verifyTreeResult(metadata, result({ ...valid(), dependencies: {} })), /root dependency/)
})

test('an external node_modules link is rejected while a physical directory is accepted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kst-package-graph-'))
  try {
    const project = path.join(root, 'project')
    const physical = path.join(root, 'external')
    fs.mkdirSync(project); fs.mkdirSync(physical)
    fs.symlinkSync(physical, path.join(project, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => preflight.verifyDependencyLocation(project), /physical project node_modules/)
    fs.unlinkSync(path.join(project, 'node_modules'))
    fs.mkdirSync(path.join(project, 'node_modules'))
    assert.doesNotThrow(() => preflight.verifyDependencyLocation(project))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
