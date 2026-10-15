import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import TargetWorkspace from '@/features/targets/TargetWorkspace.vue'
import { targetObservation, targetPreview, targetProfile, targetReceipt } from './target-fixtures'
import { V2_MAINLAND_COUNTRIES, V2_ISLAND_COUNTRIES } from '@/shared/ipc/target-template-options'

const mocks = vi.hoisted(() => ({ list: vi.fn(), submit: vi.fn() }))
vi.mock('@/utils/api/target-profiles', () => ({ listTargetProfiles: mocks.list, submitTargetProfile: mocks.submit }))
function desktop() {
  const bridge = { open: vi.fn().mockResolvedValue(undefined), refresh: vi.fn().mockResolvedValue(undefined), detect: vi.fn().mockResolvedValue(targetObservation()), preflight: vi.fn().mockResolvedValue(targetPreview()), execute: vi.fn().mockResolvedValue(targetReceipt()), reconcile: vi.fn().mockResolvedValue(targetReceipt()), listReceipts: vi.fn().mockResolvedValue([]), close: vi.fn().mockResolvedValue(undefined) }
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { targets: bridge } })
  return bridge
}
async function open(_wrapper: VueWrapper) { await flushPromises() }
async function ready(wrapper: VueWrapper) {
  await open(wrapper); await wrapper.get('[data-testid="target-profile-select"]').setValue('school-a')
  await wrapper.get('.target-entry-form').trigger('submit'); await flushPromises()
  await wrapper.get('[data-testid="target-detect"]').trigger('click'); await flushPromises()
  await wrapper.get('input[placeholder="输入本次要创建的模板名称"]').setValue('测试模板')
  await wrapper.get('.template-form').trigger('submit'); await flushPromises()
}
describe('target workspace', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([targetProfile()]); mocks.submit.mockResolvedValue(targetProfile('pending')); Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined }) })
  it('ordinary browser cannot detect or execute and does not fetch profiles', async () => {
    const wrapper = mount(TargetWorkspace); await open(wrapper)
    expect(wrapper.text()).toContain('普通浏览器不会打开平台账号'); expect(mocks.list).not.toHaveBeenCalled()
    expect(wrapper.find('.target-entry-form').exists()).toBe(false)
  })
  it('shows the URL entry point without starting platform work', () => {
    const bridge = desktop(); const wrapper = mount(TargetWorkspace)
    expect(wrapper.find('.target-body').exists()).toBe(true); expect(wrapper.find('[data-testid="target-entry-url"]').exists()).toBe(true); expect(bridge.open).not.toHaveBeenCalled()
  })
  it('makes the manual login handoff explicit instead of implying password automation', async () => {
    const bridge = desktop(); const wrapper = mount(TargetWorkspace); await open(wrapper)
    expect(wrapper.get('.target-entry-form button[type="submit"]').text()).toContain('打开并登录')
    await wrapper.get('input[aria-label="平台入口网址"]').setValue('https://school.example/entry')
    await wrapper.get('.target-entry-form').trigger('submit'); await flushPromises()
    expect(bridge.open).toHaveBeenCalledOnce(); expect(wrapper.text()).toContain('请完成登录并进入目标课程 / 店铺')
  })
  it('submits only whitelisted detection evidence, never context hashes or URL params', async () => {
    const bridge = desktop(); mocks.list.mockResolvedValue([])
    const wrapper = mount(TargetWorkspace); await open(wrapper)
    expect(wrapper.get('input[aria-label="平台入口网址"]').attributes('maxlength')).toBe('8192')
    await wrapper.get('input[aria-label="平台入口网址"]').setValue('https://school.example/entry?paras=private')
    await wrapper.get('.target-entry-form').trigger('submit'); await flushPromises()
    await wrapper.get('[data-testid="target-detect"]').trigger('click'); await flushPromises()
    expect(wrapper.get('.target-submit input').attributes('maxlength')).toBe('100')
    await wrapper.get('.target-submit').trigger('submit'); await flushPromises()
    const payload = mocks.submit.mock.calls[0]![0]
    expect(payload.entryUrl).not.toContain('?'); expect(JSON.stringify(payload)).not.toContain('private'); expect(payload).not.toHaveProperty('courseRef'); expect(payload).not.toHaveProperty('localAccountRef')
    expect(bridge.preflight).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('等待团队首次审核')
  })
  it('does not expose executable actions without a published target tool', async () => {
    const bridge = desktop(); const wrapper = mount(TargetWorkspace); await open(wrapper)
    expect(wrapper.find('.target-tool-section').exists()).toBe(true); expect(wrapper.find('.template-form').exists()).toBe(false); expect(wrapper.text()).toContain('请先在工具目录选择'); expect(bridge.execute).not.toHaveBeenCalled()
  })
  it('distinguishes an empty directory from a not-yet-selected tool', async () => {
    desktop(); const closed = mount(TargetWorkspace, { props: { hasOpenTools: false } }); await open(closed)
    expect(closed.find('.target-tool-section').exists()).toBe(true); expect(closed.text()).toContain('当前目录尚无开放')
    const available = mount(TargetWorkspace, { props: { hasOpenTools: true } }); await open(available)
    expect(available.find('.target-tool-section').exists()).toBe(true); expect(available.text()).toContain('请先在工具目录选择'); expect(available.text()).not.toContain('当前目录尚无开放')
  })
  it('preflight binds published tool, entry revision and scenario; execution requires confirmation', async () => {
    const bridge = desktop(); const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    expect(bridge.preflight).toHaveBeenCalledWith(expect.objectContaining({ toolId: 'template-tool', profileId: 'school-a', profileRevision: 1, scenario: 'training', stage: 'not_applicable' }))
    expect(wrapper.get('.target-preview button').attributes('disabled')).toBeDefined()
    await wrapper.get('.target-confirm input').setValue(true); await wrapper.get('.target-preview button').trigger('click'); await flushPromises()
    expect(bridge.execute).toHaveBeenCalledExactlyOnceWith({ planId: 'plan-1' }); expect(wrapper.text()).toContain('已核验成功')
  })
  it('prefills the complete mandatory mainland rule instead of free-typing 49 states', async () => {
    const bridge = desktop(); const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    expect(bridge.preflight.mock.calls[0]![0].input.rules).toEqual([{ serviceCode: '10001', countries: [...V2_MAINLAND_COUNTRIES], transitTime: '14 - 28', perOrder: '0', unitRate: '0', unit: 'lb' }])
    expect(V2_MAINLAND_COUNTRIES).toHaveLength(49)
    expect(wrapper.get('[data-testid="service-select"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="region-preset"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.rule-heading button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[aria-label="固定运输时效"]').element).toHaveProperty('value', '14 - 28 天')
    expect(wrapper.get('[data-testid="training-scope"]').text()).toContain('本课程已列入团队审核的实训范围')
  })
  it('adds a supported international rule and preserves the platform value/label mismatch', async () => {
    const bridge = desktop(); const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    await wrapper.get('[data-testid="add-rule"]').trigger('click')
    expect(wrapper.get('[data-testid="international-country"]').element).toHaveProperty('value', 'Canada')
    await wrapper.findAll('[data-testid="service-select"]')[1]!.setValue('20002')
    const transit = wrapper.get('[data-testid="transit-select"]')
    expect(transit.get('option[value="2 - 2"]').text()).toBe('2 - 4 天')
    await transit.setValue('2 - 2')
    await wrapper.get('.template-form').trigger('submit'); await flushPromises()
    expect(bridge.preflight.mock.lastCall![0].input.rules[1]).toMatchObject({ serviceCode: '20002', countries: ['Canada'], transitTime: '2 - 2' })
  })
  it('selects the audited island group without exposing free-form domestic state entry', async () => {
    const bridge = desktop(); const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    await wrapper.get('[data-testid="add-rule"]').trigger('click')
    await wrapper.findAll('[data-testid="service-select"]')[1]!.setValue('10001')
    await wrapper.findAll('[data-testid="region-preset"]')[1]!.setValue('islands')
    await wrapper.get('.template-form').trigger('submit'); await flushPromises()
    expect(bridge.preflight.mock.lastCall![0].input.rules[1].countries).toEqual([...V2_ISLAND_COUNTRIES])
  })
  it('rejects multi-country strings before sending a plan to the host', async () => {
    const bridge = desktop(); const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    await wrapper.get('[data-testid="add-rule"]').trigger('click')
    await wrapper.get('[data-testid="international-country"]').setValue('Canada, Mexico')
    await wrapper.get('.template-form').trigger('submit'); await flushPromises()
    expect(bridge.preflight).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="alert"]').text()).toContain('不支持逗号合并多个国家')
  })
  it('does not display an incomplete account binding as a green ready scene', async () => {
    const bridge = desktop(); bridge.detect.mockResolvedValue({ ...targetObservation(), localAccountRef: null, missing: ['account-identity-unverified'] })
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    expect(wrapper.get('.context-badge').classes()).toContain('warn')
    expect(wrapper.get('.context-badge').text()).toContain('身份或现场仍待核对')
  })
  it('distinguishes an approved URL from an unreviewed course scope', async () => {
    desktop(); const profile = targetProfile(); profile.profile.executionScopes = []; mocks.list.mockResolvedValue([profile])
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    expect(wrapper.get('[data-testid="training-scope"]').text()).toContain('本课程尚未列入团队审核的实训范围')
    expect(wrapper.get('[data-testid="training-scope"]').text()).toContain('首期不开放比赛执行')
  })
  it('changing stage invalidates plan and displays formal competition warning', async () => {
    desktop(); const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    await wrapper.get('[data-testid="context-choice"]').setValue('practice'); await flushPromises()
    expect(wrapper.find('.target-preview').exists()).toBe(false)
    await wrapper.get('[data-testid="context-choice"]').setValue('formal')
    expect(wrapper.get('.formal-warning').text()).toContain('正式比赛'); expect(wrapper.get('.formal-warning').text()).toContain('单独核验')
    expect(wrapper.text()).toContain('场景和阶段只是本次执行的选择')
  })
  it('result unknown cannot be clicked again and reconcile does not execute', async () => {
    const bridge = desktop(); bridge.execute.mockResolvedValue(targetReceipt('needs_review'))
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    await wrapper.get('.target-confirm input').setValue(true); await wrapper.get('.target-preview button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('结果待核对'); expect(wrapper.find('.target-preview button').exists()).toBe(false)
    await wrapper.get('.target-result button').trigger('click'); await flushPromises()
    expect(bridge.reconcile).toHaveBeenCalledWith({ operationId: 'operation-1' }); expect(bridge.execute).toHaveBeenCalledTimes(1)
  })
  it('loads unresolved receipts with the workspace and blocks the same plan before submit', async () => {
    const bridge = desktop(); bridge.listReceipts.mockResolvedValue([targetReceipt('needs_review')])
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    expect(bridge.listReceipts).toHaveBeenCalledOnce()
    expect(wrapper.get('.target-preview').text()).toContain('不能重复提交')
    expect(wrapper.find('.target-confirm').exists()).toBe(false)
    expect(wrapper.find('.target-preview button').exists()).toBe(false)
  })
  it('keeps an unresolved receipt but allows a different template after a fresh preflight', async () => {
    const bridge = desktop()
    bridge.execute.mockResolvedValueOnce(targetReceipt('needs_review')).mockResolvedValueOnce(targetReceipt('verified'))
    bridge.preflight.mockResolvedValueOnce(targetPreview()).mockResolvedValueOnce({
      ...targetPreview(), plan: { ...targetPreview().plan, id: 'plan-2', inputHash: 'b'.repeat(64), input: { ...targetPreview().plan.input, name: '第二个模板' } },
    })
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    await wrapper.get('.target-confirm input').setValue(true); await wrapper.get('.target-preview button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('结果待核对')
    await wrapper.get('input[placeholder="输入本次要创建的模板名称"]').setValue('第二个模板'); await wrapper.get('.template-form').trigger('submit'); await flushPromises()
    expect(wrapper.findAll('.target-preview button').length).toBeGreaterThan(0)
    await wrapper.get('.target-confirm input').setValue(true); await wrapper.get('.target-preview button').trigger('click'); await flushPromises()
    expect(bridge.execute).toHaveBeenCalledTimes(2); expect(wrapper.text()).toContain('已核验成功')
  })
  it('shows reversible receipt context without exposing a full URL or requiring course data in the journal', async () => {
    const bridge = desktop(); bridge.listReceipts.mockResolvedValue([targetReceipt('needs_review')])
    const wrapper = mount(TargetWorkspace); await open(wrapper); const details = wrapper.get('details'); (details.element as HTMLDetailsElement).open = true; await details.trigger('toggle'); await flushPromises()
    expect(wrapper.text()).toContain('学校实训'); expect(wrapper.text()).toContain('school.example/entry'); expect(wrapper.text()).toContain('课程/店铺需重新识别'); expect(wrapper.text()).toContain('aaaaaaaa')
    expect(wrapper.text()).not.toContain('?paras=')
  })
  it('IPC rejection is not represented as business failure or a retry button', async () => {
    const bridge = desktop(); bridge.execute.mockRejectedValue(new Error('连接中断'))
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    await wrapper.get('.target-confirm input').setValue(true); await wrapper.get('.target-preview button').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('本次已经发起'); expect(wrapper.find('.target-preview button').exists()).toBe(false); expect(wrapper.find('.target-result').exists()).toBe(false)
  })
  it('unknown or V3 detection never enables V2 preflight', async () => {
    const bridge = desktop(); bridge.detect.mockResolvedValue({ ...targetObservation(), kind: 'unknown', version: 'v3' })
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    expect(bridge.preflight).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('没有已验收的 V3 执行能力')
  })
  it('refresh invalidates the plan but retains unresolved receipt without a submission retry', async () => {
    const bridge = desktop(); bridge.execute.mockResolvedValue(targetReceipt('needs_review'))
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    await wrapper.get('.target-confirm input').setValue(true); await wrapper.get('.target-preview button').trigger('click'); await flushPromises()
    await wrapper.get('[data-testid="target-refresh"]').trigger('click'); await flushPromises()
    expect(bridge.refresh).toHaveBeenCalledOnce(); expect(wrapper.find('.target-preview').exists()).toBe(false); expect(wrapper.find('.target-context').exists()).toBe(false)
    expect(wrapper.get('.target-result').text()).toContain('结果待核对'); expect(wrapper.text()).toContain('已有待核对记录保留'); expect(bridge.execute).toHaveBeenCalledTimes(1)
  })
  it('login required tells the user to refresh and re-enter their selected course, not the first course', async () => {
    const bridge = desktop(); bridge.detect.mockResolvedValue({ ...targetObservation(), kind: 'login_required', missing: ['course-context'] })
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    expect(wrapper.get('.target-context').text()).toContain('请刷新并重新登录'); expect(wrapper.text()).toContain('工具不会替你选课程'); expect(bridge.preflight).not.toHaveBeenCalled()
  })
  it('refresh failure clears a usable plan without claiming login has recovered', async () => {
    const bridge = desktop(); bridge.refresh.mockRejectedValue(new Error('窗口刷新失败，请重新打开入口'))
    const wrapper = mount(TargetWorkspace, { props: { toolId: 'template-tool' } }); await ready(wrapper)
    await wrapper.get('[data-testid="target-refresh"]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('窗口刷新失败')
    expect(wrapper.find('.target-preview').exists()).toBe(false); expect(wrapper.find('.target-context').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('已刷新原平台窗口'); expect(bridge.execute).not.toHaveBeenCalled()
  })
})
