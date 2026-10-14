import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks'
import { resolve } from 'node:path'
import type { ChildProcess, fork } from 'node:child_process'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { RunPlan } from '../../shared/ipc/target-contract'
import type { TargetBrowserPort, V2TemplateUiBinding } from '../../../electron/automation/targets/contracts.cjs'
import { detailExchange, listExchange, saveExchange, templateInput, templateSnapshot } from './fixtures/v2-template-fixture'

const require = createRequire(import.meta.url)
const { TargetRunnerWorker, targetWorkerMessageSchema } = require(resolve('dist-electron/electron/automation/targets/target-runner.cjs')) as typeof import('../../../electron/automation/targets/target-runner.cjs')
const { TargetRunnerClient } = require(resolve('dist-electron/electron/automation/targets/target-runner-client.cjs')) as typeof import('../../../electron/automation/targets/target-runner-client.cjs')
const { classifyTargetSnapshot } = require(resolve('dist-electron/electron/automation/targets/v2-probe.cjs')) as typeof import('../../../electron/automation/targets/v2-probe.cjs')
const { targetHash } = require(resolve('dist-electron/electron/automation/targets/profile-policy.cjs')) as typeof import('../../../electron/automation/targets/profile-policy.cjs')
const { createOwnedWebContentsPort } = require(resolve('dist-electron/electron/automation/targets/webcontents-port.cjs')) as typeof import('../../../electron/automation/targets/webcontents-port.cjs')

function request() {
  const probe = classifyTargetSnapshot(templateSnapshot)
  const context: RunPlan['context'] = { profileId: 'fixture', profileRevision: 1, edition: 'v2', scenario: 'training', stage: 'not_applicable',
    courseRef: probe.courseRef!, shopRef: probe.shopRef!, localAccountRef: probe.localAccountRef!, role: probe.role! }
  const plan: RunPlan = { id: 'fixture-plan', schemaVersion: 1, context, contextHash: targetHash(context), input: structuredClone(templateInput), inputHash: targetHash(templateInput),
    adapterVersion: 'bjysoft-v2-template.1', recipeId: 'template.create', recipeVersion: '1.0.0', rulePackVersion: 'user-template-1', capability: 'template.create.v1',
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }
  return { plan, probe }
}

function harness(options: { noBinding?: boolean; realBrowser?: boolean; beforeMutation?: () => Promise<void>; beforeSubmit?: () => Promise<void>; timeoutMs?: number; drainTimeoutMs?: number } = {}) {
  const sequence: string[] = []
  let listening: string | null = null
  let lists = 0
  const browser: TargetBrowserPort = {
    kind: options.realBrowser ? 'owned-webcontents' : 'fixture',
    inspect: vi.fn(async () => structuredClone(templateSnapshot)),
    readControl: vi.fn(async () => ({ tagName: 'INPUT', text: '', value: templateInput.name, disabled: false })),
    readControls: vi.fn(async () => [{ tagName: 'INPUT', text: '', value: templateInput.name, disabled: false }]),
    waitForControl: vi.fn(async () => ({ tagName: 'INPUT', text: '', value: templateInput.name, disabled: false })),
    click: vi.fn(async control => {
      sequence.push(`click:${control.css}`)
      if (['#list', '#save', '#details'].includes(control.css)) expect(listening).not.toBeNull()
    }),
    typeAndBlur: vi.fn(async () => { sequence.push('fill') }), select: vi.fn(async () => undefined), reload: vi.fn(async () => undefined), dispose: vi.fn(),
    captureResponse: vi.fn(async (path, action) => {
      expect(listening).toBeNull()
      listening = path; sequence.push(`listen:${path}`)
      try {
        await action()
        if (path === '/ECrossAmazon/GetTemplateList') return listExchange(lists++ > 0)
        if (path === '/ECrossAmazon/SaveTemplate') return saveExchange()
        return detailExchange()
      } finally { listening = null; sequence.push('unlisten') }
    }),
  }
  const binding: V2TemplateUiBinding = {
    id: 'fixture-only-never-platform-uat', verificationLevel: 'fixture-only', evidenceSources: ['synthetic-test-only'],
    readList: port => port.captureResponse('/ECrossAmazon/GetTemplateList', () => port.click({ css: '#list' })),
    fillDraft: async port => { await port.typeAndBlur({ css: '#name' }, templateInput.name); await port.select({ css: '#unit' }, 'item') },
    save: port => port.click({ css: '#save' }),
    readDetails: port => port.captureResponse('/ECrossAmazon/GetFeightRelationList', () => port.click({ css: '#details' })),
    regionMatches: (actual, expected) => expected.length === 1 && actual === expected[0], assertCurrencyAndUnits: async () => undefined,
  }
  const journal = {
    beforeMutation: vi.fn(async () => { sequence.push('journal-before'); await options.beforeMutation?.() }),
    beforeSubmit: vi.fn(async () => { sequence.push('journal-submit'); await options.beforeSubmit?.() }),
    verified: vi.fn(async () => { sequence.push('journal-verified') }),
  }
  const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn(), kill: vi.fn() }) as unknown as ChildProcess
  const worker = new TargetRunnerWorker(message => queueMicrotask(() => child.emit('message', structuredClone(message))), options.noBinding ? undefined : () => binding)
  vi.mocked(child.send).mockImplementation(((message: unknown) => { queueMicrotask(() => worker.accept(structuredClone(message))); return true }) as typeof child.send)
  vi.mocked(child.kill).mockImplementation(() => { worker.dispose(); return true })
  const client = new TargetRunnerClient({ forkFn: (() => child) as typeof fork, timeoutMs: options.timeoutMs || 2000,
    drainTimeoutMs: options.drainTimeoutMs, fixtureReadOnlyControls: [{ css: '#list' }, { css: '#details' }], fixtureReadableControls: [{ css: '#name', scopeCss: '#form' }], fixtureSubmitControls: [{ css: '#save' }] })
  return { client, child, worker, browser, binding, journal, sequence, ...request() }
}

describe('isolated compiled target Runner and main-owned browser RPC', () => {
  it('accepts both complete variants without duplicate discriminators', () => {
    expect(targetWorkerMessageSchema.safeParse({ type: 'complete', runId: 'fixture', ok: false, error: { code: 'TARGET_UI_EVIDENCE_MISSING', message: 'fixture' } }).success).toBe(true)
  })
  it('listens before each UI trigger, durably marks before filling and verifies before completion', async () => {
    const h = harness()
    const receipt = await h.client.run(h.plan, h.probe, h)
    expect(receipt).toMatchObject({ templateId: 2, ruleCount: 1, verification: 'same-object-list-and-details' })
    expect(h.sequence.indexOf('journal-before')).toBeLessThan(h.sequence.indexOf('fill'))
    expect(h.sequence.indexOf('fill')).toBeLessThan(h.sequence.indexOf('journal-submit'))
    expect(h.sequence.indexOf('journal-submit')).toBeLessThan(h.sequence.indexOf('click:#save'))
    expect(h.sequence.at(-1)).toBe('journal-verified')
    expect(h.browser.captureResponse).toHaveBeenCalledTimes(4)
    expect(h.child.kill).toHaveBeenCalledOnce()
    expect(h.browser.dispose).not.toHaveBeenCalled()
  })
  it('retains the original operation context when native IPC arrives from an unrelated async resource', async () => {
    const context = new AsyncLocalStorage<string>()
    const nativeIpc = new AsyncResource('fixture-native-ipc-outside-operation')
    const h = harness()
    vi.mocked(h.child.send).mockImplementation(() => true)
    const observed: Array<string | undefined> = []
    vi.mocked(h.browser.inspect).mockImplementation(async () => {
      observed.push(context.getStore())
      await Promise.resolve()
      observed.push(context.getStore())
      return structuredClone(templateSnapshot)
    })
    vi.mocked(h.journal.beforeMutation).mockImplementation(async () => { observed.push(context.getStore()) })
    const running = context.run('operation-owned-lease', () => h.client.run(h.plan, h.probe, h))
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    const emit = (id: string, action: 'inspect' | 'journal.beforeMutation') => nativeIpc.runInAsyncScope(() => {
      expect(context.getStore()).toBeUndefined()
      h.child.emit('message', { type: 'rpc', runId: run.runId, id, request: { action, payload: {} } })
    })
    emit('native-inspect', 'inspect')
    await vi.waitFor(() => expect(h.browser.inspect).toHaveBeenCalledOnce())
    emit('native-journal', 'journal.beforeMutation')
    await vi.waitFor(() => expect(h.journal.beforeMutation).toHaveBeenCalledOnce())
    expect(observed).toEqual(['operation-owned-lease', 'operation-owned-lease', 'operation-owned-lease'])
    h.client.cancel()
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_CANCELLED' })
    nativeIpc.emitDestroy()
    context.disable()
  })
  it('current production binding rejects unsupported input before reading the browser', async () => {
    const h = harness({ noBinding: true })
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_REGION_UNSUPPORTED' })
    expect(h.browser.inspect).not.toHaveBeenCalled()
    expect(h.journal.beforeMutation).not.toHaveBeenCalled()
  })
  it('cannot promote a fixture binding to an actual owned WebContents', async () => {
    const h = harness({ realBrowser: true })
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_UI_EVIDENCE_MISSING' })
    expect(h.browser.click).not.toHaveBeenCalled()
  })
  it('failed durable marker stops before any draft mutation and does not echo raw errors', async () => {
    const h = harness({ beforeMutation: async () => { throw new Error('credential-private-not-for-ipc') } })
    const error = await h.client.run(h.plan, h.probe, h).catch(error => error)
    expect(error.code).toBe('TARGET_RUNNER_FAILED')
    expect(error.message).not.toContain('credential-private')
    expect(h.browser.typeAndBlur).not.toHaveBeenCalled()
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it('a draft failure never reaches the durable submit boundary', async () => {
    const h = harness()
    h.binding.fillDraft = async port => { await port.typeAndBlur({ css: '#name' }, templateInput.name); throw Object.assign(new Error('fixture draft mismatch'), { code: 'TARGET_DRAFT_MISMATCH' }) }
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_DRAFT_MISMATCH' })
    expect(h.journal.beforeMutation).toHaveBeenCalledOnce()
    expect(h.journal.beforeSubmit).not.toHaveBeenCalled()
    expect(h.sequence).not.toContain('click:#save')
  })
  it('a failed atomic submit marker prevents the actual save click', async () => {
    const h = harness({ beforeSubmit: async () => { throw Object.assign(new Error('fixture disk full'), { code: 'TARGET_JOURNAL_INVALID' }) } })
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_JOURNAL_INVALID' })
    expect(h.sequence).toContain('fill')
    expect(h.journal.beforeSubmit).toHaveBeenCalledOnce()
    expect(h.sequence).not.toContain('click:#save')
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it('the main process rejects repeated save clicks even if the worker attempts both', async () => {
    const h = harness()
    h.binding.save = async port => { await port.click({ css: '#save' }); await port.click({ css: '#save' }) }
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_SUBMIT_ALREADY_ATTEMPTED' })
    expect(h.journal.beforeSubmit).toHaveBeenCalledOnce()
    expect(h.sequence.filter(item => item === 'click:#save')).toHaveLength(1)
  })
  it('cancellation while the submit marker is pending cannot produce a late save click', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const h = harness({ beforeSubmit: () => pending })
    const observed = h.client.run(h.plan, h.probe, h).catch(error => error)
    await vi.waitFor(() => expect(h.journal.beforeSubmit).toHaveBeenCalledOnce())
    h.client.cancel(); release()
    expect((await observed).code).toBe('TARGET_RUNNER_CANCELLED')
    expect(h.sequence).not.toContain('click:#save')
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it('does not expose a worker RPC that can assert the host-only submission boundary', async () => {
    const h = harness()
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    h.child.emit('message', { type: 'rpc', runId: run.runId, id: 'invent-submit', request: { action: 'journal.beforeSubmit', payload: {} } })
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_PROTOCOL_INVALID' })
    expect(h.journal.beforeSubmit).not.toHaveBeenCalled()
    expect(h.browser.click).not.toHaveBeenCalled()
  })
  it('uses the exact compiled submit control on a real port and ignores fixture submit selectors', async () => {
    const h = harness({ realBrowser: true })
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    const emit = (id: string, request: unknown) => h.child.emit('message', { type: 'rpc', runId: run.runId, id, request })
    emit('draft-marker', { action: 'journal.beforeMutation', payload: {} })
    await vi.waitFor(() => expect(h.child.send).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'draft-marker', ok: true })))
    emit('fixture-save', { action: 'click', payload: { control: { css: '#save' } } })
    await vi.waitFor(() => expect(h.child.send).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'fixture-save', ok: false, error: expect.objectContaining({ code: 'TARGET_CONTROL_NOT_APPROVED' }) })))
    expect(h.journal.beforeSubmit).not.toHaveBeenCalled()
    emit('compiled-save', { action: 'click', payload: { control: { css: 'button#btnSubmit' } } })
    await vi.waitFor(() => expect(h.browser.click).toHaveBeenCalledExactlyOnceWith({ css: 'button#btnSubmit' }))
    expect(h.journal.beforeSubmit).toHaveBeenCalledOnce()
    expect(h.sequence.indexOf('journal-submit')).toBeLessThan(h.sequence.indexOf('click:button#btnSubmit'))
    h.client.cancel()
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_CANCELLED' })
  })
  it('cannot claim verified execution after bypassing the actual main-controlled save', async () => {
    const h = harness()
    h.binding.save = async () => undefined
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_VERIFY_PROOF_REQUIRED' })
    expect(h.journal.beforeSubmit).not.toHaveBeenCalled()
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it.each(['input', 'expired', 'context'] as const)('rejects %s drift before RPC', async kind => {
    const h = harness()
    if (kind === 'input') h.plan.input.name = 'changed'
    if (kind === 'expired') h.plan.expiresAt = new Date(Date.now() - 1).toISOString()
    if (kind === 'context') h.probe.shopRef = 'f'.repeat(64)
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_PLAN_MISMATCH' })
    expect(h.browser.inspect).not.toHaveBeenCalled()
  })
  it('failed UI action releases capture listener and cannot verify', async () => {
    const h = harness()
    vi.mocked(h.browser.click).mockRejectedValueOnce(new Error('fixture click failure'))
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_RUNNER_FAILED' })
    expect(h.sequence).toContain('unlisten')
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it('routes an approved read through the same worker and main-owned browser', async () => {
    const h = harness()
    h.binding.assertCurrencyAndUnits = async port => {
      const state = await port.readControl({ css: '#name', scopeCss: '#form' })
      expect(state.value).toBe(templateInput.name)
      const rows = await port.readControls({ css: '#name', scopeCss: '#form' })
      expect(rows).toEqual([state])
    }
    await h.client.run(h.plan, h.probe, h)
    expect(h.browser.readControl).toHaveBeenCalledExactlyOnceWith({ css: '#name', scopeCss: '#form' })
    expect(h.browser.readControls).toHaveBeenCalledExactlyOnceWith({ css: '#name', scopeCss: '#form' })
  })
  it.each([
    { css: '#password' },
    { css: '#name' },
    { css: '#name', scopeCss: '#form', frameCss: '#different-frame' },
    { css: '#name', scopeCss: '#form', exactText: 'different-text' },
    { css: '#name', scopeCss: '#form', scopeMatch: { css: '.regions', exactText: 'another-country' } },
  ])('rejects an unapproved read control %j', async control => {
    const h = harness()
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    h.child.emit('message', { type: 'rpc', runId: run.runId, id: 'read-unapproved', request: { action: 'readControl', payload: { control } } })
    await vi.waitFor(() => expect(h.child.send).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'TARGET_CONTROL_NOT_APPROVED' }) })))
    expect(h.browser.readControl).not.toHaveBeenCalled()
    h.client.cancel()
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_CANCELLED' })
  })
  it('cannot return arbitrary DOM fields through an approved field read', async () => {
    const h = harness()
    vi.mocked(h.browser.readControl).mockResolvedValue(Object.assign({ tagName: 'INPUT', text: '', disabled: false }, { outerHTML: 'fixture-private-dom' }))
    h.binding.assertCurrencyAndUnits = async port => { await port.readControl({ css: '#name', scopeCss: '#form' }) }
    const error = await h.client.run(h.plan, h.probe, h).catch(error => error)
    expect(error.code).toBe('TARGET_RUNNER_FAILED')
    expect(error.message).not.toContain('fixture-private-dom')
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it.each([{ scopeCss: '#another' }, { exactText: 'Submit' }, { scopeMatch: { css: '.regions', exactText: 'another-country' } }])('cannot reuse a readonly click grant with extra scope %j', async extra => {
    const h = harness()
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    h.child.emit('message', { type: 'rpc', runId: run.runId, id: 'changed-scope', request: { action: 'click', payload: { control: { css: '#list', ...extra } } } })
    await vi.waitFor(() => expect(h.child.send).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'TARGET_MUTATION_MARKER_REQUIRED' }) })))
    expect(h.browser.click).not.toHaveBeenCalled()
    h.client.cancel()
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_CANCELLED' })
  })
  it('child exit waits for in-flight local marking before freeing the execution slot', async () => {
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const h = harness({ beforeMutation: () => wait })
    const running = h.client.run(h.plan, h.probe, h)
    const observed = running.catch(error => error)
    await vi.waitFor(() => expect(h.journal.beforeMutation).toHaveBeenCalledOnce())
    h.child.emit('exit', 1)
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_RUNNER_BUSY' })
    release()
    expect((await observed).code).toBe('TARGET_RUNNER_INTERRUPTED')
    expect(h.browser.typeAndBlur).not.toHaveBeenCalled()
  })
  it('cancel and dispose stop the worker but never close the owned browser', async () => {
    const h = harness()
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    h.client.dispose()
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_CANCELLED' })
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_RUNNER_CLOSED' })
    expect(h.browser.dispose).not.toHaveBeenCalled()
  })
  it.each(['click', 'typeAndBlur', 'select'] as const)('main rejects unmarked %s even from a misbehaving worker', async action => {
    const h = harness()
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    const payload = action === 'click' ? { control: { css: '#save' } } : { control: { css: '#name' }, value: 'test' }
    h.child.emit('message', { type: 'rpc', runId: run.runId, id: 'bad-write', request: { action, payload } })
    await vi.waitFor(() => expect(h.child.send).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'TARGET_MUTATION_MARKER_REQUIRED' }) })))
    expect(h.browser[action]).not.toHaveBeenCalled()
    h.client.cancel()
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_CANCELLED' })
  })
  it('unsettled host work produces bounded failure while retaining quarantine until drained', async () => {
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const h = harness({ beforeMutation: () => wait, drainTimeoutMs: 20 })
    const observed = h.client.run(h.plan, h.probe, h).catch(error => error)
    await vi.waitFor(() => expect(h.journal.beforeMutation).toHaveBeenCalledOnce())
    h.client.cancel()
    expect((await observed).code).toBe('TARGET_HOST_DRAIN_TIMEOUT')
    expect(h.client.isDraining).toBe(true)
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_RUNNER_BUSY' })
    release()
    await h.client.whenDrained()
    expect(h.client.isDraining).toBe(false)
    expect(h.browser.typeAndBlur).not.toHaveBeenCalled()
  })
  it('drains an actual port read only after its owned native window is destroyed, without forcing an active operation free', async () => {
    const h = harness({ drainTimeoutMs: 20 })
    vi.mocked(h.child.send).mockImplementation(() => true)
    let destroyed = false
    const guest = Object.assign(new EventEmitter(), {
      isDestroyed: () => destroyed,
      getURL: () => `${templateSnapshot.origin}/ECrossAmazon/SellerShippingTemplateSettingAdd`,
      executeJavaScript: vi.fn(() => new Promise(() => undefined)),
      debugger: Object.assign(new EventEmitter(), { isAttached: () => false, detach: vi.fn() }),
    })
    const port = createOwnedWebContentsPort(guest as unknown as WebContents, { allowedOrigins: [templateSnapshot.origin], assertOwnedSession: () => undefined })
    const observed = h.client.run(h.plan, h.probe, { browser: port, journal: h.journal }).catch(error => error)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    h.child.emit('message', { type: 'rpc', runId: run.runId, id: 'pending-confirm', request: { action: 'waitForControl', payload: { control: { css: 'input.sureButton[value="确定"]', scopeCss: '.k-window' } } } })
    await vi.waitFor(() => expect(guest.executeJavaScript).toHaveBeenCalledOnce())
    h.client.cancel()
    expect((await observed).code).toBe('TARGET_HOST_DRAIN_TIMEOUT')
    expect(h.client.isDraining).toBe(true)
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_RUNNER_BUSY' })
    // Mirrors targets.close: dispose observers then actually destroy the window.
    port.dispose(); destroyed = true; guest.emit('destroyed')
    await h.client.whenDrained()
    expect(h.client.isDraining).toBe(false)
    expect(h.journal.verified).not.toHaveBeenCalled()
    expect(guest.executeJavaScript).toHaveBeenCalledOnce()
  })
  it('does not dispatch late verification after cancellation', async () => {
    const h = harness()
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    h.client.cancel()
    h.child.emit('message', { type: 'rpc', runId: run.runId, id: 'late', request: { action: 'journal.verified', payload: {} } })
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_CANCELLED' })
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it('unknown RPC actions terminate the worker without executing host code', async () => {
    const h = harness()
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    h.child.emit('message', { type: 'rpc', runId: run.runId, id: 'bad', request: { action: 'evaluate', payload: { code: 'arbitrary()' } } })
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_PROTOCOL_INVALID' })
    expect(h.browser.inspect).not.toHaveBeenCalled()
  })
  it('a successful child message without persisted readback cannot fabricate success', async () => {
    const h = harness()
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    h.child.emit('message', { type: 'complete', runId: run.runId, ok: true, receipt: {
      templateId: 2, name: templateInput.name, ruleCount: 1, verification: 'same-object-list-and-details',
      evidence: [saveExchange(), listExchange(true), detailExchange()].map(({ method, path, httpStatus }) => ({ method, path, httpStatus, code: 0 })),
    } })
    await expect(running).rejects.toMatchObject({ code: 'TARGET_VERIFY_PROOF_REQUIRED' })
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it('fixture read allowlist is ignored for real WebContents', async () => {
    const h = harness({ realBrowser: true })
    vi.mocked(h.child.send).mockImplementation(() => true)
    const running = h.client.run(h.plan, h.probe, h)
    const run = vi.mocked(h.child.send).mock.calls[0]![0] as unknown as { runId: string }
    h.child.emit('message', { type: 'rpc', runId: run.runId, id: 'fake-read', request: { action: 'click', payload: { control: { css: '#list' } } } })
    await vi.waitFor(() => expect(h.child.send).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'TARGET_MUTATION_MARKER_REQUIRED' }) })))
    expect(h.browser.click).not.toHaveBeenCalled()
    h.client.cancel()
    await expect(running).rejects.toMatchObject({ code: 'TARGET_RUNNER_CANCELLED' })
  })
  it('timeout does not turn uncertainty into success', async () => {
    const h = harness({ timeoutMs: 20 })
    vi.mocked(h.child.send).mockImplementation(() => true)
    await expect(h.client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_RUNNER_TIMEOUT' })
    expect(h.journal.verified).not.toHaveBeenCalled()
  })
  it('actual compiled child executable refuses unsupported input before any browser action', async () => {
    const h = harness()
    const client = new TargetRunnerClient({ timeoutMs: 5000 })
    await expect(client.run(h.plan, h.probe, h)).rejects.toMatchObject({ code: 'TARGET_REGION_UNSUPPORTED' })
    expect(h.browser.inspect).not.toHaveBeenCalled()
    client.dispose()
  })
})
