import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MarketingTermsView from '@/marketing/MarketingTermsView.vue'

describe('官网与真实 Windows 工具说明一致', () => {
  it('separates independent simulation from available real tools and provides real contact', () => {
    const wrapper = mount(MarketingTermsView, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    const text = wrapper.text()
    expect(text).toContain('Windows 效率平台')
    expect(text).toContain('不访问真实平台')
    expect(text).toContain('当前浏览器')
    expect(text).toContain('Moweiiong')
    expect(text).toContain('退出或刷新后恢复初始样例')
    expect(text).not.toContain('当前工具流程属于演示模式')
    expect(text).not.toContain('示意邮箱')
    expect(text).not.toContain('模拟咨询入口')
    wrapper.unmount()
  })
})
