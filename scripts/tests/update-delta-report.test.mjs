import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { createDeltaReport, readBlockmap } from '../report-update-delta.mjs'

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kst-update-delta-'))
  try {
    const workflowsDir = path.join(root, 'workflows'), candidateDir = path.join(root, 'candidate'), baseline = path.join(workflowsDir, 'baseline')
    fs.mkdirSync(candidateDir, { recursive: true }); fs.mkdirSync(baseline, { recursive: true })
    const map = checksums => gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums, sizes: checksums.map(() => 10) }] }))
    const artifact = (directory, name, data) => {
      const filename = path.join(directory, name); fs.writeFileSync(filename, data)
      return { path: filename, size: data.length, sha512: createHash('sha512').update(data).digest('hex') }
    }
    const state = { schemaVersion: 2, version: '1.8.15', stage: 'verified', leaseStatus: 'released', commitSha: 'a'.repeat(40), artifacts: { desktop: {
      installer: artifact(baseline, 'old.exe', Buffer.alloc(30)), blockmap: artifact(baseline, 'old.exe.blockmap', map(['a', 'b', 'c'])),
    } } }
    const statePath = path.join(baseline, 'state.json'); fs.writeFileSync(statePath, JSON.stringify(state))
    artifact(candidateDir, 'KST Setup 1.8.16.exe', Buffer.alloc(30))
    artifact(candidateDir, 'KST Setup 1.8.16.exe.blockmap', map(['a', 'new', 'c']))
    run({ root, candidateDir, workflowsDir, state, statePath, map })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test('computes bytes with the installed updater algorithm and verifies baseline hashes', () => fixture(data => {
  const result = createDeltaReport({ ...data, candidateVersion: '1.8.16' })
  assert.equal(result.status, 'estimated'); assert.equal(result.baselineVersion, '1.8.15')
  assert.equal(result.estimatedDownloadBytes, 10); assert.equal(result.reusableBytes, 20)
  assert.equal(result.estimatedDownloadPercent, 33.33); assert.equal(result.baselineArtifactHashesVerified, true)
  assert.equal(result.blocksRelease, false); assert.ok(result.limitations.some(value => value.includes('not a real client')))
}))

test('a changed installer or corrupted blockmap never produces an apparent successful estimate', () => fixture(data => {
  fs.writeFileSync(data.state.artifacts.desktop.installer.path, Buffer.alloc(30, 1))
  const changed = createDeltaReport({ ...data, candidateVersion: '1.8.16' })
  assert.equal(changed.status, 'unavailable'); assert.equal(changed.estimatedDownloadBytes, undefined)
  assert.match(changed.warnings.join(' '), /verified release identity/)
  fs.writeFileSync(path.join(data.candidateDir, 'KST Setup 1.8.16.exe.blockmap'), 'invalid gzip')
  assert.equal(createDeltaReport({ ...data, candidateVersion: '1.8.16' }).status, 'unavailable')
}))

test('equal/newer/unfinished baselines are rejected; missing baseline remains visible and non-blocking', () => fixture(data => {
  for (const change of [{ version: '1.8.16' }, { version: '2.0.0' }, { stage: 'desktop_published' }, { leaseStatus: 'held' }]) {
    fs.writeFileSync(data.statePath, JSON.stringify({ ...data.state, ...change }))
    const result = createDeltaReport({ ...data, candidateVersion: '1.8.16', baselineState: data.statePath })
    assert.equal(result.status, 'unavailable'); assert.equal(result.blocksRelease, false)
  }
  assert.equal(createDeltaReport({ ...data, workflowsDir: path.join(data.root, 'absent'), candidateVersion: '1.8.16' }).status, 'unavailable')
}))

test('all-new bytes generate a high-payload warning, not a deployment blocker', () => fixture(data => {
  fs.writeFileSync(path.join(data.candidateDir, 'KST Setup 1.8.16.exe.blockmap'), data.map(['x', 'y', 'z']))
  const result = createDeltaReport({ ...data, candidateVersion: '1.8.16' })
  assert.equal(result.estimatedDownloadPercent, 100); assert.equal(result.blocksRelease, false)
  assert.match(result.warnings.join(' '), /DELTA_PAYLOAD_HIGH/)
}))

test('CI pinned-production fixture verifies both bytes without inventing a local deployed state', () => fixture(data => {
  const result = createDeltaReport({ ...data, candidateVersion: '1.8.16', workflowsDir: path.join(data.root, 'absent'),
    pinnedBaseline: { version: data.state.version, ...data.state.artifacts.desktop } })
  assert.equal(result.status, 'estimated'); assert.equal(result.estimatedDownloadBytes, 10)
  assert.equal(result.baselineSource, 'reviewed-immutable-production-fixture')
  assert.equal(result.baselineCommitSha, undefined)
}))

test('blockmap ranges must cover exactly the inert installer and use supported schema', () => fixture(data => {
  const filename = path.join(data.candidateDir, 'KST Setup 1.8.16.exe.blockmap')
  assert.throws(() => readBlockmap(filename, 29), /inconsistent/)
  fs.writeFileSync(filename, gzipSync(JSON.stringify({ version: '3', files: [] })))
  assert.throws(() => readBlockmap(filename, 30), /inconsistent/)
}))
