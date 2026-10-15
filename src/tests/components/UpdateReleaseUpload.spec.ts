/* eslint-disable vue/one-component-per-file -- Two lightweight Element Plus test doubles share this suite. */
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ElementPlus, { ElMessageBox } from 'element-plus'
import UpdateReleasesView from '@/views/admin/UpdateReleasesView.vue'
import { ApiError } from '@/utils/api'
import { listUpdateReleases, stageUpdateRelease, type UpdateRelease } from '@/features/updates/release-api'

vi.mock('@/features/updates/release-api', () => ({ listUpdateReleases: vi.fn(), stageUpdateRelease: vi.fn(), publishUpdateRelease: vi.fn(), removeStagedUpdateRelease: vi.fn() }))
const uploadStub = defineComponent({ name: 'ElUpload', emits: ['update:fileList'], template: '<div><slot /></div>' })
const drawerStub = defineComponent({ name: 'ElDrawer', template: '<section><slot name="header" /><slot /><slot name="footer" /></section>' })
const release = (version = '1.8.16', latest = true): UpdateRelease => ({ version, status: 'published', files: [], is_latest: latest })
let wrapper: VueWrapper

beforeEach(() => { window.dispatchEvent(new Event('toolbox:auth-cleared')); vi.mocked(listUpdateReleases).mockReset().mockResolvedValue([]); vi.mocked(stageUpdateRelease).mockReset() })
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.restoreAllMocks() })

async function openWithFiles() {
  wrapper = mount(UpdateReleasesView, { attachTo: document.body, global: { plugins: [ElementPlus], stubs: { ElDrawer: drawerStub, ElUpload: uploadStub } } })
  await flushPromises()
  const manifest = new File(['version: 1.8.16'], 'latest.yml')
  wrapper.findComponent(uploadStub).vm.$emit('update:fileList', [manifest, new File(['exe'], 'KST Setup 1.8.16.exe'), new File(['map'], 'KST Setup 1.8.16.exe.blockmap')].map(raw => ({ name: raw.name, raw })))
  await flushPromises()
}
async function click(label: string) {
  const button = wrapper.findAll('button').find(item => item.text() === label)
  expect(button, label).toBeTruthy()
  await button!.trigger('click')
  await flushPromises()
}

describe('release upload recovery and version labels', () => {
  it('distinguishes current desktop update from old published history', async () => {
    vi.mocked(listUpdateReleases).mockResolvedValue([release(), release('1.8.15', false)])
    await openWithFiles()
    expect(wrapper.text()).toContain('当前更新版本')
    expect(wrapper.text()).toContain('历史已发布')
    expect(wrapper.text()).toContain('保留历史记录')
  })

  it('checks the version list before upload and refuses a duplicate', async () => {
    vi.mocked(listUpdateReleases).mockResolvedValue([release()])
    await openWithFiles()
    await click('上传并校验')
    expect(stageUpdateRelease).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('没有重复上传')
  })

  it.each([
    new ApiError('请求超时', { kind: 'timeout' }),
    new ApiError('响应异常', { kind: 'parse' }),
    new ApiError('服务失败', { kind: 'http', status: 500 }),
  ])('reads the server after an uncertain response and never retransmits: %s', async error => {
    vi.mocked(listUpdateReleases).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([release()])
    vi.mocked(stageUpdateRelease).mockRejectedValue(error)
    await openWithFiles()
    await click('上传并校验')
    expect(stageUpdateRelease).toHaveBeenCalledOnce()
    expect(listUpdateReleases).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('已找到 v1.8.16')
    expect(wrapper.text()).toContain('没有再次上传')
  })

  it('blocks another upload while the previous result cannot be reconciled', async () => {
    vi.mocked(listUpdateReleases).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValue(new Error('offline'))
    vi.mocked(stageUpdateRelease).mockRejectedValue(new ApiError('网络错误', { kind: 'network' }))
    await openWithFiles()
    await click('上传并校验')
    const upload = wrapper.findAll('button').find(item => item.text() === '上传并校验')!
    expect(upload.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('请先重新核对版本状态')
    vi.mocked(listUpdateReleases).mockResolvedValue([release()])
    await click('重新核对版本状态')
    expect(stageUpdateRelease).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('没有再次上传')
  })

  it('shows actual transmitted bytes and cancellation triggers a readback', async () => {
    vi.mocked(stageUpdateRelease).mockImplementation((_files, _version, options) => new Promise((_resolve, reject) => {
      options!.onProgress!({ transferredBytes: 1048576, totalBytes: 2097152 })
      options!.signal!.addEventListener('abort', () => reject(new ApiError('上传已取消', { kind: 'cancelled' })), { once: true })
    }))
    await openWithFiles()
    await click('上传并校验')
    expect(wrapper.text()).toContain('1.0 MB / 2.0 MB 已上传')
    await click('取消上传')
    expect(listUpdateReleases).toHaveBeenCalledTimes(3)
    expect(stageUpdateRelease).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('目前没有找到该版本')
    expect(wrapper.findAll('button').find(item => item.text() === '上传并校验')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('至少等待 30 秒后重新核对')
    expect(wrapper.findAll('button').some(item => item.text() === '允许手动重试')).toBe(false)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    await click('重新核对版本状态')
    expect(wrapper.findAll('button').some(item => item.text() === '允许手动重试')).toBe(true)
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
    await click('允许手动重试')
    expect(wrapper.findAll('button').find(item => item.text() === '上传并校验')!.attributes('disabled')).toBeUndefined()
    expect(stageUpdateRelease).toHaveBeenCalledOnce()
  })

  it('retains an uncertain result after leaving and returning to the release route', async () => {
    vi.mocked(stageUpdateRelease).mockRejectedValue(new ApiError('network', { kind: 'network' }))
    await openWithFiles()
    await click('上传并校验')
    expect(stageUpdateRelease).toHaveBeenCalledOnce()
    wrapper.unmount()
    await openWithFiles()
    expect(wrapper.text()).toContain('上次上传结果仍待核对')
    const upload = wrapper.findAll('button').find(item => item.text() === '上传并校验')!
    expect(upload.attributes('disabled')).toBeDefined()
    await upload.trigger('click')
    expect(stageUpdateRelease).toHaveBeenCalledOnce()
    vi.mocked(listUpdateReleases).mockResolvedValue([release()])
    await click('重新核对版本状态')
    wrapper.unmount()
    await openWithFiles()
    expect(wrapper.text()).not.toContain('上次上传结果仍待核对')
  })

  it('records uncertainty before sending so leaving during an upload cannot silently enable retry', async () => {
    vi.mocked(stageUpdateRelease).mockImplementation((_files, _version, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new ApiError('cancelled', { kind: 'cancelled' })), { once: true })
    }))
    await openWithFiles()
    await click('上传并校验')
    wrapper.unmount()
    await flushPromises()
    await openWithFiles()
    expect(wrapper.text()).toContain('上次上传结果仍待核对')
    expect(wrapper.findAll('button').find(item => item.text() === '上传并校验')!.attributes('disabled')).toBeDefined()
    expect(stageUpdateRelease).toHaveBeenCalledOnce()
  })
})
