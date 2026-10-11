import {
  Building2,
  Calculator,
  FileSpreadsheet,
  Megaphone,
  PackageCheck,
  Search,
  Truck,
  Warehouse,
} from '@lucide/vue'

export type TaskAudience = 'individual' | 'team'
export type TaskGroupId = 'launch' | 'commerce' | 'fulfillment'
export type CapabilityStatus =
  | 'interactive-demo'
  | 'controlled-validation'
  | 'desktop-conditional'
  | 'in-development'

export type MarketingTask = {
  id: string
  title: string
  intent: string
  pain: string
  support: string
  inputHint: string
  scoringNote: string
  homePain: string
  homeSupport: string
  status: CapabilityStatus
  audiences: TaskAudience[]
  group: TaskGroupId
  icon: typeof Building2
}

export const statusLabels: Record<CapabilityStatus, string> = {
  'interactive-demo': '在线体验（模拟操作）',
  'controlled-validation': '暂未开放',
  'desktop-conditional': '需安装电脑端，使用前请咨询',
  'in-development': '暂未开放',
}

/**
 * Marketing-only task facts. This is deliberately not a business API model:
 * no account, order, SKU, ASIN, or runtime state belongs here.
 */
export const marketingTasks: MarketingTask[] = [
  {
    id: 'company',
    title: '注册公司',
    homePain: '登记入口多，资料要分头填。',
    homeSupport: '后续辅助登记与重复填写。',
    intent: '我要完成赛训平台里的公司注册',
    pain: '入口多、资料散，常常不知道先填哪一项。',
    support: '后续辅助完成赛训平台里的公司登记，减少资料重复填写与来回找入口。',
    inputHint: '赛训平台要求的公司登记资料，以及本次比赛或课程的任务说明。',
    scoringNote: '暂未开放。后续辅助公司登记，具体适用范围以工具说明为准。',
    status: 'in-development',
    audiences: ['individual', 'team'],
    group: 'launch',
    icon: Building2,
  },
  {
    id: 'sourcing',
    title: '选品',
    homePain: '售价合适，算上运费还赚钱吗？',
    homeSupport: '后续对照价格、重量与成本。',
    intent: '我要比较商品，选出更合适的产品',
    pain: '价格、利润、重量和运输成本要放在一起比较。',
    support: '后续把价格、重量、利润和运费放在一起比较，帮助你判断商品是否合适。',
    inputHint: '候选商品的售价、成本、重量，以及可选运输方式和运费。',
    scoringNote: '暂未开放。后续辅助比较商品，商品取舍仍由你决定。',
    status: 'in-development',
    audiences: ['individual', 'team'],
    group: 'launch',
    icon: Search,
  },
  {
    id: 'product',
    title: '发布商品',
    homePain: '换个商品，标题、属性和变体又要填。',
    homeSupport: '辅助重复录入与页面切换。',
    intent: '我要把商品发布出去',
    pain: '标题、图片、属性、变体和价格需要反复填写。',
    support: '辅助处理明确的重复录入和页面切换，减少商品与变体之间来回找。',
    inputHint: '待发布商品的标题、图片、属性、变体与价格，以及当前任务要求。',
    scoringNote: '商品发布支持的得分配置需按任务确认；不代表所有字段或平台版本都已覆盖。',
    status: 'desktop-conditional',
    audiences: ['individual', 'team'],
    group: 'commerce',
    icon: FileSpreadsheet,
  },
  {
    id: 'shipping',
    title: '物流模板',
    homePain: '国家、单位和计费规则容易混。',
    homeSupport: '后续按已确认的配送规则辅助配置。',
    intent: '我要把物流模板建好',
    pain: '国家、服务、重量单位和计费规则容易混在一起。',
    support: '后续集中整理同一套配送规则，辅助处理重复填写和模板步骤。',
    inputHint: '需要配送的国家、服务、重量单位与已确定的计费规则。',
    scoringNote: '暂未开放。后续辅助物流模板配置，具体适用范围以工具说明为准。',
    status: 'controlled-validation',
    audiences: ['individual', 'team'],
    group: 'commerce',
    icon: Truck,
  },
  {
    id: 'marketing',
    title: '广告营销',
    homePain: '换个活动，又要找商品、填配置。',
    homeSupport: '后续辅助处理已确定的活动配置。',
    intent: '我要把广告和活动配置好',
    pain: '商品、预算、日期和活动入口经常要重新确认。',
    support: '后续按任务提供广告、秒杀和优惠券配置辅助，减少已明确参数的重复填写。',
    inputHint: '参与活动的商品、预算、起止日期，以及已确定的广告或活动参数。',
    scoringNote: '暂未开放。后续辅助广告和活动配置，营销策略仍由你决定。',
    status: 'controlled-validation',
    audiences: ['individual', 'team'],
    group: 'commerce',
    icon: Megaphone,
  },
  {
    id: 'fba',
    title: 'FBA 配送',
    homePain: '商品、库存和货件要衔接起来。',
    homeSupport: '后续辅助整理配送步骤。',
    intent: '我要处理亚马逊配送',
    pain: '配送方式、库存、货件和商品变体容易断开。',
    support: '后续提供 FBA 配送辅助，围绕商品、库存和货件减少重复操作。',
    inputHint: '需要配送的商品与变体、当前库存，以及计划使用的配送方式和货件信息。',
    scoringNote: '暂未开放。后续辅助 FBA 配送，具体适用范围以工具说明为准。',
    status: 'in-development',
    audiences: ['individual', 'team'],
    group: 'fulfillment',
    icon: Warehouse,
  },
  {
    id: 'orders',
    title: '订单发货',
    homePain: '分拣到发货，要跨多个页面。',
    homeSupport: '辅助重复步骤，发货信息由你确认。',
    intent: '我要把订单发出去',
    pain: '分拣、打包、承运人和运单号要经过多个页面。',
    support: '辅助处理重复步骤，保留发货信息和最终确认由人完成。',
    inputHint: '待处理订单、分拣与打包信息，以及确认后的承运人和运单号。',
    scoringNote: '发货任务支持的得分配置需按任务确认；发货信息与最终提交仍由你确认。',
    status: 'desktop-conditional',
    audiences: ['individual', 'team'],
    group: 'fulfillment',
    icon: PackageCheck,
  },
  {
    id: 'pricing',
    title: '定价与运费比较',
    homePain: '换个售价或发货方式，利润就要重算。',
    homeSupport: '后续辅助运费与利润计算比较。',
    intent: '我要算清价格和发货成本',
    pain: '平台费用、运费、利润和售价需要反复计算比较。',
    support: '后续按重量、目的地和费率计算不同方案的运费与利润。',
    inputHint: '商品成本、拟定售价、重量、目的地，以及当前平台费用和运输费率。',
    scoringNote: '暂未开放。后续辅助计算运费与利润，定价策略仍由你决定。',
    status: 'in-development',
    audiences: ['individual', 'team'],
    group: 'fulfillment',
    icon: Calculator,
  },
]

export const taskGroups: Array<{ id: TaskGroupId; title: string; description: string }> = [
  { id: 'launch', title: '开局与选品', description: '先把公司和商品方向理清。' },
  { id: 'commerce', title: '商品与经营', description: '商品发布、配送规则和营销配置。' },
  { id: 'fulfillment', title: '配送与履约', description: '从 FBA、发货到价格与运费比较。' },
]
