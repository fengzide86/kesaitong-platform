/* global fetch, AbortSignal */
import process from 'node:process'
import console from 'node:console'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, URL } from 'node:url'

const fixtureFiles = Object.freeze({
  '1.8.5': './nsis-upgrade-fixture.json',
  '1.8.7': './nsis-upgrade-fixture-1.8.7.json',
  '1.8.8': './nsis-upgrade-fixture-1.8.8.json',
  '1.8.14': './nsis-upgrade-fixture-1.8.14.json',
  '1.8.15': './nsis-upgrade-fixture-1.8.15.json',
})

// Only reviewed, immutable releases may seed an upgrade. Never resolve a
// baseline through latest.yml or accept a caller-provided download URL/hash.
export async function readPinnedUpgradeFixture(version = '1.8.5') {
  if (!Object.hasOwn(fixtureFiles, version)) throw new Error(`Unsupported pinned NSIS baseline: ${version}`)
  const fixture = JSON.parse(await readFile(new URL(fixtureFiles[version], import.meta.url), 'utf8'))
  const expectedName = `KST Setup ${version}.exe`
  if (fixture.version !== version || fixture.fileName !== expectedName
    || fixture.url !== `https://8.130.113.104/updates/${encodeURIComponent(expectedName)}`
    || !Number.isSafeInteger(fixture.size) || fixture.size <= 0
    || !/^[a-f0-9]{128}$/.test(fixture.sha512)) {
    throw new Error(`Invalid pinned NSIS baseline metadata: ${version}`)
  }
  if (fixture.blockmap && (fixture.blockmap.fileName !== `${expectedName}.blockmap`
    || fixture.blockmap.url !== `${fixture.url}.blockmap` || !Number.isSafeInteger(fixture.blockmap.size) || fixture.blockmap.size <= 0
    || !/^[a-f0-9]{128}$/.test(fixture.blockmap.sha512))) throw new Error('Invalid pinned NSIS blockmap metadata')
  return fixture
}

export async function matchesUpgradeFixture(file, fixture) {
  if ((await stat(file).catch(() => null))?.size !== fixture.size) return false
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex') === fixture.sha512
}

export async function prepareUpgradeFixture() {
  const fixture = await readPinnedUpgradeFixture(process.env.NSIS_BASELINE_VERSION || '1.8.5')
  const destination = path.resolve(process.env.NSIS_FIXTURE_DIR || 'D:/AmazonToolboxData/installer-fixtures')
  if (path.parse(destination).root.toLowerCase() !== 'd:\\') throw new Error('Installer fixtures must stay on D:')
  await mkdir(destination, { recursive: true })
  const output = path.join(destination, fixture.fileName)
  if (!await matchesUpgradeFixture(output, fixture)) {
    if (await stat(output).catch(() => null)) throw new Error('Cached old installer has unexpected bytes; preserve it for inspection instead of overwriting')
    const temporary = `${output}.${process.pid}.download`
    const signal = AbortSignal.timeout(900_000)
    try {
      console.log(`Downloading pinned ${fixture.version} installer (maximum 15 minutes, SHA512 checked before execution)`)
      const response = await fetch(fixture.url, { signal, redirect: 'error' })
      if (!response.ok || !response.body) throw new Error(`Pinned old installer download failed: HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }), { signal })
      if (!await matchesUpgradeFixture(temporary, fixture)) throw new Error('Pinned old installer SHA512/size mismatch')
      await rename(temporary, output)
    } finally { await rm(temporary, { force: true }) }
  }
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `NSIS_PREVIOUS_INSTALLER=${output}\nNSIS_PREVIOUS_VERSION=${fixture.version}\n`)
  }
  if (process.env.NSIS_DOWNLOAD_BLOCKMAP === '1') {
    if (!fixture.blockmap) throw new Error('This pinned release has no reviewed blockmap identity')
    const blockmapOutput = path.join(destination, fixture.blockmap.fileName)
    if (!await matchesUpgradeFixture(blockmapOutput, fixture.blockmap)) {
      if (await stat(blockmapOutput).catch(() => null)) throw new Error('Cached baseline blockmap differs; preserve it for inspection')
      const temporary = `${blockmapOutput}.${process.pid}.download`
      try {
        const signal = AbortSignal.timeout(60_000)
        const response = await fetch(fixture.blockmap.url, { signal, redirect: 'error' })
        if (!response.ok || !response.body) throw new Error(`Pinned blockmap download failed: HTTP ${response.status}`)
        await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }), { signal })
        if (!await matchesUpgradeFixture(temporary, fixture.blockmap)) throw new Error('Pinned blockmap SHA512/size mismatch')
        await rename(temporary, blockmapOutput)
      } finally { await rm(temporary, { force: true }) }
    }
    console.log('nsis_baseline_blockmap_sha512=verified')
  }
  console.log(`nsis_previous_version=${fixture.version}`)
  console.log(`nsis_previous_installer=${output}`)
  console.log('nsis_previous_sha512=verified')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareUpgradeFixture()
