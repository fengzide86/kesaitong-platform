<!-- Archived superseded prototype; not a current website entry or build input. -->
<template>
  <MarketingShell>
    <div class="simulation" ref="root" data-testid="simulation">
      <div class="simulation-notice"><span class="notice-tag">独立模拟体验</span><span>所有商品、订单和操作均为本机样例，不影响真实平台。</span><span class="storage-note">{{ temporary ? '临时体验 · 刷新可能不保留' : '样例保存在当前浏览器' }}</span></div>
      <header class="seller-header">
        <button class="seller-brand" data-action="home" @click="navigate('home')"><strong>seller <em>central</em></strong><small>亚马逊 V2 核心流程 · KST 样例</small></button>
        <div class="seller-market">美国站 <span>▾</span></div><div class="seller-account">样例卖家公司<span>无需登录 · 无真实账号</span></div>
      </header>
      <nav class="seller-nav" aria-label="模拟卖家后台导航">
        <button v-for="item in pages" :key="item.id" :data-action="`nav-${item.id}`" :class="{ active: page === item.id }" @click="navigate(item.id)">{{ item.label }}</button>
      </nav>
      <div class="experience-layout">
        <aside class="tool-panel" aria-label="一键模拟工具">
          <div class="tool-panel-title"><span class="kst-dot">K</span><div><strong>课赛通工具体验</strong><small>看工具如何操作同一套页面</small></div></div>
          <label for="simulation-task">选择一个样例任务</label>
          <select id="simulation-task" v-model="task" :disabled="running"><option value="product">商品上架</option><option value="template">配送模板</option><option value="fba">FBA 转换</option><option value="advertising">商品推广</option><option value="shipping">订单发货</option></select>
          <p class="task-description">{{ taskDescription[task] }}</p>
          <button class="button primary full" data-action="run" @click="startTask" :disabled="running">一键演示操作</button>
          <div v-if="running && !fbaProduct" class="run-controls"><button class="button" @click="paused = !paused">{{ paused ? '继续' : '暂停' }}</button><button class="button" @click="stopTask">停止</button></div>
          <div class="run-status" role="status" data-testid="run-status" :class="{ failed: runState === 'failed' }"><span class="status-dot" :class="runState" />{{ paused ? '已暂停，下一个动作等待继续' : runLabel }}</div>
          <ol v-if="steps.length" class="step-list"><li v-for="(step, index) in steps" :key="index" :class="{ done: index < cursor, current: index === cursor && running }"><span>{{ index < cursor ? '✓' : index + 1 }}</span>{{ step.label }}</li></ol>
          <div class="tool-explanation"><strong>不是播放成功动画</strong><p>自动操作会打开页面、填写字段、点击保存，并从列表重新检查结果。你也可以直接手工操作。</p></div>
          <button class="reset-button" @click="resetOpen = true">重置全部样例</button>
          <RouterLink class="back-link" to="/tools">查看真实工具使用范围 →</RouterLink>
        </aside>
        <main class="seller-main" :aria-busy="running && !paused">
          <div class="breadcrumb">样例卖家后台 <span>›</span> {{ pageTitle }}</div>
          <div v-if="notice" class="result-message" :class="{ error: lastError }" role="status" data-testid="form-result">{{ notice }}</div>
          <template v-if="page === 'home'">
            <div class="page-heading"><div><h1>卖家中心</h1><p>从商品发布，到仓库出库和订单确认。</p></div><span class="outline-tag">本地样例工作区</span></div>
            <div class="summary-grid"><div><small>已发布商品</small><strong>{{ state.products.length }}</strong><button @click="navigate('inventory')">管理库存 →</button></div><div><small>亚马逊配送</small><strong>{{ state.products.filter(p => p.delivery === 'FBA').length }}</strong><button @click="navigate('inventory')">查看 FBA →</button></div><div><small>未发货订单</small><strong>{{ state.orders.filter(o => o.status === '未发货').length }}</strong><button @click="navigate('orders')">管理订单 →</button></div></div>
            <div class="home-grid"><section class="seller-card"><h2>熟悉的页面，真正可操作的样例</h2><p>切换商品的不同分页，保存后到库存核对；分拣、打包、出库后，再回到订单回填运单。</p><div class="workflow"><span>发布商品</span><b>→</b><span>库存 / FBA</span><b>→</b><span>推广与发货</span></div><button class="button primary" data-action="new-product" @click="openProduct()">添加新商品</button></section><section class="seller-card sample-card"><SampleProductArt /><div><small>已准备一个虚构样例</small><h3>轻量旅行收纳袋</h3><p>SKU：SAMPLE-BAG-BLUE<br>还有一笔待发货样例订单。</p><button class="text-button" @click="navigate('inventory')">查看商品 →</button></div></section></div>
            <div class="boundary-note"><strong>体验边界</strong><p>这里复现核心导航、表单、列表、弹窗和流程关系，不是完整平台镜像。评分、真实物流报价、结算和外部平台接口不在模拟范围内。</p></div>
          </template>
          <template v-else-if="page === 'inventory'">
            <div class="page-heading"><div><h1>管理库存</h1><p>SKU 是商品、配送方式与推广选择之间的关联。</p></div><button class="button primary" data-action="new-product" @click="openProduct()">添加新商品</button></div>
            <div class="list-toolbar"><div class="filter-tabs"><button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部库存 ({{ state.products.length }})</button><button :class="{ active: filter === 'FBA' }" @click="filter = 'FBA'">亚马逊配送</button><button :class="{ active: filter === 'FBM' }" @click="filter = 'FBM'">卖家配送</button></div></div>
            <div class="table-scroll"><table><thead><tr><th>状态</th><th>商品信息 / SKU</th><th>价格</th><th>可售数量</th><th>配送方式</th><th>操作</th></tr></thead><tbody><tr v-for="product in filteredProducts" :key="product.id" :data-product-id="product.id"><td><span class="state-chip">在售</span></td><td><div class="product-cell"><SampleProductArt /><div><strong>{{ product.title }}</strong><small>SKU：{{ product.sku }}</small><small>ASIN：{{ product.asin }}</small><small>{{ product.variant }}</small></div></div></td><td>USD {{ product.price.toFixed(2) }}</td><td>{{ product.quantity }}</td><td>{{ product.delivery === 'FBA' ? '亚马逊配送 (FBA)' : '卖家配送 (FBM)' }}</td><td><div class="table-actions"><button class="button small" @click="openProduct(product)">编辑</button><button v-if="product.delivery === 'FBM'" class="button small" :data-action="`fba-${product.id}`" @click="openFba(product)">转换为亚马逊配送</button><span v-else class="muted">已转换 FBA</span></div></td></tr><tr v-if="!filteredProducts.length"><td colspan="6" class="empty">此配送方式下没有样例商品。</td></tr></tbody></table></div>
          </template>
          <template v-else-if="page === 'product'">
            <div class="page-heading"><div><h1>{{ productForm.id ? '编辑商品' : '添加新商品' }}</h1><p>{{ productForm.category }} · 美国站 · 样例商品</p></div><button class="button" @click="navigate('inventory')">返回库存</button></div>
            <form @submit.prevent="submitProduct" novalidate data-form="product">
              <nav class="form-tabs" aria-label="商品编辑分页"><button v-for="tab in productTabs" :key="tab.id" type="button" :data-action="`tab-${tab.id}`" :class="{ active: productTab === tab.id }" @click="productTab = tab.id">{{ tab.label }}</button></nav>
              <section v-show="productTab === 'important'" class="seller-card field-section"><h2>重要信息</h2><p class="section-intro">带 * 的字段为本体验的必填项。</p><label>商品名称 *<input v-model="productForm.title" name="title" placeholder="例如：轻量旅行收纳袋" /></label><div class="field-grid"><label>品牌 *<input v-model="productForm.brand" name="brand" /></label><label>商品类目<select v-model="productForm.category" name="category"><option>家居 / 收纳用品</option><option>服饰 / 配件</option></select></label></div><label>制造商<input v-model="manufacturer" name="manufacturer" placeholder="样例制造商（体验辅助字段）" /></label></section>
              <section v-show="productTab === 'variants'" class="seller-card field-section"><h2>变体</h2><p class="section-intro">当前体验使用一个子 SKU，保存后在库存中独立展示。</p><div class="field-grid"><label>颜色 / 尺寸 *<input v-model="productForm.variant" name="variant" placeholder="蓝色 / M" /></label><label>卖家 SKU *<input v-model="productForm.sku" name="sku" placeholder="SAMPLE-NEW-001" /></label><label>价格 (USD) *<input v-model.number="productForm.price" name="price" type="number" min="0.01" step="0.01" /></label><label>数量 *<input v-model.number="productForm.quantity" name="quantity" type="number" min="1" step="1" /></label></div></section>
              <section v-show="productTab === 'offer'" class="seller-card field-section"><h2>报价与配送</h2><div class="field-grid"><label>配送设置 *<select v-model="productForm.templateId" name="templateId"><option v-for="t in state.templates" :key="t.id" :value="t.id">{{ t.name }}</option></select></label><label>商品重量 (kg) *<input v-model.number="productForm.weight" name="weight" type="number" min="0.001" step="0.01" /></label></div><p class="info-box">新商品先采用卖家配送；转换 FBA 在库存列表中独立完成。</p></section>
              <section v-show="productTab === 'compliance'" class="seller-card field-section"><h2>合规信息</h2><label class="checkbox-label"><input v-model="productForm.battery" type="checkbox" name="battery" /> 商品包含电池</label><p class="section-intro">本体验只支持无电池样例转换 FBA。商品合规信息与 FBA 转换确认是不同步骤。</p></section>
              <section v-show="productTab === 'images'" class="seller-card field-section"><h2>图片</h2><div class="image-sample"><SampleProductArt /><div><strong>内置虚构样例图</strong><p>不上传本机文件，不读取真实商品图片。</p><button type="button" class="button" @click="notice = '已选择内置样例图；图片不会上传到任何服务。'; lastError = false">使用样例图</button></div></div></section>
              <section v-show="productTab === 'description'" class="seller-card field-section"><h2>描述与关键字</h2><label>商品描述<textarea v-model="productForm.description" name="description" rows="5" placeholder="记录你的样例描述" /></label><label>搜索关键字<input v-model="keywords" name="keywords" placeholder="体验辅助字段，不模拟评分" /></label></section>
              <div class="form-footer"><span>只保存到此浏览器的样例库存。</span><button class="button primary" data-action="save-product" type="submit">保存并完成</button></div>
            </form>
          </template>
          <template v-else-if="page === 'templates'">
            <div class="page-heading"><div><h1>配送设置</h1><p>配送模板供商品报价页选择，不等同于 FBA 转换。</p></div><button class="button primary" data-action="new-template" @click="openTemplate()">创建新配送模板</button></div>
            <div v-if="!templateEditing" class="template-list"><section v-for="t in state.templates" :key="t.id" class="seller-card template-card" :data-template-id="t.id"><div><h2>{{ t.name }}</h2><p>{{ t.country }} · {{ t.service }} · {{ t.currency }}</p></div><div><small>限重</small><strong>{{ t.limit }} {{ t.unit }}</strong></div><div><small>处理时间</small><strong>{{ t.handling }} 天</strong></div><div><small>样例运费</small><strong>{{ t.base }} + {{ t.perKg }} / kg</strong></div><button class="button" @click="openTemplate(t)">编辑模板</button></section></div>
            <form v-else @submit.prevent="submitTemplate" class="seller-card field-section" data-form="template" novalidate><h2>配送模板规则</h2><label>模板名称 *<input v-model="templateForm.name" name="templateName" /></label><div class="field-grid"><label>国家<select v-model="templateForm.country" name="country"><option>美国</option><option>英国</option><option>德国</option></select></label><label>配送服务<select v-model="templateForm.service" name="service"><option>标准配送</option><option>加急配送</option></select></label><label>重量单位<select v-model="templateForm.unit" name="unit"><option>kg</option></select></label><label>限重 *<input v-model.number="templateForm.limit" name="limit" type="number" min="0.01" step="0.01" /></label><label>币种<select v-model="templateForm.currency" name="currency"><option>USD</option><option>GBP</option><option>EUR</option></select></label><label>处理时间（天） *<input v-model.number="templateForm.handling" name="handling" type="number" min="0" /></label><label>基本运费 *<input v-model.number="templateForm.base" name="base" type="number" min="0" step="0.01" /></label><label>每 kg 运费 *<input v-model.number="templateForm.perKg" name="perKg" type="number" min="0" step="0.01" /></label></div><div class="form-footer"><button type="button" class="button" @click="templateEditing = false">取消</button><button type="submit" class="button primary" data-action="save-template">保存模板</button></div></form>
          </template>
          <template v-else-if="page === 'advertising'">
            <div class="page-heading"><div><h1>广告活动管理</h1><p>商品推广 · 样例预算和投放，不发生真实费用。</p></div><button class="button primary" data-action="new-campaign" @click="openCampaign()">创建广告活动</button></div>
            <form v-if="campaignEditing" class="seller-card field-section" @submit.prevent="submitCampaign" data-form="campaign" novalidate><h2>商品推广</h2><label>活动名称 *<input v-model="campaignForm.name" name="campaignName" /></label><div class="field-grid"><label>每日预算 (USD) *<input v-model.number="campaignForm.budget" name="budget" type="number" min="0.01" step="0.01" /></label><label>默认竞价 (USD) *<input v-model.number="campaignForm.bid" name="bid" type="number" min="0.01" step="0.01" /></label><label>开始日期 *<input v-model="campaignForm.start" name="start" type="date" /></label><label>结束日期 *<input v-model="campaignForm.end" name="end" type="date" /></label><label>投放方式<select v-model="campaignForm.targeting" name="targeting"><option>自动投放</option><option>手动投放</option></select></label><label>选择商品 *<select v-model="campaignForm.productId" name="productId"><option value="">请选择亚马逊配送商品</option><option v-for="p in fbaProducts" :key="p.id" :value="p.id">{{ p.title }} / {{ p.sku }}</option></select></label></div><p class="info-box">日期按样例美国站时区显示；只允许选择已转换 FBA 的样例商品。{{ fbaProducts.length ? '' : '请先到库存完成 FBA 转换。' }}</p><div class="form-footer"><button type="button" class="button" @click="campaignEditing = false">取消</button><button type="submit" class="button primary" data-action="save-campaign">启动样例活动</button></div></form>
            <div v-else class="table-scroll"><table><thead><tr><th>活动名称</th><th>状态</th><th>商品 SKU / ASIN</th><th>每日预算</th><th>竞价 / 投放</th><th>日期</th><th>操作</th></tr></thead><tbody><tr v-for="c in state.campaigns" :key="c.id" :data-campaign-id="c.id"><td><strong>{{ c.name }}</strong></td><td><span class="state-chip">{{ c.status }}</span></td><td>{{ productFor(c.productId)?.sku }}<small>{{ productFor(c.productId)?.asin }}</small></td><td>USD {{ c.budget }}</td><td>{{ c.bid }} / {{ c.targeting }}</td><td>{{ c.start }}<small>至 {{ c.end }}</small></td><td><button class="button small" @click="selectedCampaign = c">查看广告组</button></td></tr><tr v-if="!state.campaigns.length"><td colspan="7" class="empty">尚无样例广告活动。创建活动前请先转换 FBA。</td></tr></tbody></table></div>
          </template>
          <template v-else-if="page === 'orders'">
            <div class="page-heading"><div><h1>管理订单</h1><p>先打开确认页，再到国内仓库处理，最后回填本订单运单。</p></div><span class="outline-tag">未发货 {{ state.orders.filter(o => o.status === '未发货').length }}</span></div>
            <div v-if="!shippingOrder" class="table-scroll"><table><thead><tr><th>订单信息</th><th>商品</th><th>数量 / 国家</th><th>订单状态</th><th>仓库状态</th><th>操作</th></tr></thead><tbody><tr v-for="o in state.orders" :key="o.id" :data-order-id="o.id"><td><strong>{{ o.id }}</strong><small>虚构样例 · 非真实买家</small></td><td>{{ productFor(o.productId)?.title }}<small>{{ productFor(o.productId)?.sku }}</small></td><td>{{ o.quantity }} / {{ o.country }}</td><td><span class="state-chip">{{ o.status }}</span><small v-if="o.tracking">{{ o.tracking }}</small></td><td>{{ o.warehouse }}</td><td><button v-if="o.status === '未发货'" class="button small" :data-action="`ship-${o.id}`" @click="openShipping(o)">确认发货</button><span v-else class="muted">发货已回读</span></td></tr></tbody></table></div>
            <form v-else @submit.prevent="submitShipment" class="seller-card field-section" data-form="shipment" novalidate><h2>确认发货 · {{ shippingOrder.id }}</h2><p>{{ productFor(shippingOrder.productId)?.title }} · {{ shippingOrder.quantity }} 件 · {{ shippingOrder.country }}</p><div class="info-box">打开此页不会完成发货。请先处理国内仓库，再根据该订单的发货记录填写物流信息。</div><button type="button" class="button" data-action="go-warehouse" @click="navigate('warehouse')">前往国内仓库</button><div class="field-grid"><label>承运人 *<select v-model="shippingForm.carrier" name="shipCarrier"><option value="">请选择</option><option>中邮</option><option>E 邮宝</option><option>燕文</option><option>UPS</option></select></label><label>配送服务<input value="标准" readonly /></label><label class="wide">运单号 *<input v-model="shippingForm.tracking" name="shipTracking" placeholder="从本订单仓库发货记录取得" /></label></div><div class="form-footer"><button type="button" class="button" @click="shippingOrder = null">返回订单列表</button><button type="submit" class="button primary" data-action="confirm-shipment">确认发货</button></div></form>
          </template>
          <template v-else-if="page === 'warehouse'">
            <div class="page-heading"><div><h1>国内仓库</h1><p>订单关联不依赖商品显示名称；运单只从同一订单取得。</p></div><button v-if="shippingOrder" class="button" data-action="return-shipment" @click="navigate('orders')">回到 {{ shippingOrder.id }} 确认页</button></div>
            <div class="warehouse-flow"><span :class="{ active: true }">1 分拣产品</span><b>→</b><span>2 开始打包</span><b>→</b><span>3 立即发货</span><b>→</b><span>4 发货记录</span></div>
            <section v-for="o in state.orders" :key="o.id" class="seller-card warehouse-card" :data-warehouse-order="o.id"><div class="warehouse-product"><SampleProductArt /><div><h2>{{ o.id }}</h2><p>{{ productFor(o.productId)?.title }} · {{ o.quantity }} 件</p><span class="outline-tag">{{ o.warehouse }}</span></div></div><div class="warehouse-controls"><button v-if="o.warehouse === '待分拣'" class="button primary" :data-action="`pick-${o.id}`" @click="submitWarehouse(o, 'pick')">分拣产品</button><button v-else-if="o.warehouse === '待打包'" class="button primary" :data-action="`pack-${o.id}`" @click="submitWarehouse(o, 'pack')">打包产品</button><template v-else-if="o.warehouse === '待出库'"><label>承运人<select v-model="warehouseCarrier" name="warehouseCarrier"><option value="">请选择</option><option>中邮</option><option>E 邮宝</option><option>燕文</option><option>UPS</option></select></label><button class="button primary" :data-action="`dispatch-${o.id}`" @click="submitWarehouse(o, 'dispatch')">立即发货</button></template><div v-else class="warehouse-record"><small>发货记录 · {{ o.carrier }}</small><strong :data-tracking-for="o.id">{{ o.tracking }}</strong><span>仅是样例运单，不可用于真实物流。</span></div></div></section>
          </template>
        </main>
      </div>
      <div v-if="fbaProduct" class="modal-backdrop" @click.self="cancelFba">
        <section class="simulation-dialog" role="dialog" aria-modal="true" aria-labelledby="fba-title">
          <div class="dialog-heading"><h2 id="fba-title">转换为亚马逊配送</h2><button aria-label="关闭 FBA 表单" class="text-button" @click="cancelFba">✕</button></div>
          <div v-if="running" class="run-controls"><button class="button" @click="paused = !paused">{{ paused ? '继续' : '暂停' }}</button><button class="button" @click="stopTask">停止</button></div>
          <p>{{ fbaProduct.title }}<small>SKU：{{ fbaProduct.sku }}</small></p>
          <form @submit.prevent="submitFba" data-form="fba"><h3>危险品信息确认</h3><label>商品是否包含电池<select v-model="fbaBattery" name="fbaBattery"><option :value="false">不包含电池</option><option :value="true">包含电池</option></select></label><label class="checkbox-label"><input v-model="fbaConfirmed" type="checkbox" name="fbaConfirmed" /> 我已核对该样例的危险品信息</label><p class="info-box">此转换只改变样例配送方式，不创建真实 FBA 货件。</p><p v-if="lastError" class="inline-error" role="alert">{{ notice }}</p><div class="form-footer"><button class="button" type="button" @click="cancelFba">取消</button><button class="button primary" type="submit" data-action="save-fba">保存并转换</button></div></form>
        </section>
      </div>
      <div v-if="selectedCampaign" class="modal-backdrop" @click.self="selectedCampaign = null"><section class="simulation-dialog" role="dialog" aria-modal="true" aria-label="样例广告组详情"><div class="dialog-heading"><h2>广告组详情</h2><button class="text-button" aria-label="关闭广告组详情" @click="selectedCampaign = null">✕</button></div><h3>{{ selectedCampaign.name }}</h3><dl class="details-list"><dt>内部商品 ID</dt><dd>{{ selectedCampaign.productId }}</dd><dt>SKU</dt><dd>{{ productFor(selectedCampaign.productId)?.sku }}</dd><dt>ASIN</dt><dd>{{ productFor(selectedCampaign.productId)?.asin }}</dd><dt>每日预算</dt><dd>USD {{ selectedCampaign.budget }}</dd><dt>投放方式</dt><dd>{{ selectedCampaign.targeting }}</dd><dt>状态</dt><dd>{{ selectedCampaign.status }}</dd></dl></section></div>
      <div v-if="resetOpen" class="modal-backdrop" @click.self="resetOpen = false"><section class="simulation-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">重置本机样例？</h2><p>这会清除本体验的商品、模板、推广和发货变化，恢复初始样例。不会清理其他网站或软件数据。</p><div class="form-footer"><button class="button" @click="resetOpen = false">取消</button><button class="button primary" data-action="confirm-reset" @click="resetSimulation">确认重置</button></div></section></div>
    </div>
  </MarketingShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import MarketingShell from '@/components/landing/MarketingShell.vue'
import SampleProductArt from './SampleProductArt.vue'
import { SIMULATION_STORAGE_KEY, seedSimulation, readSimulation, newProduct, saveProduct, saveTemplate, convertFba, saveCampaign, warehouseAction, confirmShipment, type Product, type ShippingTemplate, type Campaign, type Order } from './model'

type Page = 'home' | 'inventory' | 'product' | 'templates' | 'advertising' | 'orders' | 'warehouse'
type Task = 'product' | 'template' | 'fba' | 'advertising' | 'shipping'
interface Step { label: string; action: () => void | Promise<void> }
let storage: Storage | undefined
try { storage = window.localStorage } catch { /* Private browsers can deny access. */ }
const initial = readSimulation(storage)
const state = reactive(initial.state)
const temporary = ref(initial.temporary)
const root = ref<HTMLElement>()
const page = ref<Page>('home'), task = ref<Task>('product'), filter = ref('all')
const pages: { id: Page; label: string }[] = [{ id: 'home', label: '首页' }, { id: 'inventory', label: '库存 / FBA' }, { id: 'templates', label: '配送设置' }, { id: 'advertising', label: '广告' }, { id: 'orders', label: '管理订单' }, { id: 'warehouse', label: '国内仓库' }]
const pageTitle = computed(() => page.value === 'product' ? '商品编辑' : pages.find(item => item.id === page.value)?.label)
const taskDescription: Record<Task, string> = { product: '填写商品信息、变体、报价，保存后到库存回读。', template: '配置国家、服务、处理时间和样例运费，保存配送规则。', fba: '从库存转换配送方式，核对危险品表单并回读 FBA 状态。', advertising: '选择已转换 FBA 的商品，配置预算、竞价和投放日期。', shipping: '从管理订单开始，经国内仓库分拣、打包、出库，再回填运单确认。' }
const productTabs = [{ id: 'important', label: '重要信息' }, { id: 'variants', label: '变体' }, { id: 'offer', label: '报价' }, { id: 'compliance', label: '合规信息' }, { id: 'images', label: '图片' }, { id: 'description', label: '描述 / 关键字' }]
const productTab = ref('important')
const productForm = reactive(newProduct())
const manufacturer = computed({ get: () => productForm.manufacturer, set: value => { productForm.manufacturer = value } })
const keywords = computed({ get: () => productForm.keywords, set: value => { productForm.keywords = value } })
const templateEditing = ref(false), campaignEditing = ref(false)
const templateForm = reactive<ShippingTemplate>({ id: '', name: '', country: '美国', service: '标准配送', unit: 'kg', limit: 2, currency: 'USD', handling: 2, base: 0, perKg: 0 })
const campaignForm = reactive<Campaign>({ id: '', name: '', productId: '', budget: 0, bid: 0, start: '', end: '', targeting: '自动投放', status: '投放中' })
const fbaProduct = ref<Product | null>(null), fbaBattery = ref(false), fbaConfirmed = ref(false), selectedCampaign = ref<Campaign | null>(null)
const shippingOrder = ref<Order | null>(null), shippingForm = reactive({ carrier: '', tracking: '' }), warehouseCarrier = ref('')
const resetOpen = ref(false), notice = ref(''), lastError = ref(false)
const dialogOpen = computed(() => !!fbaProduct.value || !!selectedCampaign.value || resetOpen.value)
let beforeDialogFocus: HTMLElement | null = null
watch(dialogOpen, async open => {
  if (open) {
    beforeDialogFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick(); root.value?.querySelector<HTMLElement>('[role="dialog"] button, [role="dialog"] input, [role="dialog"] select')?.focus()
  } else beforeDialogFocus?.focus()
})
function dialogKeys(event: KeyboardEvent): void {
  if (!dialogOpen.value) return
  if (event.key === 'Escape') { event.preventDefault(); if (fbaProduct.value) cancelFba(); selectedCampaign.value = null; resetOpen.value = false; return }
  if (event.key !== 'Tab') return
  const focusable = [...(root.value?.querySelectorAll<HTMLElement>('[role="dialog"] button:not(:disabled), [role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea') || [])]
  const first = focusable[0], last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => document.addEventListener('keydown', dialogKeys))
const filteredProducts = computed(() => state.products.filter(product => filter.value === 'all' || product.delivery === filter.value))
const fbaProducts = computed(() => state.products.filter(product => product.delivery === 'FBA'))
const productFor = (id: string) => state.products.find(p => p.id === id)
const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
function persist(): void {
  try { if (!storage) throw new Error('Unavailable storage'); storage.setItem(SIMULATION_STORAGE_KEY, JSON.stringify(state)); temporary.value = false } catch { temporary.value = true }
}
function result(error: string, success: string): boolean {
  lastError.value = !!error; notice.value = error || success
  if (!error) persist()
  return !error
}
function navigate(target: Page): void { page.value = target; notice.value = ''; lastError.value = false }
function openProduct(product?: Product): void { Object.assign(productForm, product ? { ...product } : newProduct()); productTab.value = 'important'; navigate('product') }
function submitProduct(): void { if (result(saveProduct(state, productForm, makeId('product')), '商品已保存，在库存列表中回读到了新状态。')) page.value = 'inventory' }
function openTemplate(template?: ShippingTemplate): void { Object.assign(templateForm, template ? { ...template } : { id: '', name: '', country: '美国', service: '标准配送', unit: 'kg', limit: 2, currency: 'USD', handling: 2, base: 0, perKg: 0 }); templateEditing.value = true; navigate('templates') }
function submitTemplate(): void { if (result(saveTemplate(state, templateForm, makeId('template')), '配送模板已保存，可在商品报价页选择。')) templateEditing.value = false }
function openFba(product: Product): void { fbaProduct.value = product; fbaBattery.value = product.battery; fbaConfirmed.value = false; notice.value = ''; lastError.value = false }
function cancelFba(): void { fbaProduct.value = null; if (running.value) stopTask() }
function submitFba(): void { if (fbaProduct.value && result(convertFba(state, fbaProduct.value.id, fbaConfirmed.value, fbaBattery.value), '配送方式已转换，库存已回读为亚马逊配送 (FBA)。')) fbaProduct.value = null }
function openCampaign(): void { Object.assign(campaignForm, { id: '', name: '', productId: '', budget: 0, bid: 0, start: '', end: '', targeting: '自动投放', status: '投放中' }); campaignEditing.value = true; navigate('advertising') }
function submitCampaign(): void { if (result(saveCampaign(state, campaignForm, makeId('campaign')), '样例活动已保存，列表中已回读预算、商品和投放状态。')) campaignEditing.value = false }
function openShipping(order: Order): void { shippingOrder.value = order; shippingForm.carrier = ''; shippingForm.tracking = ''; navigate('orders') }
function submitWarehouse(order: Order, action: 'pick' | 'pack' | 'dispatch'): void { result(warehouseAction(state, order.id, action, warehouseCarrier.value), `订单 ${order.id} 已回读为${order.warehouse}。`) }
function submitShipment(): void { if (shippingOrder.value && result(confirmShipment(state, shippingOrder.value.id, shippingForm.carrier, shippingForm.tracking), '订单已确认发货，列表中已回读本订单状态和运单。')) shippingOrder.value = null }

// The public demo drives DOM fields and the very same form submissions used by
// a human. The pacing delay makes actions observable; it never creates success.
const running = ref(false), paused = ref(false), steps = ref<Step[]>([]), cursor = ref(0)
const runState = ref<'idle' | 'running' | 'complete' | 'stopped' | 'failed'>('idle')
const runLabel = computed(() => ({ idle: '可以手动操作，也可以一键体验', running: '正在操作当前样例页面', complete: '已完成 · 列表状态核对通过', stopped: '已停止 · 已保存的样例变化保留', failed: '未完成 · 请查看页面提示后重试' })[runState.value])
let generation = 0
function stopTask(): void { generation++; running.value = false; paused.value = false; runState.value = 'stopped' }
async function ready(): Promise<void> { await nextTick(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) }
function element<T extends HTMLElement>(selector: string): T { const node = root.value?.querySelector<T>(selector); if (!node) throw new Error('页面操作位置已变化，请停止后重新开始。'); return node }
function click(action: string): void { const button = element<HTMLButtonElement>(`[data-action="${action}"]`); if (button.disabled) throw new Error('当前按钮不可用。'); button.click() }
function fill(name: string, value: string): void {
  const field = element<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)
  field.focus(); field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }))
}
function checkSaved(predicate: boolean): void { if (lastError.value || !predicate) throw new Error(notice.value || '保存后没有读回预期状态，演示已停止。') }
function buildSteps(selected: Task): Step[] {
  const suffix = makeId('demo').split('-').slice(1).join('-')
  const sku = `SAMPLE-${suffix.toUpperCase()}`, templateName = `样例配送 ${suffix}`, campaignName = `样例推广 ${suffix}`
  if (selected === 'product') return [
    { label: '打开添加商品页', action: () => click('new-product') },
    { label: '填写重要信息', action: () => { fill('title', '轻量旅行收纳袋 · 一键样例'); fill('brand', 'KST Sample') } },
    { label: '填写变体、SKU、价格和数量', action: async () => { click('tab-variants'); await ready(); fill('variant', '蓝色 / M'); fill('sku', sku); fill('price', '19.9'); fill('quantity', '60') } },
    { label: '选择配送模板并填写重量', action: async () => { click('tab-offer'); await ready(); fill('templateId', state.templates[0]!.id); fill('weight', '0.25') } },
    { label: '填写商品描述', action: async () => { click('tab-description'); await ready(); fill('description', '虚构样例收纳袋，用于演示商品发布流程。') } },
    { label: '点击保存并完成', action: () => click('save-product') },
    { label: '从库存核对 SKU 和在售状态', action: () => checkSaved(state.products.some(p => p.sku === sku && p.published && p.quantity === 60)) },
  ]
  if (selected === 'template') return [
    { label: '打开配送设置', action: () => click('nav-templates') }, { label: '创建配送模板', action: () => click('new-template') },
    { label: '填写国家、服务和处理时间', action: () => { fill('templateName', templateName); fill('country', '美国'); fill('service', '标准配送'); fill('unit', 'kg'); fill('currency', 'USD'); fill('handling', '2') } },
    { label: '填写限重和样例运费', action: () => { fill('limit', '2'); fill('base', '3'); fill('perKg', '5') } },
    { label: '保存配送模板', action: () => click('save-template') }, { label: '从列表回读模板规则', action: () => checkSaved(state.templates.some(t => t.name === templateName && t.limit === 2 && t.handling === 2)) },
  ]
  if (selected === 'fba') {
    const product = state.products.find(p => p.delivery === 'FBM' && !p.battery)
    if (!product) throw new Error('没有待转换的无电池商品；可以先发布新样例商品，或重置样例。')
    return [{ label: '进入库存管理', action: () => { filter.value = 'all'; click('nav-inventory') } }, { label: '打开 FBA 转换表单', action: () => click(`fba-${product.id}`) }, { label: '填写并确认危险品信息', action: () => { fill('fbaBattery', 'false'); const field = element<HTMLInputElement>('[name="fbaConfirmed"]'); if (!field.checked) field.click() } }, { label: '保存并转换配送方式', action: () => click('save-fba') }, { label: '从库存回读 FBA 状态', action: () => checkSaved(productFor(product.id)?.delivery === 'FBA') }]
  }
  if (selected === 'advertising') {
    const product = fbaProducts.value[0]
    if (!product) throw new Error('请先运行 FBA 转换，推广表单只显示亚马逊配送商品。')
    return [{ label: '打开商品推广创建页', action: async () => { click('nav-advertising'); await ready(); click('new-campaign') } }, { label: '填写活动、预算和竞价', action: () => { fill('campaignName', campaignName); fill('budget', '10'); fill('bid', '0.5') } }, { label: '选择日期、投放方式与 FBA 商品', action: () => { fill('start', '2026-10-01'); fill('end', '2026-12-31'); fill('targeting', '自动投放'); fill('productId', product.id) } }, { label: '启动样例活动', action: () => click('save-campaign') }, { label: '回读活动与 SKU / ASIN 关联', action: () => checkSaved(state.campaigns.some(c => c.name === campaignName && c.productId === product.id && c.budget === 10 && c.status === '投放中')) }]
  }
  const order = state.orders.find(o => o.status === '未发货')
  if (!order) throw new Error('样例订单已经完成；请重置样例后再次体验完整发货链路。')
  const orderId = order.id
  const list: Step[] = [{ label: '从管理订单打开确认页', action: async () => { click('nav-orders'); await ready(); click(`ship-${orderId}`) } }, { label: '前往国内仓库', action: () => click('go-warehouse') }]
  if (order.warehouse === '待分拣') list.push({ label: '分拣本订单产品', action: () => click(`pick-${orderId}`) })
  if (['待分拣', '待打包'].includes(order.warehouse)) list.push({ label: '打包本订单产品', action: () => click(`pack-${orderId}`) })
  if (order.warehouse !== '已出库') list.push({ label: '选择承运人并出库', action: () => { fill('warehouseCarrier', '中邮'); click(`dispatch-${orderId}`) } })
  list.push({ label: '从同一订单取得仓库运单', action: () => checkSaved(order.warehouse === '已出库' && !!element<HTMLElement>(`[data-tracking-for="${orderId}"]`).textContent?.trim()) }, { label: '回到确认页填写承运人和运单', action: async () => { const tracking = element<HTMLElement>(`[data-tracking-for="${orderId}"]`).textContent!.trim(); click('return-shipment'); await ready(); fill('shipCarrier', order.carrier); fill('shipTracking', tracking) } }, { label: '点击最终确认发货', action: () => click('confirm-shipment') }, { label: '从订单列表核对已发货状态', action: () => checkSaved(state.orders.find(o => o.id === orderId)?.status === '已发货') })
  return list
}
async function startTask(): Promise<void> {
  if (running.value) return
  const run = ++generation
  notice.value = ''; lastError.value = false; paused.value = false; cursor.value = 0
  try {
    // Return to a known entry through an actual navigation control.
    fbaProduct.value = null; selectedCampaign.value = null; shippingOrder.value = null
    click('home'); await ready(); steps.value = buildSteps(task.value); running.value = true; runState.value = 'running'
    for (let index = 0; index < steps.value.length; index++) {
      while (paused.value && run === generation) await new Promise(resolve => setTimeout(resolve, 80))
      if (run !== generation) return
      cursor.value = index; await steps.value[index]!.action(); await ready()
      if (lastError.value) throw new Error(notice.value)
      cursor.value = index + 1
      await new Promise(resolve => setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : 500))
    }
    if (run !== generation) return
    runState.value = 'complete'; running.value = false
  } catch (error) {
    if (run !== generation) return
    notice.value = error instanceof Error ? error.message : '当前操作未完成。'; lastError.value = true; runState.value = 'failed'; running.value = false
  }
}
function resetSimulation(): void { stopTask(); Object.assign(state, seedSimulation()); try { storage?.removeItem(SIMULATION_STORAGE_KEY) } catch { temporary.value = true }; fbaProduct.value = null; selectedCampaign.value = null; shippingOrder.value = null; templateEditing.value = false; campaignEditing.value = false; resetOpen.value = false; steps.value = []; runState.value = 'idle'; navigate('home'); notice.value = '已恢复初始样例，只清理了本体验的数据。' }
onBeforeUnmount(() => { generation++; document.removeEventListener('keydown', dialogKeys) })
</script>

<style scoped src="./simulation.css" />
