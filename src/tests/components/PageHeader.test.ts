import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import { provideShellPageHeader } from '@/features/shell/pageHeaderContext'

const Host = defineComponent({
  components: { PageHeader },
  setup() {
    const context = provideShellPageHeader()
    return { header: context.current }
  },
  template: `
    <section>
      <span data-testid="registered-title">{{ header?.title }}</span>
      <PageHeader eyebrow="TEST" title="合并标题" description="合并说明">
        <template #actions><button class="page-action">刷新</button></template>
      </PageHeader>
    </section>
  `,
})

describe('PageHeader', () => {
  it.each([1038, 1180, 1181, 1440])('在 %ipx 按窄窗断点放置操作，不挤占标题', async width => {
    const original = window.matchMedia
    const query = vi.fn(() => ({ matches: width >= 1181, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    window.matchMedia = query as unknown as typeof window.matchMedia
    const target = document.createElement('div')
    target.id = 'shell-page-actions'
    document.body.appendChild(target)
    const wrapper = mount(Host, { attachTo: document.body })
    try {
      await wrapper.vm.$nextTick()
      expect(query).toHaveBeenCalledWith('(min-width: 1181px)')
      expect(Boolean(target.querySelector('.page-action'))).toBe(width >= 1181)
      expect(wrapper.find('.page-header-v6--actions-only .page-action').exists()).toBe(width <= 1180)
    } finally {
      wrapper.unmount()
      target.remove()
      window.matchMedia = original
    }
  })

  it('没有壳层上下文时在页面内正常显示', () => {
    const wrapper = mount(PageHeader, {
      props: { eyebrow: 'TEST', title: '页面标题', description: '页面说明' },
    })

    expect(wrapper.get('.page-header-v6 h2').text()).toBe('页面标题')
    expect(wrapper.get('.page-header-v6 p').text()).toBe('页面说明')
  })

  it('在壳层中注册标题并把操作传送到顶部操作区', async () => {
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    const target = document.createElement('div')
    target.id = 'shell-page-actions'
    document.body.appendChild(target)
    const wrapper = mount(Host, { attachTo: document.body })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="registered-title"]').text()).toBe('合并标题')
    expect(document.querySelector('#shell-page-actions .page-action')?.textContent).toBe('刷新')
    expect(wrapper.find('.page-header-v6 h2').exists()).toBe(false)
    wrapper.unmount()
    target.remove()
    media.mockRestore()
  })
})
