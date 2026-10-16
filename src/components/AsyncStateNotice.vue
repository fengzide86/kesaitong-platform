<template>
  <div v-if="state === 'loading'" class="async-notice is-loading" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    <span>{{ loadingText }}</span>
  </div>
  <div v-else-if="state === 'error' || state === 'stale'" :class="['async-notice', `is-${state}`]" :role="state === 'error' ? 'alert' : 'status'">
    <div>
      <strong>{{ state === 'stale' ? staleTitle : errorTitle }}</strong>
      <span>{{ message || (state === 'stale' ? '当前显示上次成功载入的数据。' : '请检查连接后重试。') }}</span>
    </div>
    <button v-if="retryable" type="button" @click="$emit('retry')">重新加载</button>
  </div>
</template>

<script setup lang="ts">
import type { AsyncDataState } from '@/features/async/state'

withDefaults(defineProps<{
  state: AsyncDataState
  message?: string
  loadingText?: string
  errorTitle?: string
  staleTitle?: string
  retryable?: boolean
}>(), {
  message: '',
  loadingText: '正在加载…',
  errorTitle: '数据暂时无法加载',
  staleTitle: '数据可能已过期',
  retryable: true,
})

defineEmits<{ retry: [] }>()
</script>

<style scoped>
.async-notice{min-height:54px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:11px 14px;border:1px solid var(--color-border);border-radius:11px;color:var(--color-text-secondary);background:var(--color-surface);font-size:var(--type-meta)}.async-notice>div{display:grid;gap:3px}.async-notice strong{color:var(--color-text);font-size:var(--type-control)}.async-notice.is-error{border-color:rgba(195,61,73,.28);background:var(--color-danger-soft)}.async-notice.is-stale{border-color:rgba(190,128,25,.28);background:#fff9eb}.async-notice.is-loading{justify-content:flex-start}.async-notice button{min-height:34px;padding:0 11px;border:1px solid currentColor;border-radius:8px;color:var(--color-primary);background:var(--color-surface);font-weight:700;cursor:pointer}.spinner{width:16px;height:16px;border:2px solid var(--color-border-strong);border-top-color:var(--color-primary);border-radius:50%;animation:async-spin .8s linear infinite}@keyframes async-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
