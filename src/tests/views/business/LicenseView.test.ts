import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ checkAuthStatus: vi.fn(), getMyDevices: vi.fn() }))
vi.mock('@/utils/api', () => api)
vi.mock('@/utils', () => ({ getDeviceId: () => 'this-device' }))
vi.mock('@/stores/businessWorkspace', () => ({ useBusinessWorkspaceStore: () => ({ entitlements: { max_batch_rows: 50 } }) }))
import LicenseView from '@/views/business/LicenseView.vue'
import { authService } from '@/utils/auth'

beforeEach(() => {
  vi.resetAllMocks()
  authService.setAuth({ auth_code: 'TEST', token: 'test-token' })
  authService.setUser({ user_id: 7, plan_name: '旧套餐' })
  api.checkAuthStatus.mockResolvedValue({ success: true, data: { plan_name: '权威专业套餐', max_devices: 3, device_used: 2 } })
  api.getMyDevices.mockResolvedValue([{ id: 1, device_id: 'this-device' }, { id: 2, device_id: 'another-device' }])
})
describe('business authoritative license', () => {
  it('loads authoritative limits despite missing stored device fields', async () => {
    const wrapper = mount(LicenseView)
    expect(wrapper.text()).toContain('正在核对')
    expect(wrapper.text()).not.toContain('0 / 1')
    await flushPromises()
    expect(api.checkAuthStatus).toHaveBeenCalledWith('TEST', 'this-device')
    expect(api.getMyDevices).toHaveBeenCalledWith(7)
    expect(wrapper.text()).toContain('权威专业套餐')
    expect(wrapper.text()).toContain('已授权')
    expect(wrapper.text()).toContain('2 / 3')
    expect(wrapper.text()).toContain('1 个活动任务')
    expect(wrapper.text()).toContain('套餐授权不等于工具已开放')
    expect(wrapper.text()).not.toMatch(/并发演示|演示模式边界/)
    wrapper.unmount()
  })
  it('does not authorize this machine simply because other devices are bound', async () => {
    api.getMyDevices.mockResolvedValue([{ id: 2, device_id: 'another-device' }])
    const wrapper = mount(LicenseView)
    await flushPromises()
    expect(wrapper.text()).toContain('未识别到本机授权')
    expect(wrapper.text()).toContain('1 / 3')
    wrapper.unmount()
  })
  it('exposes a retry instead of inventing defaults on network failure', async () => {
    api.checkAuthStatus.mockRejectedValueOnce(new Error('网络暂不可用'))
    const wrapper = mount(LicenseView)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('网络暂不可用')
    expect(wrapper.find('.limits-grid').exists()).toBe(false)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('2 / 3')
    wrapper.unmount()
  })
  it('does not apply a previous identity response after the session changes', async () => {
    let resolve!: (value: unknown) => void
    api.checkAuthStatus.mockReturnValue(new Promise(done => { resolve = done }))
    const wrapper = mount(LicenseView)
    authService.setAuth({ auth_code: 'OTHER', token: 'other-token' })
    resolve({ success: true, data: { plan_name: '不得显示的旧授权', max_devices: 3 } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('不得显示的旧授权')
    wrapper.unmount()
  })
})
