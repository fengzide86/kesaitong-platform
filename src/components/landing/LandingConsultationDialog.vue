<template>
  <dialog ref="dialog" class="consultation-dialog" aria-labelledby="consultation-title" aria-describedby="consultation-preview" @cancel.prevent="dismiss" @close="handleNativeClose" @click="dismissBackdrop" @keydown="containFocus">
    <div class="consultation-content">
      <header class="consultation-header">
        <span class="preview-label"><span></span>预览演示</span>
        <button class="close-button" type="button" autofocus aria-label="关闭咨询窗口" @click="dismiss"><X :size="20" aria-hidden="true" /></button>
      </header>
      <h2 id="consultation-title">咨询课赛通</h2>
      <p class="consultation-lead">找到适合你的工具，也找到合适的开始方式。</p>
      <div class="consultation-options" role="group" aria-label="选择咨询方向">
        <button type="button" :aria-pressed="audience === 'personal'" @click="audience = 'personal'"><UserRound :size="17" aria-hidden="true" />个人工具</button>
        <button type="button" :aria-pressed="audience === 'team'" @click="audience = 'team'"><UsersRound :size="17" aria-hidden="true" />团队席位</button>
      </div>
      <div class="consultation-guidance" aria-live="polite" aria-atomic="true">
        <h3>{{ audience === 'personal' ? '从你要处理的任务开始' : '从团队的使用规模开始' }}</h3>
        <p>{{ audience === 'personal' ? '沟通时告诉我们：想用什么工具、使用多久，以及需要在哪些设备上使用。' : '沟通时告诉我们：成员人数、需要的席位，以及准备处理的批量任务。' }}</p>
      </div>
      <div class="contact-preview">
        <div class="contact-brand"><BrandMark decorative :size="38" /><div><strong>课赛通 KST</strong><span>授权与使用咨询</span></div><span class="example-label">示意联系卡</span></div>
        <div class="contact-channel"><MessageSquare :size="17" aria-hidden="true" /><div><span>企业微信</span><strong>正式二维码待接入</strong></div></div>
        <div class="contact-channel"><Mail :size="17" aria-hidden="true" /><div><span>模拟商务邮箱</span><strong>hello@kst.example</strong></div></div>
      </div>
      <p id="consultation-preview" class="preview-note">这是模拟咨询入口，示意邮箱不可用于联系。此预览不会发送消息，也不收集联系方式。</p>
      <button class="acknowledge-button" type="button" @click="dismiss">我了解了<ArrowRight :size="16" aria-hidden="true" /></button>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, Mail, MessageSquare, UserRound, UsersRound, X } from '@lucide/vue'
import BrandMark from '@/components/brand/BrandMark.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const audience = ref<'personal' | 'team'>('personal')

watch(() => props.open, open => {
  if (open && dialog.value && !dialog.value.open) {
    audience.value = 'personal'
    dialog.value.showModal()
  } else if (!open) dialog.value?.close()
}, { flush: 'post' })

function dismiss(): void {
  // Synchronize the owner before the browser's asynchronously dispatched close
  // event, so closing and immediately reopening cannot leave the trigger stale.
  emit('close')
  dialog.value?.close()
}
function handleNativeClose(): void {
  // A queued event from the previous opening must not close a new opening.
  if (!dialog.value?.open) emit('close')
}
function containFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !dialog.value?.open) return
  const controls = dialog.value.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (!first || !last) return
  // Keep keyboard navigation inside this local preview, including browsers that
  // allow native dialog traversal to move into browser chrome at its boundaries.
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
function dismissBackdrop(event: MouseEvent): void {
  if (event.target !== dialog.value || !dialog.value) return
  const bounds = dialog.value.getBoundingClientRect()
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss()
}
onBeforeUnmount(() => dialog.value?.close())
</script>

<style scoped>
.consultation-dialog { width: min(520px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); margin: auto; padding: 0; overflow-y: auto; overscroll-behavior: contain; color: #18263f; background: #fff; border: 1px solid #e2e9f3; border-radius: 22px; box-shadow: 0 24px 80px #13274b26; font-family: inherit; }
.consultation-dialog::backdrop { background: #172b4657; backdrop-filter: blur(5px); }
.consultation-content { padding: 26px 32px 30px; }
.consultation-header { display: flex; align-items: center; justify-content: space-between; }
.preview-label { display: flex; align-items: center; gap: 7px; color: #5577a9; font-size: 11px; font-weight: 500; }
.preview-label > span { width: 5px; height: 5px; background: #1565ff; border-radius: 50%; }
.close-button { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; color: #6b7c94; background: #f5f7fb; border: 0; border-radius: 50%; cursor: pointer; }
.consultation-dialog h2 { margin: 17px 0 0; font-size: 28px; font-weight: 600; letter-spacing: -.025em; line-height: 1.4; }
.consultation-lead { margin: 10px 0 0; font-size: 14px; line-height: 1.8; color: #64738b; }
.consultation-options { display: flex; gap: 8px; margin-top: 23px; padding: 4px; background: #f3f6fb; border-radius: 10px; }
.consultation-options button { display: flex; flex: 1; gap: 8px; align-items: center; justify-content: center; min-height: 42px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: #62748d; font-size: 13px; font-family: inherit; cursor: pointer; transition: background .18s, color .18s; }
.consultation-options button[aria-pressed='true'] { color: #225cae; background: #fff; border-color: #e1e8f4; box-shadow: 0 2px 5px #263e6510; }
.consultation-guidance { margin-top: 22px; min-height: 80px; }
.consultation-guidance h3 { margin: 0; font-size: 15px; font-weight: 600; }
.consultation-guidance p { margin: 8px 0 0; font-size: 13px; line-height: 1.8; color: #64738b; }
.contact-preview { margin-top: 15px; padding: 20px; background: linear-gradient(140deg, #f7faff, #fff); border: 1px solid #e0e8f5; border-radius: 14px; }
.contact-brand { display: flex; align-items: center; gap: 10px; padding-bottom: 17px; margin-bottom: 17px; border-bottom: 1px solid #e3eaf4; }
.contact-brand strong { display: block; font-size: 14px; font-weight: 600; }
.contact-brand div > span { display: block; margin-top: 5px; color: #6b7d97; font-size: 11px; }
.example-label { margin-left: auto; color: #6982a7; font-size: 10px; white-space: nowrap; }
.contact-channel { display: flex; gap: 12px; align-items: center; margin-top: 14px; color: #6b85aa; }
.contact-channel div > span { display: block; color: #6b7d97; font-size: 11px; }
.contact-channel strong { display: block; margin-top: 5px; color: #405978; font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.preview-note { margin: 16px 0 0; color: #718198; font-size: 11px; line-height: 1.8; }
.acknowledge-button { display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; min-height: 44px; margin-top: 20px; border: 0; border-radius: 8px; background: #1565ff; color: #fff; font-family: inherit; font-size: 13px; cursor: pointer; transition: background .18s; }
.acknowledge-button:hover { background: #0c55e0; }
.consultation-dialog button:focus-visible { outline: 3px solid #7ba8ff; outline-offset: 3px; }
@media (max-width: 640px) { .consultation-content { padding: 20px 22px 23px; }.consultation-dialog h2 { font-size: 25px; }.consultation-lead { font-size: 13px; }.contact-preview { padding: 16px; }.consultation-guidance { min-height: 90px; } }
@media (prefers-reduced-motion: reduce) { .consultation-dialog * { transition: none; } }
</style>
