import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import MetricComparison from '@/components/landing/MetricComparison.vue'
import type { EvidenceMetric } from '@/marketing/metric-contract'
import { reportedTimeMetrics } from '@/marketing/impact-data'

const measured: EvidenceMetric = {
  metric: 'time', before: 30, after: 12, unit: '分钟', sampleSize: 5,
  taskScope: '同一商品发布任务', measuredAt: '2026-10-06', source: 'measured',
}

describe('public measurement evidence validation', () => {
  const wrappers: VueWrapper[] = []
  const render = (metrics: EvidenceMetric[]) => {
    const wrapper = mount(MetricComparison, { props: { metrics } })
    wrappers.push(wrapper)
    return wrapper
  }
  afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

  it('shows only complete paired measurements and their own source details', () => {
    const wrapper = render([measured])
    expect(wrapper.find('.metric-value-row').text()).toContain('30分钟')
    expect(wrapper.find('.metric-after').text()).toContain('12分钟')
    expect(wrapper.find('.metric-delta').text()).toBe('变化 -18分钟')
    expect(wrapper.find('.metric-card-head').text()).toContain('已实测')
    expect(wrapper.find('.metric-source').text()).toContain('样本 5')
    expect(wrapper.find('.metric-source').text()).toContain('同一商品发布任务')
    expect(wrapper.find('.metric-source').text()).toContain('2026-10-06')
    expect(wrapper.find('.metric-source').text()).toContain('数据来自配对实测')
  })

  it('hides pending metrics even if populated with before and after figures', () => {
    const wrapper = render([{ ...measured, source: 'pending' }])
    expect(wrapper.find('[data-testid="metric-comparison"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/30|12|18|已实测/)
  })

  it('does not publish assisted values for manual records', () => {
    const wrapper = render([{ ...measured, source: 'manual' }])
    expect(wrapper.text()).toContain('人工基线')
    expect(wrapper.text()).toContain('30分钟')
    expect(wrapper.find('.metric-after').text()).toContain('待实测')
    expect(wrapper.text()).not.toContain('12分钟')
    expect(wrapper.find('.metric-delta').text()).toBe('辅助数据待实测')
    expect(wrapper.find('.metric-card-head').text()).not.toContain('已实测')
    expect(wrapper.find('[data-testid="after-number"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delta-number"]').exists()).toBe(false)
  })

  it.each([
    { sampleSize: 0 }, { sampleSize: -1 }, { sampleSize: 1.5 },
    { sampleSize: NaN }, { sampleSize: Infinity }, { sampleSize: undefined },
    { measuredAt: '' }, { measuredAt: undefined }, { measuredAt: '待补测试日期' },
    { measuredAt: '2026-2-03' }, { measuredAt: '2026-02-29' },
    { measuredAt: '2026-04-31' }, { measuredAt: '1900-02-29' },
    { measuredAt: '2026-00-10' }, { measuredAt: '2026-13-01' },
    { measuredAt: '2026-01-00' }, { measuredAt: '0000-01-01' },
    { measuredAt: '2026-10-06T12:00:00Z' }, { measuredAt: ' 2026-10-06 ' },
    { taskScope: '' }, { taskScope: '   ' }, { taskScope: undefined },
  ])('keeps only a baseline when metadata is invalid: %j', invalid => {
    const wrapper = render([{ ...measured, ...invalid } as EvidenceMetric])
    expect(wrapper.text()).toContain('30分钟')
    expect(wrapper.find('.metric-after').text()).toContain('待实测')
    expect(wrapper.find('.metric-delta').text()).toBe('辅助数据待实测')
    expect(wrapper.find('.metric-card-head').text()).not.toContain('已实测')
    expect(wrapper.text()).not.toContain('12分钟')
    expect(wrapper.text()).not.toContain('变化')
  })

  it.each(['2024-02-29', '2000-02-29'])('accepts valid leap day %s', measuredAt => {
    const wrapper = render([{ ...measured, measuredAt }])
    expect(wrapper.find('.metric-delta').text()).toBe('变化 -18分钟')
  })

  it.each([NaN, Infinity, -Infinity, -1, null])('hides invalid baseline %s', before => {
    const wrapper = render([{ ...measured, before }])
    expect(wrapper.find('[data-testid="metric-comparison"]').exists()).toBe(false)
  })

  it.each([NaN, Infinity, -Infinity, -1, null])('withholds invalid assisted value %s', after => {
    const wrapper = render([{ ...measured, after }])
    expect(wrapper.text()).toContain('30分钟')
    expect(wrapper.find('.metric-after').text()).toContain('待实测')
    expect(wrapper.find('.metric-delta').text()).toBe('辅助数据待实测')
    expect(wrapper.html()).not.toMatch(/NaN|Infinity/)
  })

  it('accepts zero measurements without claiming a time saving', () => {
    const wrapper = render([{ ...measured, before: 0, after: 0 }])
    expect(wrapper.find('[data-testid="before-number"]').text()).toBe('0分钟')
    expect(wrapper.find('[data-testid="after-number"]').text()).toBe('0分钟')
    expect(wrapper.find('.metric-delta').text()).toBe('变化 0分钟')
    expect(wrapper.find('[data-testid="delta-number"]').exists()).toBe(false)
  })

  it('shows independent provenance for mixed metrics without sharing sample sizes or sources', () => {
    const wrapper = render([
      measured,
      { metric: 'score', before: 48, after: 80, unit: '分', sampleSize: 2, taskScope: '广告配置练习', measuredAt: '2026-10-05', source: 'manual' },
      { ...measured, before: 999, after: 888, source: 'pending' },
    ])
    const cards = wrapper.findAll('.metric-card')
    expect(cards).toHaveLength(2)
    const sources = wrapper.findAll('[data-testid="metric-provenance"]')
    expect(sources).toHaveLength(2)
    const timeSource = sources[0]!.text()
    const scoreSource = sources[1]!.text()
    expect(timeSource).toContain('样本 5')
    expect(timeSource).toContain('同一商品发布任务')
    expect(timeSource).toContain('2026-10-06')
    expect(scoreSource).toContain('样本 2')
    expect(scoreSource).toContain('广告配置练习')
    expect(scoreSource).toContain('2026-10-05')
    expect(scoreSource).not.toContain('样本 5')
    expect(scoreSource).not.toContain('数据来自配对实测')
    expect(cards[1]!.find('.metric-after').text()).toContain('待实测')
    expect(wrapper.text()).not.toMatch(/999|888|80分/)
  })

  it('shows all three reported cases together without requiring selection or upgrading their evidence', () => {
    const wrapper = render(reportedTimeMetrics)
    expect(reportedTimeMetrics.map(metric => [metric.before, metric.after])).toEqual([[21, 2], [33, 2], [15, 3]])
    expect(reportedTimeMetrics.every(metric => metric.source === 'reported')).toBe(true)
    expect(reportedTimeMetrics.every(metric => metric.sampleSize === null && metric.measuredAt === null)).toBe(true)
    const results = wrapper.findAll('[data-testid="metric-result"]')
    expect(results).toHaveLength(3)
    expect(results.map(result => result.isVisible())).toEqual([true, true, true])
    expect(results.map(result => result.find('[data-testid="before-number"]').text())).toEqual(['21分钟', '33分钟', '15分钟'])
    expect(results.map(result => result.find('[data-testid="after-number"]').text())).toEqual(['2分钟', '2分钟', '3分钟'])
    expect(results.map(result => result.find('[data-testid="delta-number"]').text())).toEqual(['19', '31', '12'])
    expect(results.map(result => result.find('.metric-card-head').text())).toEqual(['发布 1 个商品', '创建 1 个物流模板', '处理 1 个订单'])
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="metric-task-selector"]').exists()).toBe(false)
    expect(wrapper.findAll('.metric-source')).toHaveLength(1)
    expect(wrapper.find('.metric-source').text()).toContain('用户提供案例')
    expect(wrapper.find('.metric-source').text()).toContain('待补充')
    expect(wrapper.text()).not.toMatch(/已实测|平均用时|平均节省|配对实测|样本\s*\d|\d{4}-\d{2}-\d{2}/)
  })

  it.each([NaN, Infinity, -Infinity, -1, null])('withholds an invalid reported assisted value %s', after => {
    const wrapper = render([{ ...reportedTimeMetrics[0]!, after }])
    expect(wrapper.find('[data-testid="before-number"]').text()).toBe('21分钟')
    expect(wrapper.find('[data-testid="after-number"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delta-number"]').exists()).toBe(false)
    expect(wrapper.find('.metric-delta').text()).toBe('辅助数据待实测')
    expect(wrapper.find('.metric-source').text()).toContain('用户提供')
    expect(wrapper.html()).not.toMatch(/NaN|Infinity/)
  })

  it('does not claim a time saving when the reported assisted task takes longer', () => {
    const wrapper = render([{ ...reportedTimeMetrics[0]!, after: 24 }])
    expect(wrapper.find('[data-testid="after-number"]').text()).toBe('24分钟')
    expect(wrapper.find('[data-testid="delta-number"]').exists()).toBe(false)
    expect(wrapper.find('.metric-saving').exists()).toBe(false)
    expect(wrapper.find('.metric-delta').text()).toBe('本案例变化 +3分钟')
  })

  it('keeps incomplete reported task scope from producing a comparison', () => {
    const wrapper = render([{ ...reportedTimeMetrics[0]!, taskScope: '   ' }])
    expect(wrapper.find('[data-testid="before-number"]').text()).toBe('21分钟')
    expect(wrapper.find('[data-testid="after-number"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="delta-number"]').exists()).toBe(false)
  })
})
