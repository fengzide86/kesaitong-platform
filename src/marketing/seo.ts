import pages from './seo-pages.json'

export const marketingSeoPages = pages
export const marketingStaticRoutes = [...pages.filter(page => page.path !== '/').map(page => page.path.slice(1, -1)), 'user/terms']

const notFound = { path: '', title: '页面未找到 · 课赛通 KST', description: '这个页面不存在，请返回课赛通官网，查看比赛备赛、课程实训和工具介绍。' }

export function marketingSeoForPath(path: string) {
  const cleanPath = path.split(/[?#]/)[0] || '/'
  const normalized = cleanPath === '/' ? '/' : `${cleanPath.replace(/\/+$/, '')}/`
  return pages.find(page => page.path === (normalized === '/user/terms/' ? '/terms/' : normalized)) || notFound
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

// The same page definitions power both the static head (link previews/crawlers)
// and Vue navigation. Page content remains rendered by the existing Vue app.
export function renderMarketingSeo(html: string, routePath: string, publicOrigin: string) {
  const page = marketingSeoForPath(routePath)
  const canonical = page.path && publicOrigin ? new URL(page.path, publicOrigin).href : ''
  const image = publicOrigin ? new URL('/pwa-512x512.png', publicOrigin).href : ''
  const tags = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}">`,
    `<meta property="og:type" content="website">`,
    '<meta property="og:locale" content="zh_CN">',
    '<meta property="og:site_name" content="课赛通 KST">',
    `<meta property="og:title" content="${escapeHtml(page.title)}">`,
    `<meta property="og:description" content="${escapeHtml(page.description)}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${escapeHtml(page.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(page.description)}">`,
    ...(page.path ? [] : ['<meta name="robots" content="noindex, follow">']),
    ...(canonical ? [`<link rel="canonical" href="${escapeHtml(canonical)}">`, `<meta property="og:url" content="${escapeHtml(canonical)}">`] : []),
    ...(image ? [`<meta property="og:image" content="${escapeHtml(image)}">`, `<meta name="twitter:image" content="${escapeHtml(image)}">`] : []),
  ]
  return html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b(?=[^>]*(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+)["'])[^>]*>/gi, '')
    .replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/gi, '')
    .replace('</head>', `${tags.join('\n    ')}\n  </head>`)
}

export function marketingSitemap(publicOrigin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(page => `  <url><loc>${escapeHtml(new URL(page.path, publicOrigin).href)}</loc></url>`).join('\n')}\n</urlset>\n`
}

export function updateMarketingSeo(document: Document, routePath: string, publicOrigin: string) {
  const page = marketingSeoForPath(routePath)
  document.title = page.title
  function meta(attribute: 'name' | 'property', key: string, content: string | null) {
    const selector = `meta[${attribute}="${key}"]`
    const current = document.querySelector<HTMLMetaElement>(selector)
    if (content === null) { current?.remove(); return }
    const element = current || document.createElement('meta')
    element.setAttribute(attribute, key)
    element.content = content
    if (!current) document.head.append(element)
  }
  meta('name', 'description', page.description)
  meta('property', 'og:title', page.title)
  meta('property', 'og:description', page.description)
  meta('name', 'twitter:title', page.title)
  meta('name', 'twitter:description', page.description)
  meta('name', 'robots', page.path ? null : 'noindex, follow')
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (page.path) {
    const url = new URL(page.path, publicOrigin).href
    const element = canonical || document.createElement('link')
    element.rel = 'canonical'
    element.href = url
    if (!canonical) document.head.append(element)
    meta('property', 'og:url', url)
  } else {
    canonical?.remove()
    meta('property', 'og:url', null)
  }
}
