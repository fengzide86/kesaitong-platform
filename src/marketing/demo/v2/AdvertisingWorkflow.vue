<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { State } from './model'
import type { WorkflowSubmit } from './workflow-contract'
import { advertisingCandidates, advertisingFingerprint, createAdvertisingDraft,
  type AdvertisingCampaign, type AdvertisingCommand, type AdvertisingData, type AdvertisingProductRef } from './advertising-workflow'
import './advertising-workflow.css'

const props = defineProps<{ state: State; data: AdvertisingData; submit: WorkflowSubmit<AdvertisingCommand>; focusId?: string }>()
const view = ref<'list' | 'type' | 'edit' | 'detail'>('list')
const activeId = ref('')
const baseline = ref('')
const draft = reactive(createAdvertisingDraft())
const working = ref(false)
const error = ref('')
const result = ref('')
const search = ref('')
const productSearch = ref('')
const deliveryFilter = ref('FBA')
const statusFilter = ref('all')
const keywordText = ref('')
const negativeText = ref('')
const active = computed(() => props.data.campaigns.find(item => item.id === activeId.value))
const candidates = computed(() => advertisingCandidates(props.state))
const shownCandidates = computed(() => candidates.value.filter(item => (deliveryFilter.value === 'all' || item.delivery === deliveryFilter.value)
  && `${item.title} ${item.sku} ${item.asin}`.toLocaleLowerCase().includes(productSearch.value.trim().toLocaleLowerCase())))
const shownCampaigns = computed(() => props.data.campaigns.filter(item => (statusFilter.value === 'all' || item.status === statusFilter.value)
  && `${item.name} ${item.groupName}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
const statusLabel = (status: AdvertisingCampaign['status']) => ({ draft: '草稿', scheduled: '已安排', paused: '已暂停' })[status]
const sameRef = (a: AdvertisingProductRef, b: AdvertisingProductRef) => a.productId === b.productId && a.variantId === b.variantId
const isSelected = (item: AdvertisingProductRef) => draft.products.some(ref => sameRef(ref, item))
const candidateTitle = (item: AdvertisingProductRef) => candidates.value.find(ref => sameRef(ref, item))?.title ?? '已保存商品（当前不在候选中）'
const currentRef = (item: AdvertisingProductRef) => candidates.value.some(ref => sameRef(ref, item) && ref.sku === item.sku && ref.asin === item.asin)
const splitLines = (value: string) => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)

function begin() {
  error.value = ''; result.value = ''; activeId.value = ''
  baseline.value = advertisingFingerprint(props.state, props.data)
  Object.assign(draft, createAdvertisingDraft())
  keywordText.value = ''; negativeText.value = ''; productSearch.value = ''; deliveryFilter.value = 'FBA'
  view.value = 'type'
}
function edit(item: AdvertisingCampaign) {
  activeId.value = item.id; error.value = ''; result.value = ''
  baseline.value = advertisingFingerprint(props.state, props.data)
  Object.assign(draft, JSON.parse(JSON.stringify(item)))
  keywordText.value = item.keywords.join('\n'); negativeText.value = item.negativeKeywords.join('\n')
  productSearch.value = ''; deliveryFilter.value = 'FBA'; view.value = 'edit'
}
function detail(item: AdvertisingCampaign) {
  activeId.value = item.id; baseline.value = advertisingFingerprint(props.state, props.data)
  error.value = ''; view.value = 'detail'
}
function addProduct(item: AdvertisingProductRef) {
  if (!isSelected(item)) draft.products.push({ productId: item.productId, variantId: item.variantId, sku: item.sku, asin: item.asin })
}
async function save(publish: boolean) {
  if (working.value) return
  working.value = true; error.value = ''; result.value = ''
  draft.keywords = splitLines(keywordText.value); draft.negativeKeywords = splitLines(negativeText.value)
  try {
    const reply = await props.submit({ type: 'save', campaignId: activeId.value || undefined,
      draft: JSON.parse(JSON.stringify(draft)), publish }, baseline.value)
    if (!reply.ok) { error.value = reply.message; return }
    activeId.value = reply.id ?? ''; result.value = reply.message
    baseline.value = advertisingFingerprint(props.state, props.data); view.value = 'detail'
  } catch { error.value = '保存未完成，请检查本地样例状态后再继续。' }
  finally { working.value = false }
}
async function changeStatus(item: AdvertisingCampaign) {
  if (working.value) return
  working.value = true; error.value = ''; result.value = ''
  const expected = view.value === 'detail' ? baseline.value : advertisingFingerprint(props.state, props.data)
  try {
    const reply = await props.submit({ type: 'status', campaignId: item.id,
      status: item.status === 'paused' ? 'scheduled' : 'paused' }, expected)
    if (!reply.ok) { error.value = reply.message; return }
    result.value = reply.message; baseline.value = advertisingFingerprint(props.state, props.data)
  } catch { error.value = '状态操作未完成，请重新读取列表核对。' }
  finally { working.value = false }
}
function back() { if (!working.value) { view.value = 'list'; error.value = '' } }
watch(() => props.focusId, id => {
  if (id === undefined) return
  const campaign = props.data.campaigns.find(item => item.id === id)
  result.value = ''
  if (id && campaign) { detail(campaign); return }
  activeId.value = id; view.value = 'detail'
  error.value = '未找到指定的广告活动；可能已重置样例，请返回列表重新选择。'
}, { immediate: true })
</script>

<template>
  <section
    class="v2-ad-workflow"
    data-testid="advertising-workflow"
  >
    <div class="v2-ad-heading">
      <h1>{{ view === 'list' ? '广告活动管理' : view === 'type' ? '选择您的广告活动类型' : view === 'detail' ? '广告组详情' : activeId ? '编辑商品推广' : '新建商品推广' }}</h1>
      <button
        v-if="view !== 'list'"
        type="button"
        class="v2-link"
        data-action="ad-back"
        :disabled="working"
        @click="back"
      >
        返回所有广告活动
      </button>
    </div>
    <p class="v2-ad-boundary">
      本机模拟体验 · 不产生广告费用、不影响真实平台。日期时区、手动投放及暂停/恢复采用本地演示规则，不代表真实投放结果。
    </p>
    <p
      v-if="error"
      class="v2-message error"
      role="alert"
      data-testid="advertising-error"
    >
      {{ error }}
    </p>
    <p
      v-if="result"
      class="v2-message"
      role="status"
      data-testid="advertising-result"
    >
      {{ result }}
    </p>

    <template v-if="view === 'list'">
      <nav
        class="v2-inventory-tabs"
        aria-label="广告列表类型"
      >
        <button
          type="button"
          :class="{ active: statusFilter !== 'draft' }"
          data-action="ad-tab-campaigns"
          @click="statusFilter='all'"
        >
          广告活动
        </button>
        <button
          type="button"
          :class="{ active: statusFilter === 'draft' }"
          data-action="ad-tab-drafts"
          @click="statusFilter='draft'"
        >
          草稿
        </button>
      </nav>
      <div class="v2-ad-tools">
        <button
          type="button"
          class="v2-button v2-yellow"
          data-action="ad-create"
          @click="begin"
        >
          创建广告活动
        </button>
        <label><span class="v2-ad-sr-only">搜索广告活动</span><input
          v-model="search"
          name="adSearch"
          placeholder="搜索广告活动或广告组"
        ></label>
        <label>状态 <select
          v-model="statusFilter"
          name="adStatusFilter"
        ><option value="all">所有状态</option><option value="scheduled">已安排</option><option value="paused">已暂停</option><option value="draft">草稿</option></select></label>
      </div>
      <div class="v2-ad-table-wrap">
        <table class="v2-ad-table">
          <thead><tr><th>状态</th><th>广告活动</th><th>类型</th><th>开始 / 结束日期</th><th>预算</th><th>广告组</th><th>操作</th></tr></thead><tbody>
            <tr
              v-for="item in shownCampaigns"
              :key="item.id"
              :data-ad-row="item.id"
            >
              <td>{{ statusLabel(item.status) }}</td><td>
                <button
                  type="button"
                  class="v2-link"
                  :data-ad-detail="item.id"
                  @click="detail(item)"
                >
                  {{ item.name }}
                </button>
              </td><td>商品推广<small>{{ item.targeting === 'automatic' ? '自动投放' : '手动投放' }}</small></td><td>{{ item.startAt.replace('T', ' ') }}<br>{{ item.endAt.replace('T', ' ') }}<small>Asia/Shanghai（样例）</small></td><td>${{ item.budgetUsd.toFixed(2) }} / 每天</td><td>1</td><td>
                <div class="v2-ad-row-actions">
                  <button
                    type="button"
                    class="v2-link"
                    :data-ad-edit="item.id"
                    @click="edit(item)"
                  >
                    编辑
                  </button><button
                    v-if="item.status !== 'draft'"
                    type="button"
                    class="v2-link"
                    :data-ad-toggle="item.id"
                    :disabled="working"
                    @click="changeStatus(item)"
                  >
                    {{ item.status === 'paused' ? '恢复' : '暂停' }}
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!shownCampaigns.length">
              <td
                colspan="7"
                class="v2-empty"
              >
                尚无符合条件的广告活动。创建活动后可从这里查看广告组和商品。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="v2-ad-count">
        共 {{ shownCampaigns.length }} 条活动 · 仅本机样例
      </p>
    </template>

    <section
      v-else-if="view === 'type'"
      class="v2-ad-type"
    >
      <h2>商品推广</h2><p>为具体商品创建广告活动。选择子商品，设置广告组、竞价和预算。</p>
      <ul><li>在同一表单选择商品与投放方式</li><li>保存后回到活动列表与广告组详情核对</li></ul>
      <button
        type="button"
        class="v2-button v2-yellow"
        data-action="ad-continue"
        @click="view='edit'"
      >
        继续
      </button>
    </section>

    <form
      v-else-if="view === 'edit'"
      class="v2-ad-form"
      @submit.prevent="save(true)"
    >
      <fieldset :disabled="working">
        <section class="v2-ad-section">
          <h2>创建广告组</h2><div class="v2-ad-fields">
            <label>广告组名称 <input
              v-model="draft.groupName"
              name="adGroupName"
              maxlength="160"
            ></label>
          </div>
        </section>
        <section class="v2-ad-section">
          <h2>商品</h2>
          <p class="v2-ad-note">
            按子 SKU / 子 ASIN 定位，内部父商品与子变体 ID 一起保存。亚马逊配送只是筛选条件，不等于有 FBA 库存，也不是本地候选的唯一资格。
          </p>
          <div class="v2-ad-tools">
            <input
              v-model="productSearch"
              name="adProductSearch"
              aria-label="搜索子商品"
              placeholder="商品名称、SKU 或子 ASIN"
            ><label>配送方式 <select
              v-model="deliveryFilter"
              name="adDeliveryFilter"
            ><option value="FBA">亚马逊配送</option><option value="FBM">卖家自行配送</option><option value="all">全部</option></select></label>
          </div>
          <div class="v2-ad-products">
            <div>
              <h3>可选商品 · {{ shownCandidates.length }}</h3><ul class="v2-ad-candidate-list">
                <li
                  v-for="item in shownCandidates"
                  :key="item.variantId"
                >
                  <div><strong>{{ item.title }}</strong><span>{{ item.term }} · {{ item.delivery === 'FBA' ? '亚马逊配送' : '卖家自行配送' }}</span><small>SKU {{ item.sku }}<br>子 ASIN（样例）{{ item.asin }}</small><small>刊登数量 {{ item.quantity }} · ${{ item.price.toFixed(2) }}</small><small v-if="item.delivery === 'FBA'">非 FBA 到仓可售数量</small></div><button
                    type="button"
                    class="v2-button"
                    data-action="ad-add-product"
                    :data-ad-product="item.variantId"
                    :disabled="isSelected(item)"
                    @click="addProduct(item)"
                  >
                    {{ isSelected(item) ? '已添加' : '添加' }}
                  </button>
                </li><li
                  v-if="!shownCandidates.length"
                  class="v2-empty"
                >
                  没有匹配的子商品，请检查搜索或配送筛选。
                </li>
              </ul>
            </div>
            <div>
              <h3>已选商品 · {{ draft.products.length }}</h3><ul class="v2-ad-candidate-list">
                <li
                  v-for="item in draft.products"
                  :key="item.variantId"
                >
                  <div>
                    <strong>{{ candidateTitle(item) }}</strong><small>SKU {{ item.sku }}<br>子 ASIN（样例）{{ item.asin }}</small><small
                      v-if="!currentRef(item)"
                      class="v2-ad-warning"
                    >当前商品已变化，请移除后重新选择。</small>
                  </div><button
                    type="button"
                    class="v2-link"
                    data-action="ad-remove-product"
                    :data-ad-remove="item.variantId"
                    @click="draft.products = draft.products.filter(ref => !sameRef(ref, item))"
                  >
                    移除
                  </button>
                </li><li
                  v-if="!draft.products.length"
                  class="v2-empty"
                >
                  请从左侧添加至少一个子商品。
                </li>
              </ul>
            </div>
          </div>
        </section>
        <section class="v2-ad-section">
          <h2>投放</h2><div class="v2-ad-radio">
            <label><input
              v-model="draft.targeting"
              name="adTargeting"
              type="radio"
              value="automatic"
            >自动投放</label><label><input
              v-model="draft.targeting"
              name="adTargeting"
              type="radio"
              value="manual"
            >手动投放</label>
          </div><p class="v2-ad-note">
            自动投放复现已有创建样本；手动关键词、竞价策略、广告位和否定词只保存本地设置，不模拟真实竞价匹配和投放效果。
          </p><div class="v2-ad-fields">
            <label>默认竞价（USD）<input
              v-model.number="draft.defaultBidUsd"
              name="adDefaultBid"
              type="number"
              min="0.01"
              step="0.01"
            ></label><label v-if="draft.targeting === 'manual'">关键词（每行一个）<textarea
              v-model="keywordText"
              name="adKeywords"
              rows="4"
              placeholder="旅行收纳袋"
            /></label>
          </div><details class="v2-ad-advanced">
            <summary>否定关键词（可选）</summary><label>每行一个关键词 <textarea
              v-model="negativeText"
              name="adNegativeKeywords"
              rows="3"
            /></label>
          </details>
        </section>
        <section class="v2-ad-section">
          <h2>广告活动竞价策略</h2><div class="v2-ad-radio v2-ad-radio-column">
            <label><input
              v-model="draft.strategy"
              name="adStrategy"
              type="radio"
              value="down"
            >动态竞价 — 只降低</label><label><input
              v-model="draft.strategy"
              name="adStrategy"
              type="radio"
              value="up-and-down"
            >动态竞价 — 提高和降低</label><label><input
              v-model="draft.strategy"
              name="adStrategy"
              type="radio"
              value="fixed"
            >固定竞价</label>
          </div><details class="v2-ad-advanced">
            <summary>根据广告位调整竞价</summary><div class="v2-ad-fields">
              <label>搜索结果顶部（%）<input
                v-model.number="draft.topOfSearchPercent"
                name="adTopOfSearch"
                type="number"
                min="0"
                max="900"
                step="1"
              ></label><label>商品页面（%）<input
                v-model.number="draft.productPagesPercent"
                name="adProductPages"
                type="number"
                min="0"
                max="900"
                step="1"
              ></label>
            </div>
          </details>
        </section>
        <section class="v2-ad-section">
          <h2>设置</h2><div class="v2-ad-fields">
            <label>广告活动名称 <input
              v-model="draft.name"
              name="adCampaignName"
              maxlength="160"
            ></label><label>开始日期 <input
              v-model="draft.startAt"
              name="adStartAt"
              type="datetime-local"
            ></label><label>结束日期 <input
              v-model="draft.endAt"
              name="adEndAt"
              type="datetime-local"
            ></label><label>日期时区 <select
              v-model="draft.timeZone"
              name="adTimeZone"
            ><option value="Asia/Shanghai">Asia/Shanghai（UTC+08:00，本地样例）</option></select></label><label>国家 / 地区 <span>美国（样例站点）</span></label><label>每日预算（USD）<input
              v-model.number="draft.budgetUsd"
              name="adBudget"
              type="number"
              min="0.01"
              step="0.01"
            ></label>
          </div><p class="v2-ad-note">
            真实平台时区尚未确认。样例明确采用 UTC+08:00，启动时间须晚于当前时间；这不是对真实平台排期的承诺。
          </p>
        </section>
        <footer class="v2-ad-save-footer">
          <button
            type="button"
            class="v2-button"
            data-action="ad-cancel"
            @click="back"
          >
            取消
          </button><button
            v-if="!activeId || active?.status === 'draft'"
            type="button"
            class="v2-button"
            data-action="ad-save-draft"
            @click="save(false)"
          >
            保存为草稿
          </button><button
            type="submit"
            class="v2-button v2-yellow"
            data-action="ad-launch"
          >
            {{ activeId && active?.status !== 'draft' ? '保存修改' : '启动广告活动' }}
          </button>
        </footer>
      </fieldset>
    </form>

    <template v-else-if="view === 'detail' && active">
      <div class="v2-ad-detail-heading">
        <div><h2>{{ active.name }}</h2><p>{{ statusLabel(active.status) }} · 商品推广 / {{ active.targeting === 'automatic' ? '自动投放' : '手动投放' }}</p></div><div class="v2-ad-row-actions">
          <button
            type="button"
            class="v2-button"
            data-action="ad-edit"
            @click="edit(active)"
          >
            编辑活动与广告组
          </button><button
            v-if="active.status !== 'draft'"
            type="button"
            class="v2-button"
            :data-action="active.status === 'paused' ? 'ad-resume' : 'ad-pause'"
            :disabled="working"
            @click="changeStatus(active)"
          >
            {{ active.status === 'paused' ? '恢复活动' : '暂停活动' }}
          </button>
        </div>
      </div>
      <dl class="v2-ad-detail-summary">
        <div><dt>每日预算</dt><dd>${{ active.budgetUsd.toFixed(2) }}</dd></div><div><dt>开始 / 结束</dt><dd>{{ active.startAt.replace('T',' ') }}<br>{{ active.endAt.replace('T',' ') }}<small>Asia/Shanghai（样例）</small></dd></div><div><dt>广告组</dt><dd>{{ active.groupName }}</dd></div><div>
          <dt>默认竞价</dt><dd data-testid="ad-readback-bid">
            ${{ active.defaultBidUsd.toFixed(2) }}
          </dd>
        </div><div>
          <dt>商品数量</dt><dd data-testid="ad-readback-count">
            {{ active.products.length }}
          </dd>
        </div>
      </dl>
      <h2>广告组商品明细</h2><p class="v2-ad-note">
        以下为保存后重新读取的样例记录。子 ASIN 为本地稳定虚构标识，与父商品 ASIN 区分；没有展示量、点击、花费或销量的虚构业绩。
      </p>
      <div class="v2-ad-table-wrap">
        <table
          class="v2-ad-table v2-ad-product-details"
          data-testid="ad-product-details"
        >
          <thead><tr><th>商品</th><th>子 SKU</th><th>子 ASIN</th><th>内部关联</th><th>当前状态</th></tr></thead><tbody>
            <tr
              v-for="item in active.products"
              :key="item.variantId"
              :data-ad-saved-product="item.variantId"
            >
              <td>{{ candidateTitle(item) }}</td><td>{{ item.sku }}</td><td>{{ item.asin }}</td><td><small>父商品：{{ item.productId }}<br>子变体：{{ item.variantId }}</small></td><td>{{ currentRef(item) ? '标识一致' : '商品已变化，历史记录保留' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <section class="v2-ad-section v2-ad-settings-readback">
        <h2>投放设置回读</h2><p>策略：{{ {down:'动态竞价 — 只降低','up-and-down':'动态竞价 — 提高和降低',fixed:'固定竞价'}[active.strategy] }} · 搜索结果顶部 {{ active.topOfSearchPercent }}% · 商品页面 {{ active.productPagesPercent }}%</p><p v-if="active.targeting === 'manual'">
          关键词：{{ active.keywords.join('、') }}
        </p><p>否定关键词：{{ active.negativeKeywords.length ? active.negativeKeywords.join('、') : '未设置' }}</p><small>活动 ID：{{ active.id }}<br>广告组 ID：{{ active.groupId }}</small>
      </section>
    </template>
    <p
      v-else
      class="v2-empty"
    >
      记录已变化，请返回列表重新读取。
    </p>
  </section>
</template>
