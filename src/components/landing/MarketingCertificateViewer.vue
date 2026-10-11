<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Maximize, Minus, Plus, X } from '@lucide/vue'
import type { CertificateEvidence } from '@/marketing/award-evidence'

const props = defineProps<{ evidence: CertificateEvidence | null }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const imageViewport = ref<HTMLElement | null>(null)
const opened = ref(false)
const zoom = ref(1)
const visualViewportStyle = ref<Record<string, string>>({})
const headingId = `certificate-title-${getCurrentInstance()?.uid ?? 0}`
const descriptionId = `${headingId}-description`
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)
let returnFocus: HTMLElement | null = null
let locked = false
let previousBodyOverflow = ''
let previousDocumentOverflow = ''
let previousBodyPadding = ''
let previousScrollBehavior = ''

function followVisualViewport() {
  const viewport = window.visualViewport
  visualViewportStyle.value = opened.value && viewport && viewport.scale > 1.01
    ? { left: `${viewport.offsetLeft}px`, top: `${viewport.offsetTop}px`, right: 'auto', bottom: 'auto', width: `${viewport.width}px`, height: `${viewport.height}px`, margin: '0' }
    : {}
}

function lockPage() {
  if (locked) return
  locked = true
  previousBodyOverflow = document.body.style.overflow
  previousDocumentOverflow = document.documentElement.style.overflow
  previousBodyPadding = document.body.style.paddingRight
  previousScrollBehavior = document.documentElement.style.scrollBehavior
  document.documentElement.style.scrollBehavior = 'auto'
  window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: 'instant' })
  const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
  if (scrollbar) document.body.style.paddingRight = `${(Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0) + scrollbar}px`
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
  window.visualViewport?.addEventListener('resize', followVisualViewport)
  window.visualViewport?.addEventListener('scroll', followVisualViewport)
}

function restorePage() {
  if (!locked) return
  document.body.style.overflow = previousBodyOverflow
  document.documentElement.style.overflow = previousDocumentOverflow
  document.body.style.paddingRight = previousBodyPadding
  document.documentElement.style.scrollBehavior = previousScrollBehavior
  window.visualViewport?.removeEventListener('resize', followVisualViewport)
  window.visualViewport?.removeEventListener('scroll', followVisualViewport)
  visualViewportStyle.value = {}
  locked = false
}

async function openViewer() {
  if (opened.value) return
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  zoom.value = 1
  opened.value = true
  lockPage()
  await nextTick()
  if (!props.evidence || !opened.value || !dialog.value) return
  if (typeof dialog.value.showModal === 'function') dialog.value.showModal()
  else dialog.value.setAttribute('open', '')
  followVisualViewport()
  dialog.value.querySelector<HTMLButtonElement>('[data-testid="certificate-close"]')?.focus({ preventScroll: true })
}

function closeViewer() {
  if (!opened.value) return
  opened.value = false
  if (dialog.value?.open) dialog.value.close()
  restorePage()
  emit('close')
  const target = returnFocus
  returnFocus = null
  void nextTick(() => { if (target?.isConnected) target.focus({ preventScroll: true }) })
}

function handleNativeClose() {
  if (!dialog.value?.open) closeViewer()
}

function handleKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeViewer(); return }
  if (event.key !== 'Tab') return
  const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? [])
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

function closeOnBackdrop(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeViewer()
}

async function setZoom(value: number) {
  const viewport = imageViewport.value
  const oldZoom = zoom.value
  const nextZoom = Math.min(3, Math.max(1, value))
  if (nextZoom === oldZoom) return
  const centerX = viewport ? (viewport.scrollLeft + viewport.clientWidth / 2) / oldZoom : 0
  const centerY = viewport ? (viewport.scrollTop + viewport.clientHeight / 2) / oldZoom : 0
  zoom.value = nextZoom
  await nextTick()
  if (viewport) {
    viewport.scrollLeft = nextZoom === 1 ? 0 : centerX * nextZoom - viewport.clientWidth / 2
    viewport.scrollTop = nextZoom === 1 ? 0 : centerY * nextZoom - viewport.clientHeight / 2
  }
}

watch(() => props.evidence, evidence => {
  if (evidence) void openViewer()
  else closeViewer()
}, { immediate: true, flush: 'post' })

onBeforeUnmount(() => {
  opened.value = false
  if (dialog.value?.open) dialog.value.close()
  restorePage()
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
  returnFocus = null
})
</script>

<template>
  <Teleport to="body">
    <dialog v-if="evidence" ref="dialog" class="certificate-viewer" :style="visualViewportStyle" data-testid="certificate-viewer" :aria-labelledby="headingId" :aria-describedby="descriptionId" @keydown="handleKeys" @cancel.prevent="closeViewer" @close="handleNativeClose" @click="closeOnBackdrop">
      <div class="certificate-viewer-content">
        <header class="certificate-viewer-heading">
          <h2 :id="headingId">{{ evidence.title }}</h2>
          <button type="button" class="certificate-close" data-testid="certificate-close" aria-label="关闭证书" @click="closeViewer"><X :size="22" aria-hidden="true" /></button>
        </header>
        <div class="certificate-toolbar" aria-label="证书缩放">
          <div class="certificate-zoom-controls">
            <button type="button" data-testid="certificate-zoom-out" aria-label="缩小证书" :disabled="zoom <= 1" @click="setZoom(zoom - 0.5)"><Minus :size="19" aria-hidden="true" /></button>
            <output aria-live="polite">{{ zoomLabel }}</output>
            <button type="button" data-testid="certificate-zoom-in" aria-label="放大证书" :disabled="zoom >= 3" @click="setZoom(zoom + 0.5)"><Plus :size="19" aria-hidden="true" /></button>
            <button type="button" class="certificate-fit" data-testid="certificate-fit" @click="setZoom(1)"><Maximize :size="17" aria-hidden="true" />适应窗口</button>
          </div>
          <span>放大后可滑动查看</span>
        </div>
        <div ref="imageViewport" class="certificate-image-viewport" tabindex="0" role="region" aria-label="证书图片，可放大并滚动查看">
          <div class="certificate-image-canvas" :style="{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }"><img :src="evidence.src" :alt="evidence.alt" draggable="false" /></div>
        </div>
        <p :id="descriptionId" class="certificate-viewer-note">{{ evidence.caption }}</p>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.certificate-viewer { width: min(1080px, calc(100vw - 32px)); height: min(900px, calc(100dvh - 32px)); max-width: none; max-height: none; margin: auto; padding: 0; border: 0; border-radius: 16px; color: var(--m-ink, #142b47); background: #fff; box-shadow: 0 24px 100px #091c4566; overflow: hidden; }
.certificate-viewer::backdrop { background: #08172dcc; }
.certificate-viewer-content { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; height: 100%; min-height: 0; }
.certificate-viewer-heading { display: flex; align-items: center; gap: 20px; padding: 16px 20px 10px; }
.certificate-viewer-heading h2 { min-width: 0; margin: 0; font-size: 19px; line-height: 1.5; font-weight: 650; }
.certificate-viewer button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; min-width: 44px; min-height: 44px; border: 1px solid var(--m-border, #dce3ed); border-radius: 8px; background: #fff; color: var(--m-ink, #142b47); cursor: pointer; font: inherit; transition: background 180ms ease; }
.certificate-viewer button:hover:not(:disabled) { background: var(--m-blue-soft, #eff4ff); }
.certificate-viewer button:disabled { color: #9ba5b3; cursor: default; }
.certificate-viewer .certificate-close { margin-left: auto; border: 0; }
.certificate-viewer button:focus-visible, .certificate-image-viewport:focus-visible { outline: 3px solid var(--m-blue, #245eea); outline-offset: -3px; }
.certificate-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 0 20px 14px; }
.certificate-zoom-controls { display: flex; align-items: center; gap: 8px; }
.certificate-zoom-controls output { min-width: 48px; text-align: center; font-size: 14px; font-variant-numeric: tabular-nums; }
.certificate-toolbar > span { color: var(--m-muted, #627084); font-size: 13px; }
.certificate-viewer .certificate-fit { gap: 7px; padding-inline: 12px; font-size: 14px; }
.certificate-image-viewport { min-width: 0; min-height: 0; margin-inline: 20px; overflow: auto; overscroll-behavior: contain; background: #eef1f5; touch-action: pan-x pan-y pinch-zoom; }
.certificate-image-canvas { min-width: 100%; min-height: 100%; padding: 16px; }
.certificate-image-canvas img { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; }
.certificate-viewer-note { margin: 0; padding: 12px 20px; color: var(--m-muted, #627084); font-size: 13px; line-height: 1.6; }
@media (max-width: 600px) { .certificate-viewer { width: calc(100vw - 16px); height: calc(100dvh - 16px); border-radius: 12px; }.certificate-viewer-heading { align-items: flex-start; gap: 8px; padding: 12px 12px 8px; }.certificate-viewer-heading h2 { align-self: center; font-size: 16px; }.certificate-toolbar { padding: 0 12px 10px; gap: 8px; }.certificate-toolbar > span { display: none; }.certificate-image-viewport { margin-inline: 12px; }.certificate-image-canvas { padding: 8px; }.certificate-viewer-note { padding: 10px 12px; } }
@media (prefers-reduced-motion: reduce) { .certificate-viewer button { transition: none; } }
</style>
