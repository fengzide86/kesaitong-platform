import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ORIGINAL_KNOWN_FOLDER_BLOCK, ORIGINAL_TEMPLATE_SHA256, PATCHED_KNOWN_FOLDER_BLOCK, SAFE_POINTER_COPY, SAFE_UPSTREAM_BUILDER_VERSION, SAFE_UPSTREAM_TEMPLATE_SHA256, patchNsisTemplate, prepareNsisTemplate } from '../../../scripts/prepare-nsis-template.mjs'
import { renderKnownFolderProbe } from '../../../scripts/test-nsis-known-folder-copy.mjs'

// Canonical upstream from the official 26.8.1 npm tarball; its entire file is
// checked against the existing production allowlist, independently of which
// builder happens to be installed in the current npm/pnpm dependency layout.
// Upstream has no final newline; the repository text fixture follows its
// normal trailing-newline convention. Remove that one fixture-only newline.
const original = readFileSync(resolve('src/tests/scripts/fixtures/multiUser-26.8.1.nsh'), 'utf8').replaceAll('\r\n', '\n').replace(/\n$/, '')
// The reviewed 26.15.3 upstream only replaces this block. Reconstructing it
// from the canonical legacy file keeps both version branches covered even
// when CI installs the older builder. The full reviewed hash remains required.
const safeUpstream = original.replace(ORIGINAL_KNOWN_FOLDER_BLOCK, [
  '      StrCpy $0 "$LocalAppData\\Programs"',
  '',
  '      Push $1',
  '      Push $2',
  '      # UserProgramFiles is the per-user install root and can be a non-default location',
  '      StrCpy $2 0',
  '      System::Call \'SHELL32::SHGetKnownFolderPath(g "${FOLDERID_UserProgramFiles}", i ${KF_FLAG_CREATE}, p 0, *p .r2)i.r1\'',
  '      ${If} $1 == 0',
  '        System::Call \'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p\'',
  '      ${endif}',
  '      # SHGetKnownFolderPath may return allocated memory even on failure',
  '      ${If} $2 != 0',
  '        System::Call \'OLE32::CoTaskMemFree(p r2)\'',
  '      ${endif}',
  '      Pop $2',
  '      Pop $1',
  '',
].join('\n'))
const projectRequire = createRequire(resolve('package.json'))
const builderMetadata = projectRequire.resolve('electron-builder/package.json')
const libraryMetadata = createRequire(builderMetadata).resolve('app-builder-lib/package.json')
const installedVersion = JSON.parse(readFileSync(libraryMetadata, 'utf8')).version as string
const installed = readFileSync(join(dirname(libraryMetadata), 'templates/nsis/multiUser.nsh'), 'utf8')
const temporaryRoots: string[] = []

function isolatedBuilder(version: string, template: string): { root: string; filename: string } {
  const root = mkdtempSync(join(tmpdir(), 'kst-nsis-layout-'))
  temporaryRoots.push(root)
  const builder = join(root, 'node_modules', '.pnpm', 'electron-builder-isolated', 'node_modules', 'electron-builder')
  const library = join(dirname(builder), 'app-builder-lib')
  mkdirSync(builder, { recursive: true })
  mkdirSync(join(library, 'templates', 'nsis'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }))
  writeFileSync(join(builder, 'package.json'), JSON.stringify({ name: 'electron-builder', version }))
  writeFileSync(join(library, 'package.json'), JSON.stringify({ name: 'app-builder-lib', version }))
  symlinkSync(builder, join(root, 'node_modules', 'electron-builder'), process.platform === 'win32' ? 'junction' : 'dir')
  const filename = join(library, 'templates', 'nsis', 'multiUser.nsh')
  writeFileSync(filename, template)
  return { root, filename }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    // Only test-owned mkdtemp roots, never a caller-supplied or customer path.
    expect(dirname(root)).toBe(resolve(tmpdir()))
    expect(root.startsWith(join(resolve(tmpdir()), 'kst-nsis-layout-'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  }
})

describe('guarded NSIS known-folder memory fix', () => {
  it('retains the exact reviewed legacy upstream fixture', () => {
    expect(createHash('sha256').update(original).digest('hex')).toBe(ORIGINAL_TEMPLATE_SHA256)
  })
  it('patches only the reviewed block and is repeatable after npm ci', () => {
    const patched = patchNsisTemplate(original, '26.8.1')
    expect(patched.changed).toBe(true)
    expect(patched.source.replace(PATCHED_KNOWN_FOLDER_BLOCK, ORIGINAL_KNOWN_FOLDER_BLOCK)).toBe(original)
    expect(patched.source).not.toMatch(/^\s*System::Store\s/m)
    expect(patched.source).not.toContain('*$2(&w${NSIS_MAX_STRLEN}')
    expect(patched.source).toContain(SAFE_POINTER_COPY)
    expect(patchNsisTemplate(patched.source, '26.8.1')).toEqual({ source: patched.source, changed: false })
  })

  it('keeps original CRLF or LF without broad dependency rewrites', () => {
    const crlf = original.replaceAll('\n', '\r\n')
    const result = patchNsisTemplate(crlf, '26.8.1')
    expect(result.source.replaceAll('\r\n', '\n')).toBe(patchNsisTemplate(original, '26.8.1').source)
    expect(result.source.replaceAll('\r\n', '')).not.toContain('\n')
  })

  it('fails closed on dependency upgrades, drift, partial patches, or duplicate blocks', () => {
    expect(() => patchNsisTemplate(original, '26.9.0')).toThrow('only supports')
    expect(() => patchNsisTemplate(original + '\n# unreviewed', '26.8.1')).toThrow('Unrecognized')
    expect(() => patchNsisTemplate(original.replace('System::Store S', 'Push $1'), '26.8.1')).toThrow('Unrecognized')
    expect(() => patchNsisTemplate(original + ORIGINAL_KNOWN_FOLDER_BLOCK, '26.8.1')).toThrow('Unrecognized')
    const patched = patchNsisTemplate(original, '26.8.1').source
    expect(() => patchNsisTemplate(patched + '\n# unreviewed', '26.8.1')).toThrow('differs')
    expect(() => patchNsisTemplate(patched + PATCHED_KNOWN_FOLDER_BLOCK, '26.8.1')).toThrow('Unrecognized')
  })

  it('does not alter registry recognition, scope, app identity, or /D handling', () => {
    const patched = patchNsisTemplate(original, '26.8.1').source
    const before = original.split(ORIGINAL_KNOWN_FOLDER_BLOCK)
    const after = patched.split(PATCHED_KNOWN_FOLDER_BLOCK)
    expect(after).toEqual(before)
    expect(patched).toContain('ReadRegStr $perUserInstallationFolder HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation')
    expect(patched).toContain('SetShellVarContext current')
    expect(patched).toContain('!insertmacro GetDParameter $R0')
  })

  it('uses the same copy and production block in a non-installing guard-page probe', () => {
    const probe = renderKnownFolderProbe('D:\\isolated\\probe.exe')
    expect(probe.split(PATCHED_KNOWN_FOLDER_BLOCK)).toHaveLength(3)
    expect(probe).toContain('VirtualProtect(p r7, p 4096, i 1, *i .r8)')
    expect(probe).toContain('RequestExecutionLevel user')
    expect(probe).toContain('!define KF_FLAG_CREATE 0')
    expect(probe).not.toMatch(/WriteReg|CreateShortCut|WriteUninstaller|FileOpen|SetOutPath/)
    expect(() => renderKnownFolderProbe('D:\\bad$path\\probe.exe')).toThrow('Unsafe')
  })

  it('all documented NSIS packaging entry points prepare the reviewed template', () => {
    const metadata = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(metadata.scripts['desktop:prepare-nsis']).toBe('node scripts/prepare-nsis-template.mjs')
    for (const command of ['electron:build', 'electron:release']) {
      expect(metadata.scripts[command]).toContain('npm run desktop:prepare-nsis &&')
      expect(metadata.scripts[command].indexOf('desktop:prepare-nsis')).toBeLessThan(metadata.scripts[command].indexOf('electron-builder --win nsis'))
    }
    expect(metadata.build.appId).toBe('com.amazon.toolbox')
    expect(metadata.build.nsis.perMachine).toBeUndefined()
  })

  it('accepts the installed reviewed builder through its dependency context', () => {
    expect(['26.8.1', SAFE_UPSTREAM_BUILDER_VERSION]).toContain(installedVersion)
    const result = patchNsisTemplate(installed, installedVersion)
    if (installedVersion === SAFE_UPSTREAM_BUILDER_VERSION) {
      expect(createHash('sha256').update(installed.replaceAll('\r\n', '\n')).digest('hex')).toBe(SAFE_UPSTREAM_TEMPLATE_SHA256)
      expect(result).toEqual({ source: installed, changed: false })
      expect(installed).toContain("System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'")
      expect(installed).toContain('Push $1\n      Push $2')
      expect(installed).toContain('StrCpy $2 0')
      expect(installed).toContain('${If} $2 != 0')
      expect(installed).toContain('Pop $2\n      Pop $1')
      expect(installed).not.toMatch(/^\s*System::Store\s/m)
      expect(installed).not.toContain('*$2(&w${NSIS_MAX_STRLEN}')
    }
  })

  it('does not accept drift, legacy patch injection or version aliases as safe upstream', () => {
    expect(createHash('sha256').update(safeUpstream).digest('hex')).toBe(SAFE_UPSTREAM_TEMPLATE_SHA256)
    expect(patchNsisTemplate(safeUpstream, SAFE_UPSTREAM_BUILDER_VERSION)).toEqual({ source: safeUpstream, changed: false })
    for (const source of [safeUpstream + '\n# unreviewed', safeUpstream.replace('StrCpy $2 0', 'StrCpy $2 1'), safeUpstream + PATCHED_KNOWN_FOLDER_BLOCK]) {
      expect(() => patchNsisTemplate(source, SAFE_UPSTREAM_BUILDER_VERSION)).toThrow('Unrecognized safe upstream')
    }
    const crlf = safeUpstream.replaceAll('\n', '\r\n')
    expect(patchNsisTemplate(crlf, SAFE_UPSTREAM_BUILDER_VERSION)).toEqual({ source: crlf, changed: false })
    expect(() => patchNsisTemplate(safeUpstream, '26.15.4')).toThrow('only supports')
    expect(() => patchNsisTemplate(safeUpstream, '26.15.3-custom')).toThrow('only supports')
    expect(() => patchNsisTemplate(safeUpstream, '26.8.1')).toThrow('Unrecognized')
    expect(() => patchNsisTemplate(original, SAFE_UPSTREAM_BUILDER_VERSION)).toThrow('Unrecognized safe upstream')
    expect(() => patchNsisTemplate(patchNsisTemplate(original, '26.8.1').source, SAFE_UPSTREAM_BUILDER_VERSION)).toThrow('Unrecognized safe upstream')
  })

  it('patches only the builder-owned library in an isolated pnpm-style layout', () => {
    const fixture = isolatedBuilder('26.8.1', original)
    const decoy = join(fixture.root, 'node_modules', 'app-builder-lib')
    mkdirSync(join(decoy, 'templates', 'nsis'), { recursive: true })
    writeFileSync(join(decoy, 'package.json'), JSON.stringify({ version: '99.0.0' }))
    const decoyFile = join(decoy, 'templates', 'nsis', 'multiUser.nsh')
    writeFileSync(decoyFile, 'unreviewed root-hoisted dependency')
    expect(prepareNsisTemplate(fixture.root)).toEqual({ version: '26.8.1', changed: true })
    expect(readFileSync(fixture.filename, 'utf8')).toContain(PATCHED_KNOWN_FOLDER_BLOCK)
    expect(readFileSync(decoyFile, 'utf8')).toBe('unreviewed root-hoisted dependency')
    expect(prepareNsisTemplate(fixture.root)).toEqual({ version: '26.8.1', changed: false })
  })

  it('verifies safe installed upstream without rewriting and rejects isolated drift', () => {
    const fixture = isolatedBuilder(SAFE_UPSTREAM_BUILDER_VERSION, safeUpstream)
    const before = readFileSync(fixture.filename)
    expect(prepareNsisTemplate(fixture.root)).toEqual({ version: SAFE_UPSTREAM_BUILDER_VERSION, changed: false })
    expect(readFileSync(fixture.filename).equals(before)).toBe(true)
    writeFileSync(fixture.filename, safeUpstream + '\n# unreviewed')
    expect(() => prepareNsisTemplate(fixture.root)).toThrow('Unrecognized safe upstream')
    expect(readFileSync(fixture.filename, 'utf8')).toBe(safeUpstream + '\n# unreviewed')
  })

  it('rejects an unreviewed isolated dependency version without modifying its template', () => {
    const fixture = isolatedBuilder('26.15.4', safeUpstream)
    expect(() => prepareNsisTemplate(fixture.root)).toThrow('only supports')
    expect(readFileSync(fixture.filename, 'utf8')).toBe(safeUpstream)
  })
})
