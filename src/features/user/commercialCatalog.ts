import { z } from 'zod'
import { api } from '@/utils/api'
import type { CustomerPlan } from './model'

const publicOfferSchema = z.object({
  sku: z.string().min(1), version: z.number().int().positive(), name: z.string().min(1),
  price: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  business_line: z.enum(['trial', 'competition', 'training', 'single_tool', 'service']),
  term_type: z.enum(['project_end', 'service_fulfillment']), description: z.string(),
  availability: z.enum(['consult', 'limited', 'available']),
  allowed_capabilities: z.array(z.string()),
  services: z.array(z.object({
    code: z.string(), count: z.number().int().positive(), minutes_per_unit: z.number().int().nonnegative(),
  }).strict()),
}).strict()

const catalogSchema = z.object({
  schema_version: z.literal(1),
  catalog_version: z.string(),
  items: z.array(publicOfferSchema),
}).strict()

type PublicOffer = z.infer<typeof publicOfferSchema>
export type CommercialPlan = CustomerPlan & Pick<PublicOffer, 'business_line' | 'description' | 'availability' | 'services' | 'allowed_capabilities'>

const serviceNames: Record<string, string> = {
  'materials-topic': '专题资料', 'materials-full': '完整资料', diagnosis: '账号诊断', 'group-qa': '集中答疑', appointment: '预约答疑',
}

export function commercialServiceLabel(service: PublicOffer['services'][number]): string {
  const unit = service.code === 'materials-full' ? '套' : service.code === 'materials-topic' ? '份' : '次'
  return `${serviceNames[service.code] || service.code} ${service.count} ${unit}${service.minutes_per_unit ? `，每次 ${service.minutes_per_unit} 分钟` : ''}`
}

const capabilityNames: Record<string, string> = {
  'company.register': '公司注册', 'product.create': '上品', 'template.create': '物流模板',
  ad_script: '广告', flash_sale: '秒杀', coupon: '优惠券', fba_agl: 'FBA 配送', ship_script: '订单发货',
}
const calculatorNames: Record<string, string> = {
  'freight.quote': '运费', selection_compare: '选品比较', cost_calculator: '成本', price_calculator: '售价', profit_calculator: '利润',
}

function offerBenefits(item: PublicOffer): string[] {
  const benefits: string[] = []
  const capabilities = new Set(item.allowed_capabilities)
  if (item.business_line === 'trial') {
    for (const [code, label] of [['company.register', '赛训平台内公司注册 1 次'], ['product.create', '上品 1 个商品'], ['template.create', '物流模板体验 1 次']]) {
      if (code && label && capabilities.has(code)) benefits.push(label)
    }
  } else {
    for (const group of [['company.register', 'product.create', 'template.create'], ['ad_script', 'flash_sale', 'coupon'], ['fba_agl', 'ship_script']]) {
      const included = group.filter(code => capabilities.has(code)).map(code => capabilityNames[code])
      if (included.length) benefits.push(included.join('、'))
    }
  }
  const calculators = Object.keys(calculatorNames).filter(code => capabilities.has(code)).map(code => calculatorNames[code])
  if (calculators.length) benefits.push(`${calculators.join('、')}计算`)
  benefits.push(...item.services.map(commercialServiceLabel))
  return benefits
}

export async function loadCommercialPlans(): Promise<CommercialPlan[]> {
  const catalog = catalogSchema.parse(await api.get('/api/commercial/catalog', {}, { cache: false }))
  return catalog.items.map(item => ({
    id: `offer:${item.sku}:${item.version}`, name: item.name, plan_code: item.sku,
    business_line: item.business_line, description: item.description, availability: item.availability,
    services: item.services, allowed_capabilities: item.allowed_capabilities,
    price: item.price, status: 'active', duration_days: 0,
    duration_label: item.term_type === 'service_fulfillment' ? '按约定服务次数与时长履约'
      : item.business_line === 'training' ? '本次实训全程 · 以约定结束时间为准' : '约定项目全程 · 以授权结束时间为准',
    is_recommended: item.sku === 'competition-full', display_badge: item.sku === 'competition-full' ? '推荐方案' : undefined,
    benefits: offerBenefits(item),
  }))
}
