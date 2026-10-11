type UnknownRecord = Record<string, unknown>;

export type SelectorStrategy = 'css' | 'id' | 'name' | 'testId' | 'label' | 'placeholder' | 'text' | 'role';

export interface SelectorCandidate {
  strategy: SelectorStrategy;
  value: string;
  name?: string;
}

export interface ScriptInputField {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'file' | 'select';
  options?: string[];
  sensitive?: boolean;
}

export interface WorkflowAction {
  id: string;
  kind: 'fill' | 'select' | 'click' | 'check' | 'upload' | 'waitFor' | 'assertText' | 'calculate';
  title: string;
  selectors?: SelectorCandidate[];
  inputKey?: string;
  value?: string | number | boolean;
  required?: boolean;
  optional?: boolean;
  idempotent?: boolean;
  timeoutMs?: number;
  retries?: number;
  formula?: 'replenishment' | 'freight';
  outputKey?: string;
}

export interface WorkflowStep {
  id: string;
  title: string;
  detail: string;
  action: string;
  actions: WorkflowAction[];
}

export interface AutomationScript {
  key: string;
  name: string;
  mode: 'workflow';
  description: string;
  version: string;
  capabilityKey: string;
  inputSchema: ScriptInputField[];
  defaultInput?: UnknownRecord;
  allowedHosts: string[];
  sandbox?: boolean;
  steps: WorkflowStep[];
  successChecks: WorkflowAction[];
  requestedKey?: string | null;
}

const SIMULATION_HOSTS = ['idtrade.cn', 'www.bjysoft.cn', 'localhost', '127.0.0.1'];

const field = (
  key: string,
  label: string,
  options: Partial<ScriptInputField> = {},
): ScriptInputField => ({ key, label, type: 'text', required: true, ...options });

const css = (value: string): SelectorCandidate => ({ strategy: 'css', value });
const name = (value: string): SelectorCandidate => ({ strategy: 'name', value });
const label = (value: string): SelectorCandidate => ({ strategy: 'label', value });
const placeholder = (value: string): SelectorCandidate => ({ strategy: 'placeholder', value });
const text = (value: string): SelectorCandidate => ({ strategy: 'text', value });
const role = (value: string, accessibleName: string): SelectorCandidate => ({ strategy: 'role', value, name: accessibleName });

function inputSelectors(inputKey: string, labels: string[]): SelectorCandidate[] {
  return [name(inputKey), css(`[data-field="${inputKey}"]`), ...labels.flatMap(item => [label(item), placeholder(item)])];
}

function fillAction(inputKey: string, title: string, labels: string[] = [title]): WorkflowAction {
  return {
    id: `fill_${inputKey}`,
    kind: 'fill',
    title,
    inputKey,
    selectors: inputSelectors(inputKey, labels),
    required: true,
    idempotent: true,
  };
}

function selectAction(inputKey: string, title: string, labels: string[] = [title]): WorkflowAction {
  return {
    id: `select_${inputKey}`,
    kind: 'select',
    title,
    inputKey,
    selectors: inputSelectors(inputKey, labels),
    required: true,
    idempotent: true,
  };
}

function submitAction(labels: string[] = ['提交', '保存', '确认']): WorkflowAction {
  return {
    id: 'submit',
    kind: 'click',
    title: '提交并保存',
    selectors: [css('#submit-task'), css('[data-action="submit"]'), ...labels.flatMap(item => [role('button', item), text(item)])],
    required: true,
    idempotent: false,
    retries: 1,
  };
}

function freightCalculation(): WorkflowAction {
  return {
    id: 'calculate_freight_quote',
    kind: 'calculate',
    title: '按当前费率包计算候选物流方案',
    formula: 'freight',
    outputKey: 'freight_quote',
    idempotent: true,
  };
}

const successChecks: WorkflowAction[] = [{
  id: 'verify_success',
  kind: 'assertText',
  title: '核验平台成功结果',
  selectors: [css('[data-status="success"]'), css('.success-message'), css('.el-message--success'), text('操作成功'), text('保存成功')],
  value: '成功',
  required: true,
  timeoutMs: 15000,
}];

function workflow(
  id: string,
  title: string,
  actions: WorkflowAction[],
): WorkflowStep {
  return { id, title, detail: `在平台页面中${title}。`, action: title, actions };
}

function script(
  key: string,
  nameValue: string,
  capabilityKey: string,
  inputSchema: ScriptInputField[],
  defaultInput: UnknownRecord,
  steps: WorkflowStep[],
  options: { sandbox?: boolean; description?: string } = {},
): AutomationScript {
  return {
    key,
    name: nameValue,
    mode: 'workflow',
    description: options.description || `自动完成${nameValue}并核验页面结果。`,
    version: '1.0.0',
    capabilityKey,
    inputSchema,
    defaultInput,
    allowedHosts: SIMULATION_HOSTS,
    sandbox: Boolean(options.sandbox),
    steps,
    successChecks,
  };
}

const DEFINITIONS = {
  register: {
    name: '新手快速注册工具',
    fields: [field('shop_name', '店铺名称'), field('contact_name', '联系人'), field('contact_phone', '联系电话')],
    defaults: { shop_name: '演示店铺', contact_name: '演示联系人', contact_phone: '13800000000' },
    steps: [workflow('fill_registration', '填写注册资料', [
      fillAction('shop_name', '填写店铺名称'), fillAction('contact_name', '填写联系人'), fillAction('contact_phone', '填写联系电话'),
    ]), workflow('submit_registration', '提交注册资料', [submitAction()])],
  },
  logistics_standard: {
    name: '物流模板标准版',
    fields: [field('template_name', '模板名称'), field('country', '配送国家', { type: 'select', options: ['美国', '加拿大', '英国', '德国'] }), field('weight_kg', '目标重量（kg）', { type: 'number' }), field('length_cm', '长度（cm）', { type: 'number', required: false }), field('width_cm', '宽度（cm）', { type: 'number', required: false }), field('height_cm', '高度（cm）', { type: 'number', required: false }), field('shipping_price', '固定运费', { type: 'number' })],
    defaults: { template_name: '演示物流模板', country: '美国', weight_kg: 0.5, length_cm: 20, width_cm: 15, height_cm: 8, shipping_price: 5.99 },
    steps: [workflow('calculate_logistics', '计算物流模板运费', [freightCalculation()]), workflow('fill_logistics', '填写物流模板', [
      fillAction('template_name', '填写模板名称'), selectAction('country', '选择配送国家'), fillAction('weight_kg', '填写目标重量'),
      fillAction('length_cm', '填写长度'), fillAction('width_cm', '填写宽度'), fillAction('height_cm', '填写高度'),
      fillAction('shipping_price', '填写固定运费'),
    ]), workflow('submit_logistics', '保存物流模板', [submitAction(['保存模板', '保存', '提交'])])],
  },
  logistics_cost: {
    name: '物流成本优选',
    fields: [field('country', '配送国家', { type: 'select', options: ['美国', '加拿大', '英国', '德国'] }), field('weight_kg', '重量（kg）', { type: 'number' }), field('length_cm', '长度（cm）', { type: 'number', required: false }), field('width_cm', '宽度（cm）', { type: 'number', required: false }), field('height_cm', '高度（cm）', { type: 'number', required: false }), field('declared_value', '申报金额', { type: 'number' })],
    defaults: { country: '美国', weight_kg: 0.5, length_cm: 20, width_cm: 15, height_cm: 8, declared_value: 20 },
    steps: [workflow('fill_freight', '填写运费计算条件', [
      selectAction('country', '选择配送国家'), fillAction('weight_kg', '填写商品重量'), fillAction('declared_value', '填写申报金额'),
    ]), workflow('compare_freight', '计算并选择物流方案', [freightCalculation(), submitAction(['开始比价', '计算运费', '查询'])])],
  },
  listing_script: {
    name: '自动上品脚本',
    fields: [
      field('sku', 'SKU'), field('title', '商品标题'), field('price', '售价', { type: 'number' }),
      field('quantity', '库存数量', { type: 'number' }), field('weight_kg', '重量（kg）', { type: 'number' }),
      field('length_cm', '长度（cm）', { type: 'number' }), field('width_cm', '宽度（cm）', { type: 'number' }),
      field('height_cm', '高度（cm）', { type: 'number' }),
    ],
    defaults: { sku: 'DEMO-SKU-001', title: '演示商品标题', price: 19.99, quantity: 20, weight_kg: 0.5, length_cm: 20, width_cm: 15, height_cm: 8 },
    steps: [workflow('fill_listing_basic', '填写商品基础信息', [
      fillAction('sku', '填写 SKU'), fillAction('title', '填写商品标题', ['商品标题', '标题', 'Product title']),
      fillAction('price', '填写售价'), fillAction('quantity', '填写库存数量'),
    ]), workflow('fill_listing_package', '填写包装信息', [
      fillAction('weight_kg', '填写重量'), fillAction('length_cm', '填写长度'),
      fillAction('width_cm', '填写宽度'), fillAction('height_cm', '填写高度'),
    ]), workflow('submit_listing', '提交商品上架', [submitAction(['发布商品', '提交审核', '保存并发布', '提交'])])],
  },
  ship_script: {
    name: '自动发货脚本',
    fields: [field('order_id', '订单号'), field('country', '配送国家', { type: 'select', options: ['美国', '加拿大', '英国', '德国'] }), field('weight_kg', '重量（kg）', { type: 'number' }), field('length_cm', '长度（cm）', { type: 'number', required: false }), field('width_cm', '宽度（cm）', { type: 'number', required: false }), field('height_cm', '高度（cm）', { type: 'number', required: false }), field('carrier', '物流承运商', { type: 'select', options: ['UPS 全球快捷', 'e邮宝', '燕文航空挂号小包', '中国邮政挂号小包'] }), field('tracking_number', '物流单号')],
    defaults: { order_id: 'DEMO-ORDER-001', country: '美国', weight_kg: 0.5, length_cm: 20, width_cm: 15, height_cm: 8, carrier: 'UPS 全球快捷', tracking_number: '1ZDEMO000001' },
    steps: [workflow('calculate_shipping', '计算并选择物流渠道', [freightCalculation()]), workflow('fill_shipping', '填写发货信息', [
      fillAction('order_id', '填写订单号'), selectAction('country', '选择配送国家'), fillAction('weight_kg', '填写重量'),
      fillAction('length_cm', '填写长度'), fillAction('width_cm', '填写宽度'), fillAction('height_cm', '填写高度'),
      selectAction('carrier', '选择物流承运商'), fillAction('tracking_number', '填写物流单号'),
    ]), workflow('submit_shipping', '确认发货', [submitAction(['确认发货', '标记为已发货', '提交'])])],
  },
  fba_agl: {
    name: '自动发 FBA/AGL',
    fields: [
      field('sku', 'SKU'), field('quantity', '发货数量', { type: 'number' }),
      field('warehouse', '目标仓库', { type: 'select', options: ['ONT8', 'LAX9', 'FTW1', 'ABE8'] }),
      field('carton_count', '箱数', { type: 'number' }), field('length_cm', '长度（cm）', { type: 'number' }),
      field('width_cm', '宽度（cm）', { type: 'number' }), field('height_cm', '高度（cm）', { type: 'number' }),
      field('weight_kg', '重量（kg）', { type: 'number' }),
    ],
    defaults: { sku: 'DEMO-FBA-001', quantity: 24, warehouse: 'ONT8', carton_count: 2, length_cm: 20, width_cm: 15, height_cm: 8, weight_kg: 0.5 },
    steps: [workflow('fill_fba', '填写 FBA/AGL 发货资料', [
      fillAction('sku', '填写 SKU'), fillAction('quantity', '填写发货数量'), selectAction('warehouse', '选择目标仓库'), fillAction('carton_count', '填写箱数'),
      fillAction('length_cm', '填写长度'), fillAction('width_cm', '填写宽度'), fillAction('height_cm', '填写高度'), fillAction('weight_kg', '填写重量'),
    ]), workflow('submit_fba', '创建货件', [submitAction(['创建货件', '确认并继续', '提交'])])],
  },
  replenishment: {
    name: '智能补货建议',
    fields: [
      field('sku', 'SKU'), field('order_demand', '订单需求', { type: 'number' }),
      field('current_stock', '当前库存', { type: 'number' }), field('safety_percent', '安全库存比例（%）', { type: 'number' }),
      field('suggested_quantity', '建议补货数量', { type: 'number', required: false }),
    ],
    defaults: { sku: 'DEMO-REPLENISH-001', order_demand: 30, current_stock: 12, safety_percent: 20, suggested_quantity: 24 },
    steps: [workflow('calculate_replenishment', '计算补货建议', [{
      id: 'calculate_suggested_quantity', kind: 'calculate', title: '按需求、库存和安全比例计算建议补货量',
      formula: 'replenishment', outputKey: 'suggested_quantity', idempotent: true,
    }]), workflow('fill_replenishment', '填写补货建议', [
      fillAction('sku', '填写 SKU'), fillAction('order_demand', '填写订单需求'), fillAction('current_stock', '填写当前库存'),
      fillAction('safety_percent', '填写安全库存比例'), fillAction('suggested_quantity', '填写建议补货数量'),
    ]), workflow('submit_replenishment', '保存补货建议', [submitAction(['保存补货建议', '生成补货单', '提交'])])],
  },
  ad_script: {
    name: '自动上广告脚本',
    fields: [field('campaign_name', '广告活动名称'), field('daily_budget', '每日预算', { type: 'number' }), field('default_bid', '默认竞价', { type: 'number' }), field('sku', '商品 SKU')],
    defaults: { campaign_name: '演示广告活动', daily_budget: 20, default_bid: 0.8, sku: 'DEMO-SKU-001' },
    steps: [workflow('fill_campaign', '填写广告活动资料', [
      fillAction('campaign_name', '填写活动名称'), fillAction('daily_budget', '填写每日预算'), fillAction('default_bid', '填写默认竞价'), fillAction('sku', '填写商品 SKU'),
    ]), workflow('submit_campaign', '创建广告活动', [submitAction(['创建广告活动', '启动活动', '提交'])])],
  },
  ali_register: {
    name: '速卖通快速开店工具',
    fields: [field('shop_name', '店铺名称'), field('contact_name', '联系人'), field('contact_phone', '联系电话')],
    defaults: { shop_name: '速卖通演示店铺', contact_name: '演示联系人', contact_phone: '13800000000' },
    steps: [workflow('fill_registration', '填写开店资料', [
      fillAction('shop_name', '填写店铺名称'), fillAction('contact_name', '填写联系人'), fillAction('contact_phone', '填写联系电话'),
    ]), workflow('submit_registration', '提交开店资料', [submitAction()])],
  },
  ali_listing: {
    name: '速卖通上品助手',
    fields: [
      field('sku', 'SKU'), field('title', '商品标题'), field('price', '售价', { type: 'number' }),
      field('quantity', '库存数量', { type: 'number' }), field('weight_kg', '重量（kg）', { type: 'number' }),
    ],
    defaults: { sku: 'ALI-DEMO-001', title: '速卖通演示商品', price: 12.99, quantity: 30, weight_kg: 0.3 },
    steps: [workflow('fill_listing_basic', '填写商品资料', [
      fillAction('sku', '填写 SKU'), fillAction('title', '填写商品标题'), fillAction('price', '填写售价'),
      fillAction('quantity', '填写库存数量'), fillAction('weight_kg', '填写重量'),
    ]), workflow('submit_listing', '发布商品', [submitAction(['发布商品', '提交审核', '提交'])])],
  },
  ali_ship: {
    name: '速卖通自动发货',
    fields: [field('order_id', '订单号'), field('carrier', '物流承运商', { type: 'select', options: ['菜鸟', '燕文', '4PX', 'DHL'] }), field('tracking_number', '物流单号')],
    defaults: { order_id: 'ALI-ORDER-001', carrier: '菜鸟', tracking_number: 'ALI-DEMO-TRACKING' },
    steps: [workflow('fill_shipping', '填写发货信息', [
      fillAction('order_id', '填写订单号'), selectAction('carrier', '选择物流承运商'), fillAction('tracking_number', '填写物流单号'),
    ]), workflow('submit_shipping', '确认发货', [submitAction(['确认发货', '填写发货通知', '提交'])])],
  },
} as const;

const SCRIPTS: Record<string, AutomationScript> = {};

for (const [capabilityKey, definition] of Object.entries(DEFINITIONS)) {
  const liveKey = `amazon.${capabilityKey}.v1`;
  const demoKey = `demo.${capabilityKey}_walkthrough_v1`;
  SCRIPTS[liveKey] = script(liveKey, definition.name, capabilityKey, [...definition.fields], { ...definition.defaults }, [...definition.steps]);
  SCRIPTS[demoKey] = script(demoKey, definition.name, capabilityKey, [...definition.fields], { ...definition.defaults }, [...definition.steps], { sandbox: true, description: `在本地模拟平台中真实操作${definition.name}。` });
}

const FALLBACK_SCRIPT: AutomationScript = {
  key: 'workflow.generic.v1',
  name: '通用平台扫描',
  mode: 'workflow',
  description: '扫描当前页面并生成适配报告；不会提交业务数据。',
  version: '1.0.0',
  capabilityKey: 'unknown',
  inputSchema: [],
  allowedHosts: SIMULATION_HOSTS,
  steps: [],
  successChecks: [],
};

function capabilityFromKey(scriptKey: string): string | null {
  const normalized = scriptKey.replace(/^demo\./, '').replace(/^amazon\./, '').replace(/_walkthrough_v\d+$/, '').replace(/\.v\d+$/, '');
  return Object.hasOwn(DEFINITIONS, normalized) ? normalized : null;
}

function resolveScript(scriptKey: string): AutomationScript {
  const exact = SCRIPTS[scriptKey];
  if (exact) return exact;
  const capabilityKey = capabilityFromKey(scriptKey || '');
  if (capabilityKey) {
    const resolvedKey = scriptKey.startsWith('demo.')
      ? `demo.${capabilityKey}_walkthrough_v1`
      : `amazon.${capabilityKey}.v1`;
    const resolved = SCRIPTS[resolvedKey];
    if (resolved) return { ...resolved, requestedKey: scriptKey };
  }
  return { ...FALLBACK_SCRIPT, requestedKey: scriptKey || null };
}

module.exports = { FALLBACK_SCRIPT, SCRIPTS: Object.freeze(SCRIPTS), resolveScript };
