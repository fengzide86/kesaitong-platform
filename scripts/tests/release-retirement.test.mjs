import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { hasPreparedArtifacts, reconcileBackendCheckpoint, validateReleaseState, verifyDesktopDownloadRange, verifyResumeHead, verifyRetiredWeb, verifyTargetProfileApi } from '../toolbox-cli.mjs'

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
  assert.match(source, /run\('npm', \['run', 'verify:release:attested'\]/)
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

test('target-profile readiness accepts an unauthenticated route but rejects a missing route', async () => {
  const calls = []
  const request = async (url, options) => {
    calls.push({ url, options })
    return new Response(null, { status: 401 })
  }
  assert.deepEqual(await verifyTargetProfileApi('https://control.example/', request), {
    status: 'ready',
    routes: ['/api/tools/target-profiles', '/api/tool-releases/target-profiles'],
  })
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.options.method === 'GET' && call.options.redirect === 'manual'))

  await assert.rejects(
    verifyTargetProfileApi('https://control.example', async url => new Response('missing', { status: url.endsWith('/api/tools/target-profiles') ? 404 : 401 })),
    /target-profile API readiness.*404/,
  )
  await assert.rejects(
    verifyTargetProfileApi('https://control.example', async () => new Response(null, { status: 302, headers: { location: '/login' } })),
    /target-profile API readiness.*302/,
  )
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

test('resume accepts the original commit after main advances but refuses rewritten history and another HEAD', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kst-resume-history-'))
  const git = args => {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(result.stderr || `git exited ${result.status}`)
    return result.stdout.trim()
  }
  try {
    git(['init', '--initial-branch=main'])
    git(['config', 'user.name', 'Offline release test'])
    git(['config', 'user.email', 'offline@example.test'])
    git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'original release'])
    const original = git(['rev-parse', 'HEAD'])
    git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'main advances'])
    const advanced = git(['rev-parse', 'HEAD'])
    git(['update-ref', 'refs/remotes/origin/main', advanced])
    assert.throws(() => verifyResumeHead({ commitSha: original }, git), /原发布状态不一致/)
    git(['checkout', '--detach', original])
    assert.deepEqual(verifyResumeHead({ commitSha: original }, git), { commitSha: original, upstream: 'origin/main' })
    assert.throws(() => verifyResumeHead({ commitSha: 'not-a-commit' }, git), /原发布状态不一致/)
    git(['checkout', '--orphan', 'rewritten'])
    git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'rewritten main'])
    git(['update-ref', 'refs/remotes/origin/main', git(['rev-parse', 'HEAD'])])
    git(['checkout', '--detach', original])
    assert.throws(() => verifyResumeHead({ commitSha: original }, git), /不在当前 origin\/main 历史内/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('new releases retain latest-main and resume retains CI, target, artifact and lease gates', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/toolbox-cli.mjs'), 'utf8')
  assert.match(source, /resumeState \? verifyResumeHead\(resumeState\) : verifyPushedHead\(\)/)
  assert.match(source, /if \(!resumeState && commitSha !== mainSha\)/)
  assert.match(source, /resumeState && resumeState\.version !== version/)
  assert.match(source, /verifyCi \? verifyGithubCi\(commitSha\)/)
  assert.match(source, /if \(!state\.controlUrl \|\| !state\.deploymentTarget\)/)
  assert.match(source, /!sameDeploymentIdentity\(state\.deploymentTarget, preflight\.deploymentTarget\)/)
  assert.match(source, /verifyPreparedArtifacts\(state\)\s+if \(resumeId\) \{\s+await reconcileBackendCheckpoint\(state, \{ assertLease: \(\) => assertRemoteReleaseLease\(state, connection\) \}\)/)
  assert.match(source, /assertRemoteReleaseLease\(state, connection\)\s+state\.backendDeploymentStarted = true\s+writeReleaseState\(state\)\s+await deployBackend\(state, connection\)/)
  assert.match(source, /if \(state\.backendDeploymentStarted === true\) fail\('已尝试后端部署的恢复状态缺少经过验证的发布产物'\)/)
})

function backendCheckpointFixture(overrides = {}) {
  const state = {
    schemaVersion: 2,
    releaseId,
    version: '1.8.14',
    commitSha: '0123456789abcdef0123456789abcdef01234567',
    controlUrl: 'https://control.example',
    stage: 'prepared',
    backendDeploymentStarted: true,
    ...overrides,
  }
  const events = []
  const actions = {
    assertLease() { events.push('lease') },
    async readJson(url) {
      const route = new URL(url).pathname
      events.push(route)
      if (route === '/api/health/live') {
        return { status: 'ok', version: state.version, commit_sha: state.commitSha, release_id: state.releaseId }
      }
      assert.equal(route, '/api/health/ready')
      return { status: 'ok', ready: true }
    },
    async verifyWeb(url) { assert.equal(url, state.controlUrl); events.push('web') },
    saveState(saved) { assert.equal(saved, state); events.push(`save:${saved.stage}`) },
  }
  return { state, events, actions }
}

test('an explicitly unstarted backend can proceed without guessing or promoting a checkpoint', async () => {
  const { state, actions, events } = backendCheckpointFixture({ backendDeploymentStarted: false })
  assert.equal(await reconcileBackendCheckpoint(state, actions), false)
  assert.equal(state.stage, 'prepared')
  assert.deepEqual(events, [])
})

test('a completed checkpoint is not rewritten or probed by reconciliation', async () => {
  const { state, actions, events } = backendCheckpointFixture({ stage: 'backend_deployed' })
  assert.equal(await reconcileBackendCheckpoint(state, actions), false)
  assert.deepEqual(events, [])
})

test('a lost checkpoint is saved only after identity, readiness, retirement and lease revalidation', async () => {
  for (const legacy of [false, true]) {
    const { state, actions, events } = backendCheckpointFixture()
    if (legacy) delete state.backendDeploymentStarted
    assert.equal(await reconcileBackendCheckpoint(state, actions), true)
    assert.equal(state.stage, 'backend_deployed')
    assert.deepEqual(events, ['lease', '/api/health/live', '/api/health/ready', 'web', 'lease', 'save:backend_deployed'])
  }
})

test('different or incomplete live identities never skip or retry an ambiguous deployment', async () => {
  for (const legacy of [false, true]) {
    for (const mismatch of [{ version: '1.8.13' }, { commit_sha: 'f'.repeat(40) }, { release_id: 'different-release' }, { release_id: undefined }, { status: 'degraded' }]) {
      const { state, actions, events } = backendCheckpointFixture()
      if (legacy) delete state.backendDeploymentStarted
      const read = actions.readJson
      actions.readJson = async url => ({ ...await read(url), ...mismatch })
      await assert.rejects(reconcileBackendCheckpoint(state, actions), /线上身份与原发布不一致.*禁止自动重复部署/)
      assert.equal(state.stage, 'prepared')
      assert.deepEqual(events, ['lease', '/api/health/live'])
    }
  }
})

test('degraded, false or missing readiness never promotes the backend checkpoint', async () => {
  for (const ready of [{ status: 'degraded', ready: true }, { status: 'ok', ready: false }, { status: 'ok' }]) {
    const { state, actions, events } = backendCheckpointFixture()
    const read = actions.readJson
    actions.readJson = async url => url.endsWith('/ready') ? ready : read(url)
    await assert.rejects(reconcileBackendCheckpoint(state, actions), /无法确认已尝试的后端已就绪/)
    assert.equal(state.stage, 'prepared')
    assert.ok(!events.some(event => event.startsWith('save:')))
  }
})

test('a still-public business web blocks checkpoint recovery', async () => {
  const { state, actions, events } = backendCheckpointFixture()
  const { request } = retiredRequest(route => route === '/admin/users' ? new Response('old app') : undefined)
  actions.verifyWeb = url => verifyRetiredWeb(url, request)
  await assert.rejects(reconcileBackendCheckpoint(state, actions), /业务 Web 下线检查失败/)
  assert.equal(state.stage, 'prepared')
  assert.ok(!events.some(event => event.startsWith('save:')))
})

test('unknown network results and lost leases never promote a checkpoint', async () => {
  for (const failure of ['live', 'ready', 'initial-lease', 'final-lease']) {
    const { state, actions, events } = backendCheckpointFixture()
    const read = actions.readJson
    actions.readJson = async url => {
      if (url.endsWith(`/${failure}`)) throw new Error('offline probe failed')
      return read(url)
    }
    let leaseCalls = 0
    actions.assertLease = () => {
      leaseCalls += 1
      if ((failure === 'initial-lease' && leaseCalls === 1) || (failure === 'final-lease' && leaseCalls === 2)) {
        throw new Error('lease fenced')
      }
    }
    await assert.rejects(reconcileBackendCheckpoint(state, actions), /offline probe failed|lease fenced/)
    assert.equal(state.stage, 'prepared')
    assert.ok(!events.some(event => event.startsWith('save:')))
  }
})
