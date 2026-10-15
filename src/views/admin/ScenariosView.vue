<template>
  <section class="framework-page" aria-label="场景与本机运行权限">
    <PageHeader title="场景与本机运行权限" description="按用户或授权码分配实训／比赛场景，覆盖全部设备。管理员现场仅在管理员自己的电脑打开，不远程控制客户电脑。" />
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="message" role="status" class="notice">{{ message }}</p>
    <section class="panel" aria-labelledby="assignment-heading">
      <h2 id="assignment-heading">分配场景</h2>
      <form @submit.prevent="saveAssignment">
        <fieldset :disabled="busy" style="border:0;padding:0;margin:0">
          <div class="fields">
            <label>分配对象<select v-model="assignment.subject_type"><option value="user">用户</option><option value="auth_code">授权码下全部用户</option></select></label>
            <label>对象编号<input v-model.number="assignment.subject_id" type="number" min="1" required></label>
            <label>场景<select v-model="assignment.mode" @change="setCompetitionEntry"><option value="training">实训</option><option value="competition">比赛</option></select></label>
            <label>入口网址<input v-model="assignment.entry_url" type="url" required></label>
            <label>批准的站点 origin（每行一个）<textarea v-model="origins" required placeholder="https://www.idtrade.cn" /></label>
            <label>结束时间（本机时区）<input v-model="assignment.expiry" type="datetime-local" required></label>
            <label>状态<select v-model="assignment.status"><option value="active">启用</option><option value="disabled">停用</option></select></label>
          </div>
          <p class="hint">比赛允许指定官网内的正常路径。额外域名仅填写经过确认的登录站点，不能用子域名或字符串前缀放行。</p>
          <div class="actions"><button class="primary" type="submit">{{ assignment.expected_revision ? '保存修改' : '建立分配' }}</button><button type="button" @click="resetAssignment">新建分配</button></div>
        </fieldset>
      </form>
      <div class="table-wrap"><table><thead><tr><th>对象</th><th>场景</th><th>入口</th><th>状态 / 版本</th><th>操作</th></tr></thead><tbody>
        <tr v-for="row in assignments" :key="`${row.subject_type}:${row.subject_id}`"><td>{{ row.subject_type === 'user' ? '用户' : '授权码' }} {{ row.subject_id }}</td><td>{{ row.mode === 'competition' ? '比赛' : '实训' }}</td><td>{{ row.entry_url }}</td><td>{{ row.status }} / {{ row.revision }}</td><td><button :disabled="busy" @click="editAssignment(row)">编辑</button></td></tr>
      </tbody></table></div><p v-if="!assignments.length" class="empty">暂无场景分配。未分配不代表获得比赛权限。</p>
    </section>
    <section class="panel" aria-labelledby="staff-permission-heading">
      <h2 id="staff-permission-heading">管理员本机现场</h2>
      <form @submit.prevent="savePermission"><fieldset :disabled="busy" style="border:0;padding:0;margin:0"><div class="fields">
        <label>员工编号<input v-model.number="permission.staff_id" type="number" min="1" required></label>
        <label>最多保留现场<input v-model.number="permission.max_scenes" type="number" min="1" max="10" required></label>
        <label>批准的站点 origin（每行一个）<textarea v-model="staffOrigins" required /></label>
        <label>权限结束时间（本机时区）<input v-model="permission.expiry" type="datetime-local" required></label>
        <label class="check"><input v-model="permission.enabled" type="checkbox">允许本机多账号现场</label>
        <label class="check"><input v-model="allowTemplate" type="checkbox">额外授权已审核的配送模板工具执行</label>
      </div><p class="hint">网页现场权限不等于工具写入权限，不继承客户授权码或专业批量套餐。自动执行仍由单个 Runner 串行处理。</p>
      <div class="actions"><button class="primary" type="submit">保存本机权限</button></div></fieldset></form>
      <div class="table-wrap"><table><thead><tr><th>员工</th><th>现场上限</th><th>状态 / 版本</th><th>操作</th></tr></thead><tbody><tr v-for="row in permissions" :key="row.staff_id"><td>{{ row.staff_id }}</td><td>{{ row.max_scenes }}</td><td>{{ row.enabled ? '允许' : '停用' }} / {{ row.revision }}</td><td><button :disabled="busy" @click="editPermission(row)">编辑</button></td></tr></tbody></table></div>
    </section>
    <ProjectScopesPanel />
    <div class="actions"><button :disabled="busy" @click="run(load)">刷新</button></div>
  </section>
</template>
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import { api } from '@/utils/api'
import { confirmAction } from '@/shared/ui/confirm'
import { useFrameworkTask } from '@/features/admin/useFrameworkTask'
import ProjectScopesPanel from '@/features/admin/ProjectScopesPanel.vue'
import '@/features/admin/framework.css'
type Assignment = { subject_type: 'user' | 'auth_code'; subject_id: number; revision: number; mode: 'training' | 'competition'; entry_url: string; allowed_origins: string[]; status: 'active' | 'disabled'; expires_at: string | null }
type Permission = { staff_id: number; revision: number; enabled: boolean; max_scenes: number; allowed_origins: string[]; allowed_capabilities: string[]; expires_at: string | null }
const { busy, error, message, run } = useFrameworkTask()
const assignments = ref<Assignment[]>([])
const permissions = ref<Permission[]>([])
const assignment = reactive({ subject_type: 'user' as 'user' | 'auth_code', subject_id: 1, expected_revision: 0, mode: 'training' as 'training' | 'competition', entry_url: '', expiry: '', status: 'active' as 'active' | 'disabled' })
const permission = reactive({ staff_id: 1, expected_revision: 0, enabled: false, max_scenes: 6, expiry: '' })
const origins = ref('')
const staffOrigins = ref('')
const allowTemplate = ref(false)
const lines = (text: string) => [...new Set(text.split(/\r?\n/).map(value => value.trim()).filter(Boolean))]
function localTime(value: string | null) { if (!value) return ''; const date = new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
function resetAssignment() { assignment.expected_revision = 0; assignment.subject_id = 1; assignment.entry_url = ''; assignment.expiry = ''; origins.value = '' }
function setCompetitionEntry() { if (assignment.mode === 'competition') { assignment.entry_url = 'https://www.idtrade.cn/User/Contest'; origins.value = 'https://www.idtrade.cn' } }
function editAssignment(row: Assignment) { Object.assign(assignment, row, { expected_revision: row.revision, expiry: localTime(row.expires_at) }); origins.value = row.allowed_origins.join('\n') }
function editPermission(row: Permission) { Object.assign(permission, row, { expected_revision: row.revision, expiry: localTime(row.expires_at) }); staffOrigins.value = row.allowed_origins.join('\n'); allowTemplate.value = row.allowed_capabilities?.includes('template.create.v1') || false }
async function load() { [assignments.value, permissions.value] = await Promise.all([api.get<Assignment[]>('/api/scenarios/assignments', {}, { cache: false }), api.get<Permission[]>('/api/scenarios/staff/permissions', {}, { cache: false })]) }
async function saveAssignment() { await run(async () => {
  const body = { expected_revision: assignment.expected_revision, mode: assignment.mode, entry_url: assignment.entry_url, allowed_origins: lines(origins.value), status: assignment.status, expires_at: new Date(assignment.expiry).toISOString() }
  const path = `/api/scenarios/assignments/${assignment.subject_type}/${assignment.subject_id}`
  if (!await confirmAction({ title: '确认场景分配', message: '此规则覆盖该对象的全部设备；运行中的任务会在下一次策略检查时受到限制。确认保存？' })) return
  await api.put(path, body); await load()
  const updated = assignments.value.find(row => row.subject_type === assignment.subject_type && row.subject_id === assignment.subject_id)
  if (updated) editAssignment(updated)
}, '场景操作已处理，请查看列表状态') }
async function savePermission() { await run(async () => {
  const body = { expected_revision: permission.expected_revision, enabled: permission.enabled, max_scenes: permission.max_scenes, allowed_origins: lines(staffOrigins.value), allowed_capabilities: allowTemplate.value ? ['template.create.v1'] : [], expires_at: new Date(permission.expiry).toISOString() }
  await api.put(`/api/scenarios/staff/${permission.staff_id}/permission`, body); await load()
  const updated = permissions.value.find(row => row.staff_id === permission.staff_id); if (updated) editPermission(updated)
}, '本机权限已保存') }
onMounted(() => run(load))
</script>
