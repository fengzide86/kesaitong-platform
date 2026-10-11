import { createPinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/api', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getBusinessBootstrap: vi.fn(async () => ({ entitlements: {}, tools: [] })),
  getCurrentUser: vi.fn(async () => ({
    product_type: 'business',
    business_workspace_enabled: true,
    entitlements: { batch_execution: true, multi_account_workspace: true },
  })),
  getPlansAdmin: vi.fn(async () => []),
  getSettings: vi.fn(async () => []),
  getProfitPolicy: vi.fn(async () => ({
    version: 1,
    ratios: { tech: 0.3, market: 0.25, product: 0.15, service: 0.15, coordination: 0.1, record: 0.05 },
  })),
}))

const modules = import.meta.glob([
  '../../App.vue',
  '../../components/**/*.vue',
  '../../features/**/*.vue',
  '../../layouts/**/*.vue',
  '../../views/**/*.vue',
], { eager: true }) as Record<string, { default: Component & { props?: Record<string, unknown> } }>

function valueForProp(definition: unknown): unknown {
  const candidate = Array.isArray(definition) ? definition[0] : definition
  const type = candidate && typeof candidate === 'object' && 'type' in candidate
    ? (candidate as { type?: unknown }).type
    : candidate
  const firstType = Array.isArray(type) ? type[0] : type
  if (firstType === String) return ''
  if (firstType === Number) return 0
  if (firstType === Boolean) return false
  if (firstType === Array) return []
  if (firstType === Function) return vi.fn()
  return {}
}

function requiredProps(component: Component & { props?: Record<string, unknown> }): Record<string, unknown> {
  if (!component.props || Array.isArray(component.props)) return {}
  return Object.fromEntries(Object.entries(component.props).map(([name, definition]) => [name, valueForProp(definition)]))
}

describe('component construction smoke', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.electronAPI = {}
  })

  afterEach(() => {
    vi.useRealTimers()
    delete window.electronAPI
  })

  for (const [filename, loaded] of Object.entries(modules)) {
    it(`constructs ${filename}`, async () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
      })
      await router.push('/')
      await router.isReady()
      const wrapper = shallowMount(loaded.default, {
        props: {
          ...requiredProps(loaded.default),
          ...(filename.endsWith('/ScenarioPainComparison.vue') ? { kind: 'competition' } : {}),
          ...(filename.endsWith('/LandingSceneChecklist.vue') ? { scene: 'competition' } : {}),
        },
        global: {
          plugins: [createPinia(), router],
          stubs: {
            RouterLink: true,
            RouterView: true,
            Transition: false,
            Teleport: true,
            'el-table-column': true,
          },
        },
      })
      expect(wrapper.exists()).toBe(true)
      wrapper.unmount()
    }, 10_000)
  }
})
