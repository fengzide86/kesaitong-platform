import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { auditLocalRendererBuild } from '../audit-web-build.mjs'

const fixtures = []
function rendererFixture() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'kst-local-renderer-'))
  fixtures.push(dist)
  fs.mkdirSync(path.join(dist, 'assets'))
  fs.writeFileSync(path.join(dist, 'assets', 'app-testhash.js'), 'export {};')
  fs.writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="./assets/app-testhash.js"></script>')
  return dist
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true })
})

test('accepts a local browser renderer without public Web infrastructure', () => {
  assert.deepEqual(auditLocalRendererBuild(rendererFixture()), { scripts: 1 })
})

for (const retired of ['sw.js', 'registerSW.js', 'workbox-abcd.js', 'manifest.webmanifest', 'web-version.json']) {
  test(`rejects accidental regeneration of ${retired}`, () => {
    const dist = rendererFixture()
    fs.writeFileSync(path.join(dist, retired), '')
    assert.throws(() => auditLocalRendererBuild(dist), /Retired business-Web artifacts/)
  })
}

test('rejects stale manifest registration in the shared renderer HTML', () => {
  const dist = rendererFixture()
  fs.appendFileSync(path.join(dist, 'index.html'), '<link rel="manifest" href="/manifest.webmanifest">')
  assert.throws(() => auditLocalRendererBuild(dist), /must not install a PWA/)
})

test('detects a missing local application script', () => {
  const dist = rendererFixture()
  fs.unlinkSync(path.join(dist, 'assets', 'app-testhash.js'))
  assert.throws(() => auditLocalRendererBuild(dist), /not a local built asset/)
})
