import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OwnedNavigationTarget } from '../../../electron/automation/targets/navigation-scope.cjs'

const require = createRequire(import.meta.url)
const { OwnedNavigationScope } = require(resolve('dist-electron/electron/automation/targets/navigation-scope.cjs')) as typeof import('../../../electron/automation/targets/navigation-scope.cjs')
const source = { webContentsId: 10, referrerUrl: 'https://school.example/ECrossAmazonHome/CompanySellerAmazonIndex?paras=local-only' }
const expected = { origin: 'https://school.example', path: '/ECrossAmazon/SellerIndex' }
function target(id = 20, url = `${expected.origin}${expected.path}`): OwnedNavigationTarget<string> {
  return { webContentsId: id, value: 'owned-window', ready: Promise.resolve(), currentUrl: () => url, dispose: vi.fn() }
}
const observation = () => ({ openerWebContentsId: source.webContentsId, referrerUrl: source.referrerUrl, url: `${expected.origin}${expected.path}?paras=never-returned` })

describe('one-action owned popup navigation', () => {
  it('arms before the click and returns only the exact new window without raw navigation context', async () => {
    const scope = new OwnedNavigationScope(() => undefined, 100, 0)
    const child = target()
    const result = await scope.run(source, expected, async () => { expect(scope.offer(observation(), () => child)).toBe(true) })
    expect(result).toMatchObject({ openerWebContentsId: 10, targetWebContentsId: 20, origin: expected.origin, path: expected.path, target: 'owned-window' })
    expect(JSON.stringify(result)).not.toContain('paras')
    expect(scope.active).toBe(false)
  })
  it('never consumes another opener popup or an existing window', async () => {
    const scope = new OwnedNavigationScope(() => undefined, 100, 0)
    const factory = vi.fn(() => target())
    await scope.run(source, expected, async () => {
      expect(scope.offer({ ...observation(), openerWebContentsId: 99 }, factory)).toBe(false)
      expect(factory).not.toHaveBeenCalled()
      scope.offer(observation(), () => target())
    })
    expect(scope.offer(observation(), factory)).toBe(false)
  })
  it.each([
    { referrerUrl: 'https://school.example/' },
    { referrerUrl: 'https://school.example/ECrossAmazonHome/CompanySellerAmazonIndex?paras=another-course' },
    { url: 'https://sibling.school.example/ECrossAmazon/SellerIndex' },
    { url: 'https://school.example/ECrossAmazon/SellerIndexExtra' },
  ])('rejects mismatched source/target %j without creating the offered window', async mismatch => {
    const scope = new OwnedNavigationScope(() => undefined, 100, 0)
    const factory = vi.fn(() => target())
    await expect(scope.run(source, expected, async () => { scope.offer({ ...observation(), ...mismatch }, factory) })).rejects.toMatchObject({ code: 'TARGET_NAVIGATION_MISMATCH' })
    expect(factory).not.toHaveBeenCalled()
  })
  it('fails on two candidates instead of choosing the first and disposes the provisional child', async () => {
    const scope = new OwnedNavigationScope(() => undefined, 100, 0)
    const child = target(); const second = vi.fn(() => target(21))
    await expect(scope.run(source, expected, async () => {
      scope.offer(observation(), () => child); scope.offer(observation(), second)
    })).rejects.toMatchObject({ code: 'TARGET_NAVIGATION_AMBIGUOUS' })
    expect(child.dispose).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })
  it('checks the final loaded route rather than accepting only the requested URL', async () => {
    const scope = new OwnedNavigationScope(() => undefined, 100, 0)
    const child = target(20, 'https://school.example/User/LoginPage24')
    await expect(scope.run(source, expected, async () => { scope.offer(observation(), () => child) })).rejects.toMatchObject({ code: 'TARGET_NAVIGATION_MISMATCH' })
    expect(child.dispose).toHaveBeenCalledTimes(1)
  })
  it('accepts an intentionally empty referrer only with an independent target-context verification', async () => {
    const scope = new OwnedNavigationScope(() => undefined, 100, 0)
    const verify = vi.fn(async () => undefined)
    const result = await scope.run(source, expected, async () => { scope.offer({ ...observation(), referrerUrl: '' }, () => target()) }, verify)
    expect(verify).toHaveBeenCalledWith('owned-window')
    expect(result.targetWebContentsId).toBe(20)
  })
  it('rejects an empty referrer without independent verification and rejects a changed destination course', async () => {
    const scope = new OwnedNavigationScope(() => undefined, 100, 0)
    const factory = vi.fn(() => target())
    await expect(scope.run(source, expected, async () => { scope.offer({ ...observation(), referrerUrl: '' }, factory) })).rejects.toMatchObject({ code: 'TARGET_NAVIGATION_MISMATCH' })
    expect(factory).not.toHaveBeenCalled()
    const child = target()
    await expect(scope.run(source, expected, async () => { scope.offer({ ...observation(), referrerUrl: '' }, () => child) }, async () => { throw new Error('course changed') })).rejects.toMatchObject({ code: 'TARGET_NAVIGATION_CONTEXT_MISMATCH' })
    expect(child.dispose).toHaveBeenCalled()
  })
  it('rejects reuse of the opener as the newly created target', async () => {
    const scope = new OwnedNavigationScope(() => undefined, 100, 0)
    await expect(scope.run(source, expected, async () => { scope.offer(observation(), () => target(source.webContentsId)) })).rejects.toMatchObject({ code: 'TARGET_NAVIGATION_NOT_NEW' })
  })
  it('times out without selecting some other tab', async () => {
    const scope = new OwnedNavigationScope(() => undefined, 10, 0)
    await expect(scope.run(source, expected, async () => undefined)).rejects.toMatchObject({ code: 'TARGET_NAVIGATION_TIMEOUT' })
  })
  it('retains the original operation async scope for a native event delivered outside it', async () => {
    const context = new AsyncLocalStorage<string>()
    const scope = new OwnedNavigationScope(() => { if (context.getStore() !== 'operation-A') throw new Error('wrong operation') }, 100, 0)
    const result = context.run('operation-A', () => scope.run(source, expected, async () => undefined))
    expect(context.getStore()).toBeUndefined()
    expect(scope.offer(observation(), () => target())).toBe(true)
    expect((await result).targetWebContentsId).toBe(20)
  })
  it('cancels an in-flight scope and refuses subsequent late windows', async () => {
    const scope = new OwnedNavigationScope(() => undefined, 100, 0)
    const result = scope.run(source, expected, async () => undefined)
    scope.cancel()
    await expect(result).rejects.toMatchObject({ code: 'TARGET_NAVIGATION_CANCELLED' })
    const factory = vi.fn(() => target())
    expect(scope.offer(observation(), factory)).toBe(false)
    expect(factory).not.toHaveBeenCalled()
  })
})
