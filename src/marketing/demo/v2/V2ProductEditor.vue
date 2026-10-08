<template>
  <div ref="editorRoot" class="v2-product-editor" data-testid="v2-product-editor">
    <header class="v2-editor-heading">
      <h1>编辑产品</h1>
      <button type="button" class="v2-editor-button" data-action="cancel-product" @click="emit('cancel')">返回库存</button>
    </header>

    <div class="v2-product-summary">
      <div class="v2-summary-image"><V2ProductImage :title="draft.title" :image="draft.images[0]" :color="draft.variants[0]?.color" /></div>
      <dl>
        <div><dt>UPC / 商品编号：</dt><dd>{{ draft.variants.find(row => !row.deleted)?.code || '尚未填写' }}</dd></div>
        <div><dt>商品名称：</dt><dd>{{ draft.title || '未命名样例商品' }}</dd></div>
        <div><dt>品牌：</dt><dd>{{ draft.brand || '尚未填写' }}</dd></div>
        <div><dt>类目：</dt><dd>{{ draft.categoryName }}</dd></div>
        <div><dt>市场：</dt><dd>美国站（本地样例）</dd></div>
        <div><dt>价格：</dt><dd>{{ priceSummary }}</dd></div>
      </dl>
      <div class="v2-parent-sku" data-field="parentSku">
        <label for="v2-parent-sku">父商品 SKU <span class="v2-required">*</span></label>
        <input id="v2-parent-sku" v-model="draft.parentSku" name="parentSku" :aria-invalid="!!fieldError('parentSku')" @input="dismissError('parentSku')" />
        <small>父商品关联标识；子 SKU 在“变体”页独立填写。</small>
        <small v-if="fieldError('parentSku')" class="v2-field-error">{{ fieldError('parentSku') }}</small>
      </div>
      <span class="v2-offline-link">在亚马逊上查看商品信息 <small>本地样例，无外部链接</small></span>
    </div>

    <form novalidate data-form="product" @submit.prevent="save(true)" @input="dismissFromEvent">
      <nav class="v2-editor-tabs" aria-label="商品编辑分页" role="tablist">
        <button v-for="tab in tabs" :id="`v2-tab-${tab.id}`" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id" :aria-controls="`v2-panel-${tab.id}`" :data-action="`tab-${tab.id}`" :class="{ 'v2-tab-active': activeTab === tab.id }" @click="setTab(tab.id)">
          {{ tab.label }}<span v-if="errorCount(tab.id)" class="v2-tab-error-count">{{ errorCount(tab.id) }}</span>
        </button>
      </nav>

      <div v-if="allErrors.length" class="v2-error-summary" role="alert" data-testid="product-errors">
        <strong>请检查以下字段：</strong>
        <button v-for="error in allErrors" :key="`${error.tab}-${error.field}`" type="button" @click="jumpToError(error)">{{ tabLabel(error.tab) }} · {{ error.message }}</button>
      </div>
      <p v-if="feedback" class="v2-editor-feedback" role="status">{{ feedback }}</p>

      <section v-show="activeTab === 'important'" id="v2-panel-important" class="v2-editor-panel" role="tabpanel" aria-labelledby="v2-tab-important">
        <p class="v2-panel-help">带 <span class="v2-required">*</span> 的项目用于本地样例完成检查，不代表原平台全部必填规则。</p>
        <div class="v2-form-row" data-field="id"><label for="v2-product-id">商品编号</label><div class="v2-form-control"><select id="v2-product-id" name="productId" disabled><option>{{ draft.id }}（1688 来源选择器）</option></select></div></div>
        <div class="v2-form-row" data-field="title"><label for="v2-product-title">商品名称 <span class="v2-required">*</span></label><div class="v2-form-control"><input id="v2-product-title" v-model="draft.title" name="title" :aria-invalid="!!fieldError('title')" /><small v-if="fieldError('title')" class="v2-field-error">{{ fieldError('title') }}</small></div></div>
        <div class="v2-form-row" data-field="brand"><label for="v2-product-brand">品牌 <span class="v2-required">*</span></label><div class="v2-form-control"><input id="v2-product-brand" v-model="draft.brand" name="brand" :aria-invalid="!!fieldError('brand')" /><small v-if="fieldError('brand')" class="v2-field-error">{{ fieldError('brand') }}</small></div></div>
        <div class="v2-form-row" data-field="manufacturer"><label for="v2-product-manufacturer">制造商 <span class="v2-required">*</span></label><div class="v2-form-control"><input id="v2-product-manufacturer" v-model="draft.manufacturer" name="manufacturer" :aria-invalid="!!fieldError('manufacturer')" /><small v-if="fieldError('manufacturer')" class="v2-field-error">{{ fieldError('manufacturer') }}</small></div></div>
        <div class="v2-form-row" data-field="partNumber"><label for="v2-product-part-number">制造商零件号</label><div class="v2-form-control"><input id="v2-product-part-number" v-model="draft.partNumber" name="partNumber" /><small v-if="fieldError('partNumber')" class="v2-field-error">{{ fieldError('partNumber') }}</small></div></div>
        <p v-if="fieldError('categoryId')" class="v2-field-error" data-field="categoryId">{{ fieldError('categoryId') }}</p>
      </section>

      <section v-show="activeTab === 'variants'" id="v2-panel-variants" class="v2-editor-panel v2-variant-panel" role="tabpanel" aria-labelledby="v2-tab-variants" data-field="variants">
        <div class="v2-form-row" data-field="variantTheme"><label for="v2-variant-theme">变体主题 <span class="v2-required">*</span></label><div class="v2-form-control"><select id="v2-variant-theme" v-model="draft.variantTheme" name="variantTheme"><option value="">请选择变体主题</option><option v-for="theme in VARIANT_THEMES" :key="theme">{{ theme }}</option></select><small v-if="fieldError('variantTheme')" class="v2-field-error">{{ fieldError('variantTheme') }}</small></div></div>
        <div class="v2-form-row"><label for="v2-variant-terms">变体术语</label><div class="v2-form-control v2-inline-controls"><input id="v2-variant-terms" v-model="variantTerms" name="variantTerms" placeholder="例如：海蓝色 / M, 浅灰色 / L" @keydown.enter.prevent="addVariants" /><button type="button" class="v2-editor-button" data-action="add-variants" @click="addVariants">添加变体</button><small>多个术语用逗号分隔；各行单独维护子 SKU。</small></div></div>
        <div class="v2-variant-toolbar"><span>父商品 SKU：<strong>{{ draft.parentSku || '尚未填写' }}</strong>　有效变体 {{ draft.variants.filter(row => !row.deleted).length }} 条</span><div><button type="button" class="v2-editor-button" data-action="apply-variants" @click="applyVariants">应用更改</button><button type="button" class="v2-editor-button" data-action="delete-selected-variants" :disabled="!selectedIds.length" @click="softDeleteSelected">删除已选</button><button type="button" class="v2-editor-button" data-action="restore-selected-variants" :disabled="!selectedIds.length" @click="restoreSelected">恢复已选</button></div></div>
        <small class="v2-panel-help">删除已选只标记当前本地样例行，可勾选后恢复；页面底部保存才写入浏览器样例。</small>
        <small v-if="fieldError('variants')" class="v2-field-error">{{ fieldError('variants') }}</small>
        <div class="v2-variant-scroll" tabindex="0" aria-label="变体表格，可横向滚动">
          <table class="v2-variant-table">
            <thead><tr><th class="v2-select-column"><input type="checkbox" aria-label="选择全部变体" :checked="allSelected" @change="selectAll" /></th><th>变体术语</th><th>色卡</th><th>卖家 SKU <span class="v2-required">*</span></th><th>商品编码 <span class="v2-required">*</span></th><th>商品编码类型</th><th>状况</th><th>状况说明</th><th>价格 (USD) <span class="v2-required">*</span></th><th>数量</th><th>SKU 图片</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="(variant, index) in draft.variants" :key="variant.id" :data-variant-id="variant.id" :class="{ 'v2-variant-deleted': variant.deleted }">
                <td><input v-model="selectedIds" type="checkbox" :value="variant.id" :aria-label="`选择变体 ${index + 1}`" /><small v-if="variant.deleted" class="v2-deleted-mark">已删除</small></td>
                <td><label class="v2-cell-label" :data-field="variantField(variant, 'term')"><span class="v2-sr-only">变体术语 {{ index + 1 }}</span><input v-model="variant.term" :name="`variantTerm-${index}`" :disabled="variant.deleted" :aria-invalid="!!fieldError(variantField(variant, 'term'))" /><small v-if="fieldError(variantField(variant, 'term'))" class="v2-field-error">{{ fieldError(variantField(variant, 'term')) }}</small></label><small>{{ variant.size ? `尺寸：${variant.size}` : '子商品' }}</small></td>
                <td><label class="v2-cell-label"><span class="v2-sr-only">色卡 {{ index + 1 }}</span><input type="color" :value="swatchFor(variant.color)" :name="`variantColor-${index}`" :disabled="variant.deleted" @input="setVariantColor(variant, $event)" /><small>{{ variant.color || '未指定' }}</small></label></td>
                <td><label class="v2-cell-label" :data-field="variantField(variant, 'sku')"><span class="v2-sr-only">卖家 SKU {{ index + 1 }}</span><input v-model="variant.sku" :name="`variantSku-${index}`" :disabled="variant.deleted" :aria-invalid="!!fieldError(variantField(variant, 'sku'))" /><small v-if="fieldError(variantField(variant, 'sku'))" class="v2-field-error">{{ fieldError(variantField(variant, 'sku')) }}</small></label></td>
                <td><label class="v2-cell-label" :data-field="variantField(variant, 'code')"><span class="v2-sr-only">商品编码 {{ index + 1 }}</span><input v-model="variant.code" :name="`variantCode-${index}`" :disabled="variant.deleted" :aria-invalid="!!fieldError(variantField(variant, 'code'))" /><small v-if="fieldError(variantField(variant, 'code'))" class="v2-field-error">{{ fieldError(variantField(variant, 'code')) }}</small></label></td>
                <td><label class="v2-cell-label" :data-field="variantField(variant, 'codeType')"><span class="v2-sr-only">商品编码类型 {{ index + 1 }}</span><select v-model="variant.codeType" :name="`variantCodeType-${index}`" :disabled="variant.deleted"><option v-for="type in CODE_TYPES" :key="type">{{ type }}</option></select><small v-if="fieldError(variantField(variant, 'codeType'))" class="v2-field-error">{{ fieldError(variantField(variant, 'codeType')) }}</small></label></td>
                <td><label class="v2-cell-label" :data-field="variantField(variant, 'condition')"><span class="v2-sr-only">状况 {{ index + 1 }}</span><select v-model="variant.condition" :name="`variantCondition-${index}`" :disabled="variant.deleted"><option v-for="condition in CONDITIONS" :key="condition">{{ condition }}</option></select><small v-if="fieldError(variantField(variant, 'condition'))" class="v2-field-error">{{ fieldError(variantField(variant, 'condition')) }}</small></label></td>
                <td><label class="v2-cell-label"><span class="v2-sr-only">状况说明 {{ index + 1 }}</span><input v-model="variant.conditionNote" :name="`variantConditionNote-${index}`" :disabled="variant.deleted" /></label></td>
                <td><label class="v2-cell-label" :data-field="variantField(variant, 'price')"><span class="v2-sr-only">价格 USD {{ index + 1 }}</span><input v-model.number="variant.price" :name="`variantPrice-${index}`" type="number" min="0" step="0.01" :disabled="variant.deleted" :aria-invalid="!!fieldError(variantField(variant, 'price'))" /><small v-if="fieldError(variantField(variant, 'price'))" class="v2-field-error">{{ fieldError(variantField(variant, 'price')) }}</small></label></td>
                <td><label class="v2-cell-label" :data-field="variantField(variant, 'quantity')"><span class="v2-sr-only">数量 {{ index + 1 }}</span><input v-model.number="variant.quantity" :name="`variantQuantity-${index}`" type="number" min="0" step="1" :disabled="variant.deleted" :aria-invalid="!!fieldError(variantField(variant, 'quantity'))" /><small v-if="fieldError(variantField(variant, 'quantity'))" class="v2-field-error">{{ fieldError(variantField(variant, 'quantity')) }}</small></label></td>
                <td><div class="v2-sku-upload" :data-field="variantField(variant, 'image')"><V2ProductImage :title="`${draft.title} ${variant.term}`" :image="variant.image" :color="variant.color" /><label class="v2-upload-link">上传<input :name="`variantImage-${index}`" type="file" accept="image/png,image/jpeg,image/webp" :disabled="variant.deleted" :aria-label="`上传 SKU 图片 ${index + 1}`" @change="uploadVariantImage(variant, $event)" /></label><button v-if="variant.image" type="button" class="v2-text-button" :disabled="variant.deleted" @click="variant.image = ''">移除</button><small v-if="fieldError(variantField(variant, 'image'))" class="v2-field-error">{{ fieldError(variantField(variant, 'image')) }}</small></div></td>
                <td><button type="button" class="v2-editor-button" :data-action="`save-variant-${index}`" :disabled="variant.deleted" @click="saveVariant(variant)">保存</button><small v-if="savedRows.includes(variant.id)" class="v2-row-saved">行已应用</small><small>{{ variant.delivery }} · {{ variant.status === 'active' ? '在售' : '非在售' }}</small></td>
              </tr>
              <tr v-if="!draft.variants.length"><td colspan="12" class="v2-empty-variants">尚无变体，请输入术语后添加。</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-show="activeTab === 'offer'" id="v2-panel-offer" class="v2-editor-panel" role="tabpanel" aria-labelledby="v2-tab-offer">
        <div class="v2-form-row" data-field="offer.maxOrderQuantity"><label for="v2-max-order">订单商品最大数量</label><div class="v2-form-control"><input id="v2-max-order" v-model.number="draft.offer.maxOrderQuantity" name="maxOrderQuantity" type="number" min="0" step="1" /><small v-if="fieldError('offer.maxOrderQuantity')" class="v2-field-error">{{ fieldError('offer.maxOrderQuantity') }}</small></div></div>
        <div class="v2-form-row" data-field="offer.templateId"><label for="v2-template">配送设置 <span class="v2-required">*</span></label><div class="v2-form-control"><select id="v2-template" v-model="draft.offer.templateId" name="templateId" :aria-invalid="!!fieldError('offer.templateId')"><option value="">请选择配送模板</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option></select><small>配送模板与报价关联；全局模板管理在“配送设置”中。</small><small v-if="fieldError('offer.templateId')" class="v2-field-error">{{ fieldError('offer.templateId') }}</small></div></div>
        <div class="v2-form-row" data-field="offer.manufacturerPrice"><label for="v2-msrp">制造商建议零售价</label><div class="v2-form-control v2-unit-control"><input id="v2-msrp" v-model.number="draft.offer.manufacturerPrice" name="manufacturerPrice" type="number" min="0" step="0.01" /><span>USD</span><small v-if="fieldError('offer.manufacturerPrice')" class="v2-field-error">{{ fieldError('offer.manufacturerPrice') }}</small></div></div>
        <div class="v2-form-row" data-field="offer.handlingTime"><label for="v2-handling">处理时间</label><div class="v2-form-control v2-unit-control"><input id="v2-handling" v-model.number="draft.offer.handlingTime" name="handlingTime" type="number" min="0" step="1" /><span>天</span><small v-if="fieldError('offer.handlingTime')" class="v2-field-error">{{ fieldError('offer.handlingTime') }}</small></div></div>
        <div class="v2-form-row" data-field="offer.restockDate"><label for="v2-restock">补货日期</label><div class="v2-form-control"><input id="v2-restock" v-model="draft.offer.restockDate" name="restockDate" type="date" /><small v-if="fieldError('offer.restockDate')" class="v2-field-error">{{ fieldError('offer.restockDate') }}</small></div></div>
        <div class="v2-form-row" data-field="offer.taxCode"><label for="v2-tax-code">产品税代码</label><div class="v2-form-control"><input id="v2-tax-code" v-model="draft.offer.taxCode" name="taxCode" /></div></div>
        <div class="v2-form-row"><label for="v2-gift-message">是否提供礼品信息</label><div class="v2-form-control"><select id="v2-gift-message" v-model="draft.offer.giftMessage" name="giftMessage"><option :value="false">否</option><option :value="true">是</option></select></div></div>
        <div class="v2-form-row"><label for="v2-gift-wrap">是否提供礼品包装</label><div class="v2-form-control"><select id="v2-gift-wrap" v-model="draft.offer.giftWrap" name="giftWrap"><option :value="false">否</option><option :value="true">是</option></select></div></div>
        <div class="v2-form-row" data-field="offer.startSaleDate"><label for="v2-start-sale">开始销售日期</label><div class="v2-form-control"><input id="v2-start-sale" v-model="draft.offer.startSaleDate" name="startSaleDate" type="date" /><small v-if="fieldError('offer.startSaleDate')" class="v2-field-error">{{ fieldError('offer.startSaleDate') }}</small></div></div>
      </section>

      <section v-show="activeTab === 'compliance'" id="v2-panel-compliance" class="v2-editor-panel" role="tabpanel" aria-labelledby="v2-tab-compliance">
        <p class="v2-panel-help">这里保存商品合规字段，不是 FBA 货件危险品确认。枚举为本地示例，不进行法规合规判断。</p>
        <h2 class="v2-field-group-heading">重量和电池信息</h2>
        <div v-for="field in batteryFields" :key="field.key" class="v2-form-row" :data-field="`compliance.${field.key}`"><label :for="`v2-compliance-${field.key}`">{{ field.label }} <span v-if="field.key === 'itemWeight'" class="v2-required">*</span></label><div class="v2-form-control v2-unit-control"><select v-if="field.options" :id="`v2-compliance-${field.key}`" :value="getCompliance(field.key)" :name="field.key" @change="setCompliance(field.key, $event)"><option value="">请选择</option><option v-for="option in field.options" :key="option">{{ option }}</option></select><input v-else :id="`v2-compliance-${field.key}`" :value="getCompliance(field.key)" :name="field.key === 'itemWeight' ? 'weight' : field.key" :type="field.type || 'text'" :min="field.type === 'number' ? 0 : undefined" step="any" :aria-invalid="!!fieldError(`compliance.${field.key}`)" @input="setCompliance(field.key, $event)" /><select v-if="field.unit" :value="getCompliance(field.unit)" :name="field.unit" :aria-label="`${field.label}单位`" @change="setCompliance(field.unit, $event)"><option v-for="unit in field.units" :key="unit">{{ unit }}</option></select><small v-if="fieldError(`compliance.${field.key}`)" class="v2-field-error">{{ fieldError(`compliance.${field.key}`) }}</small></div></div>
        <div class="v2-form-row"><label for="v2-batteries-included">是否附带电池</label><div class="v2-form-control"><select id="v2-batteries-included" v-model="draft.compliance.batteriesIncluded" name="batteriesIncluded"><option :value="false">否</option><option :value="true">是</option></select></div></div>
        <div class="v2-form-row"><label for="v2-battery-required">商品使用电池 / 本身是电池</label><div class="v2-form-control"><select id="v2-battery-required" v-model="draft.compliance.batteryRequired" name="batteryRequired"><option :value="false">否</option><option :value="true">是</option></select></div></div>
        <h2 class="v2-field-group-heading">危险品相关法规</h2>
        <div class="v2-form-row"><span class="v2-form-label">危险品相关法规</span><div class="v2-form-control v2-checkbox-options"><label v-for="regulation in hazardOptions" :key="regulation"><input v-model="draft.compliance.hazardousRegulations" name="hazardousRegulations" type="checkbox" :value="regulation" />{{ regulation }}</label></div></div>
        <div v-for="field in hazardFields" :key="field.key" class="v2-form-row" :data-field="`compliance.${field.key}`"><label :for="`v2-compliance-${field.key}`">{{ field.label }}</label><div class="v2-form-control"><input :id="`v2-compliance-${field.key}`" :value="getCompliance(field.key)" :name="field.key" :type="field.type || 'text'" step="any" @input="setCompliance(field.key, $event)" /><small v-if="field.key === 'sdsUrl'">仅保存文本，不访问或加载该地址。</small><small v-if="fieldError(`compliance.${field.key}`)" class="v2-field-error">{{ fieldError(`compliance.${field.key}`) }}</small></div></div>
        <div class="v2-form-row"><span class="v2-form-label">分类 / GHS 图形符号</span><div class="v2-form-control"><div v-for="(_, index) in draft.compliance.ghsSymbols" :key="index" class="v2-repeat-row"><label :for="`v2-ghs-${index}`" class="v2-sr-only">GHS 图形符号 {{ index + 1 }}</label><select :id="`v2-ghs-${index}`" v-model="draft.compliance.ghsSymbols[index]" :name="`ghsSymbol-${index}`"><option value="">请选择</option><option v-for="symbol in ghsOptions" :key="symbol">{{ symbol }}</option></select><button type="button" class="v2-editor-button" :aria-label="`删除 GHS 图形符号 ${index + 1}`" @click="draft.compliance.ghsSymbols.splice(index, 1)">删除</button></div><button type="button" class="v2-editor-button" data-action="add-ghs" @click="draft.compliance.ghsSymbols.push('')">添加图形符号</button></div></div>
        <div class="v2-form-row"><label for="v2-proposition65">California Proposition 65 Warning Type</label><div class="v2-form-control"><select id="v2-proposition65" v-model="draft.compliance.proposition65Warning" name="proposition65Warning"><option value="">请选择</option><option>Not Applicable</option><option>Cancer</option><option>Reproductive Harm</option><option>Cancer and Reproductive Harm</option></select></div></div>
        <div class="v2-form-row"><span class="v2-form-label">California Proposition 65 Chemical Names</span><div class="v2-form-control"><div v-for="(_, index) in draft.compliance.chemicalNames" :key="index" class="v2-repeat-row"><label :for="`v2-chemical-${index}`" class="v2-sr-only">{{ index ? 'Additional Chemical Name' : 'Chemical Name' }} {{ index + 1 }}</label><input :id="`v2-chemical-${index}`" v-model="draft.compliance.chemicalNames[index]" :name="`chemicalName-${index}`" :placeholder="index ? 'Additional Chemical Name' : 'Chemical Name'" /><button type="button" class="v2-editor-button" :aria-label="`删除化学品名称 ${index + 1}`" @click="draft.compliance.chemicalNames.splice(index, 1)">删除</button></div><button type="button" class="v2-editor-button" data-action="add-chemical" @click="draft.compliance.chemicalNames.push('')">添加化学品名称</button></div></div>
      </section>

      <section v-show="activeTab === 'images'" id="v2-panel-images" class="v2-editor-panel" role="tabpanel" aria-labelledby="v2-tab-images" data-field="images">
        <h2 class="v2-field-group-heading">商品图片</h2>
        <div class="v2-image-instructions"><p>原页说明涉及主图白底、产品占比、像素和文件大小。本地样例只检查格式、真实图片文件签名和大小，不判断白底或平台图片合规。</p><p>支持 JPG / JPEG / PNG / WebP，单张不超过 {{ Math.round(MAX_IMAGE_BYTES / 1024 / 1024) }} MB，最多 9 张。文件只转为浏览器内预览，不上传，不接受外部图片地址。</p></div>
        <div class="v2-form-row"><label for="v2-product-images">选择本机图片</label><div class="v2-form-control"><input id="v2-product-images" name="productImages" type="file" multiple accept="image/png,image/jpeg,image/webp" :disabled="draft.images.length >= 9" @change="uploadProductImages" /><small>{{ draft.images.length }} / 9 张 · 第一张为主图</small><small v-if="fieldError('images')" class="v2-field-error">{{ fieldError('images') }}</small></div></div>
        <div class="v2-image-list">
          <div v-for="(image, index) in draft.images" :key="`${index}-${image.length}`" class="v2-image-entry" :data-field="`images.${index}`"><div class="v2-image-preview"><img v-if="isSafeImage(image)" :src="image" :alt="`${draft.title || '样例商品'} ${index ? `附图 ${index}` : '主图'}`" /><span v-else>图片无效，未加载</span></div><strong>{{ index ? `附图 ${index}` : '主图' }}</strong><div><button v-if="index" type="button" class="v2-editor-button" :data-action="`main-image-${index}`" @click="makeMainImage(index)">设为主图</button><button type="button" class="v2-editor-button" :data-action="`delete-image-${index}`" @click="draft.images.splice(index, 1)">删除</button></div><small v-if="fieldError(`images.${index}`)" class="v2-field-error">{{ fieldError(`images.${index}`) }}</small></div>
          <p v-if="!draft.images.length" class="v2-no-images">暂无本机上传图片。库存使用本机合成示意图，不请求远程资源。</p>
        </div>
      </section>

      <section v-show="activeTab === 'description'" id="v2-panel-description" class="v2-editor-panel" role="tabpanel" aria-labelledby="v2-tab-description">
        <div class="v2-form-row" data-field="features"><span class="v2-form-label">Key Product Features <span class="v2-required">*</span></span><div class="v2-form-control"><div v-for="(_, index) in draft.features" :key="index" class="v2-repeat-row"><label :for="`v2-feature-${index}`" class="v2-sr-only">商品要点 {{ index + 1 }}</label><input :id="`v2-feature-${index}`" v-model="draft.features[index]" :name="`feature-${index}`" :placeholder="`商品要点 ${index + 1}`" /><button type="button" class="v2-editor-button" :aria-label="`删除商品要点 ${index + 1}`" @click="draft.features.splice(index, 1)">删除</button></div><button type="button" class="v2-editor-button" data-action="add-feature" @click="draft.features.push('')">添加要点</button><small v-if="fieldError('features')" class="v2-field-error">{{ fieldError('features') }}</small></div></div>
        <div class="v2-form-row" data-field="description"><label for="v2-description">Product Description <span class="v2-required">*</span></label><div class="v2-form-control"><textarea id="v2-description" v-model="draft.description" name="description" rows="8" :aria-invalid="!!fieldError('description')" /><small v-if="fieldError('description')" class="v2-field-error">{{ fieldError('description') }}</small></div></div>
        <div class="v2-form-row"><label for="v2-cpsia">Cpsia Warning</label><div class="v2-form-control"><select id="v2-cpsia" v-model="draft.warnings.cpsia" name="cpsia"><option value="">请选择</option><option>No Warning Applicable</option><option>Choking Hazard - Small Parts</option><option>Adult Supervision Required</option></select></div></div>
        <div class="v2-form-row"><label for="v2-cpsia-description">CPSIA Warning Description</label><div class="v2-form-control"><textarea id="v2-cpsia-description" v-model="draft.warnings.cpsiaDescription" name="cpsiaDescription" rows="3" /></div></div>
      </section>

      <section v-show="activeTab === 'keywords'" id="v2-panel-keywords" class="v2-editor-panel" role="tabpanel" aria-labelledby="v2-tab-keywords">
        <p class="v2-panel-help">枚举和重复输入用于样例字段体验，不模拟关键词评分或真实检索效果。</p>
        <div v-for="group in keywordGroups" :key="group.key" class="v2-form-row" :data-field="`keywords.${group.key}`"><span class="v2-form-label">{{ group.label }}</span><div class="v2-form-control"><div v-for="(_, index) in draft.keywords[group.key]" :key="index" class="v2-repeat-row"><label :for="`v2-keyword-${group.key}-${index}`" class="v2-sr-only">{{ group.label }} {{ index + 1 }}</label><select v-if="group.options" :id="`v2-keyword-${group.key}-${index}`" v-model="draft.keywords[group.key][index]" :name="`${group.key}-${index}`"><option value="">请选择</option><option v-for="option in keywordOptions(group)" :key="option">{{ option }}</option></select><input v-else :id="`v2-keyword-${group.key}-${index}`" v-model="draft.keywords[group.key][index]" :name="`${group.key}-${index}`" /><button type="button" class="v2-editor-button" :aria-label="`删除 ${group.label} ${index + 1}`" @click="draft.keywords[group.key].splice(index, 1)">删除</button></div><button type="button" class="v2-editor-button" :data-action="`add-${group.key}`" @click="draft.keywords[group.key].push('')">添加一项</button><small v-if="fieldError(`keywords.${group.key}`)" class="v2-field-error">{{ fieldError(`keywords.${group.key}`) }}</small></div></div>
      </section>

      <section v-show="activeTab === 'details'" id="v2-panel-details" class="v2-editor-panel" role="tabpanel" aria-labelledby="v2-tab-details">
        <p class="v2-panel-help">当前类目：{{ draft.categoryName }}。本页按真实字段组陈列；只用收纳、饮水杯、时尚珠宝三种本地配置示例说明动态字段，不代表所有类目，也不表示每个字段都必填。</p>
        <div v-if="categoryDetails.length" class="v2-category-fields"><strong>当前样例类目重点字段：</strong>{{ categoryDetails.map(key => detailLabel(key)).join('、') }}</div>
        <template v-for="group in detailGroups" :key="group.label">
          <h2 class="v2-field-group-heading">{{ group.label }}<small v-if="group.category">珠宝类目字段示例 · 其他类目可留空</small></h2>
          <div v-for="field in group.fields" :key="field.key" class="v2-form-row" :class="{ 'v2-category-relevant': categoryDetails.includes(field.key) }" :data-field="`moreDetails.${field.key}`"><label :for="`v2-detail-${field.key}`">{{ field.label }}</label><div class="v2-form-control"><select v-if="field.options" :id="`v2-detail-${field.key}`" :value="draft.moreDetails[field.key]" :name="`detail-${field.key}`" @change="setDetail(field.key, $event)"><option value="">请选择</option><option v-for="option in detailOptions(field)" :key="option">{{ option }}</option></select><input v-else :id="`v2-detail-${field.key}`" :value="draft.moreDetails[field.key]" :name="`detail-${field.key}`" :type="field.type || 'text'" :min="field.type === 'number' ? 0 : undefined" step="any" @input="setDetail(field.key, $event)" /><small v-if="fieldError(`moreDetails.${field.key}`)" class="v2-field-error">{{ fieldError(`moreDetails.${field.key}`) }}</small></div></div>
        </template>
      </section>

      <footer class="v2-editor-footer"><span>{{ pendingUploads ? '正在读取本机图片…' : '仅保存浏览器本地样例，不提交真实平台' }}</span><div><button type="button" class="v2-editor-button" data-action="save-product" :disabled="!!pendingUploads" @click="save(false)">保存</button><button type="submit" class="v2-editor-button v2-save-complete" data-action="save-product-complete" :disabled="!!pendingUploads">保存并完成</button></div></footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import V2ProductImage from './V2ProductImage.vue'
import { CODE_TYPES, CONDITIONS, VARIANT_THEMES, MAX_IMAGE_BYTES, categories, isSafeImage, newVariant, type Product, type Variant, type ShippingTemplate, type FieldError, type EditorTab, type Keywords } from './model'
import './product-editor.css'

const props = withDefaults(defineProps<{ product: Product; templates: ShippingTemplate[]; errors?: FieldError[] }>(), { errors: () => [] })
const emit = defineEmits<{ save: [product: Product, complete: boolean]; cancel: [] }>()
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const draft = ref<Product>(clone(props.product))
const editorRoot = ref<HTMLElement>()
const activeTab = ref<EditorTab>('important')
const variantTerms = ref(''), selectedIds = ref<string[]>([]), savedRows = ref<string[]>([]), feedback = ref('')
const pendingUploads = ref(0), localErrors = ref<FieldError[]>([]), dismissedFields = ref<string[]>([])
const tabs: { id: EditorTab; label: string }[] = [{ id: 'important', label: '重要信息' }, { id: 'variants', label: '变体' }, { id: 'offer', label: '报价' }, { id: 'compliance', label: '合规信息' }, { id: 'images', label: '图片' }, { id: 'description', label: '描述' }, { id: 'keywords', label: '关键字' }, { id: 'details', label: '更多详情' }]
const allErrors = computed(() => [...props.errors, ...localErrors.value].filter((error, index, errors) => !dismissedFields.value.includes(error.field) && errors.findIndex(item => item.field === error.field) === index))
const priceSummary = computed(() => {
  const prices = draft.value.variants.filter(row => !row.deleted && Number.isFinite(row.price)).map(row => row.price)
  if (!prices.length) return '尚未填写'
  const min = Math.min(...prices), max = Math.max(...prices)
  return `USD ${min.toFixed(2)}${min !== max ? ` – ${max.toFixed(2)}` : ''}`
})
const allSelected = computed(() => !!draft.value.variants.length && draft.value.variants.every(row => selectedIds.value.includes(row.id)))
const categoryExamples: Record<string, string[]> = {
  'home-storage': ['fabricType', 'packageQuantity', 'itemLength', 'itemWidth', 'itemHeight'],
  'home-kitchen': ['material', 'capacity', 'packageQuantity', 'itemHeight'],
  'fashion-jewelry': ['metalStamp', 'claspType', 'chainType', 'numberOfStones', 'stoneColor'],
}
const categoryDetails = computed(() => categoryExamples[draft.value.categoryId] || [])

interface FieldSpec { key: string; label: string; type?: 'text' | 'number' | 'date' | 'url'; options?: string[]; unit?: string; units?: string[] }
const batteryFields: FieldSpec[] = [
  { key: 'itemWeight', label: '商品重量', type: 'number', unit: 'itemWeightUnit', units: ['kg', 'g', 'lb', 'oz'] },
  { key: 'batteryWeight', label: '电池重量', type: 'number', unit: 'batteryWeightUnit', units: ['g', 'kg', 'oz', 'lb'] },
  { key: 'wattHours', label: '每个电池瓦时数', type: 'number', unit: 'wattHoursUnit', units: ['Wh'] },
  { key: 'lithiumContent', label: '锂含量', type: 'number', unit: 'lithiumContentUnit', units: ['g', 'mg'] },
  { key: 'capacity', label: '容量', type: 'number', unit: 'capacityUnit', units: ['mAh', 'Ah'] },
  { key: 'batteryLife', label: '电池平均寿命', type: 'number', unit: 'batteryLifeUnit', units: ['hours', 'days', 'years'] },
  { key: 'batteryVoltage', label: '锂电池电压', type: 'number', unit: 'batteryVoltageUnit', units: ['V'] },
  { key: 'batteryType', label: '电池类型 / 尺寸', options: ['AA', 'AAA', 'C', 'D', '9V', 'Lithium Ion', 'Lithium Metal', 'Other'] },
  { key: 'batteryCount', label: '电池数量', type: 'number' },
  { key: 'batteryComposition', label: '电池成分', options: ['Alkaline', 'Lithium Ion', 'Lithium Metal', 'Nickel Metal Hydride', 'Other'] },
  { key: 'lithiumPackaging', label: '锂电池包装', options: ['Batteries contained in equipment', 'Batteries packed with equipment', 'Batteries only'] },
  { key: 'lithiumIonCells', label: '锂离子电池单元数量', type: 'number' },
  { key: 'lithiumMetalCells', label: '锂金属电池单元数量', type: 'number' },
]
const hazardOptions = ['GHS', 'Storage', 'Waste', 'Not Applicable', 'Transportation', 'Other', 'Unknown']
const ghsOptions = ['Explosive', 'Flammable', 'Oxidizing', 'Gas Under Pressure', 'Corrosive', 'Acute Toxicity', 'Health Hazard', 'Irritant', 'Environmental Hazard']
const hazardFields: FieldSpec[] = [{ key: 'unNumber', label: '联合国危险货物编号' }, { key: 'sdsUrl', label: '安全数据表（SDS）URL', type: 'url' }, { key: 'flashPoint', label: '闪点（°C）', type: 'number' }]
interface KeywordGroup { key: keyof Keywords; label: string; options?: string[] }
const keywordGroups: KeywordGroup[] = [
  { key: 'targetAudience', label: 'Target Audience', options: ['成人', '青少年', '儿童', '男性', '女性', '通用'] },
  { key: 'intendedUse', label: 'Intended Use', options: ['日常使用', '旅行', '家居收纳', '办公', '户外'] },
  { key: 'otherAttributes', label: 'Other Attributes' }, { key: 'subjectMatter', label: 'Subject Matter', options: ['生活用品', '服饰配件', '办公用品', '旅行用品'] },
  { key: 'searchTerms', label: 'Search Terms' }, { key: 'platinumKeywords', label: 'Platinum Keywords' },
]
const detailGroups: { label: string; category?: string; fields: FieldSpec[] }[] = [
  { label: '配送重量、产地与材料', fields: [{ key: 'shippingWeight', label: 'Shipping Weight', type: 'number' }, { key: 'shippingWeightUnit', label: 'Shipping Weight Unit', options: ['kg', 'g', 'lb', 'oz'] }, { key: 'countryOfOrigin', label: 'Country/Region of Origin', options: ['China', 'United States', 'Germany', 'Japan', 'Other'] }, { key: 'launchDate', label: 'Launch Date', type: 'date' }, { key: 'fabricType', label: 'Fabric Type' }, { key: 'material', label: 'Material' }, { key: 'capacity', label: 'Capacity' }, { key: 'importDesignation', label: 'Import Designation', options: ['Imported', 'Made in USA', 'Made in USA and Imported'] }] },
  { label: '珠宝、宝石与证书', category: 'jewelry', fields: [{ key: 'metalStamp', label: 'Metal Stamp' }, { key: 'numberOfStones', label: 'Number Of Stones', type: 'number' }, { key: 'claspType', label: 'Clasp Type', options: ['Lobster Claw', 'Spring Ring', 'Toggle', 'Buckle', 'Other'] }, { key: 'chainType', label: 'Chain Type', options: ['Cable', 'Box', 'Rope', 'Snake', 'Other'] }, { key: 'certificateNumber', label: 'Certificate Number' }, { key: 'stoneCut', label: 'Stone Cut', options: ['Round', 'Princess', 'Emerald', 'Oval', 'Other'] }, { key: 'totalDiamondWeight', label: 'Total Diamond Weight', type: 'number' }, { key: 'stoneColor', label: 'Stone Color' }, { key: 'stoneClarity', label: 'Stone Clarity' }, { key: 'stoneShape', label: 'Stone Shape' }, { key: 'stoneCreationMethod', label: 'Stone Creation Method', options: ['Natural', 'Synthetic', 'Simulated'] }, { key: 'stoneTreatmentMethod', label: 'Stone Treatment Method', options: ['Not Treated', 'Heat Treated', 'Dyed', 'Other'] }, { key: 'certificateType', label: 'Certificate Type' }, { key: 'stoneDimensionsUnit', label: 'Stone Dimensions Unit Of Measure', options: ['mm', 'cm', 'in'] }] },
  { label: '珍珠信息', category: 'jewelry', fields: [{ key: 'pearlType', label: 'Pearl Type', options: ['Freshwater', 'Akoya', 'South Sea', 'Tahitian', 'Imitation'] }, { key: 'pearlMinimumColor', label: 'Pearl Minimum Color' }, { key: 'pearlLuster', label: 'Pearl Luster' }, { key: 'pearlShape', label: 'Pearl Shape' }, { key: 'totalGemWeight', label: 'Total Gem Weight', type: 'number' }, { key: 'pearlUniformity', label: 'Pearl Uniformity' }, { key: 'pearlSurfaceBlemishes', label: 'Pearl Surface Blemishes' }, { key: 'pearlStringingMethod', label: 'Pearl Stringing Method' }, { key: 'sizePerPearl', label: 'Size Per Pearl', type: 'number' }, { key: 'numberOfPearls', label: 'Number Of Pearls', type: 'number' }] },
  { label: '款式、包装与制造商', fields: [{ key: 'styleName', label: 'Style Name' }, { key: 'releaseDate', label: 'Release Date', type: 'date' }, { key: 'packageQuantity', label: 'Package Quantity', type: 'number' }, { key: 'maximumAggregateShipQuantity', label: 'Maximum Aggregate Ship Quantity', type: 'number' }, { key: 'discontinuedByManufacturer', label: 'Is Discontinued by Manufacturer', options: ['No', 'Yes'] }, { key: 'partNumber', label: 'Part Number / Model Number' }, { key: 'catalogNumber', label: 'Catalog Number' }, { key: 'modelNumber', label: 'Model Number' }] },
  { label: '商品与包装尺寸', fields: [{ key: 'itemLength', label: 'Item Dimensions - Length', type: 'number' }, { key: 'itemWidth', label: 'Item Dimensions - Width', type: 'number' }, { key: 'itemHeight', label: 'Item Dimensions - Height', type: 'number' }, { key: 'itemDimensionsUnit', label: 'Item Dimensions Unit', options: ['cm', 'mm', 'in'] }, { key: 'packageLength', label: 'Package Dimensions - Length', type: 'number' }, { key: 'packageWidth', label: 'Package Dimensions - Width', type: 'number' }, { key: 'packageHeight', label: 'Package Dimensions - Height', type: 'number' }, { key: 'packageDimensionsUnit', label: 'Package Dimensions Unit', options: ['cm', 'mm', 'in'] }] },
  { label: '显示尺寸与重量', fields: [{ key: 'weight', label: 'Weight', type: 'number' }, { key: 'stoneWeight', label: 'Stone Weight', type: 'number' }, { key: 'itemDisplayWeight', label: 'Item Display Weight', type: 'number' }, { key: 'itemDisplayLength', label: 'Item Display Dimensions - Length', type: 'number' }, { key: 'itemDisplayWidth', label: 'Item Display Dimensions - Width', type: 'number' }, { key: 'itemDisplayHeight', label: 'Item Display Dimensions - Height', type: 'number' }, { key: 'itemDisplayDiameter', label: 'Item Display Dimensions - Diameter', type: 'number' }, { key: 'itemDisplayDimensionsUnit', label: 'Item Display Dimensions Unit', options: ['cm', 'mm', 'in'] }] },
]

watch(() => props.product, product => { draft.value = clone(product); selectedIds.value = []; savedRows.value = []; localErrors.value = []; dismissedFields.value = []; feedback.value = '' })
watch(() => props.errors, errors => { dismissedFields.value = []; if (errors[0]) void jumpToError(errors[0]) })
function tabLabel(tab: EditorTab): string { return tabs.find(item => item.id === tab)?.label || tab }
function setTab(tab: EditorTab): void { activeTab.value = tab }
function errorCount(tab: EditorTab): number { return allErrors.value.filter(error => error.tab === tab).length }
function fieldError(field: string): string { return allErrors.value.find(error => error.field === field)?.message || '' }
function dismissError(field: string): void { if (!dismissedFields.value.includes(field)) dismissedFields.value.push(field); localErrors.value = localErrors.value.filter(error => error.field !== field) }
function dismissFromEvent(event: Event): void {
  // Native checkbox input precedes Vue's change-based v-model. Re-rendering
  // here would restore the old checked state before change can select it.
  if (event.target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(event.target.type)) return
  const field = (event.target as HTMLElement).closest<HTMLElement>('[data-field]')?.dataset.field
  if (field) dismissError(field)
}
async function jumpToError(error: FieldError): Promise<void> {
  activeTab.value = error.tab
  await nextTick()
  const matching = [...(editorRoot.value?.querySelectorAll<HTMLElement>('[data-field]') || [])].find(element => element.dataset.field === error.field)
  matching?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  matching?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), textarea, button')?.focus({ preventScroll: true })
}
function variantField(variant: Variant, field: string): string { return `variants.${variant.id}.${field}` }
function addVariants(): void {
  const terms = variantTerms.value.split(/[,，;；\n]/).map(term => term.trim()).filter(Boolean)
  if (!terms.length) { feedback.value = '请先输入变体术语。'; return }
  let added = 0
  for (const term of terms) {
    if (draft.value.variants.some(row => row.term === term && !row.deleted)) continue
    const [first = '', second = ''] = term.split(/\s*[/／]\s*/)
    const color = draft.value.variantTheme.includes('颜色') ? first : ''
    const size = draft.value.variantTheme === '尺寸' ? first : draft.value.variantTheme.includes('尺寸') ? second : ''
    const emptyRow = draft.value.variants.find(row => !row.deleted && !row.term && !row.sku && !row.code && !row.price && !row.quantity)
    if (emptyRow) Object.assign(emptyRow, { term, color, size })
    else draft.value.variants.push(newVariant({ term, color, size }))
    added++
  }
  variantTerms.value = ''; feedback.value = added ? `已添加 ${added} 条变体，请逐行填写子 SKU、商品编码与报价。` : '这些术语已存在，没有重复添加。'
  dismissError('variants')
}
function selectAll(event: Event): void { selectedIds.value = (event.target as HTMLInputElement).checked ? draft.value.variants.map(row => row.id) : [] }
function softDeleteSelected(): void { draft.value.variants.filter(row => selectedIds.value.includes(row.id)).forEach(row => { row.deleted = true }); feedback.value = '所选行已标记删除。勾选这些行后可恢复；未修改真实库存。' }
function restoreSelected(): void { draft.value.variants.filter(row => selectedIds.value.includes(row.id)).forEach(row => { row.deleted = false }); feedback.value = '所选变体已恢复，原子 SKU、数量和图片均保留。' }
function saveVariant(variant: Variant): void {
  localErrors.value = localErrors.value.filter(error => !error.field.startsWith(`variants.${variant.id}.`) || error.field.endsWith('.image'))
  const rowErrors: FieldError[] = []
  const add = (key: string, message: string) => rowErrors.push({ field: variantField(variant, key), message, tab: 'variants' })
  if (!variant.sku.trim()) add('sku', '请填写这条变体的卖家 SKU。')
  if (!variant.term.trim()) add('term', '请填写这条变体的术语。')
  if (!variant.code.trim()) add('code', '请填写本地样例商品编码。')
  if (!Number.isFinite(variant.price) || variant.price <= 0) add('price', '这条变体的价格必须大于 0。')
  if (!Number.isInteger(variant.quantity) || variant.quantity < 0) add('quantity', '数量必须是非负整数。')
  dismissedFields.value = dismissedFields.value.filter(field => !rowErrors.some(error => error.field === field))
  localErrors.value.push(...rowErrors)
  if (rowErrors[0]) { void jumpToError(rowErrors[0]); feedback.value = '这条变体还有字段需要检查。'; return }
  if (!savedRows.value.includes(variant.id)) savedRows.value.push(variant.id)
  feedback.value = `子 SKU ${variant.sku} 的行修改已应用到当前表单；请用页面底部保存写入本机样例。`
}
function applyVariants(): void { draft.value.variants.filter(row => !row.deleted).forEach(saveVariant); if (!allErrors.value.some(error => error.tab === 'variants')) feedback.value = '变体行修改已应用到当前表单，尚未写入库存。' }
function swatchFor(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color
  if (/蓝/.test(color)) return '#547fa5'; if (/绿/.test(color)) return '#54756c'; if (/白|奶油/.test(color)) return '#eee9dc'; if (/灰/.test(color)) return '#969ba1'; if (/红/.test(color)) return '#984950'; if (/木|杏|棕/.test(color)) return '#b49472'
  return '#d2d6da'
}
function setVariantColor(variant: Variant, event: Event): void { variant.color = (event.target as HTMLInputElement).value }
function getCompliance(key: string): string { return String((draft.value.compliance as unknown as Record<string, unknown>)[key] ?? '') }
function setCompliance(key: string, event: Event): void { (draft.value.compliance as unknown as Record<string, unknown>)[key] = (event.target as HTMLInputElement).value; dismissError(`compliance.${key}`) }
function keywordOptions(group: KeywordGroup): string[] { return [...new Set([...(group.options || []), ...draft.value.keywords[group.key].filter(Boolean)])] }
function detailOptions(field: FieldSpec): string[] { return [...new Set([...(field.options || []), ...(draft.value.moreDetails[field.key] ? [draft.value.moreDetails[field.key]!] : [])])] }
function setDetail(key: string, event: Event): void { draft.value.moreDetails[key] = (event.target as HTMLInputElement | HTMLSelectElement).value; dismissError(`moreDetails.${key}`) }
function detailLabel(key: string): string { return detailGroups.flatMap(group => group.fields).find(field => field.key === key)?.label || categories.find(category => category.id === draft.value.categoryId)?.name || key }
function fileError(field: string, message: string, tab: EditorTab): void { localErrors.value = localErrors.value.filter(error => error.field !== field); dismissedFields.value = dismissedFields.value.filter(item => item !== field); localErrors.value.push({ field, message, tab }) }
async function readLocalImage(file: File, field: string, tab: EditorTab): Promise<string | null> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { fileError(field, '请选择真实的 PNG、JPG / JPEG 或 WebP 图片文件，不接受 SVG、HTML 或外部图片地址。', tab); return null }
  if (!file.size || file.size > MAX_IMAGE_BYTES) { fileError(field, '图片不能为空，且单张不能超过 1 MB；原图片已保留。', tab); return null }
  pendingUploads.value++
  try {
    const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败')); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file) })
    if (!isSafeImage(image)) { fileError(field, '图片内容与格式不符，未加载文件；请选择有效的本机图片。', tab); return null }
    try { const preview = new Image(); preview.src = image; await preview.decode() }
    catch { fileError(field, '图片损坏或无法解码，未加载文件；请选择完整可打开的本机图片。', tab); return null }
    dismissError(field); return image
  } catch { fileError(field, '未能读取这张本机图片，请重新选择；原图片已保留。', tab); return null }
  finally { pendingUploads.value-- }
}
async function uploadVariantImage(variant: Variant, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file) return
  const image = await readLocalImage(file, variantField(variant, 'image'), 'variants')
  if (image && draft.value.variants.some(row => row.id === variant.id)) variant.image = image
  input.value = ''
}
async function uploadProductImages(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement, files = [...(input.files || [])]
  if (!files.length) return
  let added = 0
  const rejectedMessages: string[] = []
  for (const file of files) {
    if (draft.value.images.length >= 9) { rejectedMessages.push('本地样例最多保留 9 张图片，多出的文件未添加。'); break }
    const image = await readLocalImage(file, 'images', 'images')
    if (image && draft.value.images.length < 9) { draft.value.images.push(image); added++ }
    else if (image) rejectedMessages.push('本地样例最多保留 9 张图片，多出的文件未添加。')
    else rejectedMessages.push(localErrors.value.find(error => error.field === 'images')?.message || '图片读取失败，未添加。')
  }
  if (rejectedMessages.length) fileError('images', `部分文件未添加：${[...new Set(rejectedMessages)].join(' ')}`, 'images')
  if (added) feedback.value = `已在本机预览 ${added} 张图片，没有上传到任何服务。`
  input.value = ''
}
function makeMainImage(index: number): void { const image = draft.value.images.splice(index, 1)[0]; if (image) draft.value.images.unshift(image) }
function save(complete: boolean): void {
  if (pendingUploads.value) return
  // Rejected image selections do not enter the draft and therefore do not
  // block saving already-valid data. Business/sample checks remain in model.ts.
  localErrors.value = []
  dismissedFields.value = []
  feedback.value = ''
  emit('save', clone(draft.value), complete)
}
defineExpose({ setTab, getDraft: () => clone(draft.value), jumpToError })
</script>
