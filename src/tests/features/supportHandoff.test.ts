import { beforeEach, describe, expect, it } from 'vitest'
import { authService } from '@/utils/auth'
import { consumeSupportDraft, prepareSupportContext, prepareSupportDraft } from '@/features/ai/supportHandoff'

describe('one-shot support ownership', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear()
    authService.setRole('user'); authService.setAuth({ token: 'A-token' }); authService.setUser({ id: 1, auth_code_id: 11 })
  })
  it('maps error code and review status without keeping credentials or raw execution data', () => {
    prepareSupportContext({ tool_name: '上架工具', problem_code: 'E-SAVE', run_status: 'failed', execution_mode: 'live' }, 'amazon')
    const saved = sessionStorage.getItem('toolbox_support_handoff_v1')!
    expect(saved).not.toContain('A-token')
    expect(consumeSupportDraft('amazon')).toContain('当前平台结果待核对，问题编号 E-SAVE')
    expect(consumeSupportDraft('amazon')).toBe('')
  })
  it('rejects another account and another platform', () => {
    prepareSupportDraft('A private question', 'amazon')
    authService.setUser({ id: 2, auth_code_id: 22 })
    expect(consumeSupportDraft('amazon')).toBe('')
    prepareSupportDraft('B question', 'amazon')
    expect(consumeSupportDraft('aliexpress')).toBe('')
  })
  it('logout removes current and legacy handoffs', () => {
    prepareSupportDraft('A question', 'amazon')
    localStorage.setItem('toolbox_support_context', '{}')
    sessionStorage.setItem('toolbox_purchase_inquiry', 'old')
    authService.clear()
    expect(sessionStorage.getItem('toolbox_support_handoff_v1')).toBeNull()
    expect(localStorage.getItem('toolbox_support_context')).toBeNull()
    expect(sessionStorage.getItem('toolbox_purchase_inquiry')).toBeNull()
  })
})
