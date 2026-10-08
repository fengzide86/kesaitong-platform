import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { hasPreparedArtifacts, validateReleaseState, verifyDesktopDownloadRange, verifyRetiredWeb } from '../toolbox-cli.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const releaseId = '1.8.14-0123456789ab'
const worker = 'const ownedCache = `workbox-precache-v2-${self.registration.scope}`; self.registration.unregister()'
const oldState = { schemaVersion: 1, releaseId, stage: 'web_activated', version: '1.8.14' }

test('schema 2 accepts only the backend and desktop release stages', () => {
  for (const stage of ['prepared', 'backend_deployed', 'desktop_published', 'verified']) {
    const state = { schemaVersion: 2, releaseId, stage }
    assert.equal(validateReleaseState(state, releaseId), state)
  }
  assert.throws(() => validateReleaseState({ schemaVersion: 2, releaseId, stage: 'web_activated' }, releaseId))
  assert.throws(() => validateReleaseState({ schemaVersion: 2, releaseId, stage: 'prepared', artifacts: { web: {} } }, releaseId), /Web/)
  assert.throws(() => validateReleaseState(oldState, releaseId), /不能自动续跑/)
})

test('legacy resume refuses before preflight and preserves the historical state byte-for-byte', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kst-legacy-release-'))
  try {
    const directory = path.join(dataRoot, 'release-workflows', releaseId)
    fs.mkdirSync(directory, { recursive: true })
    const filename = path.join(directory, 'state.json')
    const content = `${JSON.stringify(oldState, null, 2)}\n`
    fs.writeFileSync(filename, content)
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/toolbox-cli.mjs'), 'release', '--publish', '--dry-run', '--version=1.8.14', `--resume=${releaseId}`], {
      env: { ...process.env, TOOLBOX_DATA_ROOT: dataRoot }, encoding: 'utf8', timeout: 10_000,
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /schemaVersion=1.*不能自动续跑/)
    assert.doesNotMatch(result.stdout, /运行：|SSH|CI/)
    assert.equal(fs.readFileSync(filename, 'utf8'), content)
    assert.deepEqual(fs.readdirSync(directory), ['state.json'])
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('prepared artifacts require backend, installer, blockmap and manifest without an online Web archive', () => {
  const artifacts = { backend: {}, desktop: { installer: {}, blockmap: {}, manifest: {} } }
  assert.equal(hasPreparedArtifacts({ artifacts }), true)
  assert.equal(hasPreparedArtifacts({ artifacts: { ...artifacts, web: {} } }), false)
  assert.equal(hasPreparedArtifacts({ artifacts: { ...artifacts, desktop: { installer: {}, manifest: {} } } }), false)
  const source = fs.readFileSync(path.join(root, 'scripts/toolbox-cli.mjs'), 'utf8')
  assert.doesNotMatch(source, /function publishWeb\(|function createWebArtifact\(|deploy-web\.sh|\['run', 'build:web'\]/)
  assert.match(source, /ops\/deploy\/retire-web\.py/)
  assert.match(source, /ops\/web-retired\/sw\.js/)
  assert.match(source, /run\('npm', \['run', 'verify:release'\]/)
})

function retiredRequest(override = () => undefined) {
  const calls = []
  const request = async (url, options) => {
    calls.push({ url, options })
    const route = new URL(url).pathname
    const replacement = override(route)
    if (replacement) return replacement
    if (route === '/sw.js') return new Response(worker, { headers: { 'content-type': 'application/javascript' } })
    if (route.includes('.')) return new Response('retired', { status: 410 })
    return new Response(null, { status: 302, headers: { location: 'https://kesaitong.top/#' } })
  }
  return { calls, request }
}

test('retirement verifies each audience, old assets, manifest and cleanup worker without following redirects', async () => {
  const { calls, request } = retiredRequest()
  assert.deepEqual(await verifyRetiredWeb('https://control.example/', request), { status: 'retired', destination: 'https://kesaitong.top/#' })
  assert.equal(calls.length, 17)
  assert.ok(calls.every(call => call.options.redirect === 'manual'))
  for (const route of ['/user/history', '/business/workspace', '/admin/users', '/agency/customers']) {
    assert.ok(calls.some(call => new URL(call.url).pathname === route))
  }
})

test('retirement fails if an old UI or static resource becomes publicly accessible again', async () => {
  for (const pathToRestore of ['/admin/users', '/assets/retirement-probe.js', '/web-version.json']) {
    const { request } = retiredRequest(route => route === pathToRestore ? new Response('old app') : undefined)
    await assert.rejects(verifyRetiredWeb('https://control.example', request), /下线检查失败/)
  }
})

test('retirement rejects redirects that leak query or inherit an old fragment', async () => {
  for (const location of ['https://kesaitong.top/', 'https://kesaitong.top/?token=old', 'https://other.example/#']) {
    const { request } = retiredRequest(route => route === '/' ? new Response(null, { status: 302, headers: { location } }) : undefined)
    await assert.rejects(verifyRetiredWeb('https://control.example', request), /旧片段/)
  }
})

test('retirement rejects missing cleanup worker or HTML masquerading as a worker', async () => {
  for (const response of [
    new Response('retired', { status: 410 }),
    new Response('<html>website</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('self.skipWaiting()', { headers: { 'content-type': 'application/javascript' } }),
  ]) {
    const { request } = retiredRequest(route => route === '/sw.js' ? response : undefined)
    await assert.rejects(verifyRetiredWeb('https://control.example', request), /Service Worker/)
  }
})

test('installer download survives retirement with exact HTTP range semantics', async () => {
  const state = { controlUrl: 'https://control.example', artifacts: { desktop: { installer: { path: 'KST Setup 1.8.14.exe', size: 110000000 } } } }
  await verifyDesktopDownloadRange(state, async (url, options) => {
    assert.equal(url, 'https://control.example/updates/KST%20Setup%201.8.14.exe')
    assert.equal(options.headers.Range, 'bytes=0-15')
    return new Response(new Uint8Array(16), { status: 206, headers: { 'content-range': 'bytes 0-15/110000000' } })
  })
  for (const response of [
    new Response('homepage', { status: 200 }),
    new Response(null, { status: 302, headers: { location: 'https://kesaitong.top/#' } }),
    new Response(new Uint8Array(16), { status: 206, headers: { 'content-range': 'bytes 0-15/1' } }),
    new Response(new Uint8Array(15), { status: 206, headers: { 'content-range': 'bytes 0-15/110000000' } }),
  ]) {
    await assert.rejects(verifyDesktopDownloadRange(state, async () => response), /断点下载/)
  }
})
