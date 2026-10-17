/**
 * Safe re-login state for a controlled target window.
 *
 * This module intentionally models a human-assisted recovery flow.  It never
 * stores, reads or fills credentials, cookies, OTPs or MFA codes.  When a
 * platform session disappears the runner is paused by its existing owner
 * checks; the user must log in again and the normal identity/context proof is
 * rebuilt before a plan can be created.
 */
export type ReLoginStatus = 'needs_manual_login' | 'awaiting_verification' | 'authenticated' | 'blocked'

export interface ReLoginState {
  status: ReLoginStatus
  attempts: number
  reason: string | null
  changedAt: number
}

export const createReLoginState = (now = Date.now()): ReLoginState => ({
  status: 'needs_manual_login', attempts: 0, reason: null, changedAt: now,
})

export function markLoginAttempt(previous: ReLoginState, now = Date.now()): ReLoginState {
  return { ...previous, status: 'awaiting_verification', attempts: previous.attempts + 1, reason: null, changedAt: now }
}

export function markLoginSuccess(previous: ReLoginState, now = Date.now()): ReLoginState {
  return { ...previous, status: 'authenticated', reason: null, changedAt: now }
}

export function markLoginRequired(previous: ReLoginState, reason: string, now = Date.now()): ReLoginState {
  return { ...previous, status: 'needs_manual_login', reason: reason.slice(0, 160), changedAt: now }
}

export function markPolicyBlocked(previous: ReLoginState, reason = '工作台授权已变化', now = Date.now()): ReLoginState {
  return { ...previous, status: 'blocked', reason: reason.slice(0, 160), changedAt: now }
}

export function canCreatePlan(state: ReLoginState): boolean {
  return state.status === 'authenticated'
}

export type AccountBindingDecision =
  | { accepted: true; boundAccountRef: string }
  | { accepted: false; reason: 'TARGET_ACCOUNT_SWITCH_BLOCKED' }

/** Customer sessions are single-external-account by policy. Staff sessions
 * are checked by the server lease because several staff slots may be used. */
export function bindAccountRef(kind: 'customer' | 'staff' | undefined, current: string | undefined, next: string): AccountBindingDecision {
  if (kind !== 'customer' || !current || current === next) return { accepted: true, boundAccountRef: current || next }
  return { accepted: false, reason: 'TARGET_ACCOUNT_SWITCH_BLOCKED' }
}

