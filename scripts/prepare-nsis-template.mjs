import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'
import console from 'node:console'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUPPORTED_BUILDER_VERSION = '26.8.1'
export const ORIGINAL_TEMPLATE_SHA256 = '401ed51f541f6bfdbf8f855b026ff6708f20ed2c67569f7b89e5f6942e1e8558'
export const SAFE_UPSTREAM_BUILDER_VERSION = '26.15.3'
export const SAFE_UPSTREAM_TEMPLATE_SHA256 = '9aca256695c289ec8a875143101fae8c6236bc8c6a7cf369bbe8b4986e09c9cb'

export const ORIGINAL_KNOWN_FOLDER_BLOCK = String.raw`      StrCpy $0 "$LocalAppData\Programs"
      System::Store S
      # Win7 has a per-user programfiles known folder and this can be a non-default location
      System::Call 'SHELL32::SHGetKnownFolderPath(g "${'${FOLDERID_UserProgramFiles}'}", i ${'${KF_FLAG_CREATE}'}, p 0, *p .r2)i.r1'
      ${'${If}'} $1 == 0
        System::Call '*$2(&w${'${NSIS_MAX_STRLEN}'} .s)'
        StrCpy $0 $1
        System::Call 'OLE32::CoTaskMemFree(p r2)'
      ${'${endif}'}
      System::Store L`

// SHGetKnownFolderPath returns a NUL-terminated PWSTR, not an NSIS_MAX_STRLEN
// WCHAR array. lstrcpynW writes into the System plug-in's NSIS-sized `w` output
// buffer, stops at NUL, and its count includes the terminator. Native Push/Pop
// avoids System::Store's private register stack and preserves $1/$2/$3.
// References: electron-builder#7921; NSIS Docs/System/System.html;
// Microsoft SHGetKnownFolderPath and lstrcpynW Win32 documentation.
export const SAFE_POINTER_COPY = String.raw`System::Call 'KERNEL32::lstrcpynW(w .r3, p r2, i ${'${NSIS_MAX_STRLEN}'}) p.r1'`
export const PATCHED_KNOWN_FOLDER_BLOCK = String.raw`      StrCpy $0 "$LocalAppData\Programs"
      # KST_NSIS_KNOWN_FOLDER_SAFE_COPY_V1: preserve native registers, not System::Store.
      Push $1
      Push $2
      Push $3
      StrCpy $2 0
      # Preserve Windows' redirected per-user Programs folder and the existing fallback.
      System::Call 'SHELL32::SHGetKnownFolderPath(g "${'${FOLDERID_UserProgramFiles}'}", i ${'${KF_FLAG_CREATE}'}, p 0, *p .r2)i.r1'
      ${'${If}'} $1 == 0
      ${'${AndIf}'} $2 != 0
        ${SAFE_POINTER_COPY}
        ${'${If}'} $1 != 0
          StrCpy $0 $3
        ${'${EndIf}'}
      ${'${EndIf}'}
      # The Win32 contract requires freeing a non-null result even on failure.
      ${'${If}'} $2 != 0
        System::Call 'OLE32::CoTaskMemFree(p r2)'
      ${'${EndIf}'}
      Pop $3
      Pop $2
      Pop $1`

const normalizedHash = source => createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex')

export function patchNsisTemplate(source, version) {
  const normalized = source.replaceAll('\r\n', '\n')
  if (version === SAFE_UPSTREAM_BUILDER_VERSION) {
    // This exact upstream template already uses bounded Unicode copying, native
    // register preservation and a non-null free outside the success branch.
    // Do not extend the legacy patch to newer templates or accept local edits.
    if (normalizedHash(normalized) !== SAFE_UPSTREAM_TEMPLATE_SHA256) {
      throw new Error('Unrecognized safe upstream NSIS multiUser.nsh; refusing an unreviewed packaging template')
    }
    return { source, changed: false }
  }
  if (version !== SUPPORTED_BUILDER_VERSION) throw new Error(`NSIS template patch only supports reviewed app-builder-lib ${SUPPORTED_BUILDER_VERSION} and ${SAFE_UPSTREAM_BUILDER_VERSION}; review ${version} before packaging`)
  if (normalized.split(PATCHED_KNOWN_FOLDER_BLOCK).length === 2) {
    const restored = normalized.replace(PATCHED_KNOWN_FOLDER_BLOCK, ORIGINAL_KNOWN_FOLDER_BLOCK)
    if (normalizedHash(restored) !== ORIGINAL_TEMPLATE_SHA256) throw new Error('Patched NSIS template differs from its reviewed upstream template')
    return { source, changed: false }
  }
  if (normalizedHash(normalized) !== ORIGINAL_TEMPLATE_SHA256
    || normalized.split(ORIGINAL_KNOWN_FOLDER_BLOCK).length !== 2) {
    throw new Error('Unrecognized NSIS multiUser.nsh; refusing an unreviewed packaging patch')
  }
  const patched = normalized.replace(ORIGINAL_KNOWN_FOLDER_BLOCK, PATCHED_KNOWN_FOLDER_BLOCK)
  return { source: source.includes('\r\n') ? patched.replaceAll('\n', '\r\n') : patched, changed: true }
}

export function prepareNsisTemplate(root) {
  // Resolve from the builder's dependency context: pnpm's isolated layout need
  // not expose app-builder-lib at the application node_modules root.
  const projectRequire = createRequire(path.resolve(root, 'package.json'))
  const builderMetadata = projectRequire.resolve('electron-builder/package.json')
  const libraryMetadata = createRequire(builderMetadata).resolve('app-builder-lib/package.json')
  const library = path.dirname(libraryMetadata)
  const { version } = JSON.parse(readFileSync(libraryMetadata, 'utf8'))
  const filename = path.join(library, 'templates', 'nsis', 'multiUser.nsh')
  const result = patchNsisTemplate(readFileSync(filename, 'utf8'), version)
  if (result.changed) writeFileSync(filename, result.source, 'utf8')
  return { changed: result.changed, version }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prepareNsisTemplate(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
  console.log(`nsis_known_folder_patch=${result.changed ? 'applied' : 'verified'} app_builder_lib=${result.version}`)
}
