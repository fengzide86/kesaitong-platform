<template>
  <el-drawer
    :model-value="modelValue"
    title="执行诊断与本机证据"
    size="min(620px, 96vw)"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="run-evidence" data-testid="run-evidence-drawer">
      <div class="evidence-tabs" role="tablist" aria-label="查看执行信息">
        <button id="run-diagnostic-tab" type="button" role="tab" :aria-selected="view === 'diagnostic'" aria-controls="run-diagnostic-panel" data-testid="artifact-tab-diagnostic" @click="emit('select', 'diagnostic')">诊断信息</button>
        <button v-if="canViewScreenshot" id="run-screenshot-tab" type="button" role="tab" :aria-selected="view === 'screenshot'" aria-controls="run-screenshot-panel" data-testid="artifact-tab-screenshot" @click="emit('select', 'screenshot')">本机截图</button>
      </div>

      <section v-if="view === 'diagnostic'" id="run-diagnostic-panel" role="tabpanel" aria-labelledby="run-diagnostic-tab" data-testid="run-diagnostic-panel">
        <p class="evidence-note">这里只显示执行与同步状态、错误编号及安全统计，不展示页面原文、账号、密码、Cookie 或完整网络请求。</p>
        <dl class="diagnostic-grid" data-testid="run-diagnostic-summary">
          <div v-for="row in diagnosticRows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
        </dl>
        <p v-if="diagnosticState === 'loading'" class="evidence-state" role="status" data-testid="diagnostic-loading"><LoaderCircle :size="18" class="spin" />正在读取本机诊断证据…</p>
        <p v-else-if="diagnosticState !== 'ready'" :class="['evidence-state', { error: diagnosticState === 'error' }]" :role="diagnosticState === 'error' ? 'alert' : 'status'" data-testid="diagnostic-unavailable">{{ diagnosticMessage }}</p>
        <template v-else>
          <h3>本机证据摘要</h3>
          <dl class="diagnostic-grid" data-testid="local-diagnostic-summary">
            <div v-for="row in localDiagnosticRows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
          </dl>
        </template>
        <button v-if="canReadDiagnostic && diagnosticState !== 'loading'" class="evidence-button" type="button" data-testid="reload-diagnostic" @click="emit('reload', 'diagnostic')">重新读取本机诊断</button>
      </section>

      <section v-else id="run-screenshot-panel" role="tabpanel" aria-labelledby="run-screenshot-tab" data-testid="run-screenshot-panel">
        <p class="evidence-note">截图可能包含平台或客户资料，只在本机查看，不会自动上传给支持。截图本身不能证明业务操作成功。</p>
        <div v-if="screenshotState === 'loading'" class="screenshot-state" role="status" data-testid="screenshot-loading"><LoaderCircle :size="28" class="spin" /><strong>正在读取本机截图</strong><p>只读取本次运行已登记的图片。</p></div>
        <figure v-else-if="screenshotState === 'ready' && screenshotDataUrl" class="evidence-figure">
          <img :src="screenshotDataUrl" alt="本次运行的本机证据截图" data-testid="local-screenshot" @error="emit('image-error')" />
          <figcaption>本次运行保存的截图，不是实时平台页面。</figcaption>
        </figure>
        <div v-else :class="['screenshot-state', { error: screenshotState === 'error' }]" :role="screenshotState === 'error' ? 'alert' : 'status'" data-testid="screenshot-unavailable"><ImageOff :size="28" /><strong>{{ screenshotState === 'error' ? '截图暂时无法查看' : '没有可读取的截图' }}</strong><p>{{ screenshotMessage }}</p></div>
        <button v-if="canViewScreenshot && screenshotState !== 'loading'" class="evidence-button" type="button" data-testid="reload-screenshot" @click="emit('reload', 'screenshot')">重新读取本机截图</button>
      </section>

      <p v-if="needsPlatformReview" class="evidence-review" data-testid="evidence-review-guidance">本次平台结果仍待核对。读取截图、诊断或同步记录都不会恢复任务；请先回到同一平台业务对象核对，结果不明时不要重复执行。</p>
      <p class="evidence-footer">执行结果、记录同步和本机证据读取是三个独立状态。查看信息不会重新执行工具。</p>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { ImageOff, LoaderCircle } from '@lucide/vue'

defineProps<{
  modelValue: boolean
  view: 'diagnostic' | 'screenshot'
  diagnosticRows: { label: string; value: string }[]
  localDiagnosticRows: { label: string; value: string }[]
  diagnosticState: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
  diagnosticMessage: string
  screenshotState: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
  screenshotMessage: string
  screenshotDataUrl: string
  canReadDiagnostic: boolean
  canViewScreenshot: boolean
  needsPlatformReview: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [view: 'diagnostic' | 'screenshot']
  reload: [view: 'diagnostic' | 'screenshot']
  'image-error': []
}>()
</script>

<style scoped>
.run-evidence{display:grid;gap:18px;min-width:0;color:var(--color-text)}
.evidence-tabs{display:flex;gap:7px;padding:5px;border:1px solid var(--color-border);border-radius:11px;background:var(--color-surface-soft)}
.evidence-tabs button{flex:1;min-width:0;min-height:38px;padding:8px;border:1px solid transparent;border-radius:8px;color:var(--color-text-secondary);background:transparent;font:700 var(--type-control)/1.4 var(--font-family);cursor:pointer}
.evidence-tabs button[aria-selected=true]{border-color:var(--color-border);color:var(--color-primary);background:var(--color-surface);box-shadow:var(--shadow-low)}
.evidence-note,.evidence-footer{margin:0 0 16px;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.7;overflow-wrap:anywhere}
.diagnostic-grid{display:grid;gap:0;margin:0;border:1px solid var(--color-border);border-radius:11px;overflow:hidden}
.diagnostic-grid>div{display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px;padding:11px 13px;border-bottom:1px solid var(--color-border)}
.diagnostic-grid>div:last-child{border-bottom:0}.diagnostic-grid dt{color:var(--color-text-tertiary);font-size:var(--type-meta);line-height:1.6}.diagnostic-grid dd{min-width:0;margin:0;color:var(--color-text);font-size:var(--type-control);line-height:1.6;overflow-wrap:anywhere}
h3{margin:20px 0 10px;font-size:var(--type-control)}
.evidence-state{display:flex;align-items:flex-start;gap:8px;margin:16px 0 0;padding:12px;border-radius:10px;color:var(--color-text-secondary);background:var(--color-surface-soft);font-size:var(--type-meta);line-height:1.65;overflow-wrap:anywhere}.evidence-state svg{flex-shrink:0;margin-top:3px}
.evidence-state.error,.screenshot-state.error{color:var(--color-danger);background:var(--color-danger-soft)}
.screenshot-state{min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px 18px;border:1px dashed var(--color-border);border-radius:12px;color:var(--color-text-secondary);background:var(--color-surface-soft);text-align:center}.screenshot-state strong{font-size:var(--type-card)}.screenshot-state p{max-width:360px;margin:0;font-size:var(--type-meta);line-height:1.7;overflow-wrap:anywhere}
.evidence-figure{min-width:0;margin:0;padding:10px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface-soft)}.evidence-figure img{display:block;max-width:100%;height:auto;margin:0 auto;border-radius:6px}.evidence-figure figcaption{margin:10px 0 0;color:var(--color-text-tertiary);font-size:var(--type-meta);line-height:1.6;text-align:center}
.evidence-button{width:100%;min-height:40px;margin-top:16px;padding:8px 12px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-primary);background:var(--color-surface);font:700 var(--type-control)/1.5 var(--font-family);cursor:pointer}
.evidence-review{margin:0;padding:13px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-warning);background:var(--color-warning-soft);font-size:var(--type-meta);line-height:1.7}.evidence-footer{margin:0;font-size:var(--type-micro)}
.spin{animation:evidence-spin 900ms linear infinite}@keyframes evidence-spin{to{transform:rotate(360deg)}}
@media(max-width:480px){.diagnostic-grid>div{grid-template-columns:1fr;gap:3px;padding:10px 12px}.evidence-tabs button{font-size:var(--type-meta)}.screenshot-state{padding:20px 14px}}
@media(prefers-reduced-motion:reduce){.spin{animation:none}}
</style>
