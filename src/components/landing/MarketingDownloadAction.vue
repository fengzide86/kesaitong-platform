<template>
  <div :class="['marketing-download-action', { compact }]">
    <button :class="{ compact: props.compact }" type="button" :disabled="downloading" @click="download">
      {{ downloading ? '获取中…' : '下载 Windows 桌面端' }}
    </button>
    <p v-if="message" class="download-message" role="status">{{ message }}</p>
    <LandingDesktopHandoff :open="handoffOpen" :url="handoffUrl" @close="handoffOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import LandingDesktopHandoff from '@/components/landing/LandingDesktopHandoff.vue'
import { downloadDesktopInstaller, resolveDesktopInstallerUrl } from '@/runtime/desktop-download'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const downloading = ref(false)
const message = ref('')
const handoffOpen = ref(false)
const handoffUrl = ref('')
const mobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)

async function download(): Promise<void> {
  if (downloading.value) return
  downloading.value = true
  message.value = ''
  try {
    if (mobileDevice) {
      handoffUrl.value = await resolveDesktopInstallerUrl()
      handoffOpen.value = true
    } else {
      await downloadDesktopInstaller()
      message.value = '已请求下载。下载不代表授权已开通，请使用已有授权登录。'
    }
  } catch {
    message.value = '暂时无法获取安装包，请稍后重试或联系实际交付方。'
  } finally {
    downloading.value = false
  }
}
</script>

<style scoped>
.marketing-download-action { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.marketing-download-action button { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 10px 20px; border: 0; border-radius: 8px; color: #fff; background: var(--m-blue); font: inherit; font-size: 15px; font-weight: 700; line-height: 1.5; cursor: pointer; transition: background var(--m-duration), transform var(--m-duration); }
.marketing-download-action button.compact { min-height: 44px; padding: 8px 13px; font-size: 14px; }
.marketing-download-action button:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 4px; }
.marketing-download-action button:disabled { color: #fff; background: #627084; cursor: wait; }
.download-message { flex: 1 1 260px; margin: 0; color: var(--m-text); font-size: 14px; line-height: 1.7; }
.marketing-download-action.compact { position: relative; }
.compact .download-message { position: absolute; top: calc(100% + 12px); right: 0; width: min(320px, calc(100vw - 40px)); padding: 16px; border: 1px solid var(--m-border); border-radius: 8px; color: var(--m-text); background: #fff; box-shadow: 0 8px 24px #142b4714; }
@media (hover: hover) {
  .marketing-download-action button:hover:not(:disabled) { transform: translateY(-1px); background: var(--m-blue-hover); }
}
@media (max-width: 600px) {
  .marketing-download-action { align-items: flex-start; flex-direction: column; }
  .marketing-download-action button { width: 100%; }
  .marketing-download-action.compact { align-items: center; flex-direction: row; }
  .marketing-download-action.compact button { width: auto; white-space: nowrap; }
  .download-message { flex-basis: auto; }
}
@media (prefers-reduced-motion: reduce) { .marketing-download-action button { transition: none; transform: none; } }
</style>
