<script setup lang="ts">
import { computed, ref } from 'vue'

type CapabilityStatus = 'interactive-demo' | 'desktop-execution' | 'controlled-validation' | 'in-development'
type EvidenceLevel = 'material' | 'page-observation' | 'readback' | 'unverified'
type TaskNode = {
  id: string
  title: string
  pain: string
  prerequisite: string
  humanStep: string
  toolStep: string
  verification: string
  status: CapabilityStatus
  evidence: EvidenceLevel
}

const nodes: TaskNode[] = [
  { id: 'product', title: '商品资料 / 选品', pain: '资料和变体信息容易反复整理。', prerequisite: '先确认品类、素材和当前任务规则。', humanStep: '确认商品内容和提交边界。', toolStep: '按任务准备可重复的输入步骤。', verification: '回看商品或变体状态。', status: 'desktop-execution', evidence: 'page-observation' },
  { id: 'shipping', title: '物流模板', pain: '国家、服务、重量和运费规则容易混。', prerequisite: '确认国家、单位、限重和处理时间。', humanStep: '判断规则是否适用。', toolStep: '处理重复填写和模板步骤。', verification: '回读模板列表或详情。', status: 'desktop-execution', evidence: 'readback' },
  { id: 'variants', title: '商品与变体', pain: '商品、SKU 和后续动作不是孤立页面。', prerequisite: '确认商品已保存且变体关系清楚。', humanStep: '检查关联关系和资料完整性。', toolStep: '减少页面切换和重复操作。', verification: '查看商品详情和变体状态。', status: 'controlled-validation', evidence: 'page-observation' },
  { id: 'fulfillment', title: '自发货或 FBA', pain: '配送方式会改变后续可做的动作。', prerequisite: '确认商品资格、库存和配送设置。', humanStep: '选择配送方式并处理异常。', toolStep: '按已确认的方式进入对应流程。', verification: '回读库存、配送或货件状态。', status: 'controlled-validation', evidence: 'unverified' },
  { id: 'ads', title: '广告 / 活动', pain: '投放对象、预算和活动前置条件容易漏。', prerequisite: '确认商品已具备可投放状态。', humanStep: '确认预算、日期和投放边界。', toolStep: '处理重复配置和页面跳转。', verification: '回读广告组或活动详情。', status: 'controlled-validation', evidence: 'unverified' },
  { id: 'orders', title: '订单状态回读', pain: '按钮提示完成不等于订单真正完成。', prerequisite: '确认订单、库存和发货信息可用。', humanStep: '补充承运人、运单和最终确认。', toolStep: '整理发货步骤和执行记录。', verification: '以订单列表或详情状态为准。', status: 'desktop-execution', evidence: 'readback' },
]

const fallbackNode = nodes[0]!
const activeId = ref(fallbackNode.id)
const activeNode = computed(() => nodes.find(node => node.id === activeId.value) ?? fallbackNode)
const statusLabel: Record<CapabilityStatus, string> = {
  'interactive-demo': '交互演示',
  'desktop-execution': '桌面端执行',
  'controlled-validation': '受控验证',
  'in-development': '脚本开发中',
}
const evidenceLabel: Record<EvidenceLevel, string> = {
  material: '资料建议',
  'page-observation': '页面现场',
  readback: '真实回读',
  unverified: '尚待验证',
}
</script>

<!-- eslint-disable vue/max-attributes-per-line, vue/singleline-html-element-content-newline, vue/multiline-html-element-content-newline, vue/html-self-closing -->
<template>
  <section id="task-chain" class="task-chain" data-testid="task-chain" aria-labelledby="task-chain-title">
    <div class="task-chain-heading">
      <div>
        <p class="eyebrow">从任务链看工具边界</p>
        <h2 id="task-chain-title">每一步都有前置条件，也都有确认方式。</h2>
      </div>
      <p>不把商品、物流、FBA、广告和发货拆成互不相干的功能卡。点击节点，查看这一环节谁负责、工具做什么，以及结果如何确认。</p>
    </div>
    <div class="task-chain-nodes" role="tablist" aria-label="赛训任务链">
      <template v-for="(node, index) in nodes" :key="node.id">
        <button class="task-node" :class="{ 'is-active': activeId === node.id }" type="button" role="tab" :aria-selected="activeId === node.id" :aria-controls="`task-detail-${node.id}`" @click="activeId = node.id">
          <span class="task-node-index">0{{ index + 1 }}</span>
          <strong>{{ node.title }}</strong>
          <small>{{ statusLabel[node.status] }}</small>
        </button>
        <span v-if="index < nodes.length - 1" class="task-node-arrow" aria-hidden="true">→</span>
      </template>
    </div>
    <article :id="`task-detail-${activeNode.id}`" class="task-detail" role="tabpanel" aria-live="polite">
      <div class="task-detail-title"><span class="task-detail-kicker">当前查看</span><h3>{{ activeNode.title }}</h3><div class="task-detail-badges"><span class="status-badge">{{ statusLabel[activeNode.status] }}</span><span class="status-badge">证据：{{ evidenceLabel[activeNode.evidence] }}</span></div></div>
      <div class="task-detail-grid"><div><span>常见卡点</span><p>{{ activeNode.pain }}</p></div><div><span>前置条件</span><p>{{ activeNode.prerequisite }}</p></div><div><span>人工负责</span><p>{{ activeNode.humanStep }}</p></div><div><span>工具支持</span><p>{{ activeNode.toolStep }}</p></div><div><span>最终确认</span><p>{{ activeNode.verification }}</p></div></div>
    </article>
  </section>
</template>

<style scoped>
.task-chain { padding:32px; border:1px solid #dce6f4; border-radius:17px; background:#fff; }
.task-chain-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:35px; }
.task-chain-heading h2 { margin-top:11px; font-size:27px; line-height:1.4; }
.task-chain-heading > p { max-width:31em; color:var(--muted); font-size:13px; line-height:1.85; }
.task-chain-nodes { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); align-items:stretch; gap:8px; margin-top:28px; }
.task-node { min-width:0; padding:15px 11px; border:1px solid #e1e9f4; border-radius:10px; color:#5d7393; background:#fbfcfe; text-align:left; }
.task-node.is-active { border-color:#a8c4ed; color:#245cae; background:#f0f6ff; box-shadow:0 4px 12px #335e9e14; }
.task-node-index,.task-node strong,.task-node small { display:block; }.task-node-index { color:#9bb2d4; font-size:10px; }.task-node strong { margin-top:8px; font-size:12px; line-height:1.55; }.task-node small { margin-top:8px; color:#8495ac; font-size:9px; }.task-node-arrow { display:none; align-self:center; color:#9cb2d2; font-size:16px; text-align:center; }
.task-detail { margin-top:24px; padding:23px; border-top:1px solid #e8eef5; background:#fbfcff; }.task-detail-title { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }.task-detail-kicker { color:#7891b4; font-size:10px; }.task-detail-title h3 { font-size:20px; }.task-detail-badges { display:flex; flex-wrap:wrap; gap:7px; margin-left:auto; }.status-badge { padding:5px 9px; border:1px solid #dbe6f5; border-radius:20px; color:#6580a5; background:#fff; font-size:10px; }.task-detail-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin-top:19px; }.task-detail-grid > div { padding:13px; border:1px solid #e4ebf4; border-radius:9px; background:#fff; }.task-detail-grid span { color:#6a81a4; font-size:10px; font-weight:600; }.task-detail-grid p { margin-top:8px; color:var(--muted); font-size:11px; line-height:1.75; }
@media (max-width:1100px) { .task-chain-nodes { grid-template-columns:repeat(3,1fr); }.task-node-arrow { display:block; }.task-detail-grid { grid-template-columns:repeat(3,1fr); } }
@media (max-width:900px) { .task-chain-heading { display:block; }.task-chain-heading > p { margin-top:13px; }.task-chain-nodes { grid-template-columns:repeat(2,1fr); }.task-node-arrow { display:none; }.task-detail-grid { grid-template-columns:repeat(2,1fr); } }
@media (max-width:640px) { .task-chain { padding:20px 17px; border-radius:14px; }.task-chain-heading h2 { font-size:22px; }.task-chain-heading > p { font-size:12px; }.task-chain-nodes { grid-template-columns:1fr; gap:8px; margin-top:20px; }.task-node { padding:13px; }.task-node strong { font-size:13px; }.task-node small { font-size:10px; }.task-detail { margin-top:18px; padding:17px 0 0; }.task-detail-title { display:block; }.task-detail-title h3 { margin-top:7px; font-size:19px; }.task-detail-badges { margin:11px 0 0; }.task-detail-grid { grid-template-columns:1fr; gap:8px; }.task-detail-grid > div { padding:12px; } }
</style>
