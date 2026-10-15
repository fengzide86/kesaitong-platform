import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { extractFile } from '@electron/asar'
import { auditRuntimeDependencies } from './package-runtime-dependencies.js'

const root = process.cwd()
const packageRoot = process.env.TOOLBOX_DESKTOP_PACKAGE_DIR || path.join(root, 'release', 'win-unpacked')
const asarPath = path.join(packageRoot, 'resources', 'app.asar')
const backendPath = path.join(packageRoot, 'resources', 'toolbox-backend.exe')

if (!fs.existsSync(asarPath)) throw new Error(`Packaged app not found: ${asarPath}`)
if (fs.existsSync(backendPath)) throw new Error('Internal production package must not contain the embedded backend')

const asarCli = path.join(root, 'node_modules', '@electron', 'asar', 'bin', 'asar.js')
const asarOutput = execFileSync(process.execPath, [asarCli, 'list', asarPath], { cwd: root, encoding: 'utf8' })
const entries = asarOutput
  .split(/\r?\n/)
  .filter(Boolean)

const forbidden = entries.filter(entry => {
  const normalized = entry.replaceAll('\\', '/')
  if (/(?:^|\/)toolbox-backend\.exe$/i.test(normalized)) return true
  if (/\.(?:ts|cts|map)$/i.test(normalized)) return true
  if (/(?:^|\/)(?:tests?|docs)(?:\/|$)/i.test(normalized)) return true
  if (/(?:^|\/)smoke(?:\/|$)/i.test(normalized)) return true
  if (/^\/?scripts(?:\/|$)/i.test(normalized)) return true
  if (/^\/?node_modules\/exceljs\/dist(?:\/|$)/i.test(normalized)) return true
  if (/^\/?dist\/assets\/(?:js|css)\/LandingView-/i.test(normalized)) return true
  if (/^\/?dist\/assets\/jpg\/(?:team-qualification|competition-award)/i.test(normalized)) return true
  return /(?:admin_)?token\.txt$/i.test(normalized)
})

const requiredAutomationEntries = [
  '/dist-electron/electron/automation-runner.cjs',
  '/dist-electron/electron/automation/adapter-loader.cjs',
  '/dist-electron/electron/automation/scripts/registry.cjs',
]
const missingAutomationEntries = requiredAutomationEntries.filter(required => (
  !entries.some(entry => entry.replaceAll('\\', '/').endsWith(required))
))
if (missingAutomationEntries.length) {
  throw new Error(`Missing packaged automation runtime:\n${missingAutomationEntries.join('\n')}`)
}

if (forbidden.length) {
  throw new Error(`Forbidden package entries:\n${forbidden.slice(0, 30).join('\n')}`)
}

function packagedSource(filename: string): string {
  return extractFile(asarPath, filename).toString('utf8')
}

const runtimeDependencies = auditRuntimeDependencies(filename => {
  try { return extractFile(asarPath, path.join(...filename.split('/'))).toString('utf8') }
  catch { return undefined }
})
if (runtimeDependencies.issues.length) {
  throw new Error(`Incomplete packaged runtime dependencies:\n${runtimeDependencies.issues.map(issue => (
    `${issue.code}: ${issue.chain.join(' -> ')} (${issue.manifestPath}): ${issue.message}`
  )).join('\n')}`)
}

const desktopApplicationSource = packagedSource(
  path.join('dist-electron', 'electron', 'desktop-application.cjs'),
)
const mainWindowSource = packagedSource(
  path.join('dist-electron', 'electron', 'core', 'main-window.cjs'),
)
const automationControllerSource = packagedSource(
  path.join('dist-electron', 'electron', 'automation', 'desktop-automation-controller.cjs'),
)
const mainSource = [
  packagedSource(path.join('dist-electron', 'electron', 'main.cjs')),
  desktopApplicationSource,
  mainWindowSource,
  automationControllerSource,
].join('\n')
const preloadSource = packagedSource(path.join('dist-electron', 'electron', 'preload.cjs'))
const updateManagerSource = packagedSource(path.join('dist-electron', 'electron', 'core', 'update-manager.cjs'))
const indexSource = packagedSource(path.join('dist', 'index.html'))
const internalPolicyFailures: string[] = []

if (!mainSource.includes("packageMetadata.toolbox?.distribution === 'internal'")) {
  internalPolicyFailures.push('internal distribution gate')
}
if (!mainWindowSource.includes('webviewTag: options.automationEnabled')
  || !desktopApplicationSource.includes('automationEnabled: AUTOMATION_RUNTIME_ENABLED')) {
  internalPolicyFailures.push('webview runtime gate')
}
if (mainSource.includes('webviewTag: true')) internalPolicyFailures.push('unconditional webview capability')
if (!/if\s*\(!this\.options\.automationEnabled\)\s*return/.test(automationControllerSource)
  || !automationControllerSource.includes("registerTrustedOn('launch-tool'")) {
  internalPolicyFailures.push('tool launch IPC gate')
}
const conditionalBridge = /\.\.\.\(?automationEnabled\s*\?/.exec(preloadSource)?.index ?? -1
const launchBridge = preloadSource.indexOf('launchTool:')
const conditionalBridgeEnd = preloadSource.indexOf('} : {}', launchBridge)
if (conditionalBridge < 0 || launchBridge < conditionalBridge || conditionalBridgeEnd < launchBridge) {
  internalPolicyFailures.push('tool launch preload gate')
}
if (!preloadSource.includes('demo-activity:set-active')) {
  internalPolicyFailures.push('demo activity update lock bridge')
}
const preloadImports = [...preloadSource.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(match => match[1])
if (!preloadImports.includes('electron') || preloadImports.some(module => module !== 'electron')) {
  internalPolicyFailures.push('sandbox-compatible single-file preload')
}
if (!updateManagerSource.includes('this.updater.autoInstallOnAppQuit = false')) {
  internalPolicyFailures.push('automatic install-on-quit disabled')
}
if (!mainSource.includes("window.loadURL('app://toolbox/index.html')")) {
  internalPolicyFailures.push('app protocol renderer entrypoint')
}
const csp = indexSource.match(/http-equiv=["']Content-Security-Policy["'][^>]*content=(["'])(.*?)\1/i)?.[2] || ''
const scriptPolicy = csp.match(/(?:^|;)\s*script-src\s+([^;]+)/i)?.[1] || ''
if (!scriptPolicy || scriptPolicy.includes("'unsafe-inline'") || scriptPolicy.includes("'unsafe-eval'")) {
  internalPolicyFailures.push('strict renderer script CSP')
}
if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(indexSource)) {
  internalPolicyFailures.push('inline renderer script')
}
if (!indexSource.includes('startup-loading')) internalPolicyFailures.push('static startup fallback')
if (internalPolicyFailures.length) {
  throw new Error(`Missing internal desktop runtime policy: ${internalPolicyFailures.join(', ')}`)
}

const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const packagedExecutable = path.join(packageRoot, `${metadata.build.productName}.exe`)
const spreadsheetCheck = execFileSync(packagedExecutable, [path.join(root, 'scripts/verify-packaged-spreadsheet.cjs'), asarPath], {
  cwd: packageRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '' },
  windowsHide: true, timeout: 30_000, encoding: 'utf8',
})
if (!spreadsheetCheck.includes('packaged_spreadsheet_roundtrip=verified')) throw new Error('Packaged spreadsheet smoke returned no verified result')
console.log(spreadsheetCheck.trim())
const actualLocales = fs.readdirSync(path.join(packageRoot, 'locales')).filter(filename => filename.endsWith('.pak')).sort()
if (JSON.stringify(actualLocales) !== JSON.stringify(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak'])) throw new Error(`Unexpected packaged locales: ${actualLocales.join(', ')}`)
console.log('package_locales=zh-CN,zh-TW,en-US')

console.log(`package_entries=${entries.length}`)
console.log('package_forbidden_entries=0')
console.log('package_internal_runtime_policy=verified')
console.log(`package_runtime_root_dependencies=${runtimeDependencies.rootDependencyCount}`)
console.log(`package_runtime_resolved_packages=${runtimeDependencies.resolvedPackageCount}`)
console.log('package_runtime_dependencies=verified')
