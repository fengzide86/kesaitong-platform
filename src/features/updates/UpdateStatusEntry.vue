<template>
  <button
    v-if="store.showHeaderEntry"
    class="update-status-entry"
    :class="`is-${store.state.status}`"
    type="button"
    :aria-label="accessibleLabel"
    :title="accessibleLabel"
    @click="openDetails"
  >
    <Download v-if="store.state.status === 'available' || store.state.status === 'cancelled'" :size="17" />
    <CircleCheck v-else-if="store.state.status === 'downloaded' || store.state.status === 'restart_deferred'" :size="17" />
    <CircleAlert v-else-if="store.state.status === 'error'" :size="17" />
    <LoaderCircle v-else :size="17" class="is-spinning" />
    <span class="update-status-entry__label">{{ shortLabel }}</span>
    <strong v-if="store.state.status === 'downloading'">{{ store.displayPercent }}%</strong>
    <i v-if="store.state.status === 'available'" aria-hidden="true" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CircleAlert, CircleCheck, Download, LoaderCircle } from '@lucide/vue'

import { useUpdateStore } from './store'

const store = useUpdateStore()
const props = withDefaults(defineProps<{ detailsDisabled?: boolean }>(), { detailsDisabled: false })
const shortLabel = computed(() => ({
  checking: '', available: '发现新版本', downloading: '后台下载', cancelling: '正在取消', downloaded: '可以重启',
  restart_deferred: '更新已就绪', installing: '正在重启', cancelled: '重新下载', error: '更新异常', idle: '',
})[store.state.status])
const accessibleLabel = computed(() => props.detailsDisabled
  ? `${shortLabel.value}，完成当前工作后可查看详情`
  : store.state.status === 'downloading'
  ? `应用更新正在下载，${store.displayPercent}%`
  : shortLabel.value)
function openDetails(): void { if (!props.detailsDisabled) store.openDetails() }
</script>

<style scoped>
.update-status-entry{position:relative;min-width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 11px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-text-secondary);background:var(--color-surface);font:600 var(--type-control)/1 var(--font-family);cursor:pointer;transition:color var(--motion-fast),border-color var(--motion-fast),background var(--motion-fast)}
.update-status-entry:hover{color:var(--color-primary);border-color:var(--color-primary-border);background:var(--color-primary-soft)}
.update-status-entry:disabled{cursor:default}
.update-status-entry strong{color:var(--color-primary);font-size:var(--type-meta);font-variant-numeric:tabular-nums}.update-status-entry i{position:absolute;top:5px;right:5px;width:6px;height:6px;border:2px solid var(--color-surface);border-radius:50%;background:var(--color-primary)}
.is-downloaded,.is-restart_deferred{color:var(--color-success)}.is-error{color:var(--color-danger)}.is-spinning{animation:update-spin 1s linear infinite}@keyframes update-spin{to{transform:rotate(360deg)}}
@media(max-width:1023px){.update-status-entry{width:36px;padding:0}.update-status-entry__label,.update-status-entry strong{display:none}}
@media(prefers-reduced-motion:reduce){.is-spinning{animation:none}}
</style>
