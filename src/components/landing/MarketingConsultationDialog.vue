<script setup lang="ts">
import { getCurrentInstance, nextTick, onBeforeUnmount, ref } from 'vue'
import { Copy, X } from '@lucide/vue'
import { cancelMarketingScroll } from '@/marketing/navigation-scroll'

const props = defineProps<{ wechat: string }>()
const dialog = ref<HTMLDialogElement | null>(null)
const opened = ref(false)
const selectedTask = ref('')
const copyState = ref<'idle' | 'copied' | 'manual'>('idle')
const copying = ref(false)
const titleId = `consultation-title-${getCurrentInstance()?.uid ?? 0}`
const feedbackId = `${titleId}-feedback`
const accountId = `${titleId}-wechat`
let returnFocus: HTMLElement | null = null
let pageScroll = { left: 0, top: 0 }
let locked = false
let previousBodyOverflow = ''
let previousDocumentOverflow = ''
let previousBodyPadding = ''
let previousScrollBehavior = ''
let previousOverflowAnchor = ''
let copyAttempt = 0

function lockPage() {
  if (locked) return
  cancelMarketingScroll()
  locked = true
  pageScroll = { left: window.scrollX, top: window.scrollY }
  previousBodyOverflow = document.body.style.overflow
  previousDocumentOverflow = document.documentElement.style.overflow
  previousBodyPadding = document.body.style.paddingRight
  previousScrollBehavior = document.documentElement.style.scrollBehavior
  previousOverflowAnchor = document.documentElement.style.overflowAnchor
  // Freeze any ongoing anchor animation at the point where consultation began.
  document.documentElement.style.scrollBehavior = 'auto'
  document.documentElement.style.overflowAnchor = 'none'
  window.scrollTo({ ...pageScroll, behavior: 'instant' })
  const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
  if (scrollbar) document.body.style.paddingRight = `${(Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0) + scrollbar}px`
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
}

function restorePage() {
  if (!locked) return
  document.body.style.overflow = previousBodyOverflow
  document.documentElement.style.overflow = previousDocumentOverflow
  document.body.style.paddingRight = previousBodyPadding
  window.scrollTo({ ...pageScroll, behavior: 'instant' })
  document.documentElement.style.scrollBehavior = previousScrollBehavior
  document.documentElement.style.overflowAnchor = previousOverflowAnchor
  locked = false
}

async function openConsultation(task: string, event: Event) {
  if (opened.value) return
  returnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  selectedTask.value = task
  copyState.value = 'idle'
  copying.value = false
  ++copyAttempt
  opened.value = true
  lockPage()
  await nextTick()
  if (!opened.value || !dialog.value) return
  dialog.value.showModal()
  dialog.value.querySelector<HTMLButtonElement>('[data-testid="consultation-close"]')?.focus({ preventScroll: true })
}

defineExpose({ openConsultation })

function dismiss() {
  if (!opened.value) return
  opened.value = false
  ++copyAttempt
  copying.value = false
  if (dialog.value?.open) dialog.value.close()
  restorePage()
  const target = returnFocus
  returnFocus = null
  void nextTick(() => { if (target?.isConnected) target.focus({ preventScroll: true }) })
}

function handleNativeClose() {
  // A queued close event must not dismiss a consultation that has since reopened.
  if (!dialog.value?.open) dismiss()
}

function handleKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); dismiss(); return }
  if (event.key !== 'Tab' || !dialog.value?.open) return
  const controls = Array.from(dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }) }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }) }
}

function dismissBackdrop(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss()
}

async function copyWechat() {
  if (copying.value) return
  const attempt = ++copyAttempt
  copying.value = true
  copyState.value = 'idle'
  try {
    await navigator.clipboard.writeText(props.wechat)
    if (attempt === copyAttempt && opened.value) copyState.value = 'copied'
  } catch {
    if (attempt === copyAttempt && opened.value) copyState.value = 'manual'
  } finally {
    if (attempt === copyAttempt) copying.value = false
  }
}

function selectWechat(event: Event) {
  if (event.target instanceof HTMLInputElement) event.target.select()
}

onBeforeUnmount(() => {
  opened.value = false
  ++copyAttempt
  if (dialog.value?.open) dialog.value.close()
  restorePage()
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  returnFocus = null
})
</script>

<template>
  <Teleport to="body">
    <dialog v-if="opened" ref="dialog" class="consultation-dialog" data-testid="marketing-consultation-dialog" :aria-labelledby="titleId" :aria-describedby="`${titleId}-description`" @cancel.prevent="dismiss" @close="handleNativeClose" @click="dismissBackdrop" @keydown="handleKeys">
      <div class="consultation-content">
        <header class="consultation-header">
          <p>授权与使用咨询</p>
          <button class="close-button" type="button" data-testid="consultation-close" autofocus aria-label="关闭咨询窗口" @click="dismiss"><X :size="21" aria-hidden="true" /></button>
        </header>
        <h2 :id="titleId">{{ selectedTask ? `咨询${selectedTask}` : '申请使用课赛通' }}</h2>
        <p :id="`${titleId}-description`" class="consultation-lead">{{ selectedTask ? '添加微信，确认这个工具的可用范围与使用条件。' : '添加微信，告诉我们你的比赛或课程，以及想处理的任务。' }}</p>
        <section class="consultation-checklist" aria-label="开通前核对清单">
          <strong>开通前一起核对</strong>
          <ul><li>平台与版本、当前开放的任务</li><li>输入资料、登录或人工接手的环节</li><li>费用、授权期限、设备额度与支持方式</li></ul>
          <p>确认适合你的任务后再开通；官网模拟体验不代表真实工具已开放。</p>
        </section>
        <div class="consultation-wechat">
          <label :for="accountId">公开微信号</label>
          <input :id="accountId" data-testid="consultation-wechat-account" :value="wechat" :aria-describedby="feedbackId" readonly @focus="selectWechat" @click="selectWechat">
          <button class="copy-button" type="button" data-testid="consultation-copy" :disabled="copying" @click="copyWechat"><Copy :size="18" aria-hidden="true" />{{ copying ? '正在复制…' : '复制微信号' }}</button>
          <p :id="feedbackId" class="copy-feedback" role="status" aria-live="polite"><template v-if="copyState === 'copied'">微信号已复制，请打开微信添加。</template><template v-else-if="copyState === 'manual'">未能自动复制。请选择上方微信号手动复制；手机可长按复制。</template><template v-else>{{ selectedTask ? `添加时请说明比赛或课程，以及想使用的${selectedTask}工具。` : '确认适用工具与授权后，再下载使用。' }}</template></p>
        </div>
        <button class="continue-button" type="button" @click="dismiss">{{ selectedTask ? '返回工具清单' : '继续浏览' }}</button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.consultation-dialog { width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); margin: auto; padding: 0; overflow-y: auto; overscroll-behavior: contain; color: var(--m-ink, #142b47); background: #fff; border: 1px solid var(--m-border, #e2e7ef); border-radius: 16px; box-shadow: 0 24px 80px #13274b33; font-family: inherit; }
.consultation-dialog::backdrop { background: #172b4666; }
.consultation-content { padding: 20px 28px 28px; }
.consultation-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.consultation-header p { margin: 0; color: var(--m-muted, #64758b); font-size: 14px; line-height: 1.6; }
.close-button { display: grid; place-items: center; flex-shrink: 0; width: 44px; height: 44px; padding: 0; color: var(--m-text, #43556c); background: var(--m-surface, #f5f7fa); border: 0; border-radius: 8px; cursor: pointer; }
.consultation-dialog h2 { margin: 16px 0 0; font-size: 26px; line-height: 1.4; overflow-wrap: anywhere; }
.consultation-lead { margin: 12px 0 0; color: var(--m-text, #43556c); font-size: 16px; line-height: 1.8; }
.consultation-checklist { margin-top: 18px; padding: 14px 16px; border: 1px solid var(--m-border, #e2e7ef); border-radius: 10px; background: var(--m-surface, #f5f7fa); color: var(--m-text, #43556c); font-size: 13px; line-height: 1.7; }
.consultation-checklist strong { color: var(--m-ink, #142b47); font-size: 14px; }
.consultation-checklist ul { margin: 7px 0; padding-left: 18px; }
.consultation-checklist p { margin: 0; }
.consultation-wechat { margin-top: 24px; padding: 20px; border: 1px solid #cddaf4; border-radius: 10px; background: var(--m-blue-soft, #eff4ff); }
.consultation-wechat label { display: block; margin-bottom: 10px; color: var(--m-ink, #142b47); font-size: 14px; font-weight: 700; line-height: 1.6; }
.consultation-wechat input { width: 100%; min-width: 0; min-height: 48px; padding: 8px 12px; border: 1px solid var(--m-border, #e2e7ef); border-radius: 6px; color: var(--m-ink, #142b47); background: #fff; font: inherit; font-size: 22px; font-weight: 700; }
.consultation-dialog button { font-family: inherit; }
.copy-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 44px; margin-top: 12px; padding: 10px 16px; border: 0; border-radius: 6px; color: #fff; background: var(--m-blue, #245eea); font-size: 15px; font-weight: 700; cursor: pointer; }
.copy-button:disabled { cursor: wait; opacity: .7; }
.copy-feedback { min-height: 3.4em; margin: 12px 0 0; color: var(--m-text, #43556c); font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
.continue-button { display: block; width: 100%; min-height: 44px; margin-top: 20px; padding: 10px 12px; border: 1px solid var(--m-border, #e2e7ef); border-radius: 6px; color: var(--m-text, #43556c); background: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
.consultation-dialog :is(button, input):focus-visible { outline: 3px solid var(--m-blue, #245eea); outline-offset: 3px; }
@media (hover: hover) { .copy-button:hover:not(:disabled) { background: var(--m-blue-hover, #164ac4); } .close-button:hover, .continue-button:hover { background: var(--m-blue-soft, #eff4ff); } }
@media (max-width: 600px) { .consultation-content { padding: 16px 20px 20px; } .consultation-dialog h2 { font-size: 24px; } .consultation-wechat { padding: 16px; } }
@media (prefers-reduced-motion: reduce) { .consultation-dialog * { transition: none; animation: none; } }
</style>
