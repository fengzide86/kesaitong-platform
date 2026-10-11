import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import process from 'node:process'
import console from 'node:console'

const require = createRequire(import.meta.url)
const { UUID } = require('builder-util-runtime')
const asar = require('@electron/asar')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const NSIS_APP_ID = 'com.amazon.toolbox'
export const NSIS_APP_GUID = '159e8ec2-4c1f-5b99-a3ea-a9467c2587ec'
export const NSIS_UUID_NAMESPACE = '50e065bc-3134-11e6-9bab-38c9862bdaf3'

export function readInstallerIdentity(metadata = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))) {
  assert.equal(require('app-builder-lib/package.json').version, '26.15.3', 'Re-audit NSIS registry identity after changing the pinned builder')
  assert.equal(metadata.build.appId, NSIS_APP_ID, 'Unexpected installation AppID')
  assert.equal(metadata.build.nsis?.guid, undefined, 'A custom NSIS GUID requires a separate reviewed registry contract')
  const guid = UUID.v5(NSIS_APP_ID, UUID.parse(NSIS_UUID_NAMESPACE))
  assert.equal(guid, NSIS_APP_GUID, 'Locked electron-builder UUID.v5 identity changed')
  return { appId: NSIS_APP_ID, appGuid: guid, builderVersion: '26.15.3',
    uuidNamespace: NSIS_UUID_NAMESPACE, installKey: `Software\\${guid}`,
    uninstallKey: `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}` }
}

export function verifyInstalledAsar(archivePath, expectedVersion) {
  assert.match(expectedVersion, /^\d+\.\d+\.\d+$/, 'Expected an exact released package version')
  const metadata = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'))
  assert.equal(metadata.version, expectedVersion, 'Installed ASAR must come from the expected actual installer')
  return { version: metadata.version, name: metadata.name, archivePath: path.resolve(archivePath) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, archivePath, version] = process.argv.slice(2)
  if (mode === 'identity') console.log(JSON.stringify(readInstallerIdentity()))
  else if (mode === 'asar') console.log(JSON.stringify(verifyInstalledAsar(archivePath, version)))
  else throw new Error('Expected identity or asar <installed archive> <exact version>')
}
