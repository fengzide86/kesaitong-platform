import { describe, expect, it } from 'vitest'

import {
  DESKTOP_IPC_PAYLOAD_ERROR_CODE,
  parseDesktopIpcArgs,
  parseDesktopIpcEvent,
  parseSerializableIpcError,
  serializableIpcErrorSchema,
} from './desktop-contract.js'

describe('desktop IPC contract', () => {
  it('only accepts local evidence task IDs and kinds, never a renderer file path', () => {
    expect(parseDesktopIpcArgs('artifacts:read', [{ runId: 'local_run_123_abcd', kind: 'screenshot' }]))
      .toEqual([{ runId: 'local_run_123_abcd', kind: 'screenshot' }])
    expect(parseDesktopIpcArgs('artifacts:clear', [])).toEqual([])
    expect(() => parseDesktopIpcArgs('artifacts:read', [{ runId: 'run_1', kind: 'screenshot', path: 'C:\\private.png' }])).toThrow()
    expect(() => parseDesktopIpcArgs('artifacts:read', [{ runId: '../run_1', kind: 'diagnostic' }])).toThrow()
    expect(() => parseDesktopIpcArgs('artifacts:read', [{ runId: 'run_1', kind: 'file' }])).toThrow()
  })
  it('accepts the existing credential, activity and external-link calls', () => {
    expect(parseDesktopIpcArgs('credential-save-user-code', [' KST-Y999 '])).toEqual(['KST-Y999'])
    expect(parseDesktopIpcArgs('credential-load-user-code', [])).toEqual([])
    expect(parseDesktopIpcArgs('demo-activity:set-active', ['batch:42', true])).toEqual(['batch:42', true])
    expect(parseDesktopIpcArgs('open-external', ['https://example.com/help'])).toEqual(['https://example.com/help'])
  })

  it('accepts a normal automation and batch workflow without renaming channels', () => {
    expect(parseDesktopIpcArgs('automation:start', [{ id: 7, name: 'Demo tool', executionMode: 'demo' }]))
      .toEqual([{ id: 7, name: 'Demo tool', executionMode: 'demo' }])
    expect(parseDesktopIpcArgs('automation:register-browser', [23])).toEqual([23])

    expect(parseDesktopIpcArgs('batch:create', [{
      importId: 'import_1',
      batchId: 'batch_1',
      serverBatchId: 42,
      tool: { id: 'tool_1', name: 'Batch demo' },
      maxOpenSessions: 6,
      recordKind: 'live',
    }])[0]).toEqual(expect.objectContaining({ batchId: 'batch_1', recordKind: 'live' }))
    expect(parseDesktopIpcArgs('batch:start', [{ itemId: 'item_1', tool: { id: 'tool_1' } }]))
      .toEqual([{ itemId: 'item_1', tool: { id: 'tool_1' } }])
    expect(parseDesktopIpcArgs('batch:cancel', [undefined])).toEqual([undefined])

    expect(parseDesktopIpcEvent('automation:event', {
      protocolVersion: 1,
      eventId: 'event_1',
      type: 'run.started',
    })).toEqual(expect.objectContaining({ type: 'run.started' }))
    expect(parseDesktopIpcEvent('batch:event', {
      type: 'batch.item_updated',
      timestamp: Date.now(),
      itemId: 'item_1',
      snapshot: { status: 'running', recordKind: 'live', counts: {}, items: [] },
    })).toEqual(expect.objectContaining({ itemId: 'item_1' }))
  })

  it('accepts freight requests and notification events used by the current UI', () => {
    expect(parseDesktopIpcArgs('freight:parse-workbook', [{
      id: 'competition-freight',
      version: '1.0.0',
      exchangeRateCnyPerUsd: 7,
      sheetMappings: { epacket: 'E邮宝' },
    }])[0]).toEqual(expect.objectContaining({ version: '1.0.0' }))
    expect(parseDesktopIpcArgs('freight:quote', [{
      request: {
        country: 'US',
        actualWeightKg: 0.5,
        dimensionsCm: { length: 20, width: 15, height: 8 },
      },
    }])[0]).toEqual(expect.objectContaining({ request: expect.objectContaining({ country: 'US' }) }))
    expect(parseDesktopIpcEvent('toolbox:notification-focus', { mode: 'batch', itemId: 'item_1' }))
      .toEqual({ mode: 'batch', itemId: 'item_1' })
  })

  it('rejects malformed and non-cloneable payloads with a stable serializable detail', () => {
    let rejected: unknown
    try {
      parseDesktopIpcArgs('automation:start', [{ id: 'tool_1', callback: () => undefined }])
    } catch (error) {
      rejected = error
    }

    expect(rejected).toBeInstanceOf(Error)
    expect((rejected as Error & { code?: string }).code).toBe(DESKTOP_IPC_PAYLOAD_ERROR_CODE)
    const detail = parseSerializableIpcError(rejected)
    expect(serializableIpcErrorSchema.parse(detail)).toEqual(expect.objectContaining({
      code: DESKTOP_IPC_PAYLOAD_ERROR_CODE,
      channel: 'automation:start',
    }))

    expect(() => parseDesktopIpcArgs('batch:register-browser', ['item_1', '23']))
      .toThrow(DESKTOP_IPC_PAYLOAD_ERROR_CODE)
    expect(() => parseDesktopIpcEvent('toolbox:notification-focus', { mode: 'batch' }))
      .toThrow(DESKTOP_IPC_PAYLOAD_ERROR_CODE)
    expect(() => parseDesktopIpcEvent('automation:event', {
      protocolVersion: 1,
      eventId: 'event_2',
      type: 'artifact.created',
      artifact: { open: () => undefined },
    })).toThrow(DESKTOP_IPC_PAYLOAD_ERROR_CODE)
    expect(parseSerializableIpcError('KST_IPC_ERROR:not-json')).toBeNull()
  })
})
