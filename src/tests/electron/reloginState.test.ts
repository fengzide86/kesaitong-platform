import { describe, expect, it } from 'vitest'

// The Electron sources are compiled to dist-electron before these tests run.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the test intentionally loads the compiled Electron artifact.
const { bindAccountRef, canCreatePlan, createReLoginState, markLoginAttempt, markLoginRequired, markLoginSuccess, markPolicyBlocked } = require('../../../dist-electron/electron/automation/targets/relogin-state.cjs') as typeof import('../../../electron/automation/targets/relogin-state.cjs')

describe('controlled target re-login state', () => {
  it('requires a human login after a new scene is opened', () => {
    const initial = createReLoginState(100)
    expect(initial.status).toBe('needs_manual_login')
    expect(canCreatePlan(initial)).toBe(false)
  })

  it('does not treat a login attempt as authenticated until the success evidence arrives', () => {
    const waiting = markLoginAttempt(createReLoginState(100), 120)
    expect(waiting.status).toBe('awaiting_verification')
    expect(waiting.attempts).toBe(1)
    expect(canCreatePlan(waiting)).toBe(false)
    const ready = markLoginSuccess(waiting, 140)
    expect(ready.status).toBe('authenticated')
    expect(canCreatePlan(ready)).toBe(true)
  })

  it('returns to manual recovery and never preserves a plan-ready state after failure', () => {
    const ready = markLoginSuccess(createReLoginState(), 100)
    const blocked = markLoginRequired(ready, 'TARGET_LOGIN_REJECTED', 200)
    expect(blocked.status).toBe('needs_manual_login')
    expect(blocked.reason).toBe('TARGET_LOGIN_REJECTED')
    expect(canCreatePlan(blocked)).toBe(false)
  })

  it('separates policy blocking from ordinary re-login and keeps the reason visible', () => {
    const blocked = markPolicyBlocked(createReLoginState(), '管理员工作台授权已失效', 300)
    expect(blocked.status).toBe('blocked')
    expect(blocked.reason).toContain('工作台授权')
    expect(canCreatePlan(blocked)).toBe(false)
  })

  it('blocks a customer from substituting another external account', () => {
    expect(bindAccountRef('customer', undefined, 'a'.repeat(64))).toEqual({ accepted: true, boundAccountRef: 'a'.repeat(64) })
    expect(bindAccountRef('customer', 'a'.repeat(64), 'a'.repeat(64)).accepted).toBe(true)
    expect(bindAccountRef('customer', 'a'.repeat(64), 'b'.repeat(64))).toEqual({ accepted: false, reason: 'TARGET_ACCOUNT_SWITCH_BLOCKED' })
    expect(bindAccountRef('staff', 'a'.repeat(64), 'b'.repeat(64)).accepted).toBe(true)
  })
})

