<template>
  <el-drawer :model-value="modelValue" title="批量工作台帮助" size="min(520px, 94vw)" @update:model-value="emit('update:modelValue', $event)">
    <section class="help-copy">
      <h3>查看帮助不会停止当前任务</h3>
      <p>没有工具或尚未导入时，也可以在这里提交问题和查看回复，无需离开 B 端。关闭本帮助不会退出工作台。</p>
      <h3>导入前的准备</h3>
      <p>先选择已开放的工具，准备自己的账号与业务对象资料，并按工具字段要求检查 Excel。工具准备中时不会以虚构账号或模拟结果替代真实任务。</p>
      <p>导入通过只表示字段检查通过，不代表登录、提交或任务已经完成。导入问题清单可用于修正源文件；请勿在求助说明中粘贴原表、密码或客户资料。</p>
      <h3>执行与结果核对</h3>
      <p>需要登录或验证时，在账号详情完成操作后点击“继续处理”。真实执行按队列依次进行，保留的浏览器现场不等于同时执行。退出工作台会停止批次。</p>
      <p>“未完成”不等于“确定未写入”。如果提交后结果不明，请先核对平台上的同一订单、商品或模板；不能只凭失败提示重复提交。当前平台不会替你判断业务重试是否安全。</p>
      <p>批次结束后原始输入会清理。可导出脱敏结果与本机原表行号进行核对；它不是自动重试清单。诊断截图和平台回读请在原电脑查看，提交给支持前须去除账号和客户信息。</p>
      <p v-if="store.syncState !== 'synced'" role="status">结果记录尚未同步。联网后会自动补传状态，不会再次执行任务。{{ store.liveStorageUnavailable ? '本机保存暂不可用，请保持窗口打开并重试同步。' : '请使用原授权在这台电脑重新打开系统。' }}</p>
      <h3>{{ hasBatch ? '就此批次求助' : '就当前问题求助' }}</h3>
      <p>仅附带帮助入口、工具名称和批次状态摘要；无批次时标明尚未开始。不附带账号、Excel、密码、页面内容或浏览器现场。</p>
      <label for="batch-help-topic">问题类型</label>
      <select id="batch-help-topic" v-model="topic"><option>导入校验</option><option>授权与启动</option><option>需要人工操作</option><option>执行结果</option><option>结果同步</option><option>其他</option></select>
      <label for="batch-help-content">问题说明（请勿填写密码或客户资料）</label>
      <textarea id="batch-help-content" v-model="message" rows="4" maxlength="1000" placeholder="描述你遇到的现象和希望获得的帮助" />
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="button" :disabled="sending || !message.trim()" @click="send">{{ sending ? '正在提交…' : '提交给客服支持' }}</button>
      <p v-if="sent" role="status">已提交。回复会显示在下方，可稍后刷新查看。</p>
      <h3>我的最近求助 <button type="button" :disabled="loading" @click="load">刷新回复</button></h3>
      <p v-if="loadError" role="alert">{{ loadError }}</p>
      <p v-else-if="loading">正在加载…</p>
      <p v-else-if="!tickets.length">暂无求助记录</p>
      <article v-for="ticket in tickets" :key="ticket.id"><strong>{{ ticket.title || '使用帮助' }}</strong><p>{{ ticket.admin_reply || '客服尚未回复，请稍后查看。' }}</p></article>
    </section>
  </el-drawer>
</template>
<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { ElDrawer } from 'element-plus'
import { z } from 'zod'
import { createFeedback, getMyFeedbacks } from '@/utils/api'
import { authService } from '@/utils/auth'
import { useBusinessWorkspaceStore } from '@/stores/businessWorkspace'
const props = defineProps<{ modelValue: boolean; entryPoint?: string; context?: { toolName: string; recordKind: 'demo' | 'live'; status: string; total: number } }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const store = useBusinessWorkspaceStore()
const hasBatch = computed(() => Boolean(props.context || store.snapshot.batchId || store.snapshot.serverBatchId || store.snapshot.items.length))
const topic = ref('执行结果')
const message = ref('')
const sending = ref(false)
const sent = ref(false)
const error = ref('')
const loadError = ref('')
const loading = ref(false)
const ticketSchema = z.array(z.object({ id: z.union([z.string(), z.number()]), title: z.string().nullish(), admin_reply: z.string().nullish() }))
const tickets = ref<z.infer<typeof ticketSchema>>([])
let sequence = 0
async function load(): Promise<void> {
  const request = ++sequence
  const owner = authService.getAuth()?.token
  loading.value = true
  loadError.value = ''
  tickets.value = []
  try {
    const data = ticketSchema.parse(await getMyFeedbacks({ page: 1, page_size: 10 }))
    if (request === sequence && owner === authService.getAuth()?.token) tickets.value = data
  } catch { if (request === sequence && owner === authService.getAuth()?.token) loadError.value = '回复暂时无法加载，请重试。' }
  finally { if (request === sequence) loading.value = false }
}
async function send(): Promise<void> {
  if (sending.value || !message.value.trim()) return
  const owner = authService.getAuth()?.token
  const snapshot = store.snapshot
  const summary = props.context ? `${props.context.toolName}；${props.context.recordKind === 'demo' ? '历史模拟演示' : '真实批次记录'}；记录状态 ${props.context.status}；总数 ${props.context.total}。` : hasBatch.value ? `${snapshot.tool?.name || '批量工具'}；${snapshot.recordKind === 'demo' ? '历史模拟演示' : '真实执行'}；总数 ${snapshot.items.length}，已完成 ${snapshot.counts.completed || 0}，需操作 ${snapshot.counts.waiting || 0}，未完成 ${snapshot.counts.failed || 0}。` : `${store.selectedTool?.name || '未选择工具'}；尚未开始批次。`
  const content = `${message.value.trim()}\n\n帮助入口：${props.entryPoint || '批量执行'}。\n批次摘要：${summary}`
  sending.value = true
  error.value = ''
  sent.value = false
  try {
    await createFeedback({ title: `批量工作台 · ${topic.value}`, content })
    if (owner !== authService.getAuth()?.token) return
    message.value = ''
    sent.value = true
    await load()
  } catch { if (owner === authService.getAuth()?.token) error.value = '求助未提交成功，说明已保留，请重试。' }
  finally { sending.value = false }
}
watch(() => props.modelValue, open => { if (open) void load(); else sequence += 1 }, { immediate: true })
onUnmounted(() => { sequence += 1 })
</script>
<style scoped>
.help-copy{display:grid;gap:12px;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.7}.help-copy h3,.help-copy p{margin:0}.help-copy h3{color:var(--color-text);display:flex;justify-content:space-between;align-items:center;gap:10px}.help-copy label{font-weight:600}.help-copy select,.help-copy textarea{box-sizing:border-box;max-width:100%;width:100%;border:1px solid var(--color-border);border-radius:9px;padding:10px;background:var(--color-surface);color:var(--color-text);font:inherit}.help-copy button{min-height:36px;padding:8px 12px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-primary-soft);color:var(--color-primary);cursor:pointer}.help-copy button:disabled{opacity:.5;cursor:not-allowed}.help-copy article{padding:12px;border-radius:10px;background:var(--color-surface-soft);overflow-wrap:anywhere}.help-copy [role=alert]{color:var(--color-danger)}
</style>
