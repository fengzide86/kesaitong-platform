import type { EvidenceMetric } from './metric-contract'

/** Figures supplied by a user. Unknown measurement metadata stays unknown. */
export const reportedTimeMetrics: EvidenceMetric[] = [
  {
    metric: 'time',
    before: 21,
    after: 2,
    unit: '分钟',
    sampleSize: null,
    taskScope: '发布 1 个商品',
    measuredAt: null,
    source: 'reported',
  },
  {
    metric: 'time',
    before: 33,
    after: 2,
    unit: '分钟',
    sampleSize: null,
    taskScope: '创建 1 个物流模板',
    measuredAt: null,
    source: 'reported',
  },
  {
    metric: 'time',
    before: 15,
    after: 3,
    unit: '分钟',
    sampleSize: null,
    taskScope: '处理 1 个订单',
    measuredAt: null,
    source: 'reported',
  },
]

export type CaseOutcome = {
  id: 'course' | 'competition'
  title: string
  before: { value: number; unit: '分'; label: string }
  after: { value: number | string; unit?: '分'; label: string }
  note: string
  source: 'reported'
}

export const reportedOutcomeCases: CaseOutcome[] = [
  {
    id: 'course',
    title: '实训成绩案例',
    before: { value: 21, unit: '分', label: '使用前' },
    after: { value: 90, unit: '分', label: '使用后' },
    source: 'reported',
    note: '用户提供案例，成绩变化与比赛结果受练习、策略及评分规则影响。',
  },
  {
    id: 'competition',
    title: '比赛经历案例',
    before: { value: 60, unit: '分', label: '使用前（及格）' },
    after: { value: '全国一等奖', label: '后续比赛结果' },
    source: 'reported',
    note: '用户提供案例，成绩变化与比赛结果受练习、策略及评分规则影响。',
  },
]
