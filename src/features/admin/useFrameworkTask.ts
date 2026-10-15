import { ref } from 'vue'

/** Prevent duplicate writes; surface real API failures without inventing success. */
export function useFrameworkTask() {
  const busy = ref(false)
  const error = ref('')
  const message = ref('')
  async function run(task: () => Promise<void | boolean>, success = '') {
    if (busy.value) return
    busy.value = true
    error.value = ''
    message.value = ''
    try { const result = await task(); if (result !== false) message.value = success }
    catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请核对后重试' }
    finally { busy.value = false }
  }
  return { busy, error, message, run }
}
