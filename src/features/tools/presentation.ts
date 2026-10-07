/** Customer-facing task navigation. Runtime permissions remain server-owned. */
export type ProductTaskId = 'company' | 'sourcing' | 'product' | 'shipping' | 'marketing' | 'fba' | 'orders' | 'pricing'
export type ProductTaskGroupId = 'launch' | 'commerce' | 'fulfillment'
export interface ProductTask {
  id: ProductTaskId
  title: string
  group: ProductTaskGroupId
  intent: string
  preparation: string
}

// Same task identities, names and ordering as the approved public website.
// Keep this module free of website components, icons and business API imports.
export const PRODUCT_TASKS: readonly ProductTask[] = [
  { id: 'company', title: '注册公司', group: 'launch', intent: '完成赛训平台里的公司登记', preparation: '准备公司登记资料与比赛或课程任务说明。' },
  { id: 'sourcing', title: '选品', group: 'launch', intent: '比较候选商品与成本，选出合适产品', preparation: '准备候选商品售价、成本、重量与运输方案。' },
  { id: 'product', title: '发布商品', group: 'commerce', intent: '把商品资料整理好并发布出去', preparation: '准备标题、图片、属性、变体、价格与任务要求。' },
  { id: 'shipping', title: '物流模板', group: 'commerce', intent: '按已确定的配送规则配置模板', preparation: '准备配送国家、服务、重量单位与计费规则。' },
  { id: 'marketing', title: '广告营销', group: 'commerce', intent: '处理已确定的广告与活动配置', preparation: '准备活动商品、预算、起止日期与营销参数。' },
  { id: 'fba', title: 'FBA 配送', group: 'fulfillment', intent: '衔接商品、库存与货件配送', preparation: '准备商品与变体、当前库存、配送方式与货件信息。' },
  { id: 'orders', title: '订单发货', group: 'fulfillment', intent: '处理订单到发货的重复步骤', preparation: '准备订单、分拣打包信息、承运人与运单号。' },
  { id: 'pricing', title: '定价与运费比较', group: 'fulfillment', intent: '比较售价、运费与利润方案', preparation: '准备成本、售价、重量、目的地、平台费用与费率。' },
]
export const PRODUCT_TASK_GROUPS: readonly { id: ProductTaskGroupId; title: string; description: string }[] = [
  { id: 'launch', title: '开局与选品', description: '先把公司和商品方向理清。' },
  { id: 'commerce', title: '商品与经营', description: '商品发布、配送规则和营销配置。' },
  { id: 'fulfillment', title: '配送与履约', description: '从 FBA、发货到价格与运费比较。' },
]

// Optional, additive display metadata accepts both C and B catalog shapes.
export interface ToolPresentationInput {
  id?: unknown
  capability_key?: unknown
  platform_key?: unknown
  task_ids?: unknown
  tool_kind?: unknown
  availability?: unknown
  script_status?: unknown
  target_url?: unknown
  release_status?: unknown
  status?: unknown
  available_plans?: unknown
  supports_live_single?: unknown
  supports_live_batch?: unknown
}
const LEGACY_TASKS: Readonly<Record<string, readonly ProductTaskId[]>> = {
  company: ['company'], register_company: ['company'], sourcing: ['sourcing'], product_selection: ['sourcing'],
  listing: ['product'], listing_script: ['product'], ali_listing: ['product'],
  logistics_standard: ['shipping'], logistics_template: ['shipping'],
  logistics_cost: ['shipping', 'pricing'], freight_quote: ['sourcing', 'shipping', 'orders', 'pricing'],
  pricing: ['pricing'], profit_calculator: ['sourcing', 'pricing'],
  ads: ['marketing'], ad_script: ['marketing'], coupon: ['marketing'], coupons: ['marketing'],
  lightning: ['marketing'], prime: ['marketing'], promotion: ['marketing'],
  fba_agl: ['fba'], replenishment: ['fba'], ship_script: ['orders'], ali_ship: ['orders'],
}

export function getToolTaskIds(tool: ToolPresentationInput): ProductTaskId[] {
  const explicit = Array.isArray(tool.task_ids) ? tool.task_ids : []
  const known = new Set(PRODUCT_TASKS.map(task => task.id))
  const valid = explicit.filter((id): id is ProductTaskId => typeof id === 'string' && known.has(id as ProductTaskId))
  if (valid.length) return [...new Set(valid)]
  // register / ali_register are shop registration, not company registration.
  const key = String(tool.capability_key || tool.id || '').replace(/^tool_/, '')
  return [...(LEGACY_TASKS[key] || [])]
}

export function isCustomerTool(tool: ToolPresentationInput): boolean {
  return tool.availability === 'live' || tool.availability === 'live_beta'
}

export function isToolPublished(tool: ToolPresentationInput): boolean {
  const status = tool.release_status || (tool.status === 'online' ? 'available' : tool.status)
  return status === 'available' || status === 'beta' || status === 'online'
}

export function isToolIncluded(tool: ToolPresentationInput, planCode = ''): boolean {
  const plans = Array.isArray(tool.available_plans) ? tool.available_plans.map(plan => String(plan).toUpperCase()) : []
  return !plans.length || plans.includes(planCode.toUpperCase())
}

export interface ToolPresentation {
  label: string
  description: string
  operationLabel: string
  actionLabel: string
  action: 'inspect' | 'execute' | 'calculate' | 'unavailable'
}
export function getToolPresentation(tool: ToolPresentationInput): ToolPresentation {
  const operationLabel = tool.tool_kind === 'calculation' ? '本地计算' : tool.tool_kind === 'inspection' ? '页面检查' : '平台操作'
  if (!isCustomerTool(tool)) return { label: '内部测试', description: '保留内部验证能力，不从普通用户目录启动模拟任务。', operationLabel, actionLabel: '内部测试', action: 'unavailable' }
  if (!isToolPublished(tool) || tool.script_status === 'blocked') return { label: '暂时不可用', description: '当前暂停开放，请稍后重试或联系工具帮助。', operationLabel, actionLabel: '暂时不可用', action: 'unavailable' }
  if (tool.tool_kind === 'calculation') return { label: '计算工具', description: '计算结果用于比较方案，不代表已在外部平台提交操作；入口由对应工具提供。', operationLabel, actionLabel: '计算入口待接入', action: 'calculate' }
  if (tool.script_status === 'browser_ready' && tool.target_url) return { label: '只读检查', description: '仅检查目标页面，不填写、点击或提交业务数据。', operationLabel: '页面检查', actionLabel: '打开只读检查', action: 'inspect' }
  if (tool.script_status !== 'script_ready') return { label: '准备中', description: '当前执行条件尚未齐备，不会用模拟流程替代真实功能。', operationLabel, actionLabel: '执行暂未开放', action: 'unavailable' }
  return tool.availability === 'live_beta'
    ? { label: '受控试用', description: '在支持的平台和版本范围内试用，关键操作需要人工确认。', operationLabel, actionLabel: '开始受控试用', action: 'execute' }
    : { label: '已开放执行', description: '按当前工具范围执行，结果需核对；开放状态不等于所有场景均已验收。', operationLabel, actionLabel: '开始执行', action: 'execute' }
}

export interface ToolUsabilityContext {
  planCode?: string
  runtimeAvailable?: boolean
  mode?: 'single' | 'batch'
  platformScope?: unknown
  platformKey?: string
}
export function isToolInPlatformScope(tool: ToolPresentationInput, context: Pick<ToolUsabilityContext, 'platformScope' | 'platformKey'> = {}): boolean {
  // Older catalogs omit scope. Explicit empty or invalid scopes grant nothing.
  if (context.platformScope === undefined) return true
  const scopes = Array.isArray(context.platformScope)
    ? context.platformScope.filter((scope): scope is string => typeof scope === 'string')
    : typeof context.platformScope === 'string' ? context.platformScope.split(',') : []
  const platform = String(tool.platform_key || context.platformKey || '').trim().toLowerCase()
  return Boolean(platform) && scopes.some(scope => scope.trim().toLowerCase() === platform)
}
export function isToolCurrentlyUsable(tool: ToolPresentationInput, context: ToolUsabilityContext = {}): boolean {
  if (!isCustomerTool(tool) || !isToolPublished(tool) || !isToolIncluded(tool, context.planCode) || !isToolInPlatformScope(tool, context) || !context.runtimeAvailable) return false
  const batch = context.mode === 'batch'
  if ((batch ? tool.supports_live_batch : tool.supports_live_single) !== true) return false
  const presentation = getToolPresentation(tool)
  // Calculation launchers are owned by the tool implementation, not this directory.
  return presentation.action === 'execute' || (!batch && presentation.action === 'inspect')
}
