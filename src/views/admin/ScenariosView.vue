<template>
  <section class="framework-page scenarios-page" aria-label="场景与本机运行权限">
    <PageHeader title="使用范围与账号权限" description="给用户安排实训或比赛；给内部同事开通独立的账号工作区。两类权限分别管理。" />
    <p v-if="error && !loadError" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status" class="notice kst-confirm">{{ message }}</p>
    <p v-if="loadState === 'loading'" role="status" class="hint">正在读取使用范围与账号权限…</p>
    <div v-if="loadError" role="alert" class="error">使用范围与账号权限读取失败：{{ loadError }}<button :disabled="busy" @click="run(load)">重新加载</button></div>

    <section class="panel" aria-labelledby="assignment-heading">
      <div class="section-heading">
        <div><h2 id="assignment-heading">用户使用范围</h2><p class="hint">查看已有安排，或为指定用户、授权码安排实训或比赛。</p></div>
        <button class="primary" :disabled="busy || loadState !== 'ready'" @click="startAssignment">新增使用范围</button>
      </div>
      <template v-if="loadState === 'ready'">
        <div v-if="assignments.length" class="table-wrap"><table class="scope-table"><thead><tr><th>使用对象</th><th>使用方式 / 平台</th><th>状态 / 截止时间</th><th>操作</th></tr></thead><tbody>
          <tr v-for="row in assignments" :key="row.subject_type + ':' + row.subject_id">
            <td><strong>{{ knownIdentities[identityKey(row)]?.name || subjectLabel(row.subject_type) + ' #' + row.subject_id }}</strong><small>{{ knownIdentities[identityKey(row)]?.detail || '编辑时读取身份资料，再核对保存' }}</small></td>
            <td>{{ row.mode === 'competition' ? '比赛' : '实训' }}<small class="url">{{ row.entry_url }}</small></td>
            <td>{{ row.status === 'active' ? '可以使用' : '暂时停用' }}<small>{{ displayTime(row.expires_at) }}</small></td>
            <td><button :disabled="busy" @click="editAssignment(row)">核对并编辑</button></td>
          </tr>
        </tbody></table></div>
        <p v-else class="empty">{{ assignmentPage === 1 ? '暂无场景分配。未分配不代表获得比赛权限。' : '本页没有更多使用范围，请返回上一页。' }}</p>
        <div class="list-pager"><span>第 {{ assignmentPage }} 页 · 每页最多 {{ PAGE_SIZE }} 条</span><button :disabled="busy || assignmentPage === 1" @click="changeAssignmentPage(-1)">上一页</button><button :disabled="busy || assignments.length < PAGE_SIZE" @click="changeAssignmentPage(1)">下一页</button></div>
      </template>

      <section v-if="assignmentOpen" ref="assignmentEditor" class="editor-section kst-reveal" aria-labelledby="assignment-editor-heading">
        <div class="section-heading"><h3 id="assignment-editor-heading" tabindex="-1">{{ assignmentLocked ? '修改使用范围' : '新增使用范围' }}</h3><button :disabled="busy" @click="closeAssignment">收起</button></div>
        <fieldset :disabled="busy">
          <template v-if="!assignmentLocked && !selectedIdentity">
            <div class="identity-search">
              <label>给谁使用<select v-model="assignment.subject_type" @change="changeSubjectType"><option value="user">单个用户</option><option value="auth_code">一个授权码下的所有用户</option></select></label>
              <label>查找对象<input v-model="identityKeyword" :placeholder="assignment.subject_type === 'user' ? '姓名、手机号或设备名' : '客户、项目、订单号或授权码'" @keydown.enter.prevent="searchIdentities"></label>
              <button type="button" :disabled="candidateLoading" @click="searchIdentities">搜索对象</button>
            </div>
            <p v-if="candidateLoading" role="status" class="hint">正在查找对象…</p>
            <p v-else-if="candidateError" role="alert" class="error">{{ candidateError }}<button type="button" @click="loadCandidates">重试查找</button></p>
            <template v-else>
              <ul class="identity-options" aria-label="可选择的使用对象"><li v-for="candidate in candidates" :key="candidate.id"><div><strong>{{ candidate.name }}</strong><small>{{ candidate.detail }}</small></div><button type="button" :disabled="identityLoading" @click="selectIdentity(candidate)">选择</button></li></ul>
              <p v-if="!candidates.length" class="empty">没有找到匹配对象，请换个关键词。</p>
              <div class="list-pager"><span>共 {{ candidateTotal }} 个 · 第 {{ candidatePage }} 页</span><button type="button" :disabled="candidatePage === 1" @click="changeCandidatePage(-1)">上一页对象</button><button type="button" :disabled="candidatePage * PAGE_SIZE >= candidateTotal" @click="changeCandidatePage(1)">下一页对象</button></div>
            </template>
          </template>
          <p v-if="identityLoading" role="status" class="hint">正在核对对象身份，核对完成后才能保存…</p>
          <p v-else-if="identityError" role="alert" class="error">{{ identityError }}<button v-if="assignment.subject_id" type="button" @click="resolveSelectedIdentity(assignment.subject_type, assignment.subject_id)">重新核对身份</button></p>
          <div v-if="selectedIdentity" class="identity-confirmed kst-reveal"><div><small>{{ assignmentLocked ? '修改对象已锁定' : '已选对象' }} · {{ subjectLabel(assignment.subject_type) }} #{{ selectedIdentity.id }}</small><strong>{{ selectedIdentity.name }}</strong><span>{{ selectedIdentity.detail }}</span></div><div><p>{{ assignment.subject_type === 'auth_code' ? '影响该授权码下的全部用户及设备。' : '影响这位用户的全部设备。' }}</p><button v-if="!assignmentLocked" type="button" class="change-identity" @click="reselectIdentity">更换对象</button></div></div>

          <form aria-label="使用范围编辑" @submit.prevent="saveAssignment">
            <div class="fields">
              <label>使用方式<select v-model="assignment.mode" @change="setCompetitionEntry"><option value="training">实训</option><option value="competition">比赛</option></select></label>
              <label>平台入口<input v-model="assignment.entry_url" type="url" required :readonly="assignment.mode === 'competition'" placeholder="填写用户要进入的平台" @change="fillEntryOrigin"></label>
              <label>使用截止时间（本机时区）<input v-model="assignment.expiry" type="datetime-local" required></label>
              <label>当前状态<select v-model="assignment.status"><option value="active">可以使用</option><option value="disabled">暂时停用</option></select></label>
            </div>
            <details class="advanced-options"><summary>站点范围与技术信息</summary><label>允许打开的站点（每行一个）<textarea v-model="origins" placeholder="https://www.idtrade.cn" /></label><p class="hint">按协议、主机和端口精确匹配。比赛站内正常路径不受限；额外登录站点必须经过确认，不能用子域名或前缀放行。当前记录版本：{{ assignment.expected_revision || '新建' }}。</p></details>
            <div class="actions"><button class="primary" type="submit" :disabled="!selectedIdentity || identityLoading || !!identityError || loadState !== 'ready'">{{ assignment.expected_revision ? '确认并保存修改' : '确认并保存范围' }}</button><span class="hint">保存前会再次核对对象、平台和影响范围。</span></div>
          </form>
        </fieldset>
      </section>
    </section>

    <section class="panel" aria-labelledby="staff-permission-heading">
      <div class="section-heading"><div><h2 id="staff-permission-heading">内部同事的账号工作区</h2><p class="hint">从真实后台账号选择同事。此权限不占用客户授权，也不自动开放工具。</p></div></div>
      <div class="staff-search"><label>查找后台账号<input v-model="staffKeyword" placeholder="姓名或登录账号" :disabled="busy" @keydown.enter.prevent="searchStaff"></label><button :disabled="busy || staffLoading || loadState !== 'ready'" @click="searchStaff">搜索账号</button></div>
      <p v-if="staffLoading" role="status" class="hint">正在读取后台账号…</p>
      <p v-else-if="staffError" role="alert" class="error">{{ staffError }}<button :disabled="busy" @click="loadStaff">重新读取账号</button></p>
      <template v-else-if="staffReady && loadState === 'ready'">
        <div v-if="staffAccounts.length" class="table-wrap"><table class="scope-table"><thead><tr><th>同事 / 登录账号</th><th>身份 / 状态</th><th>账号工作区</th><th>操作</th></tr></thead><tbody>
          <tr v-for="staff in staffAccounts" :key="staff.id">
            <td><strong>{{ staff.display_name || staff.username }}</strong><small>{{ staff.username }} · #{{ staff.id }}</small></td>
            <td>{{ roleName(staff.role) }}<small>{{ staff.status === 'active' ? '账号正常' : '账号已停用' }}</small></td>
            <td>{{ permissionFor(staff.id)?.enabled ? '已开通 · 最多 ' + permissionFor(staff.id)?.max_scenes + ' 个账号' : '未开通' }}<small v-if="permissionFor(staff.id)?.enabled">截至 {{ displayTime(permissionFor(staff.id)?.expires_at) }}</small></td>
            <td><button :disabled="busy || !canConfigure(staff)" @click="editPermission(staff)">{{ canConfigure(staff) ? '设置权限' : '不适用' }}</button></td>
          </tr>
        </tbody></table></div>
        <p v-else class="empty">没有找到匹配的后台账号。</p>
        <div class="list-pager"><span>共 {{ staffTotal }} 个 · 第 {{ staffPage }} 页</span><button :disabled="busy || staffPage === 1" @click="changeStaffPage(-1)">上一页账号</button><button :disabled="busy || staffPage * PAGE_SIZE >= staffTotal" @click="changeStaffPage(1)">下一页账号</button></div>
      </template>

      <section v-if="selectedStaff" ref="permissionEditor" class="editor-section kst-reveal" aria-labelledby="permission-editor-heading">
        <div class="section-heading"><h3 id="permission-editor-heading" tabindex="-1">设置工作区权限</h3><button :disabled="busy" @click="closePermission">收起</button></div>
        <div class="identity-confirmed"><div><small>后台账号 · 对象不可更换</small><strong>{{ selectedStaff.display_name || selectedStaff.username }}</strong><span>{{ selectedStaff.username }} · #{{ selectedStaff.id }} · {{ roleName(selectedStaff.role) }}</span></div><p>仅影响这位同事自己的账号工作区。</p></div>
        <form aria-label="工作区权限编辑" @submit.prevent="savePermission"><fieldset :disabled="busy">
          <div class="fields">
            <label>最多同时打开账号<input v-model.number="permission.max_scenes" type="number" min="1" max="10" required></label>
            <label>权限结束时间（本机时区）<input v-model="permission.expiry" type="datetime-local" required></label>
            <label>允许打开的站点（每行一个）<textarea v-model="staffOrigins" required placeholder="https://www.idtrade.cn" /></label>
          </div>
          <label class="check"><input v-model="permission.enabled" type="checkbox">允许这位同事使用账号工作区</label>
          <details class="advanced-options"><summary>工具执行权限与技术信息</summary><label class="check"><input v-model="allowTemplate" type="checkbox">允许使用已审核的配送模板工具</label><p class="hint">网页权限不等于工具写入权限，不继承客户套餐。自动执行仍由单个 Runner 串行处理。当前记录版本：{{ permission.expected_revision || '新建' }}。</p></details>
          <div class="actions"><button class="primary" type="submit" :disabled="loadState !== 'ready' || !staffReady || !!staffError">确认并保存工作区权限</button></div>
        </fieldset></form>
      </section>
    </section>
    <details class="project-options"><summary>项目、平台与截止时间的绑定设置</summary><ProjectScopesPanel /></details>
    <div class="actions"><button :disabled="busy" @click="run(load)">刷新</button></div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import { api } from '@/utils/api'
import { getUser, getUsersPage } from '@/utils/api/users'
import { getAuthCode, getAuthCodesPage } from '@/utils/api/auth-codes'
import { getStaffAccountsPage } from '@/utils/api/staff'
import { confirmAction } from '@/shared/ui/confirm'
import { scrollToWorkflowTarget } from '@/shared/ui/workflowMotion'
import { useFrameworkTask } from '@/features/admin/useFrameworkTask'
import ProjectScopesPanel from '@/features/admin/ProjectScopesPanel.vue'
import '@/features/admin/framework.css'

type SubjectType = 'user' | 'auth_code'
type Assignment = { subject_type: SubjectType; subject_id: number; revision: number; mode: 'training' | 'competition'; entry_url: string; allowed_origins: string[]; status: 'active' | 'disabled'; expires_at: string | null }
type Permission = { staff_id: number; revision: number; enabled: boolean; max_scenes: number; allowed_origins: string[]; allowed_capabilities: string[]; expires_at: string | null }
type Staff = Awaited<ReturnType<typeof getStaffAccountsPage>>['items'][number]
type Identity = { id: number; name: string; detail: string }
const PAGE_SIZE = 20
const { busy, error, message, run } = useFrameworkTask()
const loadState = ref<'loading' | 'ready' | 'error'>('loading'), loadError = ref('')
const assignments = ref<Assignment[]>([]), permissions = ref<Permission[]>([]), assignmentPage = ref(1)
const assignmentOpen = ref(false), assignmentLocked = ref(false), selectedIdentity = ref<Identity | null>(null)
const assignmentEditor = ref<HTMLElement | null>(null), permissionEditor = ref<HTMLElement | null>(null)
const knownIdentities = ref<Record<string, Identity>>({})
const assignment = reactive({ subject_type: 'user' as SubjectType, subject_id: null as number | null, expected_revision: 0, mode: 'training' as 'training' | 'competition', entry_url: '', expiry: '', status: 'active' as 'active' | 'disabled' })
const origins = ref(''), identityKeyword = ref(''), candidates = ref<Identity[]>([]), candidatePage = ref(1), candidateTotal = ref(0)
const candidateLoading = ref(false), candidateError = ref(''), identityLoading = ref(false), identityError = ref('')
const staffAccounts = ref<Staff[]>([]), staffPage = ref(1), staffTotal = ref(0), staffKeyword = ref('')
const staffLoading = ref(false), staffReady = ref(false), staffError = ref(''), selectedStaff = ref<Staff | null>(null)
const permission = reactive({ staff_id: null as number | null, expected_revision: 0, enabled: false, max_scenes: 6, expiry: '' })
const staffOrigins = ref(''), allowTemplate = ref(false)
let alive = true, loadGeneration = 0, candidateGeneration = 0, identityGeneration = 0, staffGeneration = 0, assignmentGeneration = 0, permissionGeneration = 0
const lines = (value: string) => [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))]
const reason = (cause: unknown) => cause instanceof Error && cause.message ? cause.message : '请稍后重试'
const subjectLabel = (kind: SubjectType) => kind === 'user' ? '用户' : '授权码'
const identityKey = (row: Pick<Assignment, 'subject_type' | 'subject_id'>) => row.subject_type + ':' + row.subject_id
const roleName = (role: string) => ({ super_admin: '超级管理员', operator: '运营', support: '客服', agent: '代理' }[role] || '其他账号')
const permissionFor = (id: number | string) => permissions.value.find(row => row.staff_id === Number(id))
const canConfigure = (staff: Staff) => staff.status === 'active' && ['super_admin', 'operator', 'support'].includes(staff.role)
function localTime(value: string | null) { if (!value) return ''; const date = new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z'); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
function displayTime(value?: string | null) { return value ? localTime(value).replace('T', ' ') || '时间待核对' : '未设置截止时间' }
function toIdentity(kind: SubjectType, record: unknown): Identity {
  if (!record || typeof record !== 'object') throw new Error('身份资料缺失，不能保存。')
  const row = record as Record<string, unknown>, id = Number(row.id)
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('身份资料不完整，不能保存。')
  const text = (key: string) => typeof row[key] === 'string' ? (row[key] as string).trim() : ''
  if (kind === 'user') return { id, name: text('name') || '未填写姓名的用户 #' + id, detail: [text('phone'), text('device_name'), text('customer_name')].filter(Boolean).join(' · ') || '暂无手机号或设备名称，请核对用户编号' }
  return { id, name: text('customer_name') || text('user_name') || '未关联客户的授权码 #' + id, detail: [text('code') ? '尾号 ' + text('code').slice(-4) : '未返回授权码尾号', text('project_id'), text('order_no')].filter(Boolean).join(' · ') }
}
function clearSelectedIdentity() {
  identityGeneration++; assignmentGeneration++; selectedIdentity.value = null; identityError.value = ''; identityLoading.value = false
  assignment.subject_id = null; assignment.expected_revision = 0
}
function resetAssignmentFields() {
  Object.assign(assignment, { expected_revision: 0, mode: 'training', entry_url: '', expiry: '', status: 'active' })
  origins.value = ''
}
function startAssignment() {
  if (busy.value || loadState.value !== 'ready') return
  clearSelectedIdentity(); resetAssignmentFields(); assignmentOpen.value = true; assignmentLocked.value = false
  assignment.subject_type = 'user'; identityKeyword.value = ''; candidatePage.value = 1; void loadCandidates()
  void nextTick(() => scrollToWorkflowTarget(assignmentEditor.value, { block: 'nearest', focusSelector: '#assignment-editor-heading' }))
}
function closeAssignment() { if (busy.value) return; assignmentOpen.value = false; candidateGeneration++; clearSelectedIdentity() }
function changeSubjectType() { clearSelectedIdentity(); resetAssignmentFields(); identityKeyword.value = ''; candidatePage.value = 1; void loadCandidates() }
function reselectIdentity() { if (busy.value || assignmentLocked.value) return; clearSelectedIdentity(); resetAssignmentFields(); void loadCandidates() }
async function loadCandidates() {
  const generation = ++candidateGeneration, kind = assignment.subject_type
  candidateLoading.value = true; candidateError.value = ''; candidates.value = []; candidateTotal.value = 0
  try {
    const params = { page: candidatePage.value, page_size: PAGE_SIZE, keyword: identityKeyword.value.trim() || undefined }
    const result = kind === 'user' ? await getUsersPage(params) : await getAuthCodesPage(params)
    if (!alive || generation !== candidateGeneration || kind !== assignment.subject_type || !assignmentOpen.value) return
    candidates.value = result.items.map(row => toIdentity(kind, row)); candidateTotal.value = result.total
  } catch (cause) { if (alive && generation === candidateGeneration) candidateError.value = '查找对象失败：' + reason(cause) }
  finally { if (alive && generation === candidateGeneration) candidateLoading.value = false }
}
function searchIdentities() { if (busy.value) return; clearSelectedIdentity(); candidatePage.value = 1; void loadCandidates() }
function changeCandidatePage(delta: number) { if (busy.value) return; clearSelectedIdentity(); candidatePage.value += delta; void loadCandidates() }
async function resolveSelectedIdentity(kind: SubjectType, id: number) {
  const generation = ++identityGeneration
  selectedIdentity.value = null; identityLoading.value = true; identityError.value = ''
  try {
    const detail = kind === 'user' ? await getUser(id) : await getAuthCode(id)
    if (!alive || generation !== identityGeneration || !assignmentOpen.value || assignment.subject_type !== kind || assignment.subject_id !== id) return
    if (!detail || typeof detail !== 'object' || !(kind === 'user' ? ['name', 'phone', 'device_name', 'device_id', 'customer_name'] : ['code', 'customer_name', 'user_name', 'project_id', 'order_no']).some(key => typeof (detail as Record<string, unknown>)[key] === 'string' && String((detail as Record<string, unknown>)[key]).trim())) throw new Error('缺少姓名、设备或授权资料，不能仅凭编号保存。')
    const identity = toIdentity(kind, detail)
    if (identity.id !== id) throw new Error('返回的对象与所选对象不一致，请重新核对。')
    selectedIdentity.value = identity; knownIdentities.value[kind + ':' + id] = identity
  } catch (cause) {
    if (alive && generation === identityGeneration) identityError.value = '无法核对身份：' + reason(cause)
  } finally { if (alive && generation === identityGeneration) identityLoading.value = false }
}
async function selectIdentity(candidate: Identity) {
  if (busy.value || assignmentLocked.value) return
  clearSelectedIdentity(); resetAssignmentFields(); assignment.subject_id = candidate.id
  const existing = assignments.value.find(row => row.subject_type === assignment.subject_type && row.subject_id === candidate.id)
  if (existing) { await editAssignment(existing); return }
  const generation = assignmentGeneration
  await resolveSelectedIdentity(assignment.subject_type, candidate.id)
  void nextTick(() => {
    if (!alive || generation !== assignmentGeneration || !assignmentOpen.value || selectedIdentity.value?.id !== candidate.id) return
    assignmentEditor.value?.querySelector<HTMLSelectElement>('form[aria-label="使用范围编辑"] select')?.focus({ preventScroll: true })
  })
}
function setCompetitionEntry() { if (assignment.mode === 'competition') { assignment.entry_url = 'https://www.idtrade.cn/User/Contest'; origins.value = 'https://www.idtrade.cn' } }
function fillEntryOrigin() { if (origins.value.trim()) return; try { const url = new URL(assignment.entry_url); if (['http:', 'https:'].includes(url.protocol)) origins.value = url.origin } catch { /* Keep invalid input for form validation. */ } }
async function editAssignment(row: Assignment) {
  if (busy.value) return
  clearSelectedIdentity(); candidateGeneration++; assignmentOpen.value = true; assignmentLocked.value = true
  Object.assign(assignment, { subject_type: row.subject_type, subject_id: row.subject_id, expected_revision: row.revision, mode: row.mode, entry_url: row.entry_url, expiry: localTime(row.expires_at), status: row.status })
  origins.value = row.allowed_origins.join('\n')
  void nextTick(() => scrollToWorkflowTarget(assignmentEditor.value, { block: 'nearest', focusSelector: '#assignment-editor-heading' }))
  await resolveSelectedIdentity(row.subject_type, row.subject_id)
}
function closePermission() { if (busy.value) return; permissionGeneration++; selectedStaff.value = null; permission.staff_id = null; permission.expected_revision = 0 }
function editPermission(staff: Staff) {
  if (busy.value || !canConfigure(staff) || loadState.value !== 'ready' || !staffReady.value || staffError.value) return
  permissionGeneration++; selectedStaff.value = { ...staff }
  const current = permissionFor(staff.id)
  Object.assign(permission, { staff_id: Number(staff.id), expected_revision: current?.revision || 0, enabled: current?.enabled || false, max_scenes: current?.max_scenes || 6, expiry: localTime(current?.expires_at || null) })
  staffOrigins.value = current?.allowed_origins.join('\n') || ''; allowTemplate.value = current?.allowed_capabilities.includes('template.create.v1') || false
  void nextTick(() => scrollToWorkflowTarget(permissionEditor.value, { block: 'nearest', focusSelector: '#permission-editor-heading' }))
}
async function loadStaff() {
  const generation = ++staffGeneration
  staffLoading.value = true; staffReady.value = false; staffError.value = ''; staffAccounts.value = []
  try {
    const result = await getStaffAccountsPage({ page: staffPage.value, page_size: PAGE_SIZE, q: staffKeyword.value.trim() || undefined })
    if (!alive || generation !== staffGeneration) return
    staffAccounts.value = result.items; staffTotal.value = result.total; staffReady.value = true
    if (selectedStaff.value) {
      const current = result.items.find(row => Number(row.id) === Number(selectedStaff.value?.id))
      selectedStaff.value = current && canConfigure(current) ? { ...current } : null
      if (!selectedStaff.value) { permissionGeneration++; permission.staff_id = null; permission.expected_revision = 0 }
    }
  } catch (cause) { if (alive && generation === staffGeneration) staffError.value = '后台账号读取失败：' + reason(cause) }
  finally { if (alive && generation === staffGeneration) staffLoading.value = false }
}
function searchStaff() { if (busy.value) return; closePermission(); staffPage.value = 1; void loadStaff() }
function changeStaffPage(delta: number) { if (busy.value) return; closePermission(); staffPage.value += delta; void loadStaff() }
function changeAssignmentPage(delta: number) { if (busy.value) return; closeAssignment(); assignmentPage.value += delta; void run(load) }
async function load() {
  const generation = ++loadGeneration
  loadState.value = 'loading'; loadError.value = ''
  try {
    const [nextAssignments, nextPermissions] = await Promise.all([
      api.get<Assignment[]>('/api/scenarios/assignments', { page: assignmentPage.value, page_size: PAGE_SIZE }, { cache: false }),
      api.get<Permission[]>('/api/scenarios/staff/permissions', {}, { cache: false }),
    ])
    if (!alive || generation !== loadGeneration) return
    assignments.value = nextAssignments; permissions.value = nextPermissions; loadState.value = 'ready'; void loadStaff()
  } catch (cause) {
    if (alive && generation === loadGeneration) { loadState.value = 'error'; loadError.value = reason(cause) }
    throw cause
  }
}
async function saveAssignment() {
  if (!selectedIdentity.value || identityLoading.value || identityError.value || loadState.value !== 'ready') return
  const generation = assignmentGeneration, kind = assignment.subject_type, identity = { ...selectedIdentity.value }
  await run(async () => {
    if (!lines(origins.value).length) throw new Error('请在“站点范围与技术信息”中填写允许打开的站点。')
    const body = { expected_revision: assignment.expected_revision, mode: assignment.mode, entry_url: assignment.entry_url, allowed_origins: lines(origins.value), status: assignment.status, expires_at: new Date(assignment.expiry).toISOString() }
    const impact = kind === 'auth_code' ? '该授权码下的全部用户及设备' : '这位用户的全部设备'
    if (!await confirmAction({ title: '确认场景分配', message: subjectLabel(kind) + '：' + identity.name + '（#' + identity.id + '）；' + identity.detail + '\n用途：' + (body.mode === 'competition' ? '比赛' : '实训') + '\n平台：' + body.entry_url + '\n允许站点：' + body.allowed_origins.join('、') + '\n截止：' + assignment.expiry.replace('T', ' ') + '（本机时区）\n状态：' + (body.status === 'active' ? '可以使用' : '暂时停用') + '\n影响范围：' + impact + '。运行中的任务会在下一次策略检查时受到限制。确认保存？' })) return false
    if (!alive || generation !== assignmentGeneration || selectedIdentity.value?.id !== identity.id || assignment.subject_type !== kind) return false
    const saved = await api.put<Assignment>('/api/scenarios/assignments/' + kind + '/' + identity.id, body)
    if (saved.subject_type !== kind || saved.subject_id !== identity.id || !Number.isSafeInteger(saved.revision) || saved.revision <= body.expected_revision) throw new Error('保存响应无法核对，请刷新列表后确认结果，不要重复提交。')
    if (!alive || generation !== assignmentGeneration) return false
    assignment.expected_revision = saved.revision; assignmentLocked.value = true
    await load()
  }, '使用范围已保存。')
}
async function savePermission() {
  if (!selectedStaff.value || !canConfigure(selectedStaff.value) || loadState.value !== 'ready' || !staffReady.value || staffError.value) return
  const generation = permissionGeneration, staff = { ...selectedStaff.value }
  await run(async () => {
    if (!lines(staffOrigins.value).length) throw new Error('请填写允许打开的站点。')
    const body = { expected_revision: permission.expected_revision, enabled: permission.enabled, max_scenes: permission.max_scenes, allowed_origins: lines(staffOrigins.value), allowed_capabilities: allowTemplate.value ? ['template.create.v1'] : [], expires_at: new Date(permission.expiry).toISOString() }
    if (!await confirmAction({ title: '确认工作区权限', message: '账号：' + (staff.display_name || staff.username) + '（' + staff.username + '，#' + staff.id + '）\n状态：' + (body.enabled ? '允许使用' : '停用') + '\n最多同时打开：' + body.max_scenes + ' 个账号\n允许站点：' + body.allowed_origins.join('、') + '\n工具写入：' + (body.allowed_capabilities.length ? '已审核的配送模板工具' : '不开通') + '\n截止：' + permission.expiry.replace('T', ' ') + '（本机时区）\n仅影响这位同事自己的账号工作区，不授予客户套餐。确认保存？' })) return false
    if (!alive || generation !== permissionGeneration || selectedStaff.value?.id !== staff.id) return false
    const saved = await api.put<Permission>('/api/scenarios/staff/' + staff.id + '/permission', body)
    if (saved.staff_id !== Number(staff.id) || !Number.isSafeInteger(saved.revision) || saved.revision <= body.expected_revision) throw new Error('保存响应无法核对，请刷新列表后确认结果，不要重复提交。')
    if (!alive || generation !== permissionGeneration) return false
    permission.expected_revision = saved.revision
    await load()
  }, '账号工作区权限已保存。')
}
onMounted(() => run(load))
onBeforeUnmount(() => { alive = false; loadGeneration++; candidateGeneration++; identityGeneration++; staffGeneration++; assignmentGeneration++; permissionGeneration++ })
</script>

<style scoped>
.scenarios-page .section-heading { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; }
.scenarios-page .section-heading h2,.scenarios-page .section-heading h3 { margin:0; }
.scenarios-page .section-heading .hint { margin:6px 0 0; }
.scenarios-page fieldset { min-width:0; border:0; padding:0; margin:0; }
.scenarios-page .scope-table { table-layout:fixed; margin-top:0; }
.scenarios-page .scope-table th:last-child { width:130px; }
.scenarios-page .scope-table th:nth-child(3) { width:24%; }
.scenarios-page .scope-table th,.scenarios-page .scope-table td { vertical-align:top; padding:14px 12px; }
.scenarios-page .scope-table strong { font-weight:600; }
.scenarios-page small { display:block; font-size:12px; line-height:1.6; color:var(--el-text-color-secondary,#6b7280); font-weight:400; }
.scenarios-page .scope-table small { margin-top:5px; }
.scenarios-page .url { overflow-wrap:anywhere; }
.scenarios-page .list-pager { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; margin-top:16px; }
.scenarios-page .list-pager span { margin-right:auto; font-size:13px; color:var(--el-text-color-secondary,#6b7280); }
.scenarios-page .editor-section { margin-top:24px; padding-top:24px; scroll-margin-top:120px; border-top:1px solid var(--el-border-color-light,#e5e7eb); }
.scenarios-page .change-identity { margin-top:8px; }
.scenarios-page .identity-search { display:grid; grid-template-columns:minmax(170px,1fr) minmax(220px,2fr) auto; gap:12px; align-items:end; }
.scenarios-page .identity-options { max-height:300px; overflow:auto; margin:16px 0 0; padding:0; list-style:none; border:1px solid var(--el-border-color-light,#e5e7eb); border-radius:8px; }
.scenarios-page .identity-options:empty { display:none; }
.scenarios-page .identity-options li { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 16px; }
.scenarios-page .identity-options li + li { border-top:1px solid var(--el-border-color-light,#e5e7eb); }
.scenarios-page .identity-options li > div { min-width:0; overflow-wrap:anywhere; }
.scenarios-page .identity-confirmed { display:flex; justify-content:space-between; gap:20px; background:var(--el-fill-color-light,#f5f7fa); border-radius:8px; padding:16px; margin:20px 0; overflow-wrap:anywhere; }
.scenarios-page .identity-confirmed strong { display:block; margin:4px 0; font-size:16px; }
.scenarios-page .identity-confirmed span,.scenarios-page .identity-confirmed p { font-size:13px; line-height:1.6; color:var(--el-text-color-secondary,#6b7280); }
.scenarios-page .identity-confirmed p { margin:0; max-width:220px; }
.scenarios-page .advanced-options { margin:16px 0; border:1px solid var(--el-border-color-light,#e5e7eb); border-radius:8px; padding:12px 16px; }
.scenarios-page summary { cursor:pointer; font-weight:500; line-height:1.8; }
.scenarios-page .advanced-options[open] summary { margin-bottom:16px; }
.scenarios-page .staff-search { display:flex; gap:12px; align-items:end; margin-bottom:16px; }
.scenarios-page .staff-search label { flex:1; max-width:420px; }
.scenarios-page .project-options { margin-top:20px; border:1px solid var(--el-border-color-light,#e5e7eb); border-radius:12px; padding:16px 24px; background:var(--el-bg-color,#fff); }
.scenarios-page button { white-space:nowrap; }
@media(max-width:900px) { .scenarios-page .identity-search { grid-template-columns:1fr 1fr; } .scenarios-page .identity-search button { justify-self:start; } .scenarios-page .identity-confirmed { display:block; } .scenarios-page .identity-confirmed p { max-width:none; margin-top:8px; } }
</style>
