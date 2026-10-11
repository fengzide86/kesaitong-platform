import type { AutomationAdapter } from './adapters/electronAutomationAdapter'
import { ElectronAutomationAdapter } from './adapters/electronAutomationAdapter'
import { DemoAutomationAdapter, type MockAutomationOptions } from './adapters/mockAutomationAdapter'
import { getRuntimeCapabilities } from '@/runtime/capabilities'

export * from './events'
export { DemoAutomationAdapter, MockAutomationAdapter, createMockSteps } from './adapters/mockAutomationAdapter'
export { ElectronAutomationAdapter } from './adapters/electronAutomationAdapter'
export type { AutomationAdapter } from './adapters/electronAutomationAdapter'

export interface AutomationAdapterOptions {
  mode: 'demo' | 'live'
  adapter?: AutomationAdapter
  mock?: MockAutomationOptions
  /** Only isolated developer/tests may explicitly opt into the historical mock. */
  allowInternalDemo?: boolean
}

export function createAutomationAdapter(options: AutomationAdapterOptions): AutomationAdapter {
  if (options.adapter) return options.adapter
  const api = typeof window !== 'undefined' ? window.electronAPI?.automation : undefined
  const capabilities = getRuntimeCapabilities()
  if (options.mode === 'demo') {
    if (!(import.meta.env.DEV || import.meta.env.MODE === 'test') || !options.allowInternalDemo) throw new Error('LEGACY_DEMO_DISABLED: 客户执行入口不提供模拟回退')
    return capabilities.isDesktop && api ? new ElectronAutomationAdapter(api) : new DemoAutomationAdapter(options.mock)
  }
  if (!capabilities.singleLive || !api) throw new Error('LIVE_RUNTIME_UNAVAILABLE: 真实工具仅支持桌面客户端')
  return new ElectronAutomationAdapter(api)
}
