import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import console from 'node:console'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { PATCHED_KNOWN_FOLDER_BLOCK, SAFE_POINTER_COPY } from './prepare-nsis-template.mjs'

// A memory/API probe, NOT an installer: no registry, shortcuts, application
// files, UAC elevation, or production network. Artifacts are retained on D:.
export function renderKnownFolderProbe(executable) {
  if (/["$\r\n]/.test(executable)) throw new Error('Unsafe NSIS probe output path')
  return String.raw`Unicode true
!include LogicLib.nsh
Name "KST NSIS pointer-copy probe"
OutFile "${executable}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
!define FOLDERID_UserProgramFiles {5CD7AEE2-2219-4A67-B85D-6C9CE15660CB}
!define KF_FLAG_CREATE 0
Section
  # Suppress the Windows crash UI: any violation remains a failing exit code.
  System::Call 'KERNEL32::SetErrorMode(i 0x8003)i'
  # Put a six-WCHAR string at the last 12 bytes of a readable page. The next
  # page is PAGE_NOACCESS, so an NSIS_MAX_STRLEN fixed-array read is invalid.
  System::Call 'KERNEL32::VirtualAlloc(p 0, p 8192, i 0x3000, i 4)p.r6'
  StrCmp $6 0 failed
  IntOp $2 $6 + 4084
  System::Call '*$2(&w6 "KST中文")'
  IntOp $7 $6 + 4096
  System::Call 'KERNEL32::VirtualProtect(p r7, p 4096, i 1, *i .r8)i.r9'
  StrCmp $9 0 failed
  Push "stack sentinel"
  ${SAFE_POINTER_COPY}
  StrCmp $1 0 failed
  StrCmp $3 "KST中文" 0 failed
  Pop $9
  StrCmp $9 "stack sentinel" 0 failed
  # Empty string immediately before the guard page must also terminate safely.
  IntOp $2 $7 - 2
  ${SAFE_POINTER_COPY}
  StrCmp $1 0 failed
  StrCmp $3 "" 0 failed
  System::Call 'KERNEL32::VirtualFree(p r6, p 0, i 0x8000)i.r9'
  StrCmp $9 0 failed

  # Exercise the exact production block; no KF_FLAG_CREATE in this probe.
  StrCpy $1 "register one"
  StrCpy $2 "register two"
  StrCpy $3 "register three"
  Push "known folder sentinel"
${PATCHED_KNOWN_FOLDER_BLOCK}
  StrCmp $0 "" failed
  StrCmp $1 "register one" 0 failed
  StrCmp $2 "register two" 0 failed
  StrCmp $3 "register three" 0 failed
  Pop $9
  StrCmp $9 "known folder sentinel" 0 failed

  # Unknown KNOWNFOLDERID: leave the original fallback, preserve registers.
  !undef FOLDERID_UserProgramFiles
  !define FOLDERID_UserProgramFiles {00000000-0000-0000-0000-000000000000}
${PATCHED_KNOWN_FOLDER_BLOCK}
  StrCmp $0 "$LocalAppData\Programs" 0 failed
  StrCmp $1 "register one" 0 failed
  StrCmp $2 "register two" 0 failed
  StrCmp $3 "register three" 0 failed
  SetErrorLevel 0
  Quit
failed:
  SetErrorLevel 51
  Quit
SectionEnd
`
}

async function resolveInstalledBuilderCompiler(root, build, cacheRoot) {
  // Resolve through the builder's own dependency context, including pnpm layouts.
  // The current builder owns the archive checksum, URL-hashed cache directory,
  // compiler location and NSISDIR; an old locally populated cache is not proof.
  const projectRequire = createRequire(path.join(root, 'package.json'))
  const builderMetadata = projectRequire.resolve('electron-builder/package.json')
  const builderRequire = createRequire(builderMetadata)
  const { getMakeNsisPath } = builderRequire('app-builder-lib/out/toolsets/windows.js')
  if (typeof getMakeNsisPath !== 'function') throw new Error('Installed electron-builder does not expose its NSIS compiler resolver')
  const previousCache = process.env.ELECTRON_BUILDER_CACHE
  process.env.ELECTRON_BUILDER_CACHE = cacheRoot
  try {
    return await getMakeNsisPath(build.toolsets?.nsis, build.nsis?.customNsisBinary)
  } finally {
    if (previousCache === undefined) delete process.env.ELECTRON_BUILDER_CACHE
    else process.env.ELECTRON_BUILDER_CACHE = previousCache
  }
}

export async function resolveNsisCompiler({ root = process.cwd(), env = process.env, fileExists = existsSync, resolveBuilderCompiler = resolveInstalledBuilderCompiler } = {}) {
  const dataRoot = path.resolve(env.TOOLBOX_DATA_ROOT || 'D:/AmazonToolboxData')
  let selected
  if (env.KST_NSIS_HOME) {
    const nsisRoot = path.resolve(env.KST_NSIS_HOME)
    const compiler = [path.join(nsisRoot, 'Bin', 'makensis.exe'), path.join(nsisRoot, 'makensis.exe')].find(fileExists)
    if (!compiler) throw new Error('KST_NSIS_HOME does not contain makensis.exe; refusing to fall back to another compiler')
    selected = { path: compiler, env: { NSISDIR: nsisRoot } }
  } else {
    const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    // Match with-toolbox-data-root.mjs, which sets the build cache explicitly.
    const cacheRoot = path.join(dataRoot, 'electron-builder-cache')
    selected = await resolveBuilderCompiler(root, metadata.build || {}, cacheRoot)
  }
  if (!selected?.path || !fileExists(selected.path)) throw new Error('The installed builder resolved a missing NSIS compiler')
  if (path.basename(selected.path).toLowerCase() !== 'makensis.exe') throw new Error('NSIS memory probe requires the reviewed native Windows makensis.exe')
  return selected
}

export async function runKnownFolderProbe() {
  if (process.platform !== 'win32') throw new Error('The real NSIS memory probe requires Windows')
  const dataRoot = path.resolve(process.env.TOOLBOX_DATA_ROOT || 'D:/AmazonToolboxData')
  const compiler = await resolveNsisCompiler()
  const parent = path.join(dataRoot, 'installer-smoke')
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(path.join(parent, 'kst-nsis-memory-probe-'))
  const executable = path.join(directory, 'pointer-copy-probe.exe')
  const source = path.join(directory, 'pointer-copy-probe.nsi')
  writeFileSync(source, renderKnownFolderProbe(executable), 'utf8')
  const compiled = spawnSync(compiler.path, ['/INPUTCHARSET', 'UTF8', '/V2', source], { env: { ...process.env, ...compiler.env }, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  if (compiled.error || compiled.status !== 0) throw new Error(`NSIS probe compilation failed: ${compiled.error?.message || compiled.stderr || compiled.stdout}`)
  const result = spawnSync(executable, [], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  const report = { kind: 'nsis-memory-api-probe', passed: !result.error && result.status === 0, exitCode: result.status, error: result.error?.message, assertions: ['guard-page-unicode', 'guard-page-empty', 'register-and-stack-preservation', 'known-folder-fallback'], compiler: compiler.path, nsisDirectory: compiler.env?.NSISDIR, executable }
  writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2), 'utf8')
  if (!report.passed) throw new Error(`NSIS memory probe failed (${result.status}); evidence: ${directory}`)
  console.log(`nsis_known_folder_memory_probe=passed evidence=${directory}`)
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runKnownFolderProbe()
