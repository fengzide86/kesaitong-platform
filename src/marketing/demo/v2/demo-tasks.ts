export type DemoTask = 'product' | 'shipping' | 'template' | 'fba' | 'advertising'
export interface DemoOutcome {
  task: DemoTask
  objectId: string
  title: string
  before: string
  after: string
  facts: { label: string; value: string }[]
  page: string
  params?: Record<string, string>
}
export const demoTasks: Record<DemoTask, { name: string; description: string; stages: string[] }> = {
  product: { name: '商品上架', description: '选择类目，填写商品信息与两个变体，保存后回库存核对。', stages: ['商品类目', '信息与变体', '保存回读'] },
  shipping: { name: '订单发货', description: '读取订单重量与目的国，对比样例运费后选择承运人；完成仓库发货，再回订单填运单并确认。不代表真实报价。', stages: ['详情重量', '目的国比价', '仓库发货', '回填确认'] },
  template: { name: '配送模板', description: '创建配送规则，保存模板并重新打开核对；可继续设置默认或分配到商品。', stages: ['配送方式', '区域与运费', '保存回读'] },
  fba: { name: 'FBA 转换', description: '选择子 SKU，确认仅转换，填写危险品资料，回库存核对配送方式。转换不等于商品已到仓。', stages: ['选择子 SKU', '确认与危险品', 'FBA 库存回读'] },
  advertising: { name: '商品推广', description: '设置活动与广告组，选择样例商品和投放方式，保存后回读广告组详情。', stages: ['活动设置', '商品与投放', '保存回读'] },
}
export function isDemoTask(task: string): task is DemoTask { return Object.hasOwn(demoTasks, task) }
export function taskMeta(task: string) { return demoTasks[isDemoTask(task) ? task : 'product'] }
export function recommendedTask(page: string): DemoTask {
  if (['orders', 'shipment', 'warehouse'].includes(page)) return 'shipping'
  if (page === 'templates') return 'template'
  if (page === 'fba') return 'fba'
  if (page === 'advertising') return 'advertising'
  return 'product'
}
export function stageIndex(task: string, label: string, index: number, total: number): number {
  if (task === 'product') return index < 4 ? 0 : index >= total - 2 ? 2 : 1
  if (task === 'shipping') {
    if (/回原订单|确认发货|已发货列表/.test(label)) return 3
    if (/仓库|分拣|打包|发货记录|已出库|勾选本订单/.test(label)) return 2
    if (/目的国|比价|运费|承运人/.test(label)) return 1
    return 0
  }
  if (/回读|核对|保存并|最终/.test(label)) return 2
  return index < 2 ? 0 : 1
}
