import { describe, expect, it } from 'vitest'

import { updateSnapshotSchema } from './update-contract.js'

describe('updateSnapshotSchema', () => {
  it('accepts an actionable downloaded update', () => {
    const snapshot = updateSnapshotSchema.parse({
      status: 'downloaded',
      currentVersion: '1.7.2',
      availableVersion: '1.8.0',
      releaseNotes: ['改进公告中心'],
      percent: 100,
      transferredBytes: 1024,
      totalBytes: 1024,
      canRestart: true,
    })

    expect(snapshot.releaseNotes).toEqual(['改进公告中心'])
  })

  it('rejects fabricated progress values', () => {
    expect(() => updateSnapshotSchema.parse({
      status: 'downloading',
      currentVersion: '1.7.2',
      percent: 120,
      canRestart: false,
    })).toThrow()
  })

  it('accepts only observable download phases and cancellation state', () => {
    const snapshot = updateSnapshotSchema.parse({
      status: 'cancelling', currentVersion: '1.8.15', canRestart: false,
      downloadPhase: 'transferring', bytesPerSecond: 1234,
      lastProgressAt: '2026-10-12T06:00:00.000Z', downloadStalled: true,
      canRetryDownload: false, canRetryInstall: false,
    })
    expect(snapshot.status).toBe('cancelling')
    expect(snapshot.bytesPerSecond).toBe(1234)
    for (const invalid of [
      { bytesPerSecond: -1 }, { bytesPerSecond: Number.POSITIVE_INFINITY },
      { downloadPhase: 'verified' }, { lastProgressAt: 'a while ago' },
    ]) {
      expect(updateSnapshotSchema.safeParse({ ...snapshot, ...invalid }).success).toBe(false)
    }
  })
})
