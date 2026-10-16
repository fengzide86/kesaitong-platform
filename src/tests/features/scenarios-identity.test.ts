import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScenariosView from '@/views/admin/ScenariosView.vue'

const mocks = vi.hoisted(() => ({
  get: vi.fn(), put: vi.fn(), users: vi.fn(), user: vi.fn(), codes: vi.fn(), code: vi.fn(), staff: vi.fn(), confirm: vi.fn(), motion: vi.fn(),
}))
vi.mock('@/utils/api', () => ({ api: { get: mocks.get, put: mocks.put } }))
vi.mock('@/utils/api/users', () => ({ getUsersPage: mocks.users, getUser: mocks.user }))
vi.mock('@/utils/api/auth-codes', () => ({ getAuthCodesPage: mocks.codes, getAuthCode: mocks.code }))
vi.mock('@/utils/api/staff', () => ({ getStaffAccountsPage: mocks.staff }))
vi.mock('@/shared/ui/confirm', () => ({ confirmAction: mocks.confirm }))
vi.mock('@/shared/ui/workflowMotion', () => ({ scrollToWorkflowTarget: mocks.motion }))

const user = (id = 91) => ({ id, name: '样例用户' + id, phone: '13800000000', device_name: '课堂电脑' + id })
const code = (id = 201) => ({ id, customer_name: '样例学校', code: 'SECRET-EXAMPLE-' + id, project_id: '2026秋季实训', order_no: 'ORDER-' + id })
const staff = (id = 7, role = 'operator', status = 'active') => ({ id, username: 'operator' + id, display_name: '运营同事' + id, role, status })
const assignment = (id = 91, revision = 4, kind = 'user') => ({ subject_type: kind, subject_id: id, revision, mode: 'training', entry_url: 'https://training.example/entry', allowed_origins: ['https://training.example'], status: 'active', expires_at: '2027-01-01T00:00:00Z' })
const permission = (id = 7) => ({ staff_id: id, revision: 3, enabled: true, max_scenes: 6, allowed_origins: ['https://training.example'], allowed_capabilities: [] as string[], expires_at: '2027-01-01T00:00:00Z' })
const page = <T>(items: T[], total = items.length) => ({ items, total, page: 1, page_size: 20 })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
let wrapper: VueWrapper
let assignments: ReturnType<typeof assignment>[]
let permissions: ReturnType<typeof permission>[]

function button(text: string) {
  const found = wrapper.findAll('button').find(node => node.text() === text)
  if (!found) throw new Error('缺少按钮：' + text)
  return found
}
async function click(text: string) { await button(text).trigger('click'); await flushPromises() }
function input(labelText: string, tag = 'input') {
  const found = wrapper.findAll('label').find(node => node.text().startsWith(labelText))
  if (!found) throw new Error('缺少字段：' + labelText)
  return found.get(tag)
}
async function submitAssignment() { await wrapper.get('form[aria-label="使用范围编辑"]').trigger('submit'); await flushPromises() }
async function mountView(attachTo?: Element) { wrapper = mount(ScenariosView, { attachTo, global: { stubs: { ProjectScopesPanel: true } } }); await flushPromises() }
async function chooseUser() { await click('新增使用范围'); await click('选择') }
async function fillAssignment() {
  await input('使用方式', 'select').setValue('competition')
  await input('使用截止时间').setValue('2027-01-01T12:00')
}
beforeEach(() => {
  vi.resetAllMocks()
  assignments = []; permissions = [permission()]
  mocks.get.mockImplementation(async (path: string) => path === '/api/scenarios/assignments' ? assignments : permissions)
  mocks.users.mockResolvedValue(page([user()]))
  mocks.user.mockImplementation(async (id: number) => user(id))
  mocks.codes.mockResolvedValue(page([code()]))
  mocks.code.mockImplementation(async (id: number) => code(id))
  mocks.staff.mockResolvedValue(page([staff(), staff(8)]))
  mocks.confirm.mockResolvedValue(true)
  mocks.put.mockImplementation(async (path: string, body: Record<string, unknown>) => path.includes('/assignments/')
    ? { ...body, subject_type: path.split('/').at(-2), subject_id: Number(path.split('/').at(-1)), revision: Number(body.expected_revision) + 1 }
    : { ...body, staff_id: Number(path.split('/').at(-2)), revision: Number(body.expected_revision) + 1 })
})
afterEach(() => wrapper?.unmount())

describe('使用范围：先确认真实身份，再保存规则', () => {
  it('主动选中身份后焦点进入首个可编辑字段，不写入权限', async () => {
    await mountView(document.body); await chooseUser()
    expect(document.activeElement).toBe(input('使用方式', 'select').element)
    expect(mocks.put).not.toHaveBeenCalled()
  })

  it('列表优先，编辑器按需展开，没有默认用户或管理员1，也不自动写入', async () => {
    await mountView()
    expect(wrapper.findAll('form')).toHaveLength(0)
    expect(mocks.get).toHaveBeenCalledWith('/api/scenarios/assignments', { page: 1, page_size: 20 }, { cache: false })
    expect(mocks.staff).toHaveBeenCalledWith({ page: 1, page_size: 20, q: undefined })
    expect(wrapper.text()).toContain('运营同事7')
    expect(mocks.users).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
    expect(mocks.motion).not.toHaveBeenCalled()
    await click('新增使用范围')
    expect(wrapper.get('#assignment-editor-heading').attributes('tabindex')).toBe('-1')
    expect(wrapper.get('.editor-section').classes()).toContain('kst-reveal')
    expect(mocks.motion).toHaveBeenLastCalledWith(wrapper.get('.editor-section').element, { block: 'nearest', focusSelector: '#assignment-editor-heading' })
    await fillAssignment(); await submitAssignment()
    expect(button('确认并保存范围').attributes('disabled')).toBeDefined()
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(mocks.put).not.toHaveBeenCalled()
  })

  it('显式选择后读取详情，比赛固定精确入口，确认展示姓名与全部影响范围', async () => {
    await mountView(); await chooseUser(); await fillAssignment()
    expect(mocks.user).toHaveBeenCalledWith(91)
    expect(wrapper.get('.identity-confirmed').text()).toContain('样例用户91')
    expect(wrapper.get('.identity-confirmed').classes()).toContain('kst-reveal')
    expect(wrapper.get('.identity-confirmed').classes()).not.toContain('kst-confirm')
    expect((input('平台入口').element as HTMLInputElement).readOnly).toBe(true)
    mocks.confirm.mockResolvedValueOnce(false)
    await submitAssignment()
    expect(mocks.put).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('使用范围已保存')
    await submitAssignment()
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('样例用户91') }))
    expect(mocks.confirm.mock.calls.at(-1)![0].message).toContain('这位用户的全部设备')
    expect(mocks.put).toHaveBeenCalledWith('/api/scenarios/assignments/user/91', expect.objectContaining({ expected_revision: 0, mode: 'competition', entry_url: 'https://www.idtrade.cn/User/Contest', allowed_origins: ['https://www.idtrade.cn'] }))
  })

  it('授权码搜索分页，选择后显示客户/项目/尾号，保存范围明确包含全部关联用户', async () => {
    mocks.codes.mockResolvedValue(page([code()], 41))
    await mountView(); await click('新增使用范围')
    await input('给谁使用', 'select').setValue('auth_code'); await flushPromises()
    await input('查找对象').setValue('样例学校'); await click('搜索对象')
    expect(mocks.codes).toHaveBeenLastCalledWith({ page: 1, page_size: 20, keyword: '样例学校' })
    await click('下一页对象')
    expect(mocks.codes).toHaveBeenLastCalledWith({ page: 2, page_size: 20, keyword: '样例学校' })
    expect(wrapper.text()).not.toContain('SECRET-EXAMPLE-')
    await click('选择'); await fillAssignment(); await submitAssignment()
    expect(mocks.code).toHaveBeenCalledWith(201)
    expect(mocks.put).toHaveBeenCalledWith('/api/scenarios/assignments/auth_code/201', expect.objectContaining({ expected_revision: 0 }))
    expect(mocks.confirm.mock.calls.at(-1)![0].message).toContain('该授权码下的全部用户及设备')
  })

  it('旧记录编辑锁定对象与原版本，重新新增必须清空旧对象和版本', async () => {
    assignments = [assignment()]
    await mountView(); await click('核对并编辑')
    expect(wrapper.text()).toContain('修改对象已锁定')
    expect(wrapper.find('select').element).toBe(input('使用方式', 'select').element)
    expect(wrapper.text()).not.toContain('更换对象')
    await submitAssignment()
    expect(mocks.put).toHaveBeenLastCalledWith('/api/scenarios/assignments/user/91', expect.objectContaining({ expected_revision: 4 }))
    await click('新增使用范围')
    expect(wrapper.find('.identity-confirmed').exists()).toBe(false)
    expect(button('确认并保存范围').attributes('disabled')).toBeDefined()
    mocks.users.mockResolvedValue(page([user(92)]))
    await click('搜索对象'); await click('选择'); await fillAssignment(); await submitAssignment()
    expect(mocks.put).toHaveBeenLastCalledWith('/api/scenarios/assignments/user/92', expect.objectContaining({ expected_revision: 0 }))
  })

  it.each([
    ['详情缺失', () => mocks.user.mockResolvedValue(undefined)],
    ['只有编号没有身份资料', () => mocks.user.mockResolvedValue({ id: 91 })],
    ['对象不一致', () => mocks.user.mockResolvedValue(user(92))],
    ['详情读取失败', () => mocks.user.mockRejectedValue(new Error('无权读取身份详情'))],
  ])('%s 不猜姓名也不允许提交', async (_name, setup) => {
    assignments = [assignment()]; setup()
    await mountView(); await click('核对并编辑')
    expect(wrapper.text()).toContain('无法核对身份')
    expect(wrapper.find('.identity-confirmed').exists()).toBe(false)
    expect(button('确认并保存修改').attributes('disabled')).toBeDefined()
    await submitAssignment()
    expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('对象详情迟到不会进入另一个类型的编辑器', async () => {
    const slow = deferred<ReturnType<typeof user>>()
    mocks.user.mockReturnValueOnce(slow.promise)
    await mountView(); await click('新增使用范围')
    await button('选择').trigger('click'); await flushPromises()
    await input('给谁使用', 'select').setValue('auth_code'); await flushPromises()
    await click('选择')
    slow.resolve(user()); await flushPromises()
    expect(wrapper.get('.identity-confirmed').text()).toContain('样例学校')
    expect(wrapper.get('.identity-confirmed').text()).not.toContain('样例用户91')
    await fillAssignment(); await submitAssignment()
    expect(mocks.put).toHaveBeenLastCalledWith('/api/scenarios/assignments/auth_code/201', expect.objectContaining({ expected_revision: 0 }))
  })

  it('过期的搜索响应不覆盖新对象列表，搜索失败不显示暂无对象', async () => {
    const slow = deferred<ReturnType<typeof page<ReturnType<typeof user>>>>()
    mocks.users.mockReturnValueOnce(slow.promise)
    await mountView(); await click('新增使用范围')
    await input('给谁使用', 'select').setValue('auth_code'); await flushPromises()
    slow.resolve(page([user()])); await flushPromises()
    expect(wrapper.get('.identity-options').text()).toContain('样例学校')
    expect(wrapper.get('.identity-options').text()).not.toContain('样例用户91')
    mocks.codes.mockRejectedValueOnce(new Error('搜索服务不可用'))
    await click('搜索对象')
    expect(wrapper.text()).toContain('搜索服务不可用')
    expect(wrapper.text()).not.toContain('没有找到匹配对象')
  })

  it('20条分页不声称全量，进入下一页与加载失败不保留旧空态', async () => {
    assignments = Array.from({ length: 20 }, (_, index) => assignment(index + 1))
    await mountView(); await click('下一页')
    expect(mocks.get).toHaveBeenCalledWith('/api/scenarios/assignments', { page: 2, page_size: 20 }, { cache: false })
    mocks.get.mockRejectedValueOnce(new Error('使用范围服务不可用'))
    await click('刷新')
    expect(wrapper.text()).toContain('使用范围服务不可用')
    expect(wrapper.text()).not.toContain('暂无场景分配')
    expect(button('新增使用范围').attributes('disabled')).toBeDefined()
  })

  it('版本冲突保留编辑内容与版本，不自动覆盖或展示成功', async () => {
    assignments = [assignment()]
    await mountView(); await click('核对并编辑')
    mocks.put.mockRejectedValue(new Error('版本冲突，请刷新核对'))
    await input('平台入口').setValue('https://training.example/new'); await submitAssignment()
    expect(wrapper.text()).toContain('版本冲突')
    expect((input('平台入口').element as HTMLInputElement).value).toBe('https://training.example/new')
    expect(wrapper.text()).not.toContain('使用范围已保存')
    expect(mocks.put).toHaveBeenCalledTimes(1)
  })

  it('确认等待时页面退出，不提交旧对象', async () => {
    const confirm = deferred<boolean>()
    mocks.confirm.mockReturnValue(confirm.promise)
    await mountView(); await chooseUser(); await fillAssignment()
    await wrapper.get('form[aria-label="使用范围编辑"]').trigger('submit'); await flushPromises()
    wrapper.unmount(); confirm.resolve(true); await flushPromises()
    expect(mocks.put).not.toHaveBeenCalled()
  })
})

describe('后台账号工作区：按真实账号确认权限', () => {
  it('必须从账号表选择，代理/停用账号不能配置，权限确认包含账号、站点和工具范围', async () => {
    mocks.staff.mockResolvedValue(page([staff(), staff(8, 'agent'), staff(9, 'support', 'disabled')]))
    await mountView()
    expect(wrapper.findAll('button').filter(node => node.text() === '不适用')).toHaveLength(2)
    expect(wrapper.find('form[aria-label="工作区权限编辑"]').exists()).toBe(false)
    await click('设置权限')
    expect(wrapper.get('#permission-editor-heading').attributes('tabindex')).toBe('-1')
    expect(mocks.motion).toHaveBeenLastCalledWith(wrapper.get('.editor-section').element, { block: 'nearest', focusSelector: '#permission-editor-heading' })
    expect((input('允许使用已审核的配送模板工具').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('form[aria-label="工作区权限编辑"]').text()).not.toContain('管理员编号')
    mocks.confirm.mockResolvedValueOnce(false)
    await wrapper.get('form[aria-label="工作区权限编辑"]').trigger('submit'); await flushPromises()
    expect(mocks.put).not.toHaveBeenCalled()
    await wrapper.get('form[aria-label="工作区权限编辑"]').trigger('submit'); await flushPromises()
    const confirm = mocks.confirm.mock.calls.at(-1)![0].message
    expect(confirm).toContain('运营同事7（operator7，#7）')
    expect(confirm).toContain('https://training.example')
    expect(confirm).toContain('工具写入：不开通')
    expect(confirm).toContain('仅影响这位同事自己的账号工作区')
    expect(mocks.put).toHaveBeenCalledWith('/api/scenarios/staff/7/permission', expect.objectContaining({ expected_revision: 3, allowed_capabilities: [] }))
  })

  it('切换后台账号不继承旧版本和工具权限，搜索分页20条且清空选择', async () => {
    permissions[0]!.allowed_capabilities = ['template.create.v1']
    mocks.staff.mockResolvedValue(page([staff(), staff(8)], 41))
    await mountView(); await click('设置权限')
    const configureButtons = wrapper.findAll('button').filter(node => node.text() === '设置权限')
    await configureButtons[1]!.trigger('click'); await flushPromises()
    expect(wrapper.get('.identity-confirmed').text()).toContain('运营同事8')
    expect((input('允许使用已审核的配送模板工具').element as HTMLInputElement).checked).toBe(false)
    await input('权限结束时间').setValue('2027-01-01T12:00')
    await input('允许打开的站点', 'textarea').setValue('https://training.example')
    await wrapper.get('form[aria-label="工作区权限编辑"]').trigger('submit'); await flushPromises()
    expect(mocks.put).toHaveBeenCalledWith('/api/scenarios/staff/8/permission', expect.objectContaining({ expected_revision: 0, enabled: false, allowed_capabilities: [] }))
    await click('下一页账号')
    expect(mocks.staff).toHaveBeenLastCalledWith({ page: 2, page_size: 20, q: undefined })
    expect(wrapper.find('form[aria-label="工作区权限编辑"]').exists()).toBe(false)
  })

  it('后台账号读取失败不伪装空列表，迟到响应不覆盖新搜索', async () => {
    const slow = deferred<ReturnType<typeof page<ReturnType<typeof staff>>>>()
    mocks.staff.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page([staff(8)]))
    await mountView()
    await input('查找后台账号').setValue('operator8'); await input('查找后台账号').trigger('keydown.enter'); await flushPromises()
    slow.resolve(page([staff(7)])); await flushPromises()
    expect(wrapper.text()).toContain('运营同事8')
    expect(wrapper.text()).not.toContain('运营同事7')
    mocks.staff.mockRejectedValueOnce(new Error('后台账号目录不可用'))
    await click('搜索账号')
    expect(wrapper.text()).toContain('后台账号目录不可用')
    expect(wrapper.text()).not.toContain('没有找到匹配的后台账号')
    expect(wrapper.find('form[aria-label="工作区权限编辑"]').exists()).toBe(false)
  })
})
