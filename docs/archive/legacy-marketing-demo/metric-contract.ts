// Historical unused metric prototype; current evidence uses metric-evidence.ts.
export type EvidenceMetric = {
  metric: 'time' | 'score'
  before: number | null
  after: number | null
  unit: '分钟' | '分'
  sampleSize: number | null
  taskScope: string
  measuredAt: string | null
  source: 'manual' | 'measured' | 'pending' | 'reported'
}
