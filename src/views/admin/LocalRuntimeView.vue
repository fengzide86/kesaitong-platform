<template>
  <section class="local-runtime">
    <PageHeader title="多账号工具工作台" :description="`把不同账号分开管理：每个窗口独立登录、互不串号，当前最多同时保留 ${maxScenes} 个现场。`">
      <template #actions><el-button :disabled="!bridge" :loading="busy || toolsLoading" @click="refresh">刷新权限与工具</el-button></template>
    </PageHeader>
    <section class="runtime-summary" aria-label="账号工作台概览">
      <article class="summary-chip"><span class="summary-chip-icon">{{ scenes.length }}</span><span><small>已打开现场</small><strong>共 {{ maxScenes }} 个槽位</strong></span></article>
      <article class="summary-chip"><span class="summary-chip-icon is-primary">{{ readyScenes.length }}</span><span><small>可以继续操作</small><strong>网页状态待现场确认</strong></span></article>
      <article class="summary-chip" :class="{ 'is-warning': blockedScenes.length }"><span class="summary-chip-icon is-warning">{{ blockedScenes.length }}</span><span><small>需要重新确认</small><strong>{{ blockedScenes.length ? '权限变化或登录已失效' : '当前没有异常提醒' }}</strong></span></article>
      <article class="summary-chip summary-help"><span class="summary-chip-icon is-muted">i</span><span><small>运行规则</small><strong>同一外部账号不能重复占用</strong></span></article>
    </section>
    <el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon />
    <el-alert v-if="!bridge" title="请在课赛通桌面客户端打开本机工作台，浏览器预览不能创建账号现场。" type="info" :closable="false" />
    <div class="runtime-grid">
      <aside class="scene-list">
        <header class="scene-list-header"><div><span class="section-eyebrow">账号现场</span><h2>我的账号窗口</h2></div><strong class="slot-count">{{ scenes.length }} / {{ maxScenes }}</strong></header>
        <p class="scene-list-intro">一个账号一个窗口，换账号前先退出并清理旧现场。</p>
        <el-form label-position="top" @submit.prevent="open">
          <el-form-item label="账号备注"><el-input v-model="label" placeholder="例如：实训 A 班账号" maxlength="60" /></el-form-item>
          <el-form-item label="要打开的平台"><el-select v-model="origin" placeholder="选择已开放平台"><el-option v-for="site in policy?.allowedOrigins ?? []" :key="site" :label="site" :value="site" /></el-select></el-form-item>
          <el-button class="add-scene-button" type="primary" native-type="submit" :disabled="!policy || busy || !label.trim() || !origin || scenes.length >= maxScenes">{{ scenes.length >= maxScenes ? '已达到现场上限' : '添加账号窗口' }}</el-button>
        </el-form>
        <ul class="scene-items" aria-label="已打开账号窗口">
          <li v-for="(scene, index) in scenes" :key="scene.id" :class="['scene-item', { selected: scene.selected, blocked: scene.status === 'policy_blocked' }]">
            <button class="scene-select" :aria-pressed="scene.selected" :aria-label="`选择 ${scene.label}，${sceneStatusLabel(scene)}`" @click="select(scene.id)">
              <span class="scene-index">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="scene-copy"><strong>{{ scene.label }}</strong><small>{{ displayOrigin(scene.origin) }}</small><span :class="['scene-status', scene.status === 'policy_blocked' ? 'is-warning' : 'is-ready']"><i aria-hidden="true"></i>{{ sceneStatusLabel(scene) }}</span></span>
              <ChevronRight :size="15" aria-hidden="true" />
            </button>
            <el-button class="scene-close" text size="small" @click="close(scene.id)">退出并清理</el-button>
          </li>
        </ul>
        <p v-if="!scenes.length" class="scene-empty">还没有账号现场。<br>先添加一个账号窗口，再在中间网页里手动登录。</p>
      </aside>
      <div ref="host" class="scene-host" aria-label="当前账号平台网页">
        <div v-if="!scenes.some(scene => scene.selected && scene.status === 'ready')" class="empty">
          <span class="empty-mark">⌁</span><strong>{{ selectedBlocked ? '这个现场需要重新确认' : '先选择一个账号现场' }}</strong><p>{{ selectedBlocked ? '权限或登录状态发生变化，请在网页中完成登录后，再刷新确认。' : '登录页面会显示在这里；每个窗口的登录状态彼此隔离。' }}</p>
        </div>
      </div>
      <aside class="task-detail">
        <header class="detail-header"><div><span class="section-eyebrow">任务监控</span><h2>当前账号要做什么</h2></div><span class="detail-status" :class="selectedBlocked ? 'is-warning' : 'is-ready'">{{ selectedBlocked ? '需重新确认' : selectedScene ? '已选账号' : '未选择' }}</span></header>
        <div class="selected-account" :class="{ 'is-muted': !selectedScene, 'is-warning': selectedBlocked }"><span class="account-avatar">{{ selectedScene ? (selectedSceneLabel?.slice(0, 1) || '账') : '—' }}</span><span><strong>{{ selectedSceneLabel || '还没有选择账号' }}</strong><small>{{ selectedSceneOrigin ? displayOrigin(selectedSceneOrigin) : '从左侧选择一个账号窗口' }}</small></span></div>
        <p class="detail-intro">选好账号后，再选择已开放的工具。多个账号可以同时打开网页；任务是否能执行，以工具授权和当前状态为准。</p>
        <el-select v-model="toolId" :disabled="toolsLoading || !!toolsError || !toolsLoaded" placeholder="选择要使用的工具"><el-option v-for="tool in tools" :key="tool.id" :label="tool.name" :value="tool.id" /></el-select>
        <p v-if="toolsLoading" role="status">正在加载工具目录…</p>
        <div v-else-if="toolsError" role="alert"><p>{{ toolsError }}</p><el-button @click="loadTools">重新加载工具</el-button></div>
        <p v-else-if="toolsLoaded && !tools.length">目前没有可用工具，请先完成平台审核和工具开放。</p>
        <TargetWorkspace v-if="selectedScene && toolsLoaded" :key="selectedScene" :tool-id="toolId" :has-open-tools="tools.length > 0" />
        <div v-if="selectedScene" class="task-boundary"><span class="boundary-dot"></span><span>账号登录、工具任务和执行记录相互隔离</span></div>
      </aside>
    </div>
    <section v-if="scenes.length" class="runtime-overview" aria-label="全部账号现场状态">
      <header><div><span class="section-eyebrow">一眼看全</span><h2>全部账号现场</h2></div><small>点击账号即可切换中间网页</small></header>
      <div class="overview-grid">
        <button v-for="scene in scenes" :key="`overview-${scene.id}`" class="overview-card" :class="{ selected: scene.selected, blocked: scene.status === 'policy_blocked' }" @click="select(scene.id)"><span class="overview-card-main"><i :class="['status-dot', scene.status === 'policy_blocked' ? 'is-warning' : 'is-ready']"></i><strong>{{ scene.label }}</strong></span><small>{{ scene.status === 'policy_blocked' ? '需要重新确认权限或登录' : '网页已打开 · 可切换查看' }}</small><ChevronRight :size="15" aria-hidden="true" /></button>
      </div>
    </section>
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
import { ChevronRight } from '@lucide/vue'

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
const maxScenes = computed(() => policy.value?.maxScenes ?? 10)
const readyScenes = computed(() => scenes.value.filter(scene => scene.status === 'ready'))
const blockedScenes = computed(() => scenes.value.filter(scene => scene.status === 'policy_blocked'))
const selectedSceneRecord = computed(() => scenes.value.find(scene => scene.selected))
const selectedSceneLabel = computed(() => selectedSceneRecord.value?.label)
const selectedSceneOrigin = computed(() => selectedSceneRecord.value?.origin)
const selectedBlocked = computed(() => selectedSceneRecord.value?.status === 'policy_blocked')
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
function sceneStatusLabel(scene: z.infer<typeof sceneSummarySchema>) {
  return scene.status === 'policy_blocked' ? '需要重新确认权限或登录' : '网页已打开 · 登录状态请在网页确认'
}
function displayOrigin(value: string) {
  try { return new URL(value).host } catch { return value }
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

/* Multi-account workspace: make the next decision obvious without implying
   that the current single-run runner executes ten jobs in parallel. */
.local-runtime { display: grid; gap: 14px; color: var(--color-text); }
.runtime-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.summary-chip { min-width: 0; min-height: 64px; display: flex; align-items: center; gap: 10px; padding: 11px 13px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); box-shadow: var(--shadow-low); transition: border-color var(--motion-fast), background-color var(--motion-fast), transform var(--motion-press); }
.summary-chip:hover { border-color: var(--color-border-strong); transform: translateY(-1px); }
.summary-chip > span:last-child { min-width: 0; display: grid; gap: 3px; }
.summary-chip small { color: var(--color-text-secondary); font-size: var(--type-micro); }
.summary-chip strong { overflow: hidden; color: var(--color-text); font-size: var(--type-meta); text-overflow: ellipsis; white-space: nowrap; }
.summary-chip-icon { width: 34px; height: 34px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 10px; color: var(--color-text); background: var(--color-canvas); font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; }
.summary-chip-icon.is-primary { color: var(--color-primary); background: var(--color-primary-soft); }
.summary-chip-icon.is-warning { color: var(--color-warning); background: var(--color-warning-soft); }
.summary-chip-icon.is-muted { color: var(--color-text-tertiary); background: var(--color-surface-soft); font-size: 14px; }
.summary-chip.is-warning { border-color: rgba(183, 121, 31, .28); background: color-mix(in srgb, var(--color-warning-soft) 30%, var(--color-surface)); }
.scene-list { display: flex; flex-direction: column; }
.scene-list-header, .detail-header, .runtime-overview > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.section-eyebrow { display: block; color: var(--color-primary); font-size: var(--type-micro); font-weight: 800; letter-spacing: .12em; }
.scene-list h2, .detail-header h2, .runtime-overview h2 { margin: 5px 0 0; color: var(--color-text); font-size: var(--type-card); letter-spacing: -.02em; }
.slot-count { flex: 0 0 auto; padding: 4px 8px; border-radius: 999px; color: var(--color-primary); background: var(--color-primary-soft); font-size: var(--type-meta); font-variant-numeric: tabular-nums; }
.scene-list-intro, .detail-intro { margin: -5px 0 14px; color: var(--color-text-secondary); font-size: var(--type-meta); line-height: 1.6; }
.scene-list form { display: grid; gap: 2px; padding-bottom: 14px; border-bottom: 1px solid var(--color-border); }
.add-scene-button { width: 100%; }
.scene-items { display: grid; gap: 8px; margin: 14px 0 0; padding: 0; list-style: none; overflow-y: auto; }
.scene-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px; min-width: 0; padding: 3px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface); transition: border-color var(--motion-fast), background-color var(--motion-fast), box-shadow var(--motion-fast); }
.scene-item:hover { border-color: var(--color-border-strong); }
.scene-item.selected { border-color: rgba(45, 95, 202, .46); background: var(--color-primary-soft); box-shadow: 0 5px 16px rgba(45, 95, 202, .08); }
.scene-item.blocked { border-color: rgba(183, 121, 31, .38); background: var(--color-warning-soft); }
.scene-select { grid-template-columns: 24px minmax(0, 1fr) auto; align-items: start; gap: 7px; min-height: 62px; padding: 7px 6px; }
.scene-index { padding-top: 2px; color: var(--color-text-tertiary); font-size: var(--type-micro); font-variant-numeric: tabular-nums; }
.scene-copy { display: grid; gap: 3px; min-width: 0; }
.scene-copy strong { overflow: hidden; color: var(--color-text); font-size: var(--type-control); text-overflow: ellipsis; white-space: nowrap; }
.scene-copy small { overflow: hidden; color: var(--color-text-secondary); font-size: var(--type-micro); text-overflow: ellipsis; white-space: nowrap; }
.scene-status { display: inline-flex; align-items: center; gap: 5px; min-width: 0; color: var(--color-text-secondary); font-size: var(--type-micro); line-height: 1.3; }
.scene-status i, .boundary-dot, .status-dot { width: 6px; height: 6px; flex: 0 0 auto; display: inline-block; border-radius: 50%; background: var(--color-border-strong); }
.scene-status.is-ready, .detail-status.is-ready { color: var(--color-success); }
.scene-status.is-ready i, .boundary-dot { background: var(--color-success); }
.scene-status.is-warning, .detail-status.is-warning { color: var(--color-warning); }
.scene-status.is-warning i { background: var(--color-warning); }
.scene-select > svg { margin-top: 4px; color: var(--color-border-strong); }
.scene-close { align-self: end; margin: 0 5px 3px 0; color: var(--color-text-tertiary); font-size: var(--type-micro); }
.scene-close:hover { color: var(--color-danger); }
.scene-empty { margin: auto 0; padding: 28px 5px 8px; color: var(--color-text-tertiary); font-size: var(--type-meta); line-height: 1.7; text-align: center; }
.scene-host { position: relative; min-height: 0; background: var(--color-surface-soft); }
.empty { display: grid; place-items: center; align-content: center; gap: 7px; height: 100%; min-height: 300px; padding: 28px; }
.empty-mark { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 13px; color: var(--color-primary); background: var(--color-primary-soft); font-size: 27px; line-height: 1; }
.empty strong { color: var(--color-text); font-size: var(--type-control); }
.empty p { max-width: 280px; margin: 0; color: var(--color-text-secondary); font-size: var(--type-meta); line-height: 1.6; text-align: center; }
.task-detail { display: flex; flex-direction: column; }
.detail-status { flex: 0 0 auto; padding: 4px 8px; border-radius: 999px; background: var(--color-surface-soft); font-size: var(--type-micro); }
.selected-account { display: flex; align-items: center; gap: 9px; min-width: 0; margin-bottom: 12px; padding: 10px; border: 1px solid rgba(45, 95, 202, .15); border-radius: 10px; background: var(--color-primary-soft); }
.selected-account.is-warning { border-color: rgba(183, 121, 31, .28); background: var(--color-warning-soft); }
.selected-account.is-muted { border-color: var(--color-border); background: var(--color-surface-soft); }
.account-avatar { width: 30px; height: 30px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 9px; color: var(--color-primary); background: var(--color-surface); font-weight: 800; }
.selected-account > span:last-child { min-width: 0; display: grid; gap: 2px; }
.selected-account strong, .selected-account small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected-account strong { color: var(--color-text); font-size: var(--type-control); }
.selected-account small { color: var(--color-text-secondary); font-size: var(--type-micro); }
.detail-intro { margin-bottom: 13px; }
.task-boundary { display: flex; align-items: center; gap: 7px; margin-top: auto; padding-top: 14px; color: var(--color-text-tertiary); font-size: var(--type-micro); line-height: 1.5; }
.runtime-overview { padding: 16px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface); box-shadow: var(--shadow-low); }
.runtime-overview > header { align-items: center; margin-bottom: 12px; }
.runtime-overview > header small { color: var(--color-text-secondary); font-size: var(--type-micro); }
.overview-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.overview-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 9px; min-width: 0; padding: 11px 12px; border: 1px solid var(--color-border); border-radius: 10px; color: var(--color-text); background: var(--color-surface); text-align: left; cursor: pointer; transition: border-color var(--motion-fast), background-color var(--motion-fast), transform var(--motion-press); }
.overview-card:hover { border-color: var(--color-border-strong); transform: translateY(-1px); }
.overview-card.selected { border-color: rgba(45, 95, 202, .45); background: var(--color-primary-soft); }
.overview-card.blocked { border-color: rgba(183, 121, 31, .35); background: var(--color-warning-soft); }
.overview-card-main { display: flex; align-items: center; gap: 7px; min-width: 0; }
.overview-card-main strong { overflow: hidden; font-size: var(--type-control); text-overflow: ellipsis; white-space: nowrap; }
.overview-card small { grid-column: 1 / -1; overflow: hidden; color: var(--color-text-secondary); font-size: var(--type-micro); text-overflow: ellipsis; white-space: nowrap; }
.overview-card > svg { grid-column: 2; grid-row: 1; align-self: center; color: var(--color-border-strong); }
.status-dot.is-ready { background: var(--color-success); }.status-dot.is-warning { background: var(--color-warning); }
@media (max-width: 1100px) { .runtime-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .runtime-summary { grid-template-columns: 1fr; } .summary-help { display: none; } .runtime-overview > header { display: grid; } .runtime-overview > header small { margin-top: -6px; } }
@media (prefers-reduced-motion: reduce) { .summary-chip, .scene-item, .overview-card { transition: none; transform: none !important; } }
</style>
