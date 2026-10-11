<template>
  <div v-if="!hideBanner && store.banner" class="info-banner" role="status">
    <Megaphone :size="16" />
    <div>
      <strong>{{ store.banner.title }}</strong>
      <span>{{ store.banner.content }}</span>
    </div>
    <button type="button" aria-label="不再显示这条公告" @click="store.dismiss(store.banner)"><X :size="15" /></button>
  </div>

  <Teleport to="body">
    <Transition name="announcement-fade">
      <div
        v-if="store.critical"
        class="announcement-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="critical-announcement-title"
        aria-describedby="critical-announcement-content"
      >
        <section ref="criticalModal" class="announcement-modal" :class="store.critical.severity" tabindex="-1">
          <div class="type-icon"><CircleAlert :size="24" /></div>
          <span class="type-label">{{ typeText(store.critical.category) }}</span>
          <h3 id="critical-announcement-title">{{ store.critical.title }}</h3>
          <p id="critical-announcement-content">{{ store.critical.content }}</p>
          <div class="modal-footer">
            <small>{{ formatDate(store.critical.published_at || store.critical.created_at) }}</small>
            <button type="button" :disabled="dismissing" @click="dismissCritical">我已了解</button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useModalFocus } from '@/composables/useModalFocus'
import { showToast } from '@/utils'
import { CircleAlert, Megaphone, X } from '@lucide/vue'

import { useAnnouncementStore } from '@/features/announcements/store'
import type { Announcement } from '@/features/announcements/model'
import { useOverlayCoordinatorStore } from '@/features/shell/overlay-store'

defineProps<{ hideBanner?: boolean }>()
const store = useAnnouncementStore()
const overlay = useOverlayCoordinatorStore()
const criticalModal = ref<HTMLElement | null>(null)
const dismissing = ref(false)
async function dismissCritical() {
  if (!store.critical || dismissing.value) return
  dismissing.value = true
  try { await store.dismiss(store.critical) }
  catch { showToast('公告状态未保存，请稍后重试', 'error') }
  finally { dismissing.value = false }
}
useModalFocus(computed(() => Boolean(store.critical)), criticalModal, () => { void dismissCritical() })

function typeText(category: Announcement['category']): string {
  return category === 'maintenance' ? '维护通知' : '重要通知'
}
function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString('zh-CN') : ''
}

onMounted(() => store.load().catch(() => undefined))
const stopCriticalWatch = watch(() => Boolean(store.critical), value => overlay.setCriticalAnnouncement(value), { immediate: true })
onUnmounted(() => { stopCriticalWatch(); overlay.setCriticalAnnouncement(false) })
</script>

<style scoped>
.announcement-modal{box-sizing:border-box;max-height:calc(100dvh - 32px);display:flex;flex-direction:column;min-height:0}.announcement-modal>p{overflow:auto;min-height:0;overflow-wrap:anywhere}.announcement-modal h3{overflow-wrap:anywhere}.type-icon,.modal-footer{flex-shrink:0}
.info-banner{min-height:52px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:11px;margin-bottom:16px;padding:10px 12px;border:1px solid rgba(45,95,202,.16);border-radius:var(--radius-md);color:var(--color-primary);background:var(--color-primary-soft)}.info-banner div{min-width:0;display:flex;align-items:baseline;gap:9px}.info-banner strong{flex-shrink:0;font-size:var(--type-control)}.info-banner span{overflow:hidden;color:var(--color-text-secondary);font-size:var(--type-meta);text-overflow:ellipsis;white-space:nowrap}.info-banner button{width:36px;height:36px;display:grid;place-items:center;border:0;color:var(--color-text-secondary);background:transparent;cursor:pointer}
.announcement-overlay{position:fixed;inset:0;z-index:var(--z-critical-announcement);isolation:isolate;display:grid;place-items:center;padding:16px;background:rgba(24,32,51,.3);backdrop-filter:blur(5px)}.announcement-modal{width:min(430px,100%);padding:28px;border:1px solid var(--color-border);border-top:3px solid var(--color-primary);border-radius:var(--radius-xl);background:var(--color-surface);box-shadow:var(--shadow-overlay)}.announcement-modal.critical{border-top-color:var(--color-danger)}.type-icon{width:44px;height:44px;display:grid;place-items:center;margin-bottom:14px;border-radius:11px;color:var(--color-warning);background:var(--color-warning-soft)}.critical .type-icon{color:var(--color-danger);background:var(--color-danger-soft)}.type-label{color:var(--color-text-secondary);font-size:var(--type-micro);font-weight:800;letter-spacing:.06em}.announcement-modal h3{margin:6px 0 10px;color:var(--color-text);font-size:20px}.announcement-modal>p{margin:0;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.75;white-space:pre-wrap}.modal-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:22px;padding-top:15px;border-top:1px solid var(--color-border)}.modal-footer small{color:var(--color-text-secondary);font-size:var(--type-micro)}.modal-footer button{min-height:40px;padding:0 16px;border:0;border-radius:9px;color:#fff;background:var(--color-primary);font-size:var(--type-control);font-weight:700;cursor:pointer}.announcement-fade-enter-active,.announcement-fade-leave-active{transition:opacity var(--motion-fast)}.announcement-fade-enter-from,.announcement-fade-leave-to{opacity:0}@media(prefers-reduced-motion:reduce){.announcement-fade-enter-active,.announcement-fade-leave-active{transition:none}}
</style>
