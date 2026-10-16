<template>
  <section class="local-runtime">
    <PageHeader title="账号工作区" description="在当前电脑分别打开多个账号窗口。每个窗口独立登录，任务开始前请先选对账号和平台。">
      <template #actions><el-button :disabled="!bridge" :loading="busy || toolsLoading" @click="refresh">刷新权限与工具</el-button></template>
    </PageHeader>
    <el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon />
    <el-alert v-if="!bridge" title="请在课赛通桌面客户端打开本机工作台，浏览器预览不能创建账号现场。" type="info" :closable="false" />
    <div class="runtime-grid">
      <aside class="scene-list">
        <h2>我的账号窗口 <span>{{ scenes.length }} / {{ policy?.maxScenes ?? 6 }}</span></h2>
        <el-form label-position="top" @submit.prevent="open">
          <el-form-item label="账号备注"><el-input v-model="label" placeholder="例如：实训 A 班账号" maxlength="60" /></el-form-item>
          <el-form-item label="要打开的平台"><el-select v-model="origin" placeholder="选择已开放平台"><el-option v-for="site in policy?.allowedOrigins ?? []" :key="site" :label="site" :value="site" /></el-select></el-form-item>
          <el-button type="primary" native-type="submit" :disabled="!policy || busy || !label.trim() || !origin">添加账号窗口</el-button>
        </el-form>
        <ul>
          <li v-for="scene in scenes" :key="scene.id" :class="{ selected: scene.selected }">
            <button class="scene-select" @click="select(scene.id)"><strong>{{ scene.label }}</strong><small>{{ scene.origin }}</small><span>{{ scene.status === 'policy_blocked' ? '平台权限有变化，请重新确认' : '窗口已打开 · 登录状态请在网页确认' }}</span></button>
            <el-button text size="small" @click="close(scene.id)">退出账号并清理</el-button>
          </li>
        </ul>
      </aside>
      <div ref="host" class="scene-host" aria-label="当前账号平台网页">
        <div v-if="!scenes.some(scene => scene.selected && scene.status === 'ready')" class="empty">先在左侧添加或选择账号窗口。<br>登录页面会显示在这里。</div>
      </div>
      <aside class="task-detail"><h2>要做什么</h2><p>先选左侧账号，再选一个已开放的工具。每个账号的登录状态互不影响。</p>
        <el-select v-model="toolId" :disabled="toolsLoading || !!toolsError || !toolsLoaded" placeholder="选择要使用的工具"><el-option v-for="tool in tools" :key="tool.id" :label="tool.name" :value="tool.id" /></el-select>
        <p v-if="toolsLoading" role="status">正在加载工具目录…</p>
        <div v-else-if="toolsError" role="alert"><p>{{ toolsError }}</p><el-button @click="loadTools">重新加载工具</el-button></div>
        <p v-else-if="toolsLoaded && !tools.length">目前没有可用工具，请先完成平台审核和工具开放。</p>
        <TargetWorkspace v-if="selectedScene && toolsLoaded" :key="selectedScene" :tool-id="toolId" :has-open-tools="tools.length > 0" />
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ScenarioPolicy } from '@/shared/ipc/scenario-contract'
import type { z } from 'zod'
import type { sceneSummarySchema } from '@/shared/ipc/scenario-contract'
import TargetWorkspace from '@/features/targets/TargetWorkspace.vue'
import { getTools } from '@/utils/api/tools'
import { toolCatalogSchema, type ToolCatalogItem } from '@/features/tools/model'
import PageHeader from '@/components/PageHeader.vue'
import { confirmAction } from '@/shared/ui/confirm'

const bridge = window.electronAPI?.scenes
const policy = ref<ScenarioPolicy | null>(null)
const scenes = ref<z.infer<typeof sceneSummarySchema>[]>([])
const label = ref('')
const origin = ref('')
const error = ref('')
const busy = ref(false)
const host = ref<HTMLElement>()
const tools = ref<ToolCatalogItem[]>([])
const toolsLoading = ref(false), toolsLoaded = ref(false), toolsError = ref('')
const toolId = ref<string | number>()
const selectedScene = computed(() => scenes.value.find(scene => scene.selected)?.id)
let observer: ResizeObserver | undefined
let poll: ReturnType<typeof setInterval> | undefined
async function action(work: () => Promise<void>) {
  busy.value = true; error.value = ''
  try { await work() } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请刷新后重试' }
  finally { busy.value = false }
}
async function position() {
  const rect = host.value?.getBoundingClientRect()
  if (rect && bridge) await bridge.bounds({ x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), width: Math.max(0, Math.round(Math.min(rect.right, window.innerWidth) - Math.max(0, rect.x))), height: Math.max(0, Math.round(Math.min(rect.bottom, window.innerHeight) - Math.max(0, rect.y))) })
}
async function refreshPermissions() { if (bridge) await action(async () => { policy.value = await bridge.policy(); scenes.value = await bridge.list(); if (!origin.value) origin.value = policy.value.allowedOrigins[0] ?? ''; await nextTick(); await position() }) }
async function loadTools() {
  if (!bridge || toolsLoading.value) return
  toolsLoading.value = true; toolsError.value = ''
  try {
    tools.value = toolCatalogSchema.parse(await getTools()).filter(tool => tool.target_capability === 'template.create.v1' && ['live', 'live_beta'].includes(tool.availability) && tool.script_status === 'script_ready')
    toolsLoaded.value = true
    if (!tools.value.some(tool => tool.id === toolId.value)) toolId.value = undefined
  } catch { toolsError.value = '工具目录加载失败，请重新加载工具后重试。' }
  finally { toolsLoading.value = false }
}
async function refresh() { await Promise.all([refreshPermissions(), loadTools()]) }
async function open() { if (bridge) await action(async () => { scenes.value = await bridge.open({ accountSlot: crypto.randomUUID(), label: label.value, entryUrl: origin.value }); label.value = ''; await position() }) }
async function select(id: string) { if (bridge) await action(async () => { await bridge.select(id); scenes.value = await bridge.list(); await position() }) }
async function close(id: string) {
  if (!bridge || busy.value) return
  const scene = scenes.value.find(item => item.id === id)
  if (!await confirmAction({ title: '退出并清理这个账号窗口？', message: `将关闭「${scene?.label || '当前账号'}」并清理该窗口保存的登录状态。下次使用需要重新登录。`, confirmText: '退出并清理' })) return
  await action(async () => { await bridge.close(id); scenes.value = await bridge.list() })
}
onMounted(async () => {
  await refresh()
  observer = new ResizeObserver(() => { void position().catch(() => undefined) })
  if (host.value) observer.observe(host.value)
  window.addEventListener('scroll', position, true)
  poll = setInterval(() => { if (bridge && !busy.value) void refreshPermissions() }, 30_000)
})
onBeforeUnmount(() => { observer?.disconnect(); if (poll) clearInterval(poll); window.removeEventListener('scroll', position, true); void bridge?.hide() })
</script>

<style scoped>
.local-runtime { padding: 20px; min-width: 0; max-width: 100%; overflow-x: hidden; }
h2 { font-size: 14px; margin: 0 0 16px; }
p { color: #62738c; font-size: 13px; line-height: 1.7; }
.runtime-grid { display: grid; grid-template-columns: 210px minmax(0, 1fr) 340px; height: calc(100vh - 235px); min-height: 520px; gap: 12px; margin-top: 16px; }
.scene-list, .scene-host, .task-detail { border: 1px solid #dce4ee; border-radius: 10px; background: #fff; overflow: hidden; }
.scene-list, .task-detail { padding: 16px; overflow-y: auto; }
h2 span { color: #74849a; font-weight: normal; }
ul { padding: 0; list-style: none; }
li { border: 1px solid #e4eaf2; border-radius: 8px; padding: 6px; margin-top: 10px; }
li.selected { border-color: #698aca; background: #f4f7fe; }
.scene-select { border: 0; padding: 6px; background: transparent; display: grid; text-align: left; gap: 5px; width: 100%; cursor: pointer; color: #253b59; }
.scene-select small { overflow-wrap: anywhere; }
.scene-select span { color: #6a7c92; font-size: 12px; }
.empty { padding: 80px 24px; text-align: center; color: #75849a; line-height: 2; }
@media (max-width: 1100px) { .runtime-grid { grid-template-columns: 190px minmax(0, 1fr); } .task-detail { grid-column: 1 / -1; min-height: 180px; } }
@media (max-width: 720px) { .local-runtime { padding: 12px; } .runtime-grid { display: flex; flex-direction: column; height: auto; min-height: 0; } .scene-list, .scene-host, .task-detail { min-height: 220px; } .scene-host { order: 2; } .task-detail { order: 3; } .scene-list { order: 1; } }
</style>
