import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'

const root = process.cwd()
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseDir = path.resolve(root, process.env.TOOLBOX_DESKTOP_RELEASE_DIR || metadata.build?.directories?.output || 'release')
const manifestPath = path.join(releaseDir, 'latest.yml')
if (!fs.existsSync(manifestPath)) throw new Error(`NSIS update manifest is missing: ${manifestPath}`)

const manifest = fs.readFileSync(manifestPath, 'utf8')
const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(manifest)?.[1]
const installerName = /^path:\s*(.+?)\s*$/m.exec(manifest)?.[1]?.replace(/^['"]|['"]$/g, '')
const sha512 = /^sha512:\s*(\S+)\s*$/m.exec(manifest)?.[1]
if (version !== metadata.version) throw new Error(`latest.yml version ${version || '<missing>'} does not match ${metadata.version}`)
if (!installerName || !sha512) throw new Error('latest.yml must include installer path and sha512')

const installerPath = path.join(releaseDir, installerName)
if (installerName !== path.basename(installerName) || /[\\/]/.test(installerName)) {
  throw new Error('NSIS manifest installer must be a file name, not a path')
}
const blockmapPath = `${installerPath}.blockmap`
for (const required of [installerPath, blockmapPath]) {
  const stat = fs.statSync(required, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.size === 0) throw new Error(`NSIS artifact is missing or empty: ${required}`)
}

const expectedName = `KST Setup ${metadata.version}.exe`
if (path.basename(installerPath) !== expectedName) {
  throw new Error(`Unexpected installer name: ${path.basename(installerPath)} (expected ${expectedName})`)
}

const actualHash = createHash('sha512').update(fs.readFileSync(installerPath)).digest('base64')
if (actualHash !== sha512) throw new Error('NSIS installer SHA512 does not match latest.yml')
const fileHash = /^\s+sha512:\s*(\S+)\s*$/m.exec(manifest)?.[1]
const fileSize = /^\s+size:\s*(\d+)\s*$/m.exec(manifest)?.[1]
const fileUrl = /^\s+- url:\s*(.+?)\s*$/m.exec(manifest)?.[1]?.replace(/^['"]|['"]$/g, '')
if (fileHash !== actualHash || fileUrl !== installerName || Number(fileSize) !== fs.statSync(installerPath).size) {
  throw new Error('NSIS manifest files entry disagrees with installer hash, size or name')
}

process.stdout.write(`nsis_installer=${path.relative(root, installerPath)}\n`)
process.stdout.write(`nsis_blockmap=${path.relative(root, blockmapPath)}\n`)
process.stdout.write(`nsis_manifest=${path.relative(root, manifestPath)}\n`)
process.stdout.write('nsis_sha512=verified\n')
