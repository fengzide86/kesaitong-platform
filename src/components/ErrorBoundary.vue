<template>
  <div>
    <slot v-if="!error"></slot>
    <div v-else class="error-boundary">
      <div class="error-content">
        <div class="error-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <h2 class="error-title">页面出错了</h2>
        <p class="error-message">{{ errorMessage }}</p>
        <div class="error-actions">
          <button @click="reload" class="btn-primary">重新加载</button>
          <button @click="goHome" class="btn-secondary">返回首页</button>
        </div>
        <details v-if="showDetails" class="error-details">
          <summary>错误详情</summary>
          <pre>{{ error.stack }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured, type ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'
import { captureException } from '@/utils/sentry'

defineProps({
  showDetails: {
    type: Boolean,
    default: () => import.meta.env.DEV
  }
})

const router = useRouter()
const error = ref<Error | null>(null)
const errorMessage = ref('发生了未知错误')

onErrorCaptured((err, instance, info) => {
  error.value = err
  errorMessage.value = err.message || '发生了未知错误'
  
  // 记录错误到控制台
  console.error('[ErrorBoundary] Caught error:', err)
  console.error('[ErrorBoundary] Component:', instance?.$options?.name || 'Unknown')
  console.error('[ErrorBoundary] Info:', info)
  
  // 发送到错误追踪服务
  if (import.meta.env.PROD) {
    sendErrorToAnalytics(err, instance, info)
  }
  
  // 阻止错误继续传播
  return false
})

function reload() {
  window.location.reload()
}

function goHome() {
  error.value = null
  router.push('/')
}

function sendErrorToAnalytics(err: Error, instance: ComponentPublicInstance | null, info: string) {
  captureException(err, {
    component: instance?.$options?.name || 'Unknown',
    info,
    url: window.location.href,
  })
}
</script>

<style scoped>
.error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.error-content {
  background: white;
  border-radius: 16px;
  padding: 3rem;
  max-width: 500px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.error-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 1.5rem;
  color: var(--color-danger);
}

.error-icon svg {
  width: 100%;
  height: 100%;
}

.error-title {
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 1rem;
}

.error-message {
  font-size: 1rem;
  color: var(--color-text-secondary);
  margin-bottom: 2rem;
  line-height: 1.6;
}

.error-actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  margin-bottom: 2rem;
}

.btn-primary {
  padding: 0.75rem 1.5rem;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary:hover {
  background: var(--color-primary-hover);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.4);
}

.btn-secondary {
  padding: 0.75rem 1.5rem;
  background: white;
  color: var(--color-primary);
  border: 2px solid var(--color-primary);
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: var(--color-surface-soft);
  transform: translateY(-2px);
}

.error-details {
  text-align: left;
  margin-top: 2rem;
}

.error-details summary {
  cursor: pointer;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
}

.error-details pre {
  background: var(--color-surface-soft);
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.875rem;
  color: var(--color-text);
}
</style>
