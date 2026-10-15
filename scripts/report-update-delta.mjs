import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readPinnedUpgradeFixture } from './prepare-nsis-upgrade.mjs'

const require = createRequire(import.meta.url)
const { computeOperations, OperationKind } = require('electron-updater/out/differentialDownloader/downloadPlanBuilder.js')
const LIMIT = 16 * 1024 * 1024

function compareVersions(left, right) {
  const parse = version => {
    if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Invalid release version')
    return version.split('.').map(Number)
  }
  const a = parse(left), b = parse(right)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function readBlockmap(filename, installerBytes) {
  const data = fs.readFileSync(filename)
  if (data.length > LIMIT) throw new Error('Blockmap exceeds report input limit')
  const value = JSON.parse(gunzipSync(data, { maxOutputLength: LIMIT }).toString('utf8'))
  const file = value?.files?.[0]
  if (value.version !== '2' || value.files.length !== 1 || file?.name !== 'file' || file.offset !== 0
    || !Array.isArray(file.checksums) || !Array.isArray(file.sizes) || !file.sizes.length
    || file.sizes.length !== file.checksums.length
    || file.checksums.some(checksum => typeof checksum !== 'string' || !checksum || checksum.length > 256)
    || file.sizes.some(size => !Number.isSafeInteger(size) || size <= 0)
    || file.sizes.reduce((sum, size) => sum + size, 0) !== installerBytes) {
    throw new Error('Unsupported or inconsistent NSIS blockmap; no download estimate was made')
  }
  return value
}

function verifiedArtifact(record) {
  if (!record || !path.isAbsolute(record.path || '') || !/^[a-f0-9]{128}$/i.test(record.sha512 || '')) throw new Error('Baseline artifact identity is incomplete')
  const stat = fs.statSync(record.path)
  if (!stat.isFile() || stat.size !== record.size
    || createHash('sha512').update(fs.readFileSync(record.path)).digest('hex') !== record.sha512.toLowerCase()) {
    throw new Error('Baseline artifact does not match the verified release identity')
  }
  return record
}

export function selectBaseline({ workflowsDir, candidateVersion, explicitState }) {
  if (explicitState) return path.resolve(explicitState)
  if (!fs.existsSync(workflowsDir)) return null
  const candidates = []
  for (const entry of fs.readdirSync(workflowsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const filename = path.join(workflowsDir, entry.name, 'state.json')
    if (!fs.existsSync(filename)) continue
    let state
    try { state = JSON.parse(fs.readFileSync(filename, 'utf8')) } catch { continue }
    if (state.schemaVersion !== 2 || state.stage !== 'verified' || state.leaseStatus !== 'released'
      || !/^\d+\.\d+\.\d+$/.test(state.version || '')) continue
    if (compareVersions(state.version, candidateVersion) < 0) candidates.push({ filename, version: state.version })
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version))
  return candidates[0]?.filename || null
}

export function createDeltaReport({ candidateDir, candidateVersion, workflowsDir, baselineState, pinnedBaseline }) {
  const report = {
    schemaVersion: 1, kind: 'kst-nsis-delta-estimate', candidateVersion,
    generatedAt: new Date().toISOString(), status: 'unavailable',
    method: 'electron-updater.computeOperations', blocksRelease: false,
    limitations: ['Estimate only: not a real client download or timing result.',
      'Requires the matching cached old installer and working HTTP Range; otherwise the client downloads the full installer.',
      'Payload bytes exclude HTTP overhead and blockmap requests.'],
    warnings: [],
  }
  try {
    const installer = path.join(candidateDir, `KST Setup ${candidateVersion}.exe`)
    const candidateStat = fs.statSync(installer)
    if (!candidateStat.isFile() || candidateStat.size <= 0) throw new Error('Candidate installer is missing or empty')
    report.fullDownloadBytes = candidateStat.size
    report.candidateSha512 = createHash('sha512').update(fs.readFileSync(installer)).digest('hex')
    const newMap = readBlockmap(`${installer}.blockmap`, candidateStat.size)
    let baselineVersion, baselineCommitSha, oldInstaller, oldBlockmap
    if (pinnedBaseline) {
      if (compareVersions(pinnedBaseline.version, candidateVersion) >= 0) throw new Error('The pinned baseline must be earlier than the candidate')
      baselineVersion = pinnedBaseline.version
      oldInstaller = verifiedArtifact(pinnedBaseline.installer)
      oldBlockmap = verifiedArtifact(pinnedBaseline.blockmap)
      report.baselineSource = 'reviewed-immutable-production-fixture'
    } else {
      const selected = selectBaseline({ workflowsDir, candidateVersion, explicitState: baselineState })
      if (!selected) throw new Error('No earlier verified and released local baseline. Set TOOLBOX_UPDATE_BASELINE_STATE to its state.json.')
      const state = JSON.parse(fs.readFileSync(selected, 'utf8'))
      if (state.schemaVersion !== 2 || state.stage !== 'verified' || state.leaseStatus !== 'released'
        || compareVersions(state.version, candidateVersion) >= 0) throw new Error('The baseline must be an earlier verified and released version')
      baselineVersion = state.version; baselineCommitSha = state.commitSha
      oldInstaller = verifiedArtifact(state.artifacts?.desktop?.installer)
      oldBlockmap = verifiedArtifact(state.artifacts?.desktop?.blockmap)
      report.baselineSource = 'verified-released-local-state'
    }
    const oldMap = readBlockmap(oldBlockmap.path, oldInstaller.size)
    const operations = computeOperations(oldMap, newMap, { info() {}, debug() {}, warn(message) { report.warnings.push(message) } })
    const downloadBytes = operations.filter(operation => operation.kind === OperationKind.DOWNLOAD)
      .reduce((sum, operation) => sum + operation.end - operation.start, 0)
    const reusedBytes = operations.filter(operation => operation.kind === OperationKind.COPY)
      .reduce((sum, operation) => sum + operation.end - operation.start, 0)
    if (downloadBytes + reusedBytes !== candidateStat.size) throw new Error('Download plan does not cover the candidate')
    Object.assign(report, { status: 'estimated', baselineVersion,
      baselineCommitSha, baselineSha512: oldInstaller.sha512,
      estimatedDownloadBytes: downloadBytes, reusableBytes: reusedBytes,
      estimatedDownloadPercent: Math.round(downloadBytes / candidateStat.size * 10000) / 100,
      downloadRangeCount: operations.filter(operation => operation.kind === OperationKind.DOWNLOAD).length,
      baselineArtifactHashesVerified: true })
    if (downloadBytes / candidateStat.size >= 0.8) report.warnings.push('DELTA_PAYLOAD_HIGH: at least 80% of the installer must be downloaded; review packaging changes. Necessary security updates are not blocked.')
  } catch (error) {
    report.warnings.push(error instanceof Error ? error.message : String(error))
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))
  const candidateDir = path.resolve(process.env.TOOLBOX_DESKTOP_RELEASE_DIR || metadata.build?.directories?.output || 'release')
  const dataRoot = process.env.TOOLBOX_DATA_ROOT || (process.platform === 'win32' ? 'D:/AmazonToolboxData' : path.join(os.tmpdir(), 'AmazonToolboxData'))
  let pinnedBaseline
  if (process.env.TOOLBOX_UPDATE_BASELINE_VERSION) {
    const fixture = await readPinnedUpgradeFixture(process.env.TOOLBOX_UPDATE_BASELINE_VERSION)
    const directory = process.env.NSIS_FIXTURE_DIR || path.join(dataRoot, 'installer-fixtures')
    pinnedBaseline = { version: fixture.version, installer: { ...fixture, path: path.join(directory, fixture.fileName) },
      blockmap: fixture.blockmap ? { ...fixture.blockmap, path: path.join(directory, fixture.blockmap.fileName) } : null }
  }
  const report = createDeltaReport({ candidateDir, candidateVersion: metadata.version,
    workflowsDir: path.join(dataRoot, 'release-workflows'), baselineState: process.env.TOOLBOX_UPDATE_BASELINE_STATE, pinnedBaseline })
  fs.mkdirSync(candidateDir, { recursive: true })
  const filename = path.join(candidateDir, 'update-delta-report.json')
  const temporary = `${filename}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n')
  fs.renameSync(temporary, filename)
  console.log(`update_delta_report=${filename}`)
  console.log(`update_delta_status=${report.status}`)
  console.log(`update_delta_estimated_percent=${report.estimatedDownloadPercent ?? 'not-measured'}`)
  for (const warning of report.warnings) console.warn(`[update-delta] ${warning}`)
}
