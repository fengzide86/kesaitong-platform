<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, Check, ChevronDown, ChevronUp, MousePointer2, Pause, Play, ShieldCheck, Square } from '@lucide/vue'
import kstLogo from '../../../assets/brand/kst-logo-horizontal.svg'
import kstSymbol from '../../../assets/brand/kst-symbol-compact.svg'
import { stageIndex, taskMeta, type DemoOutcome } from './demo-tasks'

type Pace = 'guided' | 'flow'
const props = defineProps<{
  open: boolean
  task: string
  activeTask?: string
  pace: Pace
  running: boolean
  paused: boolean
  status: string
  currentStep: string
  action: string
  steps: string[]
  cursor: number
  selectedOrder?: string
  orders?: { id: string; label: string }[]
  outcome?: DemoOutcome
}>()
const emit = defineEmits<{
  close: []
  toggle: []
  'update:task': [value: string]
  'update:pace': [value: Pace]
  'update:order': [value: string]
  start: []
  pause: []
  stop: []
  'view-result': []
  'next-task': []
}>()

const body = ref<HTMLElement | null>(null)
const taskSelector = ref<HTMLSelectElement | null>(null)
const dockToggle = ref<HTMLButtonElement | null>(null)
const hasOpened = ref(props.open)
let requestedFocus: 'panel' | 'dock' | undefined
watch(() => props.open, open => {
  if (open) hasOpened.value = true
  if (requestedFocus === (open ? 'panel' : 'dock')) {
    ;(open ? taskSelector.value : dockToggle.value)?.focus({ preventScroll: true })
    requestedFocus = undefined
  }
}, { flush: 'post' })
watch([() => props.task, () => props.running], () => {
  // Reset only the task content. The selector stays outside this scroll area.
  if (body.value) body.value.scrollTop = 0
}, { flush: 'post' })

const selectedRun = computed(() => props.running || !props.activeTask || props.task === props.activeTask)
const hasTaskHistory = computed(() => selectedRun.value && props.steps.length > 0)
const completed = computed(() => selectedRun.value ? Math.max(0, Math.min(props.cursor, props.steps.length)) : 0)
const finished = computed(() => hasTaskHistory.value && !props.running && props.status === '已完成，保存状态核对通过' && completed.value === props.steps.length)
const displayStatus = computed(() => selectedRun.value ? (props.paused ? '已暂停' : props.status) : '就绪')
const taskName = computed(() => taskMeta(selectedRun.value ? (props.activeTask || props.task) : props.task).name)
const taskDescription = computed(() => taskMeta(props.task).description)
const taskStages = computed(() => taskMeta(props.task).stages)
const phaseProgress = computed(() => taskMeta(props.activeTask || props.task).stages.map((name, phase) => {
  const indexes = props.steps.flatMap((label, index) => stageIndex(props.activeTask || props.task, label, index, props.steps.length) === phase ? [index] : [])
  return { name, done: indexes.length > 0 && indexes.every(index => index < completed.value), current: indexes.includes(props.cursor) }
}))
const noShippingOrders = computed(() => props.task === 'shipping' && props.orders !== undefined && props.orders.length === 0)
function stepState(index: number) {
  if (index < completed.value) return '已完成'
  if (props.running && index === props.cursor) return props.paused ? '已暂停' : '正在操作'
  if (!props.running && index === props.cursor) return props.status.startsWith('已停止') ? '已停止' : '未完成'
  return props.running ? '待开始' : '未执行'
}
function updateTask(event: Event) { emit('update:task', (event.target as HTMLSelectElement).value) }
function updatePace(event: Event) { emit('update:pace', (event.target as HTMLSelectElement).value as Pace) }
function updateOrder(event: Event) { emit('update:order', (event.target as HTMLSelectElement).value) }
function collapseControl() {
  requestedFocus = 'dock'
  emit('close')
}
function expandControl() {
  requestedFocus = 'panel'
  emit('toggle')
}
</script>

<template>
  <aside
    v-if="open"
    class="kst-demo-panel"
    :class="{ 'kst-demo-panel--active': running }"
    aria-label="课赛通工具控制"
    @keydown.esc.stop.prevent="collapseControl"
  >
    <header class="kst-demo-header">
      <div class="kst-demo-brand">
        <img
          :src="kstLogo"
          alt="课赛通 KST"
        ><span>演示控制</span>
      </div>
      <button
        class="kst-demo-collapse"
        aria-label="收起工具控制"
        @click="collapseControl"
      >
        收起控制<ChevronDown
          :size="16"
          aria-hidden="true"
        />
      </button>
    </header>

    <div class="kst-demo-task-picker">
      <label
        class="kst-demo-select-label"
        for="kst-demo-task"
      >演示任务</label>
      <select
        id="kst-demo-task"
        ref="taskSelector"
        :value="task"
        class="kst-demo-select"
        aria-label="选择一键任务"
        :disabled="running"
        @change="updateTask"
      >
        <option value="product">
          商品上架 · 两个变体
        </option>
        <option value="shipping">
          订单发货 · 国内仓库
        </option>
        <option value="template">
          配送模板 · 规则与回读
        </option>
        <option value="fba">
          FBA 转换 · 危险品与库存
        </option>
        <option value="advertising">
          商品推广 · 活动与广告组
        </option>
      </select>
    </div>

    <div ref="body" class="kst-demo-body">
      <template v-if="!running">
        <div
          v-if="(hasTaskHistory && !finished) || (selectedRun && status === '未完成')"
          class="kst-demo-last-result"
          role="status"
        >
          <span><span data-testid="run-status">{{ displayStatus }}</span><small v-if="completed">已完成 {{ completed }} / {{ steps.length }} 步</small></span>
        </div>
        <span
          v-else
          class="kst-demo-sr-only"
          role="status"
          data-testid="run-status"
        >{{ displayStatus }}</span>
        <section
          v-if="finished && outcome"
          class="kst-demo-outcome"
          data-testid="demo-outcome"
          aria-label="本轮保存结果"
        >
          <span class="kst-demo-outcome-caption">本轮已保存 · 本机样例</span>
          <h2>{{ outcome.title }}</h2><p
            v-if="outcome.task === 'shipping'"
            class="kst-demo-object-id"
          >
            {{ outcome.objectId }}
          </p>
          <div class="kst-demo-outcome-change">
            <span>{{ outcome.before }}</span><ArrowRight
              :size="16"
              aria-hidden="true"
            /><strong>{{ outcome.after }}</strong>
          </div>
          <div class="kst-demo-outcome-actions">
            <button
              class="kst-demo-primary"
              data-action="view-demo-result"
              @click="emit('view-result')"
            >
              查看这个结果<ArrowRight
                :size="14"
                aria-hidden="true"
              />
            </button><button
              class="kst-demo-secondary"
              data-action="next-demo-task"
              @click="emit('next-task')"
            >
              体验另一项
            </button>
          </div>
          <details v-if="outcome.facts.length" class="kst-demo-outcome-details">
            <summary>查看结果详情</summary>
            <dl>
              <template v-for="fact in outcome.facts" :key="fact.label">
                <dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd>
              </template>
            </dl>
          </details>
        </section>
        <details
          v-if="hasTaskHistory"
          class="kst-demo-result-trace"
          :open="!finished"
        >
          <summary>本轮实际操作步骤<span class="kst-demo-trace-task">{{ taskName }}</span><span class="kst-demo-trace-count">{{ completed }} / {{ steps.length }} 已完成</span></summary><ol
            class="kst-demo-result-steps"
            aria-label="本轮实际操作步骤"
          >
            <li
              v-for="(step, index) in steps"
              :key="`${index}-${step}`"
              :class="{ 'is-done': index < completed, 'is-interrupted': index === cursor && !finished }"
            >
              <span class="kst-demo-step-mark"><Check
                v-if="index < completed"
                :size="12"
                aria-hidden="true"
              /><span v-else>{{ index + 1 }}</span></span><span class="kst-demo-step-label">{{ step }}</span><span class="kst-demo-step-state">{{ stepState(index) }}</span>
            </li>
          </ol>
        </details>

        <div
          v-if="task === 'shipping'"
          class="kst-demo-order-setting"
        >
          <label
            class="kst-demo-select-label"
            for="kst-demo-order"
          >当前订单</label>
          <select
            id="kst-demo-order"
            :value="selectedOrder || ''"
            class="kst-demo-select"
            aria-label="选择演示订单"
            :disabled="!orders?.length"
            @change="updateOrder"
          >
            <option
              v-if="!orders?.length"
              value=""
            >
              暂无未发货样例订单
            </option>
            <option
              v-for="order in orders"
              :key="order.id"
              :value="order.id"
            >
              {{ order.label }}
            </option>
          </select>
          <p
            v-if="!orders?.length"
            class="kst-demo-empty-note"
            role="status"
          >
            没有未发货订单，可重置样例后再演示。
          </p>
        </div>
        <p v-if="!finished" class="kst-demo-task-summary">{{ taskStages.join(' → ') }}</p>
        <details class="kst-demo-settings">
          <summary>操作说明与演示节奏<ChevronDown :size="15" aria-hidden="true" /></summary>
        <div class="kst-demo-task-preview">
          <p>{{ taskDescription }}</p>
          <ol
            class="kst-demo-task-stages"
            :class="{ 'has-four-stages': task === 'shipping' }"
            aria-label="任务流程概览"
          >
            <li
              v-for="(stage, index) in taskStages"
              :key="stage"
            >
              <span class="kst-demo-stage-node">{{ index + 1 }}</span><span>{{ stage }}</span><ArrowRight
                v-if="index < taskStages.length - 1"
                :size="12"
                class="kst-demo-stage-link"
                aria-hidden="true"
              />
            </li>
          </ol>
        </div>

        <label
          class="kst-demo-select-label"
          for="kst-demo-pace"
        >演示节奏</label>
        <select
          id="kst-demo-pace"
          :value="pace"
          class="kst-demo-select"
          aria-label="演示速度"
          @change="updatePace"
        >
          <option value="guided">
            细看过程 · 推荐
          </option>
          <option value="flow">
            流畅演示
          </option>
        </select>
        <p class="kst-demo-pace-note">
          {{ pace === 'guided' ? '逐项填写，关键结果留约 2 秒看清，再进入下一步。' : '节奏更紧凑，适合看完整操作流程。' }}
        </p>
        </details>
      </template>

      <template v-else>
        <div class="kst-demo-run-heading">
          <strong>{{ taskName }}</strong><span class="kst-demo-eyebrow"><span :class="{ 'is-paused': paused }" />{{ paused ? '已暂停' : '正在执行' }}</span>
        </div>
        <div
          class="kst-demo-current"
          :class="{ 'is-paused': paused }"
        >
          <span class="kst-demo-current-number">{{ Math.min(cursor + 1, steps.length) }}<small>/ {{ steps.length }}</small></span>
          <div>
            <h2>{{ currentStep || '准备开始' }}</h2><p data-testid="demo-active-action">
              <MousePointer2
                :size="13"
                aria-hidden="true"
              />{{ action || (paused ? '点击继续，接着看下一步。' : '正在准备页面操作') }}
            </p>
          </div>
        </div>
        <div class="kst-demo-run-pace">
          <label for="kst-demo-running-pace">演示节奏</label><select
            id="kst-demo-running-pace"
            :value="pace"
            class="kst-demo-select"
            aria-label="演示速度"
            @change="updatePace"
          >
            <option value="guided">
              细看过程
            </option><option value="flow">
              流畅演示
            </option>
          </select>
        </div>
        <ol
          class="kst-demo-phase-list"
          aria-label="本轮执行阶段"
        >
          <li
            v-for="(phase, index) in phaseProgress"
            :key="phase.name"
            :class="{ 'is-done': phase.done, 'is-current': phase.current }"
          >
            <span><Check
              v-if="phase.done"
              :size="12"
              aria-hidden="true"
            /><template v-else>{{ index + 1 }}</template></span><strong>{{ phase.name }}</strong><small>{{ phase.done ? '已完成' : phase.current ? (paused ? '暂停中' : '进行中') : '待开始' }}</small>
          </li>
        </ol>
        <details
          class="kst-demo-full-steps"
          :open="paused"
        >
          <summary>展开完整步骤 <span>{{ completed }} / {{ steps.length }}</span></summary>
          <div class="kst-demo-timeline-heading">
            <strong>实际操作步骤<span class="kst-demo-trace-task">{{ taskName }}</span></strong><span>已完成 {{ completed }} / {{ steps.length }} 步</span>
          </div>
          <ol
            class="kst-demo-steps"
            aria-label="演示步骤"
          >
            <li
              v-for="(step, index) in steps"
              :key="`${index}-${step}`"
              :class="{ 'is-done': index < completed, 'is-current': index === cursor, 'is-paused': index === cursor && paused }"
              :aria-current="index === cursor ? 'step' : undefined"
            >
              <span class="kst-demo-step-mark"><Check
                v-if="index < completed"
                :size="12"
                aria-hidden="true"
              /><span v-else>{{ index + 1 }}</span></span><span class="kst-demo-step-label">{{ step }}</span><span class="kst-demo-step-state">{{ stepState(index) }}</span>
            </li>
          </ol>
        </details>
        <span
          class="kst-demo-sr-only"
          role="status"
          data-testid="run-status"
        >{{ displayStatus }}</span>
      </template>
    </div>

    <footer class="kst-demo-footer">
      <div
        v-if="running"
        class="kst-demo-controls"
      >
        <button
          class="kst-demo-primary"
          @click="emit('pause')"
        >
          <Play
            v-if="paused"
            :size="16"
            aria-hidden="true"
          /><Pause
            v-else
            :size="16"
            aria-hidden="true"
          />{{ paused ? '继续' : '暂停' }}
        </button><button
          class="kst-demo-stop"
          @click="emit('stop')"
        >
          <Square
            :size="13"
            aria-hidden="true"
          />停止
        </button>
      </div>
      <button
        v-else
        class="kst-demo-primary kst-demo-start"
        data-action="run"
        :disabled="noShippingOrders"
        @click="emit('start')"
      >
        <Play
          :size="16"
          aria-hidden="true"
        />{{ hasTaskHistory ? '再演示一次' : '开始演示' }}
      </button>
      <p class="kst-demo-scope">
        <ShieldCheck
          :size="13"
          aria-hidden="true"
        />操作虚构样例，不连接真实平台
      </p>
    </footer>
  </aside>

  <aside
    v-if="!open && (hasOpened || running || hasTaskHistory)"
    class="v2-run-dock kst-demo-dock"
    :class="{ 'is-paused': paused, 'is-finished': finished }"
    aria-label="演示运行控制"
  >
    <button
      ref="dockToggle"
      class="kst-demo-dock-summary"
      aria-label="展开课赛通工具控制"
      data-action="open-demo-controller"
      @click="expandControl"
    >
      <span class="kst-demo-dock-brand"><img
        :src="kstSymbol"
        alt="课赛通"
      ><span class="kst-demo-dock-dot" /></span>
      <span class="kst-demo-dock-copy"><span class="kst-demo-dock-caption">{{ running ? `${taskName} · ${paused ? '已暂停' : `${Math.min(cursor + 1, steps.length)} / ${steps.length}`}` : taskName }}</span><strong>{{ running ? currentStep || '准备开始' : hasTaskHistory ? displayStatus : '展开控制，选择演示任务' }}</strong></span>
      <span class="kst-demo-dock-expand-label">展开<ChevronUp
        :size="16"
        class="kst-demo-dock-expand"
        aria-hidden="true"
      /></span>
    </button>
    <div
      v-if="running"
      class="kst-demo-dock-controls"
    >
      <button
        class="kst-demo-dock-pause"
        @click="emit('pause')"
      >
        <Play
          v-if="paused"
          :size="14"
          aria-hidden="true"
        /><Pause
          v-else
          :size="14"
          aria-hidden="true"
        />{{ paused ? '继续' : '暂停' }}
      </button>
    </div>
    <div
      v-if="running"
      class="kst-demo-sr-only"
    >
      <p
        class="kst-demo-dock-action"
        data-testid="demo-active-action"
      >
        <MousePointer2
          :size="12"
          aria-hidden="true"
        />{{ action || (paused ? '演示已暂停' : '正在准备页面操作') }}
      </p>
    </div>
    <progress v-if="running" class="kst-demo-dock-progress" :value="completed" :max="Math.max(1, steps.length)" aria-label="演示步骤进度" />
    <span
      class="kst-demo-sr-only"
      role="status"
      data-testid="run-status"
    >{{ displayStatus }}</span>
  </aside>
</template>

<style src="./v2-demo-controller.css" />
<style src="./v2-demo-outcomes.css" />
