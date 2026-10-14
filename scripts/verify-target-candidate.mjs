// Local packaged startup and archive evidence only; never a platform business UAT.
/* global process, URL, window, document, getComputedStyle, console */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { extractFile, listPackage, statFile } from '@electron/asar'
import { _electron as electron } from 'playwright-core'

const repository = process.cwd()
assert.ok(process.env.TOOLBOX_DESKTOP_PACKAGE_DIR, 'Select an explicit candidate with TOOLBOX_DESKTOP_PACKAGE_DIR')
const packageDirectory = path.resolve(process.env.TOOLBOX_DESKTOP_PACKAGE_DIR)
const metadata = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'))
const archive = path.join(packageDirectory, 'resources', 'app.asar')
const executable = path.join(packageDirectory, `${metadata.build.productName}.exe`)
const evidenceParent = path.join(process.env.TOOLBOX_DATA_ROOT || 'D:/AmazonToolboxData', 'audits', 'kst-multi-target-candidate')
await mkdir(evidenceParent, { recursive: true })
const evidence = await mkdtemp(path.join(evidenceParent, 'native-start-'))
const diagnostic = { scope: 'packaged startup and local IPC presence; no login, deployment, real platform action, or installer execution', version: metadata.version, packageDirectory, status: 'running', checks: [], files: [], errors: [], externalRequests: [] }
let application
const server = createServer((_request, response) => {
  response.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  response.end('{"detail":"isolated candidate startup"}')
})
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const packagedFile = filename => extractFile(archive, path.join(...filename.split('/')))
async function assertCompiledFile(filename) {
  const packaged = packagedFile(filename)
  const compiled = await readFile(path.join(repository, filename))
  assert.equal(hash(packaged), hash(compiled), `Candidate does not match compiled ${filename}`)
  diagnostic.files.push({ filename, sha256: hash(packaged) })
}
async function currentRendererFiles(relative = 'dist') {
  const files = []
  for (const entry of await readdir(path.join(repository, relative), { withFileTypes: true })) {
    const filename = `${relative}/${entry.name}`
    assert.ok(!entry.isSymbolicLink(), `Renderer integrity requires physical build files, not links: ${filename}`)
    if (entry.isDirectory()) files.push(...await currentRendererFiles(filename))
    else {
      assert.ok(entry.isFile(), `Unsupported renderer build entry: ${filename}`)
      files.push(filename)
    }
  }
  return files
}
async function assertRendererArchive() {
  const patterns = metadata.build.files
  assert.ok(Array.isArray(patterns) && patterns.length > 0 && patterns.every(pattern => typeof pattern === 'string'),
    'Renderer integrity requires the current string-based electron-builder files policy; review new FileSet policies explicitly')
  // Apply the real package include/exclude patterns, including source maps and
  // tests. This does not assume that every local build byproduct belongs in ASAR.
  const includes = patterns.filter(pattern => !pattern.startsWith('!'))
  const excludes = patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1))
  const expected = (await currentRendererFiles()).filter(filename =>
    includes.some(pattern => path.posix.matchesGlob(filename, pattern))
    && !excludes.some(pattern => path.posix.matchesGlob(filename, pattern))).sort()
  assert.ok(expected.includes('dist/index.html'), 'Current desktop renderer build must include dist/index.html')
  const actual = []
  for (const entry of listPackage(archive, {})) {
    const filename = entry.replaceAll('\\', '/').replace(/^\/+/, '')
    if (!filename.startsWith('dist/')) continue
    const information = statFile(archive, path.join(...filename.split('/')), false)
    assert.ok(!('link' in information), `Packaged renderer must not contain links: ${filename}`)
    if (!('files' in information)) actual.push(filename)
  }
  // A set comparison catches obsolete chunks as well as missing current chunks.
  assert.deepEqual(actual.sort(), expected, 'Candidate renderer file set differs from the current desktop build and package policy')
  for (const filename of expected) await assertCompiledFile(filename)
  diagnostic.rendererFileCount = expected.length
  diagnostic.rendererManifestSha256 = hash(Buffer.from(JSON.stringify(diagnostic.files.filter(file => file.filename.startsWith('dist/')))))
  diagnostic.checks.push('complete packaged renderer file set and bytes match the current desktop dist; no missing or obsolete chunks')
}
try {
  for (const filename of [
    'dist-electron/electron/desktop-main.cjs',
    'dist-electron/electron/desktop-application.cjs',
    'dist-electron/electron/automation/execution-lease.cjs',
    'dist-electron/electron/automation/desktop-automation-controller.cjs',
    'dist-electron/electron/automation/targets/target-controller.cjs',
    'dist-electron/electron/automation/targets/target-runner.cjs',
    'dist-electron/electron/automation/targets/target-runner-client.cjs',
    'dist-electron/electron/automation/targets/ui-bindings.cjs',
    'dist-electron/electron/automation/targets/webcontents-port.cjs',
    'dist-electron/electron/automation/targets/v2-probe.cjs',
    'dist-electron/electron/automation/targets/contracts.cjs',
    'dist-electron/electron/automation/targets/v2-template-binding.cjs',
    'dist-electron/electron/automation/targets/v2-template.cjs',
    'dist-electron/electron/automation/targets/verified-context.cjs',
    'dist-electron/electron/automation/targets/local-context-capture.cjs',
    'dist-electron/electron/automation/targets/login-observer.cjs',
    'dist-electron/electron/automation/targets/navigation-scope.cjs',
    'dist-electron/electron/automation/targets/profile-policy.cjs',
    'dist-electron/electron/automation/targets/run-plan.cjs',
    'dist-electron/electron/automation/targets/operation-journal.cjs',
    'dist-electron/src/shared/ipc/target-contract.js',
    'dist-electron/src/shared/ipc/target-template-options.js',
    'dist-electron/electron/preload.cjs',
  ]) {
    await assertCompiledFile(filename)
  }
  diagnostic.checks.push('packaged desktop entrypoint/host/lease/controller/Runner/identity/navigation/template binding/scope contracts/preload match current compiled output')
  await assertRendererArchive()
  const controller = packagedFile('dist-electron/electron/automation/targets/target-controller.cjs').toString('utf8')
  assert.ok(controller.includes('TARGET_UI_EVIDENCE_MISSING'))
  assert.ok(controller.includes('resolveUiBinding'))
  diagnostic.checks.push('missing UI evidence remains a controller execution blocker')
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const api = `http://localhost:${server.address().port}`
  const runtimeRoot = path.join(evidence, 'user-data')
  const environment = { ...process.env, NODE_ENV: 'production', TOOLBOX_RUNTIME_DIR: runtimeRoot,
    TOOLBOX_CONTROL_API_URL: api, TOOLBOX_USE_BUNDLED_BACKEND: 'false' }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.TOOLBOX_RUNNER_MOCK
  application = await electron.launch({ executablePath: executable, env: environment, timeout: 30_000 })
  const packagedState = await application.evaluate(({ app, BrowserWindow, session }, { api, runtimeRoot }) => {
    const path = process.mainModule.require('node:path')
    process.mainModule.require('electron-updater').autoUpdater.setFeedURL({ provider: 'generic', url: api })
    globalThis.__kstCandidateExternalRequests = []
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, callback) => {
      const url = new URL(request.url)
      const external = !['localhost', '127.0.0.1'].includes(url.hostname)
      if (external) globalThis.__kstCandidateExternalRequests.push(`${url.origin}${url.pathname}`)
      callback({ cancel: external })
    })
    for (const window of BrowserWindow.getAllWindows()) {
      window.setPosition(-4000, -4000)
      window.setContentSize(1280, 900)
      window.webContents.setBackgroundThrottling(false)
      window.showInactive()
    }
    const fromArchive = relative => process.mainModule.require(path.join(process.resourcesPath, 'app.asar', relative))
    const bindings = fromArchive('dist-electron/electron/automation/targets/ui-bindings.cjs')
    const shared = fromArchive('dist-electron/src/shared/ipc/target-contract.js')
    const options = fromArchive('dist-electron/src/shared/ipc/target-template-options.js')
    const plans = fromArchive('dist-electron/electron/automation/targets/run-plan.cjs')
    const template = fromArchive('dist-electron/electron/automation/targets/v2-template-binding.cjs')
    const binding = bindings.resolveUiBinding(shared.TARGET_ADAPTER_VERSION)
    const unsupportedAdapters = ['unknown', 'school-v2-template.1', 'bjysoft-v2-template.school.1', 'bjysoft-v3-template.1', 'bjysoft-v2-template.2']
    const rejectedWith = (action, code) => { try { action(); return false } catch (error) { return error?.code === code } }
    // Pure contract checks on synthetic, in-memory values only. No target
    // window, login, request, saved journal or business action is created here.
    const fixtureOrigin = 'https://candidate-fixture.invalid'
    const fingerprint = 'a'.repeat(64)
    const courseRef = 'b'.repeat(64)
    const profile = shared.targetProfileSchema.parse({ schemaVersion: 1, id: 'packaged-contract-fixture', revision: 1, name: 'isolated package contract',
      providerId: 'bjysoft', productKey: 'amazon', edition: 'v2', entryUrl: `${fixtureOrigin}/entry`, reviewStatus: 'approved',
      allowedRoutes: [{ origin: fixtureOrigin, pathPrefix: '/entry', role: 'entry' }, { origin: fixtureOrigin, pathPrefix: '/ECrossAmazon', role: 'business' }],
      capabilities: [shared.TARGET_TEMPLATE_CAPABILITY], adapterVersion: shared.TARGET_ADAPTER_VERSION,
      evidence: { edition: 'v2', pageFingerprint: fingerprint, pageFingerprints: { courseMap: '1'.repeat(64), templateList: fingerprint, templateEditor: '2'.repeat(64) }, markers: ['amazon-v2', 'seller-shipping-template'], source: 'admin-verified' },
      executionScopes: [{ scenario: 'training', stage: 'not_applicable', courseRef, source: 'admin-verified', evidenceRef: 'synthetic-package-contract-only' }] })
    const probe = shared.probeObservationSchema.parse({ kind: 'matched', platformFamily: 'bjy-amazon', version: 'v2', origin: fixtureOrigin,
      path: '/ECrossAmazon/SellerShippingTemplateSetting', pageFingerprint: fingerprint, courseRef, shopRef: 'c'.repeat(64), localAccountRef: 'd'.repeat(64),
      role: '2', evidence: ['verified-local-identity', 'verified-v2-logo', 'template-list-controls-observed'], missing: [] })
    const request = { profileId: profile.id, profileRevision: 1, toolId: 'synthetic-package-contract', scenario: 'training', stage: 'not_applicable',
      input: { name: 'synthetic-package-contract', currency: 'USD', pricingMode: 'weight-item', rules: [{ countries: [...options.V2_MAINLAND_COUNTRIES], serviceCode: '10001', transitTime: options.V2_TEMPLATE_FIXED_TRANSIT['10001'], perOrder: '0', unitRate: '0', unit: 'lb' }] } }
    template.assertSupportedV2TemplateInput(request.input)
    const plan = plans.buildTargetPlan(request, profile, probe)
    plans.assertPlanContext(plan, profile, { ...probe, path: '/ECrossAmazon/SellerShippingTemplateSettingAdd', pageFingerprint: profile.evidence.pageFingerprints.templateEditor })
    const contractChecks = {
      auditedBindingAvailable: binding?.verificationLevel === 'audited-ui' && !binding.id.includes('fixture') && binding.evidenceSources.length > 0,
      auditedBindingMethods: ['readList', 'fillDraft', 'save', 'readDetails', 'regionMatches', 'assertCurrencyAndUnits'].every(method => typeof binding?.[method] === 'function'),
      exactSaveControlAvailable: bindings.isCompiledTargetControl(shared.TARGET_ADAPTER_VERSION, { css: 'button#btnSubmit' }, 'click'),
      unknownAndSchoolAdaptersRejected: unsupportedAdapters.every(version => bindings.resolveUiBinding(version) === undefined && bindings.resolveReadOnlyControls(version).length === 0 && !bindings.isCompiledTargetControl(version, { css: 'button#btnSubmit' }, 'click')),
      arbitrarySelectorRejected: !bindings.isCompiledTargetControl(shared.TARGET_ADAPTER_VERSION, { css: 'body' }, 'click'),
      noUnsignedReadControls: bindings.resolveReadOnlyControls(shared.TARGET_ADAPTER_VERSION).length === 0,
      scopedTrainingContractAvailable: plan.context.courseRef === courseRef && plan.context.scenario === 'training',
      unreviewedSchoolOriginRejected: rejectedWith(() => plans.buildTargetPlan(request, profile, { ...probe, origin: 'https://unreviewed-school.invalid' }), 'TARGET_ROUTE_BLOCKED'),
      sameUrlUnreviewedCourseRejected: rejectedWith(() => plans.buildTargetPlan(request, profile, { ...probe, courseRef: 'e'.repeat(64) }), 'TARGET_SCENARIO_UNVERIFIED'),
      userDeclaredTrainingInsufficient: rejectedWith(() => plans.buildTargetPlan(request, { ...profile, executionScopes: [] }, probe), 'TARGET_SCENARIO_UNVERIFIED'),
      oldSingleFingerprintInsufficient: rejectedWith(() => plans.buildTargetPlan(request, { ...profile, evidence: { ...profile.evidence, pageFingerprints: undefined } }, probe), 'TARGET_STRUCTURE_EVIDENCE_MISSING'),
      changedEditorFingerprintRejected: rejectedWith(() => plans.assertPlanContext(plan, profile, { ...probe, path: '/ECrossAmazon/SellerShippingTemplateSettingAdd' }), 'TARGET_STRUCTURE_CHANGED'),
      declaredFormalRejected: rejectedWith(() => plans.buildTargetPlan({ ...request, scenario: 'competition', stage: 'formal' }, profile, probe), 'TARGET_SCENARIO_UNVERIFIED'),
      v3CannotUseV2Plan: rejectedWith(() => plans.buildTargetPlan(request, profile, { ...probe, version: 'v3' }), 'TARGET_CONTEXT_INCOMPLETE'),
      missingIdentityRejected: rejectedWith(() => plans.buildTargetPlan(request, profile, { ...probe, localAccountRef: null }), 'TARGET_CONTEXT_INCOMPLETE'),
    }
    return { isPackaged: app.isPackaged, version: app.getVersion(), isolated: path.resolve(app.getPath('userData')) === path.resolve(runtimeRoot),
      contractChecks }
  }, { api, runtimeRoot })
  assert.equal(packagedState.isPackaged, true)
  assert.equal(packagedState.version, metadata.version)
  assert.equal(packagedState.isolated, true)
  for (const [name, passed] of Object.entries(packagedState.contractChecks)) assert.equal(passed, true, `Packaged target contract failed: ${name}`)
  diagnostic.contractChecks = packagedState.contractChecks
  diagnostic.checks.push('actual packaged process uses isolated user data', 'packaged audited V2 binding exists without unknown/school adapter fallback', 'synthetic contract checks require reviewed origin/course/identity and per-page fingerprints; no platform actions performed')
  const page = await application.firstWindow()
  page.on('pageerror', error => diagnostic.errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.electronAPI?.runtime?.deviceId) && !document.querySelector('.startup-loading'), null, { timeout: 20_000 })
  assert.match(page.url(), /^app:\/\/toolbox\//)
  const bridge = await page.evaluate(() => ({ methods: Object.keys(window.electronAPI.targets || {}).sort(), controlApi: window.electronAPI.runtime.controlApiBase, title: document.title }))
  assert.deepEqual(bridge.methods, ['close', 'detect', 'execute', 'listReceipts', 'open', 'preflight', 'reconcile', 'refresh'].sort())
  assert.equal(bridge.controlApi, api)
  assert.ok((await page.locator('body').innerText()).includes('授权码'), 'Native login UI must render')
  await page.waitForFunction(() => ['.login-form-card', '.brand-content'].every(selector => {
    const node = document.querySelector(selector)
    return node && Number(getComputedStyle(node).opacity) >= 0.99
  }), null, { timeout: 10_000 })
  diagnostic.checks.push('native app:// login UI rendered', 'trusted preload exposes typed target bridge including refresh', 'control plane is isolated loopback')
  diagnostic.externalRequests = await application.evaluate(() => globalThis.__kstCandidateExternalRequests)
  assert.deepEqual(diagnostic.errors, [])
  assert.deepEqual(diagnostic.externalRequests, [])
  const screenshot = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64'))
  await writeFile(path.join(evidence, 'native-login.png'), Buffer.from(screenshot, 'base64'))
  diagnostic.status = 'passed'
} catch (error) {
  diagnostic.status = 'failed'
  diagnostic.errors.push(error instanceof Error ? error.message : String(error))
  throw error
} finally {
  if (application) await application.close().catch(() => application.process().kill())
  if (server.listening) await new Promise(resolve => server.close(resolve))
  await writeFile(path.join(evidence, 'candidate-runtime.json'), JSON.stringify(diagnostic, null, 2))
  console.log(`target_candidate_runtime=${diagnostic.status}`)
  console.log(`target_candidate_evidence=${evidence}`)
}
