import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditRuntimeDependencies } from '../package-runtime-dependencies.js'

function fixture(manifests: Record<string, unknown>) {
  return auditRuntimeDependencies(filename => Object.hasOwn(manifests, filename)
    ? typeof manifests[filename] === 'string' ? manifests[filename] as string : JSON.stringify(manifests[filename])
    : undefined)
}

test('required root dependencies must exist inside the package', () => {
  const result = fixture({ 'package.json': { dependencies: { exceljs: '^4.4.0' } } })
  assert.equal(result.rootDependencyCount, 1)
  assert.equal(result.resolvedPackageCount, 0)
  assert.deepEqual(result.issues.map(issue => [issue.code, issue.chain]), [['MISSING_DEPENDENCY', ['<root>', 'exceljs']]])
})

test('all root graphs catch missing jszip/setimmediate and updater/fs-extra dependencies', () => {
  const result = fixture({
    'package.json': { dependencies: { jszip: '^3', 'electron-updater': '^6' } },
    'node_modules/jszip/package.json': { dependencies: { setimmediate: '^1' } },
    'node_modules/electron-updater/package.json': { dependencies: { 'fs-extra': '^11' } },
  })
  assert.deepEqual(result.issues.map(issue => issue.chain), [['<root>', 'jszip', 'setimmediate'], ['<root>', 'electron-updater', 'fs-extra']])
})

test('nearest nested and scoped node_modules win; distinct versions and cycles remain valid', () => {
  const result = fixture({
    'package.json': { dependencies: { a: '1', '@scope/b': '1' } },
    'node_modules/a/package.json': { dependencies: { shared: '1' } },
    'node_modules/a/node_modules/shared/package.json': { dependencies: { nested: '1' } },
    'node_modules/a/node_modules/nested/package.json': { dependencies: { a: '1' } },
    'node_modules/@scope/b/package.json': { dependencies: { shared: '2' } },
    'node_modules/shared/package.json': { dependencies: { hoisted: '1' } },
    'node_modules/hoisted/package.json': { dependencies: { '@scope/b': '1' } },
  })
  assert.equal(result.rootDependencyCount, 2)
  assert.equal(result.resolvedPackageCount, 6)
  assert.deepEqual(result.issues, [])
})

test('dev and optional graphs are excluded, while malformed required manifests fail closed', () => {
  const valid = fixture({
    'package.json': { dependencies: { required: '1', optional: '1' }, optionalDependencies: { optional: '1' }, devDependencies: { dev: '1' } },
    'node_modules/required/package.json': { dependencies: { optionalChild: '1' }, optionalDependencies: { optionalChild: '1' }, devDependencies: { missingDev: '1' } },
  })
  assert.equal(valid.rootDependencyCount, 1)
  assert.deepEqual(valid.issues, [])
  const broken = fixture({ 'package.json': { dependencies: { required: '1' } }, 'node_modules/required/package.json': '{broken' })
  assert.deepEqual(broken.issues.map(issue => [issue.code, issue.chain]), [['INVALID_MANIFEST', ['<root>', 'required']]])
})
