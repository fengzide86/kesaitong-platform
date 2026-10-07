import { describe, expect, it } from 'vitest'
import { PRODUCT_TASKS, getToolTaskIds, getToolPresentation, isCustomerTool, isToolCurrentlyUsable } from './presentation'
const tool = { id: 'listing', capability_key: 'listing_script', availability: 'live', status: 'online', script_status: 'script_ready', supports_live_single: true, supports_live_batch: true, available_plans: ['Y199'] }
describe('shared customer tool presentation', () => {
  it('keeps eight identities and explicit many-to-many mapping', () => {
    expect(PRODUCT_TASKS.map(task => task.id)).toEqual(['company', 'sourcing', 'product', 'shipping', 'marketing', 'fba', 'orders', 'pricing'])
    expect(getToolTaskIds({ ...tool, task_ids: ['sourcing', 'pricing', 'pricing', 'unknown'] })).toEqual(['sourcing', 'pricing'])
    expect(getToolTaskIds({ capability_key: 'register' })).toEqual([]); expect(getToolTaskIds({ capability_key: 'future' })).toEqual([])
    expect(getToolTaskIds({ capability_key: 'freight_quote' })).toEqual(['sourcing', 'shipping', 'orders', 'pricing'])
  })
  it('never promotes demos, blocked scripts or unknown states', () => {
    expect(isCustomerTool({ availability: 'demo_only', supports_live_single: true })).toBe(false)
    expect(isCustomerTool({ availability: 'future' })).toBe(false)
    expect(getToolPresentation({ ...tool, availability: 'demo_only' }).action).toBe('unavailable')
    expect(getToolPresentation({ ...tool, script_status: 'script_not_ready' }).action).toBe('unavailable')
    expect(getToolPresentation({ ...tool, script_status: 'blocked' }).action).toBe('unavailable')
  })
  it('separates type from stage without acceptance claims', () => {
    expect(getToolPresentation({ ...tool, availability: 'live_beta' }).label).toBe('受控试用'); expect(getToolPresentation(tool).label).toBe('已开放执行')
    expect(getToolPresentation({ ...tool, script_status: 'browser_ready', target_url: 'https://example.test' }).action).toBe('inspect')
    expect(getToolPresentation({ ...tool, tool_kind: 'calculation' }).operationLabel).toBe('本地计算'); expect(getToolPresentation(tool).label).not.toContain('验收')
  })
  it('requires entitlement, publication, local runtime and supported mode', () => {
    const context = { planCode: 'Y199', runtimeAvailable: true, mode: 'single' as const }
    expect(isToolCurrentlyUsable(tool, context)).toBe(true); expect(isToolCurrentlyUsable(tool, { ...context, planCode: 'Y15' })).toBe(false)
    expect(isToolCurrentlyUsable(tool, { ...context, runtimeAvailable: false })).toBe(false); expect(isToolCurrentlyUsable({ ...tool, release_status: 'maintenance' }, context)).toBe(false)
    expect(isToolCurrentlyUsable({ ...tool, supports_live_single: false }, context)).toBe(false)
    expect(isToolCurrentlyUsable({ ...tool, script_status: 'browser_ready', target_url: 'https://example.test' }, context)).toBe(true)
    expect(isToolCurrentlyUsable({ ...tool, script_status: 'browser_ready', target_url: 'https://example.test' }, { ...context, mode: 'batch' })).toBe(false)
    expect(isToolCurrentlyUsable({ ...tool, tool_kind: 'calculation' }, context)).toBe(false)
  })
  it('honors explicit platform scopes without breaking legacy catalogs', () => {
    const context = { planCode: 'Y199', runtimeAvailable: true, platformKey: 'amazon' }
    expect(isToolCurrentlyUsable(tool, context)).toBe(true)
    expect(isToolCurrentlyUsable(tool, { ...context, platformScope: 'amazon, aliexpress' })).toBe(true)
    expect(isToolCurrentlyUsable(tool, { ...context, platformScope: ['aliexpress'] })).toBe(false)
    expect(isToolCurrentlyUsable({ ...tool, platform_key: 'aliexpress' }, { ...context, platformScope: ['aliexpress'] })).toBe(true)
    expect(isToolCurrentlyUsable(tool, { ...context, platformScope: [] })).toBe(false)
    expect(isToolCurrentlyUsable(tool, { ...context, platformScope: null })).toBe(false)
  })
})
