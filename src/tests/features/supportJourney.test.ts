import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { demoPreviewFor } from '@/features/automation/demoPreview'
import { useCustomerSupportChat } from '@/features/ai/useCustomerSupportChat'
import { prepareSupportDraft } from '@/features/ai/supportHandoff'
import { authService } from '@/utils/auth'

const mocks = vi.hoisted(() => ({ transfer: vi.fn(), prompt: vi.fn(), confirm: vi.fn(), create: vi.fn(), toast: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessageBox: { prompt: mocks.prompt } }))
vi.mock('@/stores/platform', () => ({ usePlatformStore: () => ({ currentPlatform: 'amazon' }) }))
vi.mock('@/shared/ui/confirm', () => ({ confirmAction: mocks.confirm }))
vi.mock('@/utils', () => ({ showToast: mocks.toast }))
vi.mock('@/utils/api', () => ({
  createChatSession: mocks.create, transferChatToHuman: mocks.transfer,
  getChatHistory: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  sendChatMessage: vi.fn(), getChatSession: vi.fn(), resolveChatSession: vi.fn(),
}))

describe('customer support handoff', () => {
  async function setup() {
    mocks.create.mockResolvedValue({ session_id: 'test-session', status: 'active', welcome_message: '你好', suggested_questions: [] })
    mocks.prompt.mockResolvedValue({ value: '我想购买冲刺套餐' })
    mocks.confirm.mockResolvedValue(true)
    mocks.transfer.mockResolvedValue({ feedback_id: 1 })
    let chat!: ReturnType<typeof useCustomerSupportChat>
    const wrapper = mount(defineComponent({ setup() { chat = useCustomerSupportChat(); return () => null } }))
    await flushPromises()
    return { chat, wrapper }
  }
  it('requires an editable question before welcome-only handoff', async () => {
    const { chat, wrapper } = await setup()
    await chat.transferToHuman()
    expect(mocks.prompt).toHaveBeenCalled()
    expect(mocks.transfer).toHaveBeenCalledWith('test-session', { summary: '我想购买冲刺套餐' })
    expect(chat.sessionTransferred.value).toBe(true)
    expect(chat.messages.value.some(m => m.content === '我想购买冲刺套餐')).toBe(true)
    wrapper.unmount()
  })
  it('does not transfer after the question dialog is cancelled', async () => {
    const { chat, wrapper } = await setup()
    mocks.prompt.mockRejectedValue('cancel')
    await chat.transferToHuman()
    expect(mocks.transfer).not.toHaveBeenCalled()
    expect(chat.sessionTransferred.value).toBe(false)
    wrapper.unmount()
  })
  it('leaves purchase context as a draft rather than automatically submitting', async () => {
    authService.setAuth({ token: 'test-token' })
    authService.setRole('user')
    authService.setUser({ id: 1 })
    prepareSupportDraft('咨询套餐', 'amazon')
    const { chat, wrapper } = await setup()
    expect(chat.inputMessage.value).toBe('咨询套餐')
    expect(chat.messages.value).toHaveLength(1)
    expect(sessionStorage.getItem('toolbox_purchase_inquiry')).toBeNull()
    wrapper.unmount()
  })
  it('releases submit state after failure so the user can retry', async () => {
    const { chat, wrapper } = await setup()
    mocks.transfer.mockRejectedValue(new Error('网络失败'))
    await chat.transferToHuman()
    expect(chat.isTransferring.value).toBe(false)
    expect(chat.sessionTransferred.value).toBe(false)
    expect(mocks.toast).toHaveBeenCalledWith('网络失败', 'error')
    wrapper.unmount()
  })
})

describe('honest demo content', () => {
  it('describes meaningful inputs but never represents live execution or a real quote', () => {
    expect(demoPreviewFor('物流模板').fields[0]?.value).toContain('示例')
    expect(demoPreviewFor('运费比较').output).toContain('不提供真实报价')
    expect(demoPreviewFor('其他工具').output).toContain('不代表平台任务成功')
  })
})
