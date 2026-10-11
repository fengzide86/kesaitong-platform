import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useLicenseLogin } from '@/features/auth/useLicenseLogin'

const mocks = vi.hoisted(() => ({ verify: vi.fn(), login: vi.fn(), device: vi.fn(), auth: vi.fn(), remember: vi.fn(), push: vi.fn(), toast: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }), useRoute: () => ({ query: {} }) }))
vi.mock('@/utils', () => ({ Auth: { set: mocks.auth }, getDeviceId: () => 'device-A', getDeviceName: () => 'device name', showToast: mocks.toast }))
vi.mock('@/utils/api', () => ({ api: { get: vi.fn().mockResolvedValue([]) }, verifyAuthCode: mocks.verify }))
vi.mock('@/stores/user', () => ({ useUserStore: () => ({ setLogin: mocks.login, setDevice: mocks.device }) }))
vi.mock('@/stores/connection', () => ({ useConnectionStore: () => ({ status: 'online', probe: vi.fn() }) }))
vi.mock('@/utils/credentialStore', () => ({ saveRememberedUserCode: mocks.remember }))
function harness() {
  let login!: ReturnType<typeof useLicenseLogin>
  const wrapper = mount(defineComponent({ setup() { login = useLicenseLogin(); return () => null } }))
  return { login, wrapper }
}
describe('login attempt identity', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); sessionStorage.clear(); localStorage.clear() })
  afterEach(() => vi.useRealTimers())
  it('uses the submitted code/device snapshot even if input changes while response is pending', async () => {
    let finish!: (response: unknown) => void
    mocks.verify.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { login, wrapper } = harness()
    login.authCode.value = 'CODE-A'
    const attempt = login.handleLogin()
    login.authCode.value = 'CODE-B'
    await login.handleLogin()
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    finish({ success: true, data: { token: 'TOKEN-A', id: 1 } })
    await flushPromises(); await vi.runAllTimersAsync(); await attempt
    expect(mocks.login).toHaveBeenCalledWith(expect.objectContaining({ token: 'TOKEN-A', auth_code: 'CODE-A' }))
    expect(mocks.remember).toHaveBeenCalledWith('CODE-A')
    expect(mocks.push).toHaveBeenCalledWith('/user/tools')
    wrapper.unmount()
  })
  it.each([true, false])('ignores late success/failure after leaving the page: success=%s', async success => {
    let finish!: (response: unknown) => void
    mocks.verify.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { login, wrapper } = harness()
    login.authCode.value = 'CODE-A'
    const attempt = login.handleLogin()
    wrapper.unmount()
    finish({ success, data: success ? { token: 'TOKEN-A', id: 1 } : undefined, message: 'old failure' })
    await attempt
    expect(mocks.login).not.toHaveBeenCalled()
    expect(mocks.remember).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })
  it('leaving during transition prevents the old login from redirecting the new page', async () => {
    mocks.verify.mockResolvedValueOnce({ success: true, data: { token: 'TOKEN-A', id: 1 } })
    const { login, wrapper } = harness(); login.authCode.value = 'CODE-A'
    const attempt = login.handleLogin(); await flushPromises()
    wrapper.unmount(); await vi.runAllTimersAsync(); await attempt
    expect(mocks.login).toHaveBeenCalledTimes(1)
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
