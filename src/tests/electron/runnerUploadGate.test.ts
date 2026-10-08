import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

type Values = Record<string, unknown>
interface Runtime {
  executeAction(action: Values, input: Values, stepId: string): Promise<void>
  tool: Values
  script: Values
  hostRequest: (action: string, payload: Values) => Promise<unknown>
}

function setup(browserMode: string) {
  const compiled = resolve('dist-electron/electron/automation-runner.cjs')
  const require = createRequire(compiled)
  const engine = require('./automation/action-engine.cjs') as Record<string, unknown>
  const perform = vi.fn(async () => undefined)
  const module = { exports: {} }
  runInNewContext(`${readFileSync(compiled, 'utf8')}\nmodule.exports = { AutomationRuntime };`, {
    require: (name: string) => name === './automation/action-engine.cjs' ? { ...engine, executePlaywrightAction: perform } : require(name),
    module, exports: module.exports, __dirname: resolve(compiled, '..'), console, Buffer, setTimeout, clearTimeout,
    process: { ...process, env: { ...process.env, TOOLBOX_AUTOMATION_MOCK: '0' }, on: vi.fn() },
  })
  const { AutomationRuntime } = module.exports as { AutomationRuntime: new () => Runtime }
  const runtime = new AutomationRuntime()
  const host = vi.fn(async (_action: string, _payload: Values) => ({ valid: true }))
  Object.assign(runtime, {
    tool: { executionMode: 'live', browserMode }, script: { sandbox: true }, hostRequest: host,
    waitWhilePaused: vi.fn(async () => undefined), ensureActive: vi.fn(), handleInterruptionIfNeeded: vi.fn(async () => undefined),
    throttle: vi.fn(async () => undefined), requirePage: () => ({}),
  })
  return { runtime, host, perform }
}

describe('Runner local upload authorization', () => {
  it.each(['playwright', 'embedded-cdp'])('blocks %s upload before page dispatch when main refuses the path', async mode => {
    const test = setup(mode)
    test.host.mockRejectedValueOnce(new Error('LOCAL_FILE_UNREADABLE'))
    await expect(test.runtime.executeAction({ id: 'upload', kind: 'upload', inputKey: 'document' }, { document: 'D:\\资料\\中文 文件.csv' }, 'step')).rejects.toThrow('LOCAL_FILE_UNREADABLE')
    expect(test.host).toHaveBeenCalledExactlyOnceWith('files.validate-upload', { filePath: 'D:\\资料\\中文 文件.csv' })
    expect(test.perform).not.toHaveBeenCalled()
  })
  it.each(['playwright', 'embedded-cdp'])('requires the file ACK before %s dispatch, including literal paths', async mode => {
    const test = setup(mode)
    await test.runtime.executeAction({ id: 'upload', kind: 'upload', value: 'D:\\资料\\sample.csv' }, {}, 'step')
    expect(test.host.mock.calls[0]).toEqual(['files.validate-upload', { filePath: 'D:\\资料\\sample.csv' }])
    if (mode === 'playwright') expect(test.perform).toHaveBeenCalledOnce()
    else expect(test.host.mock.calls[1]?.[0]).toBe('browser.action')
  })
  it('batch upload host actions cannot bypass the native validation callback', async () => {
    const require = createRequire(import.meta.url)
    const { BatchCoordinator } = require(resolve('dist-electron/electron/automation/batch-coordinator.cjs')) as {
      BatchCoordinator: new (options: Values) => { createRunner(item: Values): unknown }
    }
    const dispatch = vi.fn()
    const validateUpload = vi.fn(async () => { throw new Error('LOCAL_FILE_UNREADABLE') })
    let onHostRequest!: (action: string, payload: Values) => Promise<unknown>
    const coordinator = new BatchCoordinator({
      hostManager: { request: dispatch }, validateUpload,
      runnerFactory: (options: { onHostRequest: typeof onHostRequest }) => { onHostRequest = options.onHostRequest; return {} },
    })
    coordinator.createRunner({ itemId: 'one' })
    await expect(onHostRequest('files.validate-upload', { filePath: 'D:\\unknown.csv' })).rejects.toThrow('LOCAL_FILE_UNREADABLE')
    await expect(onHostRequest('browser.action', { action: { kind: 'upload', inputKey: 'document' }, input: { document: 'D:\\unknown.csv' } })).rejects.toThrow('LOCAL_FILE_UNREADABLE')
    expect(validateUpload).toHaveBeenCalledTimes(2)
    expect(dispatch).not.toHaveBeenCalled()
  })
  it('batch upload host actions fail closed if native validation was not registered', async () => {
    const require = createRequire(import.meta.url)
    const { BatchCoordinator } = require(resolve('dist-electron/electron/automation/batch-coordinator.cjs')) as {
      BatchCoordinator: new (options: Values) => { createRunner(item: Values): unknown }
    }
    const dispatch = vi.fn()
    let onHostRequest!: (action: string, payload: Values) => Promise<unknown>
    const coordinator = new BatchCoordinator({ hostManager: { request: dispatch },
      runnerFactory: (options: { onHostRequest: typeof onHostRequest }) => { onHostRequest = options.onHostRequest; return {} } })
    coordinator.createRunner({ itemId: 'one' })
    await expect(onHostRequest('files.validate-upload', { filePath: 'D:\\unknown.csv' })).rejects.toMatchObject({ code: 'LOCAL_FILE_UNAVAILABLE' })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
