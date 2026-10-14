import { EventEmitter } from 'node:events'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TargetExecutionController as Controller } from '../../../electron/automation/targets/target-controller.cjs'
import type { HostTemplateJournal, TemplateVerification, TemplateReconciliation, BrowserSnapshot } from '../../../electron/automation/targets/contracts.cjs'
import type { TargetPreflightRequest, TargetProfile, SignedTargetProfile, RunPlanPreview, OperationReceipt } from '../../shared/ipc/target-contract'
import type { TrustedHandleRegistrar } from '../../../electron/ipc/trusted-ipc.cjs'
import { makeVerifiedFixture, templateInput, templateSnapshot } from './fixtures/v2-template-fixture'

const paths: string[] = []
const controllers: Controller[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.restoreAllMocks()
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})
function deferred<T>() { let resolveValue!: (value: T) => void; const promise = new Promise<T>(resolve => { resolveValue = resolve }); return { promise, resolve: resolveValue } }

function setup() {
  const source = resolve('dist-electron/electron/automation/targets/target-controller.cjs')
  const require = createRequire(source)
  const { stableJson, checkedUrl, routeAllowed } = require('./profile-policy.cjs')
  const { classifyTargetSnapshot } = require('./v2-probe.cjs')
  const { ExecutionLease } = require('../execution-lease.cjs')
  const { TargetOperationJournal } = require('./operation-journal.cjs')
  const root = mkdtempSync(join(tmpdir(), 'kst-target-controller-')); paths.push(root)
  const keys = generateKeyPairSync('ed25519')
  const publicKeyB64 = (keys.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32).toString('base64')
  const profile: TargetProfile = {
    schemaVersion: 1, id: 'fixture-platform', revision: 1, name: 'fixture', providerId: 'bjysoft', productKey: 'amazon', edition: 'v2', entryUrl: 'https://fixture.invalid/entry',
    allowedRoutes: [{ origin: 'https://fixture.invalid', pathPrefix: '/entry', role: 'entry' }, { origin: 'https://fixture.invalid', pathPrefix: '/ECrossAmazon', role: 'business' }],
    reviewStatus: 'approved', capabilities: ['template.create.v1'], adapterVersion: 'bjysoft-v2-template.1',
    evidence: { edition: 'v2', pageFingerprint: classifyTargetSnapshot(templateSnapshot).pageFingerprint, markers: ['amazon-v2', 'seller-shipping-template'], source: 'admin-verified',
      pageFingerprints: { courseMap: classifyTargetSnapshot({ ...templateSnapshot, path: '/ECrossAmazonHome/CourseIndexTraining_1', courseDom: true, templateDom: false }).pageFingerprint,
        templateList: classifyTargetSnapshot(templateSnapshot).pageFingerprint, templateEditor: classifyTargetSnapshot({ ...templateSnapshot, path: '/ECrossAmazon/SellerShippingTemplateSettingAdd' }).pageFingerprint } },
    executionScopes: [{ scenario: 'training', stage: 'not_applicable', courseRef: classifyTargetSnapshot(templateSnapshot).courseRef!, source: 'admin-verified', evidenceRef: 'synthetic-fixture-course' }],
  }
  let profileValue = profile
  let invalidSignature = false
  function signedProfile(): SignedTargetProfile {
    return { profile: profileValue, signature: invalidSignature ? Buffer.alloc(64).toString('base64') : sign(null, Buffer.from(stableJson(profileValue)), keys.privateKey).toString('base64'), signingKeyId: 'fixture-key' }
  }
  let currentOwner = 'owner-A'
  let profileGate: Promise<void> | null = null
  const windows: MockWindow[] = []
  class MockWindow extends EventEmitter {
    destroyed = false
    url = 'about:blank'
    webContents = Object.assign(new EventEmitter(), { getURL: () => this.url, setWindowOpenHandler: vi.fn(), isDestroyed: () => this.destroyed })
    constructor(readonly configuration: { webPreferences: { partition: string } }) { super(); windows.push(this) }
    loadURL = vi.fn(async (url: string) => { this.url = url })
    show = vi.fn(); focus = vi.fn(); isDestroyed = () => this.destroyed
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed') } }
  }
  const fetchMock = vi.fn(async (url: string) => {
    let data: unknown
    if (url.includes('/api/tools/target-profiles')) {
      if (profileGate) await profileGate
      data = [signedProfile()]
    } else if (url.includes('/launch-grant?')) {
      const manifest = { schemaVersion: 2, toolId: 'template-tool', scriptKey: 'bjysoft.v2.template', version: '1.0.0', runnerApiVersion: 2, targetProfileId: profile.id, targetProfileRevision: profile.revision, requiredCapability: 'template.create.v1' }
      data = { launch_data: { token: 'synthetic-grant', tool_id: 'template-tool', platform_key: 'amazon', script_key: manifest.scriptKey, tool_version: manifest.version, runner_api_version: 2, signature_required: true,
        tool_signature: sign(null, Buffer.from(stableJson(manifest)), keys.privateKey).toString('base64'), signing_key_id: 'fixture-key', tool_manifest: manifest, target_profile: signedProfile() } }
    } else if (url.endsWith('/api/tools/launch-grant/verify')) data = { valid: true, tool_id: 'template-tool', platform_key: 'amazon', target_profile_id: profile.id, target_profile_revision: profile.revision, required_capability: 'template.create.v1' }
    else if (url.endsWith('/api/executions/reconcile')) data = { accepted: true, duplicate: false, reconciled: true, execution_id: 1 }
    else throw new Error(`Unexpected control path ${new URL(url).pathname}`)
    return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data }) }
  })
  const session = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() })
  let bindingEnabled = false
  const resolveBinding = vi.fn(() => bindingEnabled ? { id: 'internal-contract-test-only' } : undefined)
  const submitBusiness = vi.fn()
  const proof: TemplateVerification = { templateId: 22, name: templateInput.name, ruleCount: 1, verification: 'same-object-list-and-details', evidence: [{ method: 'POST', path: '/ECrossAmazon/SaveTemplate', httpStatus: 200, code: 0 }] }
  const runMock = vi.fn(async (_plan: unknown, _probe: unknown, dependencies: { journal: HostTemplateJournal }) => {
    await dependencies.journal.beforeMutation()
    await dependencies.journal.beforeSubmit()
    submitBusiness()
    await dependencies.journal.verified(proof)
  })
  const reconcileMock = vi.fn<() => Promise<TemplateReconciliation>>(async () => ({ status: 'not_found' }))
  let drainGate: Promise<void> = Promise.resolve()
  let draining = false
  let snapshot = structuredClone(templateSnapshot)
  const cancelRunner = vi.fn()
  const portDispose = vi.fn()
  const portsOpened: string[][] = []
  const cjs = { exports: {} }
  runInNewContext(readFileSync(source, 'utf8'), {
    require: (name: string) => {
      if (name === 'electron') return { app: { getVersion: () => '1.8.16' }, BrowserWindow: MockWindow, net: { fetch: fetchMock }, session: { fromPartition: () => session } }
      if (name === './ui-bindings.cjs') return { resolveUiBinding: resolveBinding }
      if (name === './target-runner-client.cjs') return { TargetRunnerClient: class { run = runMock; cancel = cancelRunner; dispose = vi.fn(); get isDraining() { return draining }; whenDrained = () => drainGate } }
      if (name === './webcontents-port.cjs') return { createOwnedWebContentsPort: (guest: { getURL(): string }, options: { assertOwnedSession(): void; allowedOrigins: string[] }) => {
        portsOpened.push([...options.allowedOrigins])
        return { kind: 'fixture', inspect: async () => {
          options.assertOwnedSession()
          if (!options.allowedOrigins.includes(new URL(guest.getURL()).origin)) throw Object.assign(new Error('origin changed'), { code: 'TARGET_ORIGIN_BLOCKED' })
          return structuredClone(snapshot)
        }, readCourseFields: async () => ({ courseId: snapshot.context.courseId, shopId: snapshot.context.shopId }), dispose: portDispose }
      } }
      if (name === './v2-template.cjs') return { reconcileV2Template: reconcileMock }
      return require(name)
    }, module: cjs, exports: cjs.exports, process, Buffer, URL, URLSearchParams, AbortSignal, structuredClone, setTimeout, clearTimeout,
  })
  const { TargetExecutionController } = cjs.exports as { TargetExecutionController: typeof Controller }
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const register = ((channel, handler) => handlers.set(channel, handler as unknown as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)) as TrustedHandleRegistrar
  const reports = { reserve: vi.fn(async () => 'report-reservation'), submit: vi.fn<(...args: unknown[]) => Promise<{ warning?: string }>>(async () => ({})) }
  const lease = new ExecutionLease()
  const controller = new TargetExecutionController({ register, lease, reports: reports as never, resolveSession: async () => ({ owner: currentOwner, token: `${currentOwner}-token` }), directory: root, apiBase: 'https://control.invalid', publicKeyB64, signingKeyId: 'fixture-key' })
  controllers.push(controller); controller.register()
  const event = { sender: { id: 7 } } as IpcMainInvokeEvent
  const invoke = async <T = unknown>(name: string, request?: unknown): Promise<T> => await handlers.get(`targets:${name}`)!(event, request) as T
  const open = () => invoke('open', { entryUrl: profile.entryUrl, profileId: profile.id })
  const request: TargetPreflightRequest = { profileId: profile.id, profileRevision: profile.revision, toolId: 'template-tool', scenario: 'training', stage: 'not_applicable', input: structuredClone(templateInput) }
  const prepare = () => invoke<RunPlanPreview>('preflight', request)
  // These seams cover orchestration only. The separate owned-port/navigation
  // tests exercise native controls; this fixture is not live identity evidence.
  const installReadonlyRecoveryNavigation = () => {
    const internals = controller as unknown as {
      collectCourseIdentity(owner: string): Promise<void>
      navigateTemplateList(owner: string, course: BrowserSnapshot['context']): Promise<void>
      site: { epoch: number; verifiedContext?: BrowserSnapshot['verifiedContext']; courseContext?: BrowserSnapshot['context'] }
    }
    const collect = vi.spyOn(internals, 'collectCourseIdentity').mockImplementation(async () => {
      const { proofHash: _oldHash, ...proofFields } = snapshot.verifiedContext!
      const fields = { ...proofFields, siteEpoch: internals.site.epoch }
      internals.site.verifiedContext = { ...fields, proofHash: createHash('sha256').update(JSON.stringify(fields)).digest('hex') }
      internals.site.courseContext = { ...templateSnapshot.context }
    })
    const navigate = vi.spyOn(internals, 'navigateTemplateList').mockImplementation(async () => { snapshot = structuredClone(templateSnapshot) })
    return { collect, navigate }
  }
  return { controller, invoke, open, prepare, reports, fetchMock, windows, lease, submitBusiness, runMock, reconcileMock, cancelRunner, journalClass: TargetOperationJournal, proof, checkedUrl, routeAllowed, request, portsOpened, session, root,
    installReadonlyRecoveryNavigation,
    setOwner: (owner: string) => { currentOwner = owner }, enableBinding: () => { bindingEnabled = true }, setProfileGate: (gate: Promise<void> | null) => { profileGate = gate },
    setProfile: (value: TargetProfile) => { profileValue = value }, profile, invalidSignature: () => { invalidSignature = true },
    setDrain: (gate: Promise<void>, isDraining = true) => { drainGate = gate; draining = isDraining },
    setSnapshot: (value: BrowserSnapshot) => { snapshot = value },
  }
}

describe('controlled target lifecycle and authorisation', () => {
  it('blocks an invalid signed profile before creating a browser', async () => {
    const test = setup(); test.invalidSignature()
    await expect(test.open()).rejects.toMatchObject({ code: 'TARGET_SIGNATURE_INVALID' })
    expect(test.windows).toHaveLength(0)
    expect(test.reports.reserve).not.toHaveBeenCalled()
  })
  it('takes the shared execution lease even while opening waits for control API', async () => {
    const test = setup(); const gate = deferred<void>(); test.setProfileGate(gate.promise)
    const opening = test.open()
    await vi.waitFor(() => expect(test.fetchMock).toHaveBeenCalledTimes(1))
    expect(() => test.lease.acquire()).toThrow()
    await expect(test.invoke('detect')).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    gate.resolve(); await opening
    expect(test.lease.busy).toBe(false)
  })
  it('never reserves or requests a launch grant when the actual UI binding is missing', async () => {
    const test = setup(); await test.open()
    const preview = await test.prepare()
    expect(preview.canExecute).toBe(false)
    await expect(test.invoke('execute', { planId: preview.plan.id })).rejects.toMatchObject({ code: 'TARGET_UI_EVIDENCE_MISSING' })
    expect(test.reports.reserve).not.toHaveBeenCalled()
    expect(test.fetchMock.mock.calls.some(([url]) => url.includes('/launch-grant'))).toBe(false)
    expect(test.runMock).not.toHaveBeenCalled()
  })
  it('does not let another control account use the first account scene or plan', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    test.setOwner('owner-B')
    await expect(test.invoke('detect')).rejects.toMatchObject({ code: 'TARGET_SESSION_REQUIRED' })
    await expect(test.invoke('execute', { planId: preview.plan.id })).rejects.toMatchObject({ code: 'TARGET_PLAN_INVALID' })
    expect(test.reports.reserve).not.toHaveBeenCalled()
  })
  it('requires a fresh plan when the approved profile revision changes', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    test.setProfile({ ...test.profile, revision: 2 })
    await expect(test.invoke('execute', { planId: preview.plan.id })).rejects.toMatchObject({ code: 'TARGET_REVISION_CHANGED' })
    expect(test.reports.reserve).not.toHaveBeenCalled()
  })
  it('consumes one scoped plan once and records a verified operation before reporting', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    expect(await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })).toMatchObject({ status: 'verified', objectRef: '22' })
    await expect(test.invoke('execute', { planId: preview.plan.id })).rejects.toMatchObject({ code: 'TARGET_PLAN_INVALID' })
    expect(test.submitBusiness).toHaveBeenCalledTimes(1)
    expect(test.reports.reserve).toHaveBeenCalledTimes(1)
    expect(test.reports.submit).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }), 'report-reservation')
  })
  it('does not submit when the atomic write-ahead transition fails', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    const original = test.journalClass.prototype.transition
    vi.spyOn(test.journalClass.prototype, 'transition').mockImplementation(function (this: unknown, ...args: unknown[]) {
      if ((args[2] as { status?: string }).status === 'submitting') throw new Error('disk full')
      return original.apply(this, args)
    })
    expect(await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })).toMatchObject({ status: 'not_submitted' })
    expect(test.submitBusiness).not.toHaveBeenCalled()
  })
  it('keeps draft failure definitely unsubmitted and permits a fresh same-name plan without editing history', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => {
      await dependencies.journal.beforeMutation()
      expect(await test.invoke<OperationReceipt[]>('list-receipts')).toEqual([expect.objectContaining({ status: 'prepared', checks: ['draft-edit-authorised-no-submit'] })])
      throw Object.assign(new Error('fixture country unavailable before save'), { code: 'TARGET_NAVIGATION_TIMEOUT' })
    })
    const failed = await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    expect(failed).toMatchObject({ status: 'not_submitted', errorCode: 'TARGET_NAVIGATION_TIMEOUT' })
    expect(test.submitBusiness).not.toHaveBeenCalled()
    const fresh = await test.prepare()
    expect(fresh.plan.id).not.toBe(preview.plan.id)
    expect(await test.invoke<OperationReceipt>('execute', { planId: fresh.plan.id })).toMatchObject({ status: 'verified' })
    expect(test.submitBusiness).toHaveBeenCalledOnce()
    expect(await test.invoke<OperationReceipt[]>('list-receipts')).toEqual([
      expect.objectContaining({ id: failed.id, status: 'not_submitted', errorCode: 'TARGET_NAVIGATION_TIMEOUT' }),
      expect.objectContaining({ status: 'verified' }),
    ])
  })
  it('rechecks the current approved profile at the exact submit boundary after editing', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => {
      await dependencies.journal.beforeMutation()
      test.setProfile({ ...test.profile, revision: 2 })
      await dependencies.journal.beforeSubmit()
      test.submitBusiness()
    })
    expect(await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })).toMatchObject({ status: 'not_submitted', errorCode: 'TARGET_REVISION_CHANGED' })
    expect(test.submitBusiness).not.toHaveBeenCalled()
  })
  it('rechecks the active course/shop identity at the exact submit boundary after editing', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => {
      await dependencies.journal.beforeMutation()
      test.setSnapshot({ ...templateSnapshot, context: { ...templateSnapshot.context, shopId: 'different-fixture-shop' } })
      await dependencies.journal.beforeSubmit()
      test.submitBusiness()
    })
    expect(await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })).toMatchObject({ status: 'not_submitted' })
    expect(test.submitBusiness).not.toHaveBeenCalled()
  })
  it('keeps post-submit timeout and not-found readback pending, never permitting blind retry', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => { await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit(); throw Object.assign(new Error('uncertain'), { code: 'TARGET_RESPONSE_TIMEOUT' }) })
    const receipt = await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    expect(receipt.status).toBe('needs_review')
    expect(receipt.checks).toEqual(['submit-boundary-durably-recorded'])
    expect(receipt.checks).not.toContain('draft-edit-authorised-no-submit')
    const readback = await test.invoke<OperationReceipt>('reconcile', { operationId: receipt.id })
    expect(readback).toMatchObject({ status: 'needs_review', errorCode: 'TARGET_OBJECT_NOT_FOUND' })
    expect(test.runMock).toHaveBeenCalledTimes(1)
    expect(test.reconcileMock).toHaveBeenCalledTimes(1)
  })
  it('rejects a same-object unknown outcome before consuming another grant', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => {
      await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit()
      throw Object.assign(new Error('fixture response lost'), { code: 'TARGET_RESPONSE_TIMEOUT' })
    })
    const first = await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    expect(first.status).toBe('needs_review')
    const grants = test.fetchMock.mock.calls.filter(([url]) => url.includes('/launch-grant')).length
    const next = await test.prepare()
    await expect(test.invoke('execute', { planId: next.plan.id })).rejects.toMatchObject({ code: 'TARGET_DUPLICATE_OR_UNKNOWN' })
    expect(test.fetchMock.mock.calls.filter(([url]) => url.includes('/launch-grant'))).toHaveLength(grants)
    expect(test.reports.submit).toHaveBeenCalledTimes(1)
  })
  it('reconciles directly from a freshly logged-in course map without creating a new plan or grant', async () => {
    const test = setup(); test.enableBinding()
    test.setProfile({ ...test.profile, allowedRoutes: [...test.profile.allowedRoutes, { origin: templateSnapshot.origin, pathPrefix: '/ECrossAmazonHome', role: 'business' }] })
    await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => { await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit(); throw new Error('fixture response lost') })
    const receipt = await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    test.controller.close(); await test.open()
    test.setSnapshot({ ...templateSnapshot, path: '/ECrossAmazonHome/CourseIndexTraining_1', courseDom: true, templateDom: false })
    const flow = test.installReadonlyRecoveryNavigation()
    test.reconcileMock.mockResolvedValueOnce({ status: 'verified', receipt: test.proof })
    const callsBefore = test.fetchMock.mock.calls.filter(([url]) => url.includes('/launch-grant')).length
    expect(await test.invoke<OperationReceipt>('reconcile', { operationId: receipt.id })).toMatchObject({ status: 'verified', objectRef: '22' })
    expect(flow.collect).toHaveBeenCalledExactlyOnceWith('owner-A')
    expect(flow.navigate).toHaveBeenCalledExactlyOnceWith('owner-A', templateSnapshot.context)
    expect(flow.collect.mock.invocationCallOrder[0]).toBeLessThan(flow.navigate.mock.invocationCallOrder[0]!)
    expect(test.runMock).toHaveBeenCalledOnce()
    expect(test.submitBusiness).not.toHaveBeenCalled()
    expect(test.fetchMock.mock.calls.filter(([url]) => url.includes('/launch-grant'))).toHaveLength(callsBefore)
  })
  it.each(['shop', 'account'] as const)('does not navigate from a different course-map %s while reconciling a historical object', async drift => {
    const test = setup(); test.enableBinding()
    test.setProfile({ ...test.profile, allowedRoutes: [...test.profile.allowedRoutes, { origin: templateSnapshot.origin, pathPrefix: '/ECrossAmazonHome', role: 'business' }] })
    await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => { await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit(); throw new Error('fixture response lost') })
    const receipt = await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    test.controller.close(); await test.open()
    test.setSnapshot({ ...templateSnapshot, path: '/ECrossAmazonHome/CourseIndexTraining_1', courseDom: true, templateDom: false,
      ...(drift === 'shop' ? { context: { ...templateSnapshot.context, shopId: '999' } } : { verifiedContext: makeVerifiedFixture('880002', '405') }) })
    const flow = test.installReadonlyRecoveryNavigation()
    await expect(test.invoke('reconcile', { operationId: receipt.id })).rejects.toMatchObject({ code: 'TARGET_CONTEXT_CHANGED' })
    expect(flow.collect).toHaveBeenCalledOnce()
    expect(flow.navigate).not.toHaveBeenCalled()
    expect(test.reconcileMock).not.toHaveBeenCalled()
    expect(await test.invoke<OperationReceipt[]>('list-receipts')).toEqual([expect.objectContaining({ id: receipt.id, status: 'needs_review' })])
  })
  it('requires the audited course-map fingerprint before recovery navigation', async () => {
    const test = setup(); test.enableBinding()
    test.setProfile({ ...test.profile, allowedRoutes: [...test.profile.allowedRoutes, { origin: templateSnapshot.origin, pathPrefix: '/ECrossAmazonHome', role: 'business' }] })
    await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => { await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit(); throw new Error('fixture response lost') })
    const receipt = await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    test.controller.close(); await test.open()
    test.setSnapshot({ ...templateSnapshot, path: '/ECrossAmazonHome/CourseIndexTraining_1', courseDom: true, templateDom: false, controls: ['changed-map-control'] })
    const flow = test.installReadonlyRecoveryNavigation()
    await expect(test.invoke('reconcile', { operationId: receipt.id })).rejects.toMatchObject({ code: 'TARGET_STRUCTURE_CHANGED' })
    expect(flow.navigate).not.toHaveBeenCalled()
    expect(test.reconcileMock).not.toHaveBeenCalled()
  })
  it('does not resurrect an old-owner window after close/logout while profile fetch was pending', async () => {
    const test = setup(); const gate = deferred<void>(); test.setProfileGate(gate.promise)
    const opening = test.open()
    await vi.waitFor(() => expect(test.fetchMock).toHaveBeenCalledTimes(1))
    test.controller.close(); test.lease.invalidate(); test.setOwner('owner-B')
    gate.resolve()
    await expect(opening).rejects.toThrow()
    expect(test.windows).toHaveLength(0)
  })
  it('does not borrow a newer owner permit when a revoked request finishes during the new request', async () => {
    const test = setup(); const oldGate = deferred<void>(); const newGate = deferred<void>()
    test.setProfileGate(oldGate.promise)
    const oldOpening = test.open()
    await vi.waitFor(() => expect(test.fetchMock).toHaveBeenCalledTimes(1))
    test.controller.close(); test.lease.invalidate(); test.setOwner('owner-B')
    test.setProfileGate(newGate.promise)
    const newOpening = test.open()
    await vi.waitFor(() => expect(test.fetchMock).toHaveBeenCalledTimes(2))
    oldGate.resolve()
    await expect(oldOpening).rejects.toThrow()
    expect(test.windows).toHaveLength(0)
    expect(test.lease.busy).toBe(true)
    newGate.resolve(); await newOpening
    expect(test.windows).toHaveLength(1)
    expect(test.lease.busy).toBe(false)
  })
  it('does not persist a late verified callback after closing the platform scene', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    const gate = deferred<void>()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => {
      await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit(); test.submitBusiness()
      await gate.promise; await dependencies.journal.verified(test.proof)
    })
    const execution = test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    await vi.waitFor(() => expect(test.submitBusiness).toHaveBeenCalledTimes(1))
    test.controller.close(); gate.resolve()
    expect(await execution).toMatchObject({ status: 'needs_review', errorCode: 'TARGET_SESSION_REVOKED' })
  })
  it('does not persist a late readback after closing the platform scene', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => { await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit(); throw new Error('uncertain') })
    const receipt = await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    const gate = deferred<void>()
    test.reconcileMock.mockImplementationOnce(async () => { await gate.promise; return { status: 'verified', receipt: test.proof } })
    const readback = test.invoke('reconcile', { operationId: receipt.id })
    await vi.waitFor(() => expect(test.reconcileMock).toHaveBeenCalledTimes(1))
    test.controller.close(); gate.resolve()
    await expect(readback).rejects.toMatchObject({ code: 'TARGET_SESSION_REVOKED' })
    expect(await test.invoke<OperationReceipt[]>('list-receipts')).toEqual([expect.objectContaining({ status: 'needs_review' })])
  })
  it('returns a bounded host failure but retains the shared lease until the host actually drains', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    const gate = deferred<void>()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => {
      await dependencies.journal.beforeMutation()
      await dependencies.journal.beforeSubmit()
      test.setDrain(gate.promise)
      throw Object.assign(new Error('host action still pending'), { code: 'TARGET_HOST_DRAIN_TIMEOUT' })
    })
    expect(await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })).toMatchObject({ status: 'needs_review', errorCode: 'TARGET_HOST_DRAIN_TIMEOUT' })
    expect(test.lease.busy).toBe(true)
    await expect(test.invoke('detect')).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    expect(() => test.lease.acquire()).toThrow()
    gate.resolve()
    await vi.waitFor(() => expect(test.lease.busy).toBe(false))
  })
  it('accepts the observed WebVPN hostname without treating encoded IP labels as private IPs', () => {
    const test = setup()
    const origin = 'https://http-10-28-2-187-851.webvpn.gtcfla.edu.cn'
    expect(test.checkedUrl(`${origin}/User/LoginPage24`).origin).toBe(origin)
    const profile = { ...test.profile, entryUrl: `${origin}/User/LoginPage24`, allowedRoutes: [{ origin, pathPrefix: '/User/LoginPage24', role: 'entry' }, { origin, pathPrefix: '/ECrossCommon/CourseIndexTrainingCourse', role: 'business' }] }
    expect(test.routeAllowed(`${origin}/ECrossCommon/CourseIndexTrainingCourse`, profile, 'business')).toBe(true)
    expect(test.routeAllowed('https://http-10-28-2-188-851.webvpn.gtcfla.edu.cn/ECrossCommon/CourseIndexTrainingCourse', profile, 'business')).toBe(false)
    expect(test.routeAllowed(`${origin}/ECrossCommon/OtherCourse`, profile, 'business')).toBe(false)
    expect(() => test.checkedUrl('http://10.28.2.187:851/User/LoginPage24')).toThrow()
  })
  it('creates distinct isolated browser partitions for distinct control accounts', async () => {
    const test = setup(); await test.open()
    const firstPartition = test.windows[0]!.configuration.webPreferences.partition
    test.controller.close(); test.setOwner('owner-B'); await test.open()
    const secondPartition = test.windows[1]!.configuration.webPreferences.partition
    expect(firstPartition).not.toBe(secondPartition)
    expect(firstPartition).not.toMatch(/^persist:/)
    expect(secondPartition).not.toMatch(/^persist:/)
  })
  it('keeps the global drain fence after logout invalidates the former owner permit', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    const gate = deferred<void>()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => {
      await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit(); test.setDrain(gate.promise)
      throw Object.assign(new Error('pending host action'), { code: 'TARGET_HOST_DRAIN_TIMEOUT' })
    })
    await test.invoke('execute', { planId: preview.plan.id })
    test.controller.close(); test.lease.invalidate(); test.setOwner('owner-B')
    expect(test.lease.busy).toBe(true)
    expect(() => test.lease.acquire()).toThrow()
    await expect(test.open()).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    gate.resolve(); await vi.waitFor(() => expect(test.lease.busy).toBe(false))
    await test.open()
    expect(test.windows).toHaveLength(2)
  })
  it.each(['storage', 'network'])('does not turn durable verification into failure when reporting has a %s failure', async failure => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    if (failure === 'storage') test.reports.submit.mockRejectedValueOnce(new Error('disk unavailable'))
    else test.reports.submit.mockResolvedValueOnce({ warning: 'queued locally' })
    const receipt = await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    expect(receipt.status).toBe('verified')
    expect(receipt.checks).toContain(failure === 'storage' ? 'pending-control-report-storage' : 'pending-control-report')
    expect(test.submitBusiness).toHaveBeenCalledTimes(1)
    expect(await test.invoke<OperationReceipt[]>('list-receipts')).toEqual([expect.objectContaining({ status: 'verified' })])
  })
  it('retains verified business success when the worker exits after proof was persisted', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => {
      await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit(); await dependencies.journal.verified(test.proof)
      throw Object.assign(new Error('child died after proof'), { code: 'TARGET_RUNNER_INTERRUPTED' })
    })
    const receipt = await test.invoke<OperationReceipt>('execute', { planId: preview.plan.id })
    expect(receipt.status).toBe('verified')
    expect(receipt.checks).toContain('runner-completion-interrupted-after-verification')
  })
  it('refreshes to the reviewed entry in the same account partition and invalidates the old plan', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    const oldPartition = test.windows[0]!.configuration.webPreferences.partition
    await test.invoke('refresh')
    expect(test.windows[0]!.destroyed).toBe(true)
    expect(test.windows[1]!.configuration.webPreferences.partition).toBe(oldPartition)
    expect(test.windows[1]!.url).toBe(test.profile.entryUrl)
    await expect(test.invoke('execute', { planId: preview.plan.id })).rejects.toMatchObject({ code: 'TARGET_PLAN_INVALID' })
    expect(test.reports.reserve).not.toHaveBeenCalled()
  })
  it('does not refresh away an active or draining submission', async () => {
    const test = setup(); test.enableBinding(); await test.open(); const preview = await test.prepare()
    const gate = deferred<void>()
    test.runMock.mockImplementationOnce(async (_plan, _probe, dependencies) => {
      await dependencies.journal.beforeMutation(); await dependencies.journal.beforeSubmit(); test.setDrain(gate.promise)
      throw Object.assign(new Error('pending host action'), { code: 'TARGET_HOST_DRAIN_TIMEOUT' })
    })
    await test.invoke('execute', { planId: preview.plan.id })
    await expect(test.invoke('refresh')).rejects.toMatchObject({ code: 'RUN_ALREADY_ACTIVE' })
    expect(test.windows[0]!.destroyed).toBe(false)
    expect(test.windows).toHaveLength(1)
    gate.resolve()
  })
  it('requires this window successful login evidence before collecting a course-map identity', async () => {
    const test = setup(); await test.open()
    test.setSnapshot({ ...templateSnapshot, path: '/ECrossAmazonHome/CourseIndexTraining_1', courseDom: true, templateDom: false })
    await expect(test.prepare()).rejects.toMatchObject({ code: 'TARGET_LOGIN_EVIDENCE_REQUIRED' })
    expect(test.reports.reserve).not.toHaveBeenCalled()
    expect(test.runMock).not.toHaveBeenCalled()
  })
  it('lets an unknown entry follow manual login/course redirects and rebinds only the read-only probe origin', async () => {
    const test = setup()
    await test.invoke('open', { entryUrl: 'https://gateway.invalid/User/LoginPage24' })
    await test.invoke('detect')
    const navigation = { preventDefault: vi.fn() }
    test.windows[0]!.webContents.emit('will-navigate', navigation, 'https://course.invalid/ECrossAmazonHome/CourseIndexTraining_1')
    expect(navigation.preventDefault).not.toHaveBeenCalled()
    test.windows[0]!.url = 'https://course.invalid/ECrossAmazonHome/CourseIndexTraining_1'
    await test.invoke('detect')
    expect(test.portsOpened).toEqual([['https://gateway.invalid'], ['https://course.invalid']])
    await expect(test.prepare()).rejects.toMatchObject({ code: 'TARGET_SESSION_PROFILE_MISMATCH' })
    expect(test.reports.reserve).not.toHaveBeenCalled()
    expect(test.runMock).not.toHaveBeenCalled()
  })
  it('never promotes an unaudited vendor sibling origin after approval', async () => {
    const test = setup(); await test.open(); await test.invoke('detect')
    const navigation = { preventDefault: vi.fn() }
    test.windows[0]!.webContents.emit('will-navigate', navigation, 'https://sibling.fixture.invalid/ECrossAmazon/SellerIndex')
    expect(navigation.preventDefault).toHaveBeenCalledTimes(1)
    test.windows[0]!.url = 'https://sibling.fixture.invalid/ECrossAmazon/SellerIndex'
    await expect(test.invoke('detect')).rejects.toMatchObject({ code: 'TARGET_ROUTE_BLOCKED' })
    expect(test.portsOpened).toHaveLength(1)
  })
  it('keeps the login partition when an unknown entry becomes approved but replaces the window policy', async () => {
    const test = setup()
    await test.invoke('open', { entryUrl: test.profile.entryUrl })
    const partition = test.windows[0]!.configuration.webPreferences.partition
    await test.open()
    expect(test.windows[0]!.destroyed).toBe(true)
    expect(test.windows[1]!.configuration.webPreferences.partition).toBe(partition)
    expect(test.session.listenerCount('will-download')).toBe(1)
  })
  it('reopens the updated approved policy instead of indefinitely reusing a stale revision', async () => {
    const test = setup(); await test.open()
    test.setProfile({ ...test.profile, revision: 2 })
    await test.open()
    expect(test.windows[0]!.destroyed).toBe(true)
    expect(test.windows).toHaveLength(2)
    const preview = await test.invoke<RunPlanPreview>('preflight', { ...test.request, profileRevision: 2 })
    expect(preview.plan.context.profileRevision).toBe(2)
  })
  it.each(['practice', 'formal'] as const)('does not present manually selected %s as an observed competition stage', async stage => {
    const test = setup(); test.enableBinding(); await test.open()
    await expect(test.invoke<RunPlanPreview>('preflight', { ...test.request, scenario: 'competition', stage })).rejects.toMatchObject({ code: 'TARGET_SCENARIO_UNVERIFIED' })
    expect(test.reports.reserve).not.toHaveBeenCalled()
    expect(test.runMock).not.toHaveBeenCalled()
  })
  it('does not reconcile a historical competition attempt against an unverified current stage', async () => {
    const test = setup(); await test.open()
    const preview = await test.prepare()
    // A historical on-disk competition record is distinct from a newly
    // approved plan; current preflight cannot create this old shape anymore.
    preview.plan.context.scenario = 'competition'; preview.plan.context.stage = 'formal'
    const { targetHash } = createRequire(resolve('dist-electron/electron/automation/targets/target-controller.cjs'))('./profile-policy.cjs')
    preview.plan.contextHash = targetHash(preview.plan.context)
    const historicalJournal = new test.journalClass(test.root)
    const receipt = historicalJournal.begin('owner-A', preview.plan)
    historicalJournal.transition('owner-A', receipt.id, { status: 'submitting' })
    await expect(test.invoke('reconcile', { operationId: receipt.id })).rejects.toMatchObject({ code: 'TARGET_STAGE_UNVERIFIED' })
    expect(test.reconcileMock).not.toHaveBeenCalled()
    expect(await test.invoke<OperationReceipt[]>('list-receipts')).toEqual([expect.objectContaining({ status: 'needs_review' })])
  })
  it('does not let a user-declared training value bypass a missing signed course scope', async () => {
    const test = setup(); test.enableBinding(); test.setProfile({ ...test.profile, executionScopes: [] }); await test.open()
    await expect(test.prepare()).rejects.toMatchObject({ code: 'TARGET_SCENARIO_UNVERIFIED' })
    expect(test.reports.reserve).not.toHaveBeenCalled()
  })
  it('does not use a different signed course scope for the current course', async () => {
    const test = setup(); test.enableBinding(); test.setProfile({ ...test.profile, executionScopes: [{ ...test.profile.executionScopes![0]!, courseRef: createHash('sha256').update('other-course').digest('hex') }] }); await test.open()
    await expect(test.prepare()).rejects.toMatchObject({ code: 'TARGET_SCENARIO_UNVERIFIED' })
    expect(test.reports.reserve).not.toHaveBeenCalled()
  })
  it('does not reuse cookies between different exact deployment origins for the same control account', async () => {
    const test = setup()
    await test.invoke('open', { entryUrl: 'https://school.example/User/LoginPage24' })
    const first = test.windows[0]!.configuration.webPreferences.partition
    await test.invoke('open', { entryUrl: 'https://school.example:8443/User/LoginPage24' })
    const second = test.windows[1]!.configuration.webPreferences.partition
    expect(first).not.toBe(second)
  })
  it('does not reuse an unapproved discovery window for a different path on the same origin', async () => {
    const test = setup()
    await test.invoke('open', { entryUrl: 'https://school.example/User/LoginPage24' })
    await test.invoke('open', { entryUrl: 'https://school.example/User/Welcome6' })
    expect(test.windows).toHaveLength(2)
    expect(test.windows[0]!.destroyed).toBe(true)
    expect(test.windows[1]!.destroyed).toBe(false)
  })
})
