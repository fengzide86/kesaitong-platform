import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import AuthEntryShell from '@/components/auth/AuthEntryShell.vue'
import AuthArtwork from '@/components/auth/AuthArtwork.vue'

type ArtworkVariant = 'consumer' | 'admin'
type LiquidRenderer = { setVariant: (variant: ArtworkVariant) => void; dispose: () => void }

const liquid = vi.hoisted(() => ({
  createLiquidRibbon: vi.fn<(canvas: HTMLCanvasElement, variant: ArtworkVariant, onReady: (ready: boolean) => void) => LiquidRenderer>(),
}))

vi.mock('@/components/auth/liquidRibbon', () => ({ createLiquidRibbon: liquid.createLiquidRibbon }))

// Approved liquid study: keep these shapes independent from the implementation
// so an accidental redesign cannot update both the rendering and the assertion.
const approvedRibbon = 'M340 990 C680 860 919 694 907 535 C897 424 676 407 683 285 C690 165 865 109 1114 70 C929 149 792 203 800 281 C810 351 1026 398 1046 513 C1087 733 754 946 340 990Z'
const approvedTributaries = [
  'M526 313 C530 254 572 209 628 183 C653 171 679 162 706 156 C658 177 615 202 584 236 C558 263 539 291 526 313Z',
  'M798 611 C824 694 722 767 588 794 C696 780 816 728 827 666 C829 644 818 623 798 611Z',
  'M1332 709 C1384 797 1278 872 1127 921 C1270 890 1387 829 1374 763 C1369 742 1354 724 1332 709Z',
]

beforeEach(() => {
  liquid.createLiquidRibbon.mockReset()
  liquid.createLiquidRibbon.mockImplementation(() => ({ setVariant: vi.fn(), dispose: vi.fn() }))
})

describe('AuthEntryShell', () => {
  it('提供统一的认证双栏根节点并透传业务属性', () => {
    const wrapper = mount(AuthEntryShell, {
      props: { variant: 'admin' },
      attrs: { class: 'login-container', 'aria-label': '后台账号登录' },
      slots: { default: '<section class="login-card">登录</section>' },
    })

    expect(wrapper.classes()).toEqual(expect.arrayContaining(['auth-entry-shell', 'auth-entry-admin', 'login-container']))
    expect(wrapper.attributes('aria-label')).toBe('后台账号登录')
    expect(wrapper.find('.login-card').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('AuthArtwork', () => {
  it.each(['consumer', 'admin'] as const)('为 %s 保留批准小样的主 S 和三条静态支流作为无 GPU 后备', (variant) => {
    const wrapper = mount(AuthArtwork, { props: { variant } })
    expect(wrapper.get('.brand-ribbon').attributes('d')).toBe(approvedRibbon)
    expect(wrapper.findAll('.brand-tributaries path').map(path => path.attributes('d'))).toEqual(approvedTributaries)
    expect(wrapper.get('.auth-artwork-svg').attributes('viewBox')).toBe('0 0 1440 900')
    expect(wrapper.get('.auth-artwork-svg').attributes('preserveAspectRatio')).toBe('xMidYMid slice')
    expect(wrapper.findAll('.brand-water-current, .brand-orbits, .brand-orbit-glow, .brand-flow-head, .brand-flow-segment')).toHaveLength(0)
    expect(wrapper.get('.auth-liquid-canvas').element).toBeInstanceOf(HTMLCanvasElement)
    expect(wrapper.classes()).not.toContain('is-liquid-ready')
    wrapper.unmount()
  })

  it('挂载时仅创建一个 renderer，并将真实 canvas 与当前端类型传入', () => {
    const wrapper = mount(AuthArtwork, { props: { variant: 'admin' } })
    expect(liquid.createLiquidRibbon).toHaveBeenCalledExactlyOnceWith(
      wrapper.get('.auth-liquid-canvas').element, 'admin', expect.any(Function),
    )
    wrapper.unmount()
  })

  it('只有 renderer 就绪后启用液态层，失效时回到仍然存在的静态 SVG', async () => {
    const wrapper = mount(AuthArtwork)
    const onReady = liquid.createLiquidRibbon.mock.calls[0]![2]
    const fallback = wrapper.get('.auth-artwork-svg').element
    const canvas = wrapper.get('.auth-liquid-canvas').element

    onReady(true)
    await nextTick()
    expect(wrapper.classes()).toContain('is-liquid-ready')
    expect(wrapper.get('.auth-artwork-svg').element).toBe(fallback)

    onReady(false)
    await nextTick()
    expect(wrapper.classes()).not.toContain('is-liquid-ready')
    expect(wrapper.get('.auth-artwork-svg').element).toBe(fallback)
    expect(wrapper.get('.auth-liquid-canvas').element).toBe(canvas)
    wrapper.unmount()
  })

  it('切换端类型更新现有 renderer，不重复创建 WebGL 上下文', async () => {
    const wrapper = mount(AuthArtwork, { props: { variant: 'consumer' } })
    const renderer = liquid.createLiquidRibbon.mock.results[0]!.value as LiquidRenderer

    await wrapper.setProps({ variant: 'admin' })
    expect(wrapper.classes()).toContain('auth-artwork-admin')
    expect(renderer.setVariant).toHaveBeenLastCalledWith('admin')
    await wrapper.setProps({ variant: 'consumer' })
    expect(renderer.setVariant).toHaveBeenLastCalledWith('consumer')
    expect(liquid.createLiquidRibbon).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('卸载时释放 renderer，避免离开登录页后继续绘制', () => {
    const wrapper = mount(AuthArtwork)
    const renderer = liquid.createLiquidRibbon.mock.results[0]!.value as LiquidRenderer
    expect(renderer.dispose).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
  })

  it('同一页面多个背景的 SVG 引用互不串色', () => {
    const wrapper = mount(defineComponent({
      setup: () => () => h('div', [h(AuthArtwork, { variant: 'consumer' }), h(AuthArtwork, { variant: 'admin' })]),
    }))
    const artworks = wrapper.findAllComponents(AuthArtwork)
    const allIds = wrapper.findAll('defs [id]').map(definition => definition.attributes('id'))
    expect(allIds.length).toBeGreaterThan(0)
    expect(new Set(allIds).size).toBe(allIds.length)
    for (const artwork of artworks) {
      const ownIds = artwork.findAll('defs [id]').map(definition => definition.attributes('id'))
      const references = artwork.findAll('[fill^="url("], [stroke^="url("]')
      expect(references.length).toBeGreaterThan(0)
      for (const reference of references) {
        for (const attribute of ['fill', 'stroke']) {
          const value = reference.attributes(attribute)
          if (value?.startsWith('url(#')) expect(ownIds).toContain(value.slice(5, -1))
        }
      }
    }
    wrapper.unmount()
  })

  it('为用户端透传背景样式且不向辅助技术暴露装饰', () => {
    const wrapper = mount(AuthArtwork, { props: { variant: 'consumer' }, attrs: { class: 'brand-shapes' } })

    expect(wrapper.classes()).toEqual(expect.arrayContaining(['auth-artwork', 'auth-artwork-consumer', 'brand-shapes']))
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('svg').attributes('focusable')).toBe('false')
    expect(wrapper.find('[tabindex]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('为管理端提供独立的背景样式且不参与键盘交互', () => {
    const wrapper = mount(AuthArtwork, { props: { variant: 'admin' }, attrs: { class: 'admin-contours' } })

    expect(wrapper.classes()).toEqual(expect.arrayContaining(['auth-artwork-admin', 'admin-contours']))
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('svg').attributes('focusable')).toBe('false')
    expect(wrapper.find('[tabindex]').exists()).toBe(false)
    wrapper.unmount()
  })
})
