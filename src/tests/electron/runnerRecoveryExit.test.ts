import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import type { ChildProcess, fork } from 'node:child_process'
import type { RunnerClient as ClientType } from '../../../electron/automation/runner-client.cjs'

const require = createRequire(import.meta.url)
const { RunnerClient } = require('../../../dist-electron/electron/automation/runner-client.cjs') as { RunnerClient: typeof ClientType }

function setup() {
  const child = Object.assign(new EventEmitter(), { connected: true, send: vi.fn(), stdout: null, stderr: null }) as unknown as ChildProcess
  const onEvent = vi.fn()
  const forkFn = (() => child) as typeof fork
  const client = new RunnerClient({ scriptPath: 'fixture', forkFn, onEvent, timeoutMs: 1000 })
  const start = client.start({ id: 'fixture' })
  const command = vi.mocked(child.send).mock.calls[0]![0] as unknown as { id: string }
  child.emit('message', { type: 'event', event: { protocolVersion: 1, eventId: 'started', type: 'run.started', runId: 'run_fixture' } })
  child.emit('message', { type: 'response', id: command.id, ok: true, data: { runId: 'run_fixture' } })
  return { child, onEvent, start }
}

describe('Runner interruption recovery signal', () => {
  it('emits exactly one unknown-result failure on unexpected exit after start', async () => {
    const { child, onEvent, start } = setup()
    await start
    child.emit('exit', 1, null); child.emit('error', new Error('late transport error'))
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['run.started', 'run.failed'])
    expect(onEvent.mock.calls[1]![0]).toMatchObject({ error: { code: 'RUNNER_PROCESS_INTERRUPTED' } })
  })
  it('does not fabricate an interruption after genuine completed or cancelled results', async () => {
    for (const type of ['run.completed', 'run.cancelled']) {
      const { child, onEvent, start } = setup()
      await start
      child.emit('message', { type: 'event', event: { protocolVersion: 1, eventId: 'terminal', type, runId: 'run_fixture' } })
      child.emit('exit', 0, null)
      expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['run.started', type])
    }
  })
})
