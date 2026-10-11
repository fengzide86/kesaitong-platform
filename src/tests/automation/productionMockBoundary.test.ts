import { describe, expect, it, vi } from 'vitest'
import { createAutomationAdapter, MockAutomationAdapter } from '@/automation'
vi.mock('@/runtime/capabilities', () => ({ getRuntimeCapabilities: () => ({ isDesktop: false, singleLive: false }) }))
describe('historical mock remains explicit and internal', () => {
  it('rejects the customer/default demo fallback', () => {
    expect(() => createAutomationAdapter({ mode: 'demo' })).toThrow('LEGACY_DEMO_DISABLED')
    expect(() => createAutomationAdapter({ mode: 'live' })).toThrow('LIVE_RUNTIME_UNAVAILABLE')
  })
  it('supports explicit internal fixtures only in developer/test builds', () => {
    expect(createAutomationAdapter({ mode: 'demo', allowInternalDemo: true })).toBeInstanceOf(MockAutomationAdapter)
  })
})
