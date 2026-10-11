import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearApiCache, getUser, getUsersPage, getAuthCode, getAuthCodesPage, getFeedback, getOrder } from '@/utils/api'
import { getStaffAccountsPage } from '@/utils/api/staff'
import { extendAuthCode } from '@/utils/api/auth-codes'

beforeEach(() => {
  clearApiCache('')
  localStorage.clear()
  sessionStorage.clear()
})

describe('admin exact-object readbacks', () => {
  it('retains staff total and server-side keyword past the first hundred accounts', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [{ id: 121 }], total: 121, page: 7, page_size: 20 }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    expect(await getStaffAccountsPage({ page: 7, q: '成员', page_size: 20 })).toMatchObject({ items: [{ id: 121 }], total: 121, page: 7 })
    expect(new URL(String(fetcher.mock.calls[0]?.[0]), 'http://localhost').searchParams.get('q')).toBe('成员')
  })
  it('extends through one atomic request, without client date or status calculation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 9, status: 'frozen' }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    expect(await extendAuthCode(9, 30)).toMatchObject({ status: 'frozen' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/api/auth-codes/9/extend')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{"days":30}' })
  })
  it('retains authorization server pagination and forwards every filter without caching', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [{ id: 101 }], total: 101, page: 6, page_size: 20 }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const params = { page: 6, page_size: 20, keyword: '验收', product_type: 'consumer', status: 'expired', platform_key: 'amazon' }
    expect(await getAuthCodesPage(params)).toMatchObject({ items: [{ id: 101 }], total: 101, page: 6, page_size: 20 })
    await getAuthCodesPage(params)
    expect(fetcher).toHaveBeenCalledTimes(2)
    const url = new URL(String(fetcher.mock.calls[0]?.[0]), 'http://localhost')
    for (const [key, value] of Object.entries(params)) expect(url.searchParams.get(key)).toBe(String(value))
  })

  it.each([
    [getUser, '/api/users/'], [getAuthCode, '/api/auth-codes/'],
    [getFeedback, '/api/feedback/'], [getOrder, '/api/orders/'],
  ] as const)('encodes the object ID, forwards platform and never reuses a cached detail (%s)', async (read, path) => {
    let sequence = 0
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, data: { id: 7, sequence: ++sequence } }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    expect(await read('7/extra', { platform_key: 'amazon' })).toMatchObject({ sequence: 1 })
    expect(await read('7/extra', { platform_key: 'amazon' })).toMatchObject({ sequence: 2 })
    expect(fetcher).toHaveBeenCalledTimes(2)
    const url = new URL(String(fetcher.mock.calls[0]?.[0]), 'http://localhost')
    expect(url.pathname).toBe(path + '7%2Fextra')
    expect(url.searchParams.get('platform_key')).toBe('amazon')
  })

  it('retains server counts and filters when reverse-looking up activated users', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, data: [{ id: 42, auth_code_id: 17 }], total: 21, page: 2, page_size: 20, total_pages: 2 }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const result = await getUsersPage({ auth_code_id: 17, page: 2, platform_key: 'amazon' })
    expect(result).toMatchObject({ items: [{ id: 42, auth_code_id: 17 }], total: 21, page: 2 })
    const url = new URL(String(fetcher.mock.calls[0]?.[0]), 'http://localhost')
    expect(url.searchParams.get('auth_code_id')).toBe('17')
    expect(url.searchParams.get('page')).toBe('2')
  })
})
