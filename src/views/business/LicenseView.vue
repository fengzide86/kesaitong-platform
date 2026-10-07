<template>
  <div class="license-page">
    <PageHeader eyebrow="BUSINESS LICENSE" title="专业授权信息" description="核对当前套餐、本机设备与席位，以及真实任务的运行条件。">
      <template #actions><button class="refresh-license" type="button" :disabled="loading" @click="loadLicense"><RefreshCw :size="15" />刷新授权</button></template>
    </PageHeader>
    <p v-if="loading" role="status">正在核对套餐与本机授权…</p>
    <p v-else-if="loadError" class="license-error" role="alert">{{ loadError }} <button type="button" @click="loadLicense">重新加载</button></p>
    <section v-if="user" class="license-card">
      <div class="license-mark"><BadgeCheck :size="26" /></div>
      <div><small>当前专业授权</small><h2>{{ user.plan_name || '专业批量版' }}</h2><p>有效期至 {{ formatDate(user.expires_at) }}</p></div>
      <span class="business-badge">BUSINESS</span>
    </section>
    <section v-if="user && !loading && !loadError" class="limits-grid">
      <article><span>这台电脑</span><strong>{{ deviceAuthorized ? '已授权' : '未识别到本机授权' }}</strong><small>{{ devices.length }} / {{ user.max_devices }} 台设备</small></article>
      <article><span>真实任务单批上限</span><strong>{{ store.entitlements.max_batch_rows || 50 }}</strong><small>仅统计有效导入行，需工具已开放真实执行</small></article>
      <article><span>真实执行</span><strong>1 个活动任务</strong><small>依次执行；最多保留 {{ store.entitlements.max_open_sessions || 6 }} 个待操作浏览器现场</small></article>
      <article><span>授权席位</span><strong>{{ user.seat_used ?? '待核对' }} / {{ user.seat_limit ?? '待核对' }}</strong><small>释放或扩容请联系授权提供方，不会自动增加收费</small></article>
    </section>
    <p>套餐授权不等于工具已开放。真实批次还需工具发布状态、脚本就绪、桌面端和输入检查均满足；不会自动启用尚未开放的能力。</p>
    <p class="security-note"><ShieldCheck :size="16" />客户密码、Cookie 和 Excel 原文不会上传到服务端。</p>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { BadgeCheck, RefreshCw, ShieldCheck } from '@lucide/vue'
import { z } from 'zod'
import { useBusinessWorkspaceStore } from '@/stores/businessWorkspace'
import PageHeader from '@/components/PageHeader.vue'
import { checkAuthStatus, getMyDevices } from '@/utils/api'
import { getDeviceId } from '@/utils'
import { authService } from '@/utils/auth'
import { deviceListSchema, type DeviceSummary } from '@/features/user/model'

const storedBusinessUserSchema = z.object({
  plan_name: z.string().optional(),
  expires_at: z.string().nullable().optional(),
  seat_used: z.number().optional(),
  seat_limit: z.number().optional(),
  device_used: z.number().optional(),
  max_devices: z.number().int().positive(),
}).passthrough()

const store = useBusinessWorkspaceStore()
const user = ref<z.infer<typeof storedBusinessUserSchema> | null>(null)
const devices = ref<DeviceSummary[]>([])
const loading = ref(true)
const loadError = ref('')
const currentDeviceId = getDeviceId()
const deviceAuthorized = computed(() => devices.value.some(device => device.device_id === currentDeviceId))
let requestSequence = 0
async function loadLicense(): Promise<void> {
  const sequence = ++requestSequence
  const auth = authService.getAuth()
  loading.value = true
  loadError.value = ''
  try {
    const userId = authService.getUser()?.user_id ?? authService.getUser()?.id
    if (!auth?.auth_code || userId === undefined) throw new Error('授权会话不完整，请重新登录后查看。')
    const [status, boundDevices] = await Promise.all([
      checkAuthStatus(auth.auth_code, currentDeviceId), getMyDevices(userId),
    ])
    if (sequence !== requestSequence || auth.token !== authService.getAuth()?.token) return
    if (!status.success || !status.data) throw new Error(status.message || '当前授权暂不可用，请重新登录。')
    const next = storedBusinessUserSchema.parse(status.data)
    devices.value = deviceListSchema.parse(boundDevices)
    user.value = next
  } catch (error) {
    if (sequence !== requestSequence) return
    user.value = null
    devices.value = []
    loadError.value = error instanceof Error ? error.message : '暂时无法核对授权，请检查网络后重试。'
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}
onMounted(loadLicense)
onUnmounted(() => { requestSequence += 1 })
const formatDate = (value: string | null | undefined): string => value
  ? new Date(value).toLocaleDateString('zh-CN')
  : '未设置'
</script>
<style scoped>
.refresh-license{display:flex;gap:7px;align-items:center;padding:10px 14px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-primary);background:var(--color-surface);cursor:pointer}.refresh-license:disabled{opacity:.6}.license-error{padding:16px;border-radius:12px;background:var(--color-danger-soft);color:var(--color-danger)}.license-error button{margin-left:8px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer}
.license-page{display:grid;gap:20px}.license-page>header span{font-size:var(--type-micro);font-weight:800;letter-spacing:.12em;color:var(--color-primary)}h1{margin:7px 0 0;font-size:var(--type-page);letter-spacing:-.04em;color:var(--color-text)}header p{margin:8px 0 0;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.6}.license-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px;padding:24px;border:1px solid rgba(169,133,82,.26);border-radius:17px;background:linear-gradient(145deg,#fcfcfd,#f8f7f4);box-shadow:var(--shadow-low)}.license-mark{width:52px;height:52px;display:grid;place-items:center;border-radius:15px;color:#765d38;background:#f1eadf}.license-card small{color:var(--color-text-tertiary);font-size:var(--type-meta)}.license-card h2{margin:5px 0;color:var(--color-text);font-size:22px}.license-card p{margin:0;color:var(--color-text-secondary);font-size:var(--type-control)}.business-badge{padding:6px 9px;border-radius:7px;color:#765d38;background:#f1eadf;font-size:var(--type-micro);font-weight:800;letter-spacing:.1em}.limits-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.limits-grid article{min-height:130px;padding:20px;display:grid;align-content:space-between;gap:8px;border:1px solid var(--color-border);border-radius:15px;background:var(--color-surface)}.limits-grid span,.limits-grid small{font-size:var(--type-meta);color:var(--color-text-tertiary)}.limits-grid strong{font-size:22px;color:var(--color-text);font-variant-numeric:tabular-nums}.security-note{display:flex;align-items:center;gap:8px;padding:14px;color:var(--color-success);font-size:var(--type-meta);background:#edf8f4;border-radius:12px}@media(max-width:760px){.limits-grid{grid-template-columns:1fr}.business-badge{display:none}.license-card{grid-template-columns:auto 1fr}}
</style>
