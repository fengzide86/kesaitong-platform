import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DemoCasePreview from '@/components/DemoCasePreview.vue'

// Kept solely for historical internal fixtures, not imported by any customer entry.
describe('legacy internal fixture presentation', () => {
  it('explicitly distinguishes fixture output from a real platform result', () => {
    const wrapper = mount(DemoCasePreview, { props: { toolName: '历史工具样例', platform: 'Amazon', completed: true } })
    expect(wrapper.text()).toContain('流程示例 · 非真实数据')
    expect(wrapper.text()).toContain('不连接外部平台')
    expect(wrapper.text()).toContain('示例流程已结束')
    wrapper.unmount()
  })
})
