import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UpdateDetailsDrawer from '@/features/updates/UpdateDetailsDrawer.vue'
import UpdateRestartDialog from '@/features/updates/UpdateRestartDialog.vue'
import restartDialogSource from '@/features/updates/UpdateRestartDialog.vue?raw'
import resetCss from '@/assets/css/base/reset.css?raw'
import { useUpdateStore } from '@/features/updates/store'
import type { UpdateSnapshot } from '@/shared/ipc/update-contract'

const route = reactive({ name: 'BusinessWorkspace' })
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('element-plus', () => ({ ElMessageBox: { confirm: vi.fn(async () => {}) } }))
const base: UpdateSnapshot = { supported: true, status: 'available', currentVersion: '1.8.15', availableVersion: '1.8.16', releaseNotes: ['更新体验'], canRestart: false }
let wrapper: VueWrapper | undefined

beforeEach(() => { setActivePinia(createPinia()); route.name = 'BusinessWorkspace' })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = '' })

async function drawer(snapshot: Partial<UpdateSnapshot>) {
  const store = useUpdateStore()
  store.state = { ...base, ...snapshot }
  store.openDetails()
  wrapper = mount(UpdateDetailsDrawer, { attachTo: document.body })
  await nextTick()
  return store
}

describe('update controls', () => {
  it('lets an idle workspace inspect and cancel a real download with speed', async () => {
    const store = await drawer({ status: 'downloading', percent: 25, transferredBytes: 1024, totalBytes: 4096, bytesPerSecond: 2048, downloadPhase: 'transferring' })
    const cancel = vi.spyOn(store, 'cancelDownload').mockResolvedValue()
    expect(wrapper!.text()).toContain('当前速度 2 KB/秒')
    expect(wrapper!.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
    await wrapper!.findAll('button').find(button => button.text() === '取消下载')!.trigger('click')
    await flushPromises()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('shows a stalled explanation without making up speed and locks cancelling retry', async () => {
    const store = await drawer({ status: 'downloading', downloadStalled: true, bytesPerSecond: 2048, downloadPhase: 'transferring' })
    expect(wrapper!.text()).toContain('暂未收到新的下载数据')
    expect(wrapper!.text()).not.toContain('当前速度')
    store.state = { ...base, status: 'cancelling' }
    await nextTick()
    expect(wrapper!.text()).toContain('正在结束当前请求')
    expect(wrapper!.findAll('button').find(button => button.text() === '正在取消…')!.attributes('disabled')).toBeDefined()
    expect(wrapper!.findAll('button').some(button => button.text() === '重新下载')).toBe(false)
  })

  it('allows a deferred ready update to restart, but not while the main process reports work', async () => {
    const store = await drawer({ status: 'restart_deferred', canRestart: true })
    const install = vi.spyOn(store, 'install').mockResolvedValue()
    const restart = wrapper!.findAll('button').find(button => button.text() === '立即重启')!
    await restart.trigger('click')
    expect(install).toHaveBeenCalledOnce()
    store.state = { ...base, status: 'restart_deferred', canRestart: false }
    await nextTick()
    expect(restart.attributes('disabled')).toBeDefined()
    expect(wrapper!.text()).toContain('当前工作尚未结束')
  })

  it.each([
    ['DOWNLOAD_FAILED', { canRetryDownload: true }, '重新下载', 'startDownload'],
    ['INSTALL_QUIESCE_TIMEOUT', { canRetryInstall: true }, '重新尝试安装', 'install'],
    ['INSTALL_LAUNCH_TIMEOUT', { canRetryDownload: true }, '重新下载', 'startDownload'],
    ['INSTALLER_MISSING', { canRetryDownload: true }, '重新下载', 'startDownload'],
    ['FEED_INVALID', {}, '重新检查', 'checkManually'],
  ] as const)('offers the proper recovery action for %s', async (errorCode, capabilities, label, action) => {
    const store = await drawer({ status: 'error', errorCode, ...capabilities })
    const spy = vi.spyOn(store, action).mockResolvedValue()
    await wrapper!.findAll('button').find(button => button.text() === label)!.trigger('click')
    expect(spy).toHaveBeenCalledOnce()
  })

  it('uses a native modal and Escape only dismisses, never approves install-on-quit', async () => {
    const previous = document.createElement('button')
    document.body.append(previous); previous.focus()
    const store = useUpdateStore()
    store.state = { ...base, status: 'downloaded', canRestart: true }
    const defer = vi.spyOn(store, 'deferInstall').mockResolvedValue()
    wrapper = mount(UpdateRestartDialog, { attachTo: document.body })
    await flushPromises()
    const dialog = wrapper.get('dialog').element as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('稍后决定是否安装')
    await wrapper.get('dialog').trigger('cancel')
    await flushPromises()
    expect(dialog.open).toBe(false)
    expect(defer).not.toHaveBeenCalled()
    expect(store.shouldPromptRestart).toBe(false)
    expect(document.activeElement).toBe(previous)
  })

  it('owns native-dialog centering after the actual global reset and bounds narrow windows', async () => {
    // The DOM test environment does not perform viewport layout. Verify the real reset/component
    // cascade here; packaged capture separately checks measured center/bounds.
    const style = document.createElement('style')
    const componentCss = [...restartDialogSource.matchAll(/<style scoped>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n')
    style.textContent = `${resetCss}\n${componentCss}`
    document.head.append(style)
    try {
      const store = useUpdateStore()
      store.state = { ...base, status: 'downloaded', canRestart: true }
      wrapper = mount(UpdateRestartDialog, { attachTo: document.body })
      await flushPromises()
      const dialog = wrapper.get('dialog').element as HTMLDialogElement
      const computed = getComputedStyle(dialog)
      expect(dialog.open).toBe(true)
      expect(computed.position).toBe('fixed')
      expect(computed.inset).toBe('0')
      expect(computed.margin).toBe('auto')
      expect(computed.height).toBe('fit-content')
      const bounds = [...(style.sheet?.cssRules ?? [])].find(rule => rule instanceof CSSStyleRule && rule.selectorText === '.restart-dialog') as CSSStyleRule
      expect(bounds.style.maxWidth).toBe('calc(100vw - 40px)')
      expect(bounds.style.maxHeight).toBe('calc(100dvh - 40px)')
      expect(computed.overflow).toBe('auto')
      expect(getComputedStyle(wrapper.get('.restart-card > div:last-child').element).flexWrap).toBe('wrap')
      expect(componentCss).not.toContain('.restart-overlay')
      expect(componentCss).not.toContain('.restart-fade')
    } finally {
      style.remove()
    }
  })
})
