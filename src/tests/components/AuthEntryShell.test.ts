import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AuthEntryShell from '@/components/auth/AuthEntryShell.vue'
import AuthArtwork from '@/components/auth/AuthArtwork.vue'

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
  })
})

describe('AuthArtwork', () => {
  it('为用户端透传背景样式且不向辅助技术暴露装饰', () => {
    const wrapper = mount(AuthArtwork, { props: { variant: 'consumer' }, attrs: { class: 'brand-shapes' } })

    expect(wrapper.classes()).toEqual(expect.arrayContaining(['auth-artwork', 'auth-artwork-consumer', 'brand-shapes']))
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('svg').attributes('focusable')).toBe('false')
  })

  it('为管理端提供独立的背景样式且不参与键盘交互', () => {
    const wrapper = mount(AuthArtwork, { props: { variant: 'admin' }, attrs: { class: 'admin-contours' } })

    expect(wrapper.classes()).toEqual(expect.arrayContaining(['auth-artwork-admin', 'admin-contours']))
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('svg').attributes('focusable')).toBe('false')
  })
})
