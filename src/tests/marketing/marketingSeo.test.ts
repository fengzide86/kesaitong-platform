import { afterEach, describe, expect, it } from 'vitest'
import { marketingSeoForPath, marketingSeoPages, marketingSitemap, renderMarketingSeo, updateMarketingSeo } from '@/marketing/seo'

const origin = 'https://kesaitong.top'
const head = document.head.innerHTML
afterEach(() => { document.head.innerHTML = head })

describe('marketing search and share metadata', () => {
  it('renders distinct static heads before JavaScript runs, retaining the app shell and security policy', () => {
    const template = '<html><head><title>旧标题</title><meta name="description" content="旧摘要"><link rel="canonical" href="https://kesaitong.top/"><meta property="og:url" content="https://kesaitong.top/"><meta http-equiv="Content-Security-Policy" content="connect-src none"></head><body><div id="app"></div><script type="module" src="/assets/app-12345678.js"></script></body></html>'
    const titles = new Set<string>()
    const descriptions = new Set<string>()
    for (const page of marketingSeoPages) {
      const parsed = new DOMParser().parseFromString(renderMarketingSeo(template, page.path, origin), 'text/html')
      expect(parsed.title).toBe(page.title)
      expect(parsed.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(page.description)
      expect(parsed.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(`${origin}${page.path}`)
      expect(parsed.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${origin}${page.path}`)
      expect(parsed.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
      expect(parsed.querySelectorAll('meta[property="og:url"]')).toHaveLength(1)
      expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull()
      expect(parsed.querySelector('script')?.getAttribute('src')).toBe('/assets/app-12345678.js')
      titles.add(parsed.title)
      descriptions.add(page.description)
    }
    expect(titles.size).toBe(5)
    expect(descriptions.size).toBe(5)
  })

  it('updates metadata on client navigation and removes stale noindex after leaving a missing page', () => {
    updateMarketingSeo(document, '/competition?from=nav', origin)
    expect(document.title).toContain('比赛备赛')
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(`${origin}/competition/`)
    updateMarketingSeo(document, '/not-a-route', origin)
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.querySelector('meta[property="og:url"]')).toBeNull()
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain('noindex')
    updateMarketingSeo(document, '/course/', origin)
    expect(document.title).toContain('课程实训')
    expect(document.querySelector('meta[name="robots"]')).toBeNull()
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${origin}/course/`)
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1)
  })

  it('canonicalizes the legacy terms alias and lists only the five public pages', () => {
    expect(marketingSeoForPath('/user/terms/#privacy').path).toBe('/terms/')
    const xml = marketingSitemap(origin)
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
    expect(urls).toEqual(marketingSeoPages.map(page => `${origin}${page.path}`))
    expect(xml).not.toContain('/user/terms')
    const missing = renderMarketingSeo('<html><head></head><body></body></html>', '/missing', origin)
    expect(missing).toContain('name="robots" content="noindex, follow"')
    expect(missing).not.toContain('rel="canonical"')
  })
})
