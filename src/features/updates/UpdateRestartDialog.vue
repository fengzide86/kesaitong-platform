<template>
    <dialog ref="dialogRef" class="restart-dialog" aria-labelledby="restart-title" aria-describedby="restart-description" @cancel.prevent="dismiss">
      <section class="restart-card">
        <button ref="dismissButton" class="restart-close" type="button" aria-label="稍后决定是否安装" @click="dismiss"><X :size="18" /></button>
        <div class="restart-icon"><CircleCheck :size="24" /></div>
        <p>UPDATE READY</p>
        <h2 id="restart-title">更新已经准备好了</h2>
        <span id="restart-description">重启后将使用 v{{ store.state.availableVersion }}。已完成的工作会保留；软件会先安全结束本机服务。</span>
        <div>
          <button type="button" class="secondary" @click="defer">退出时安装</button>
          <button type="button" class="primary" :disabled="!store.state.canRestart" @click="store.install">立即重启</button>
        </div>
      </section>
    </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { CircleCheck, X } from '@lucide/vue'
import { useUpdateStore } from './store'

const store = useUpdateStore()
const route = useRoute()
const visible = computed(() => !['UserLogin', 'AdminLogin'].includes(String(route.name)) && store.shouldPromptRestart)
const dialogRef = ref<HTMLDialogElement | null>(null)
const dismissButton = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null
watch(visible, async show => {
  await nextTick()
  const dialog = dialogRef.value
  if (!dialog) return
  if (show && visible.value && !dialog.open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    dismissButton.value?.focus({ preventScroll: true })
  } else if (!visible.value && dialog.open) {
    dialog.close()
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    returnFocus = null
  }
}, { immediate: true })
function dismiss(): void { store.dismissRestartPrompt() }
async function defer(): Promise<void> { await store.deferInstall() }
onBeforeUnmount(() => { if (dialogRef.value?.open) dialogRef.value.close() })
</script>

<style scoped>
/* The global reset overrides the browser's dialog margin; own both axes. */
.restart-dialog{position:fixed;inset:0;margin:auto;border:0;padding:0;width:440px;height:fit-content;max-width:calc(100vw - 40px);max-height:calc(100vh - 40px);max-height:calc(100dvh - 40px);box-sizing:border-box;background:transparent;color:var(--color-text);overflow:auto}
.restart-dialog::backdrop{background:rgba(24,32,51,.28);backdrop-filter:blur(5px)}
.restart-card{position:relative;width:100%;box-sizing:border-box;padding:28px;border:1px solid var(--color-border);border-radius:18px;background:var(--color-surface);box-shadow:var(--shadow-overlay);text-align:center}
.restart-icon{width:48px;height:48px;display:grid;place-items:center;margin:0 auto 14px;border-radius:14px;color:var(--color-success);background:var(--color-success-soft)}
.restart-card>p{margin:0;color:var(--color-premium);font-size:var(--type-micro);font-weight:800;letter-spacing:.14em}
.restart-card h2{margin:7px 0 9px;color:var(--color-text);font-size:22px}
.restart-card>span{display:block;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.65}
.restart-card>div:last-child{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;margin-top:24px}
.restart-card button{min-height:40px;padding:0 16px;border-radius:10px;font:700 var(--type-control)/1 var(--font-family);cursor:pointer}
.restart-card .secondary{border:1px solid var(--color-border);color:var(--color-text-secondary);background:var(--color-surface)}
.restart-card .primary{border:1px solid var(--color-primary);color:#fff;background:var(--color-primary)}
.restart-card .restart-close{position:absolute;right:10px;top:10px;display:grid;place-items:center;min-height:36px;width:36px;padding:0;border:0;background:transparent;color:var(--color-text-secondary)}
.restart-card button:focus-visible{outline:3px solid var(--color-primary);outline-offset:3px}
.restart-card button:disabled{opacity:.5;cursor:not-allowed}
@media(max-width:420px){.restart-card{padding:24px 18px}}
</style>
