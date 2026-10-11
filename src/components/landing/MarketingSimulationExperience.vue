<script setup lang="ts">
import { nextTick, onBeforeUnmount, onErrorCaptured, ref, shallowRef, type Component } from 'vue'
import { ArrowRight, Box, Megaphone, PackageCheck, Play, Truck, Warehouse, X } from '@lucide/vue'
import type { DemoTask } from '@/marketing/demo/v2/demo-tasks'
import { cancelMarketingScroll } from '@/marketing/navigation-scroll'

const tasks: { id: DemoTask; title: string; description: string; icon: Component }[] = [
  { id: 'product', title: '商品发布', description: '填写商品与变体', icon: Box },
  { id: 'template', title: '物流模板', description: '配置配送规则', icon: Truck },
  { id: 'advertising', title: '广告营销', description: '建立推广活动', icon: Megaphone },
  { id: 'fba', title: 'FBA 转换', description: '切换配送方式', icon: Warehouse },
  { id: 'shipping', title: '订单发货', description: '从仓库到发货', icon: PackageCheck },
]

const opened = ref(false)
const initialTask = ref<DemoTask>('product')
const dialog = ref<HTMLDialogElement | null>(null)
const experienceFrame = ref<HTMLElement | null>(null)
const simulation = shallowRef<Component | null>(null)
const loading = ref(false)
const failed = ref(false)
const zoomViewport = ref<Record<string, string>>({})
let loadAttempt = 0
let returnFocus: HTMLElement | null = null
let oldBodyOverflow = ''
let oldDocumentOverflow = ''
let oldBodyPadding = ''
let oldDocumentScrollBehavior = ''
let oldDocumentOverflowAnchor = ''
let locked = false
let pageScroll = { left: 0, top: 0 }

function followVisualViewport() {
  const viewport = window.visualViewport
  // On pinch zoom, keep the exit bar and controls within the visible area,
  // rather than pinning them to the wider, unzoomed layout viewport.
  zoomViewport.value = opened.value && viewport && viewport.scale > 1.01
    ? { left: `${viewport.offsetLeft}px`, top: `${viewport.offsetTop}px`, right: 'auto', bottom: 'auto', width: `${viewport.width}px`, height: `${viewport.height}px` }
    : {}
}

function watchVisualViewport() {
  window.visualViewport?.addEventListener('resize', followVisualViewport)
  window.visualViewport?.addEventListener('scroll', followVisualViewport)
  followVisualViewport()
}

function unwatchVisualViewport() {
  window.visualViewport?.removeEventListener('resize', followVisualViewport)
  window.visualViewport?.removeEventListener('scroll', followVisualViewport)
  zoomViewport.value = {}
}

function lockPage() {
  if (locked) return
  cancelMarketingScroll()
  pageScroll = { left: window.scrollX, top: window.scrollY }
  locked = true
  oldBodyOverflow = document.body.style.overflow
  oldDocumentOverflow = document.documentElement.style.overflow
  oldBodyPadding = document.body.style.paddingRight
  oldDocumentScrollBehavior = document.documentElement.style.scrollBehavior
  oldDocumentOverflowAnchor = document.documentElement.style.overflowAnchor
  // Stop an in-flight smooth anchor scroll before the dialog takes focus.
  // overflow:hidden blocks gestures, but does not cancel programmatic scrolling.
  document.documentElement.style.scrollBehavior = 'auto'
  document.documentElement.style.overflowAnchor = 'none'
  window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: 'instant' })
  const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
  if (scrollbar) {
    const padding = Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0
    document.body.style.paddingRight = `${padding + scrollbar}px`
  }
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
}

function restorePage() {
  if (!locked) return
  document.body.style.overflow = oldBodyOverflow
  document.documentElement.style.overflow = oldDocumentOverflow
  document.body.style.paddingRight = oldBodyPadding
  window.scrollTo({ ...pageScroll, behavior: 'instant' })
  document.documentElement.style.scrollBehavior = oldDocumentScrollBehavior
  document.documentElement.style.overflowAnchor = oldDocumentOverflowAnchor
  locked = false
}

async function loadSimulation() {
  const attempt = ++loadAttempt
  loading.value = true
  failed.value = false
  simulation.value = null
  try {
    const module = await import('@/marketing/demo/v2/V2SimulationView.vue')
    if (attempt === loadAttempt && opened.value) simulation.value = module.default
  } catch {
    if (attempt === loadAttempt && opened.value) failed.value = true
  } finally {
    if (attempt === loadAttempt) loading.value = false
  }
}

async function openExperience(task: DemoTask, event: Event) {
  if (opened.value) return
  returnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  initialTask.value = task
  opened.value = true
  lockPage()
  watchVisualViewport()
  await nextTick()
  dialog.value?.showModal()
  dialog.value?.querySelector<HTMLButtonElement>('[data-testid="experience-close"]')?.focus({ preventScroll: true })
  void loadSimulation()
}

// Tool details use the same dialog and teardown as the prominent experience entrance.
defineExpose({ openExperience })

function closeExperience() {
  if (!opened.value) return
  ++loadAttempt
  // Unmount the simulation before releasing the page. Its own teardown stops a running demo.
  simulation.value = null
  opened.value = false
  loading.value = false
  failed.value = false
  dialog.value?.close()
  unwatchVisualViewport()
  restorePage()
  const target = returnFocus
  returnFocus = null
  void nextTick(() => {
    if (target?.isConnected) target.focus({ preventScroll: true })
  })
}

function innerDialog() {
  return experienceFrame.value?.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')
}

function handleKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    // Inner dialogs receive Escape first. Do not let the browser close both layers.
    if (event.defaultPrevented) return
    event.preventDefault()
    if (event.target instanceof Element && event.target.closest('.kst-demo-panel')) return
    if (!innerDialog()) closeExperience()
    return
  }
  if (event.key !== 'Tab' || event.defaultPrevented || innerDialog()) return
  const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
  ) ?? []).filter(element => {
    const style = getComputedStyle(element)
    return element.getClientRects().length > 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]') && style.display !== 'none' && style.visibility !== 'hidden'
  })
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first || !last) {
    event.preventDefault()
    dialog.value?.focus()
  } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleCancel(event: Event) {
  event.preventDefault()
  if (!innerDialog()) closeExperience()
}

onErrorCaptured(() => {
  if (!opened.value) return
  simulation.value = null
  failed.value = true
  loading.value = false
  return false
})

onBeforeUnmount(() => {
  ++loadAttempt
  simulation.value = null
  unwatchVisualViewport()
  restorePage()
})
</script>

<template>
  <section id="experience" class="marketing-experience" data-testid="marketing-simulation-experience" aria-labelledby="experience-title" tabindex="-1">
    <div class="experience-intro">
      <div><p class="experience-eyebrow">无需下载 · 无需登录</p><h2 id="experience-title">在线操作体验</h2><p class="experience-description">选一项，自己操作或看一键演示。</p><p class="experience-scope">本机样例，不连接真实平台或账号。</p></div>
      <button class="experience-primary" type="button" data-testid="experience-start" aria-haspopup="dialog" @click="openExperience('product', $event)"><Play :size="20" aria-hidden="true" />开始体验</button>
    </div>
    <div class="experience-tasks">
      <button v-for="task in tasks" :key="task.id" type="button" :data-experience-task="task.id" aria-haspopup="dialog" @click="openExperience(task.id, $event)">
        <component :is="task.icon" :size="24" :stroke-width="1.7" aria-hidden="true" />
        <strong>{{ task.title }}</strong><span class="experience-task-description">{{ task.description }}</span>
        <span class="experience-task-action">体验这个任务<ArrowRight :size="17" aria-hidden="true" /></span>
      </button>
    </div>
    <Teleport to="body">
      <dialog v-if="opened" ref="dialog" class="marketing-experience-dialog" :class="{ 'is-zoomed': Boolean(zoomViewport.width) }" :style="zoomViewport" data-testid="marketing-experience-dialog" aria-labelledby="experience-dialog-title" aria-describedby="experience-dialog-description" tabindex="-1" @keydown="handleKeys" @cancel="handleCancel" @close="closeExperience">
        <header class="experience-dialog-header">
          <div><h2 id="experience-dialog-title">亚马逊仿真操作体验 <span>· 本机样例</span></h2><p id="experience-dialog-description">只在此体验中操作，不会影响真实平台。</p><p class="experience-session-note" data-testid="experience-session-note">本次操作会保留，退出或刷新后重新开始。</p></div>
          <button type="button" data-testid="experience-close" aria-label="退出操作体验" @click="closeExperience"><X :size="20" aria-hidden="true" /><span>退出体验</span></button>
        </header>
        <div ref="experienceFrame" class="experience-frame" data-testid="experience-frame">
          <div v-if="loading" class="experience-feedback" role="status"><strong>正在准备操作体验…</strong><p>无需登录，将使用本机样例。</p></div>
          <div v-else-if="failed" class="experience-feedback" role="alert"><strong>暂时没能打开体验</strong><p>可以重试，或先继续查看工具介绍。</p><div class="experience-feedback-actions"><button type="button" @click="loadSimulation">重新加载</button><button type="button" class="experience-exit" @click="closeExperience">退出体验</button></div></div>
          <component :is="simulation" v-else-if="simulation" :embedded="true" :initial-task="initialTask" @close="closeExperience" />
        </div>
      </dialog>
    </Teleport>
  </section>
</template>

<style scoped>
.marketing-experience { margin-top: 28px; padding: 0 24px 24px; border: 1px solid #cddbf5; border-radius: var(--m-radius); background: #edf3ff; scroll-margin-top: 100px; }
.experience-intro { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin: -1px -25px 0; padding: 28px 32px; border-radius: var(--m-radius) var(--m-radius) 0 0; color: #fff; background: linear-gradient(110deg, #123c96, #194bd0); }
.experience-intro > div { min-width: 0; }
.experience-eyebrow { margin: 0 0 10px; color: #dfebff; font-size: 14px; font-weight: 600; }
.experience-intro h2 { margin: 0; color: #fff; font-size: 32px; line-height: 1.35; }
.experience-description { margin: 10px 0 0; color: #fff; font-size: var(--m-body); line-height: 1.7; }
.experience-scope { margin: 8px 0 0; color: #dfebff; font-size: 14px; line-height: 1.7; }
.experience-primary { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 10px; min-height: 52px; padding: 14px 26px; border: 0; border-radius: 10px; color: #113991; background: #fff; font: inherit; font-size: 18px; font-weight: 700; cursor: pointer; transition: background 180ms ease, transform 180ms ease; }
.experience-primary:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
.experience-tasks { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 24px; }
.experience-tasks button { position: relative; display: flex; flex-direction: column; align-items: flex-start; min-width: 0; min-height: 172px; padding: 20px 18px; border: 1px solid #d5e0f5; border-radius: 12px; color: var(--m-blue-hover); background: #fff; text-align: left; font: inherit; cursor: pointer; transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease; }
.experience-tasks strong { margin-top: 16px; color: var(--m-ink); font-size: 16px; line-height: 1.6; }
.experience-task-description { margin-top: 5px; color: var(--m-text); font-size: 14px; line-height: 1.6; }
.experience-task-action { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; color: var(--m-blue-hover); font-size: 14px; font-weight: 700; line-height: 1.6; }
.experience-tasks button:focus-visible, .experience-dialog-header button:focus-visible, .experience-feedback button:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 4px; }
.marketing-experience-dialog { position: fixed; inset: 0; z-index: 500; width: 100%; max-width: none; height: 100%; height: 100dvh; max-height: none; margin: 0; padding: 0; border: 0; color: #192a44; background: #f5f7fb; font-family: var(--m-font, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif); }
.marketing-experience-dialog[open] { display: flex; flex-direction: column; }
.marketing-experience-dialog::backdrop { background: rgba(16, 29, 51, 0.6); }
.experience-dialog-header { display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; gap: 24px; min-height: 84px; padding: 16px 24px; border-bottom: 1px solid #dbe2ef; background: #fff; }
.experience-dialog-header h2 { margin: 0; font-size: 20px; line-height: 1.5; }
.experience-dialog-header h2 span { color: #52637c; font-size: 15px; font-weight: 500; }
.experience-dialog-header p { margin: 4px 0 0; color: #52637c; font-size: 14px; line-height: 1.6; }
.experience-dialog-header .experience-session-note { color: #344866; font-size: 13px; }
.experience-dialog-header button { display: flex; flex-shrink: 0; align-items: center; justify-content: center; gap: 8px; min-width: 44px; min-height: 44px; padding: 10px 16px; border: 1px solid #c9d5ea; border-radius: 8px; color: #193f88; background: #f3f6fc; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
.experience-frame { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; height: 0; overflow: hidden; transform: translateZ(0); isolation: isolate; }
.experience-frame :deep(.v2-experience) { width: 100%; height: 100%; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
.experience-frame :deep(.v2-experience.is-embedded .v2-demo-identity),
.experience-frame :deep(.v2-experience.is-embedded .v2-demo-entry-links > .kst-home-link) { display: none; }
.experience-frame :deep(.v2-experience.is-embedded .v2-experience-strip) { min-height: 50px; padding: 3px 20px; gap: 0; flex-wrap: nowrap; }
.experience-frame :deep(.v2-experience.is-embedded .v2-demo-entry-links) { flex: 1 1 auto; width: 100%; min-width: 0; margin: 0; gap: 16px; justify-content: flex-start; flex-wrap: nowrap; overflow-x: auto; overscroll-behavior-inline: contain; }
.experience-frame :deep(.v2-experience.is-embedded .v2-demo-entry-links > button) { flex-shrink: 0; min-height: 44px; font-size: 14px; }
.marketing-experience-dialog.is-zoomed .experience-frame :deep(.kst-demo-brand > span) { display: none; }
.experience-feedback { display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100%; padding: 32px 20px; text-align: center; }
.experience-feedback strong { color: #192a44; font-size: 22px; line-height: 1.5; }
.experience-feedback p { margin: 12px 0 0; color: #52637c; font-size: 16px; line-height: 1.7; }
.experience-feedback-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 24px; }
.experience-feedback button { min-height: 44px; padding: 11px 20px; border: 1px solid #1742c6; border-radius: 8px; color: #fff; background: #1742c6; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
.experience-feedback .experience-exit { color: #193f88; background: #fff; border-color: #c9d5ea; }
@media (hover: hover) { .experience-primary:hover { background: #eaf1ff; transform: translateY(-2px); } .experience-tasks button:hover { border-color: var(--m-blue); box-shadow: 0 4px 14px #204aa214; transform: translateY(-2px); } .experience-dialog-header button:hover { background: #e8effc; } }
@media (max-width: 960px) { .experience-tasks { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .marketing-experience { margin-top: 24px; padding: 0 16px 16px; }
  .experience-intro { flex-direction: column; align-items: stretch; gap: 20px; margin-inline: -17px; padding: 24px 20px; }
  .experience-intro h2 { font-size: 28px; }
  .experience-primary { width: 100%; }
  .experience-tasks { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .experience-tasks button { min-height: 160px; padding: 18px 14px; }
  .experience-tasks strong { font-size: 15px; }
  .experience-task-description, .experience-task-action { font-size: 14px; }
  .experience-dialog-header { align-items: flex-start; gap: 12px; min-height: 72px; padding: max(12px, env(safe-area-inset-top)) 16px 12px; }
  .experience-dialog-header h2 { font-size: 16px; }
  .experience-dialog-header h2 span { display: block; font-size: 14px; }
  .experience-dialog-header p { display: none; }
  .experience-dialog-header .experience-session-note { display: block; max-width: 28em; font-size: 12px; line-height: 1.5; }
  .experience-dialog-header button { padding: 9px 10px; gap: 5px; font-size: 13px; }
  .experience-dialog-header button span { display: inline; white-space: nowrap; }
  .experience-frame :deep(.v2-experience.is-embedded .v2-experience-strip) { padding-inline: 12px; }
  .experience-frame :deep(.v2-experience.is-embedded .v2-demo-entry-links) { gap: 12px; }
  .experience-feedback strong { font-size: 20px; }
}
@media (prefers-reduced-motion: reduce) { .experience-primary, .experience-tasks button { transition: none; transform: none !important; } }
</style>
