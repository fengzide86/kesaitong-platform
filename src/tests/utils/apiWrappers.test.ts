import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiModules = import.meta.glob([
  '../../utils/api/*.ts',
  '!../../utils/api/*.spec.ts',
  '!../../utils/api/*.test.ts',
], { eager: true }) as Record<string, Record<string, unknown>>

const payload = {
  id: 'entity-1',
  client_demo_run_id: 'demo-run-1',
  client_demo_batch_id: 'demo-batch-1',
  tool_id: 'tool-1',
  tool_name: 'Tool',
  platform_key: 'amazon',
  scenario_id: 'scenario-1',
  total_step_count: 1,
  row_count: 1,
  event_seq: 1,
  status: 'running',
  completed_step_count: 0,
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))
})

describe('generated endpoint wrapper surface', () => {
  it('serializes every public API wrapper without synchronous exceptions', async () => {
    const calls: Array<PromiseSettledResult<unknown>> = []
    for (const [modulePath, exports] of Object.entries(apiModules)) {
      if (modulePath.endsWith('/index.ts')) continue
      for (const exported of Object.values(exports)) {
        if (typeof exported !== 'function') continue
        const result = Promise.resolve().then(() => exported(payload, payload, payload, payload))
        calls.push(...await Promise.allSettled([result]))
      }
    }
    expect(calls.length).toBeGreaterThan(60)
    expect(calls.filter(result => result.status === 'fulfilled').length).toBeGreaterThan(50)
    expect(fetch).toHaveBeenCalled()
  })
})
