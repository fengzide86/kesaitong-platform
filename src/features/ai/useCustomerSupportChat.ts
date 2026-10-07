import { ref, nextTick, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { createChatSession, sendChatMessage, getChatSession, resolveChatSession, transferChatToHuman, getChatHistory } from '@/utils/api'
import { showToast } from '@/utils'
import { usePlatformStore } from '@/stores/platform'
import { confirmAction } from '@/shared/ui/confirm'
import {
  chatHistorySchema,
  chatReplySchema,
  chatSessionCreatedSchema,
  chatSessionDetailSchema,
  parseJsonRecord,
  type ChatMessage,
  type ChatSessionSummary,
} from '@/features/ai/model'
import { formatChatTime as formatTime, supportSessionStatusLabel as getStatusText } from './presentation'


export function useCustomerSupportChat() {
const platformStore = usePlatformStore()

const sessionId = ref<string | null>(null)
type DisplayMessage = ChatMessage & { delivery?: 'sending' | 'sent' | 'failed' }
const messages = ref<DisplayMessage[]>([])
const inputMessage = ref('')
const sendingSessions = ref(new Set<string>())
const isLoading = computed(() => Boolean(sessionId.value && sendingSessions.value.has(sessionId.value)))
const sessionLoading = ref(false)
const sessionError = ref('')
const isTransferring = ref(false)
const showActions = ref(false)
const showRating = ref(false)
const rating = ref(0)
const sessionResolved = ref(false)
const sessionTransferred = ref(false)
const lastAiMessage = ref<string | null>(null)
const messagesContainer = ref<HTMLElement | null>(null)
const showHistory = ref(false)
const historySessions = ref<ChatSessionSummary[]>([])
let nextMsgId = 0
let sessionSequence = 0
let mounted = true
const sessionMessages = new Map<string, DisplayMessage[]>()
const quickQuestions = ['授权码无法使用', '工具一直没有反应', '本次操作未完成', '需要更换设备', '联系人工客服']

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

async function startNewSession() {
  const sequence = ++sessionSequence
  const platform = platformStore.currentPlatform
  sessionLoading.value = true
  sessionError.value = ''
  try {
    const res = chatSessionCreatedSchema.parse(await createChatSession({ platform_key: platform }))
    if (!mounted || sequence !== sessionSequence || platform !== platformStore.currentPlatform) return false
    sessionId.value = res.session_id
    messages.value = [{
      id: nextMsgId++,
      role: 'system',
      content: res.welcome_message || '您好！我是 AI 客服，请问有什么可以帮您？',
      created_at: new Date().toISOString()
    }]
    sessionMessages.set(res.session_id, messages.value)
    inputMessage.value = ''
    lastAiMessage.value = null
    rating.value = 0
    showActions.value = false
    showRating.value = false
    sessionResolved.value = false
    sessionTransferred.value = false
    scrollToBottom()
    return true
  } catch {
    if (!mounted || sequence !== sessionSequence) return false
    sessionError.value = '暂时无法连接客服，请检查网络后重试。'
    showToast('创建会话失败', 'error')
    return false
  } finally {
    if (mounted && sequence === sessionSequence) sessionLoading.value = false
  }
}

function askQuickQuestion(question: string) {
  if (question === '联系人工客服') {
    transferToHuman()
    return
  }
  inputMessage.value = question
  sendMessage()
}

async function sendMessage() {
  const text = inputMessage.value.trim()
  if (!text || isLoading.value || sessionLoading.value || sessionResolved.value || sessionTransferred.value) return
  if (!sessionId.value && !await startNewSession()) return
  if (!sessionId.value) return

  const message: DisplayMessage = {
    id: nextMsgId++,
    role: 'user',
    content: text,
    created_at: new Date().toISOString(),
    delivery: 'sending',
  }
  messages.value.push(message)
  inputMessage.value = ''
  await deliverMessage(messages.value[messages.value.length - 1]!)
}

async function retryMessage(id: number | undefined) {
  const message = messages.value.find(item => item.id === id && item.delivery === 'failed')
  if (!message || isLoading.value || sessionLoading.value || sessionResolved.value || sessionTransferred.value) return
  await deliverMessage(message)
}

async function deliverMessage(message: DisplayMessage) {
  const sid = sessionId.value
  if (!sid) return
  const platform = platformStore.currentPlatform
  const target = messages.value
  const current = () => mounted && sid === sessionId.value && target === messages.value && platform === platformStore.currentPlatform
  sendingSessions.value.add(sid)
  message.delivery = 'sending'
  showActions.value = false
  scrollToBottom()

  try {
    const res = chatReplySchema.parse(await sendChatMessage(sid, message.content, { platform_key: platform }))
    if (res.session_id !== sid) throw new Error('回复会话不匹配')
    message.delivery = 'sent'
    target.push({
      id: nextMsgId++,
      role: 'ai',
      content: res.reply,
      knowledge_refs: res.knowledge_refs || [],
      created_at: new Date().toISOString()
    })
    if (current()) { lastAiMessage.value = res.reply; showActions.value = true }
  } catch {
    message.delivery = 'failed'
    if (current()) showToast('未能确认回复，请稍后重试或联系人工支持', 'error')
  } finally {
    sendingSessions.value.delete(sid)
    if (current()) scrollToBottom()
  }
}

async function markResolved() {
  showActions.value = false
  showRating.value = true
}

async function submitRating(star: number) {
  if (!sessionId.value) return
  const sid = sessionId.value
  rating.value = star
  try {
    await resolveChatSession(sid, star)
    if (!mounted || sid !== sessionId.value) return
    showRating.value = false
    sessionResolved.value = true
    showToast('感谢您的反馈！', 'success')
  } catch {
    showToast('提交失败', 'error')
  }
}

async function transferToHuman() {
  if (!sessionId.value || isLoading.value || sessionLoading.value || isTransferring.value || sessionTransferred.value) return
  const sid = sessionId.value
  let summary: string | undefined
  if (!messages.value.some(message => message.role === 'user' && message.content.trim())) {
    try {
      const result = await ElMessageBox.prompt('请描述要处理的问题，或需要咨询的套餐。', '联系人工支持', {
        inputType: 'textarea', inputValue: inputMessage.value, confirmButtonText: '继续', cancelButtonText: '取消',
        inputValidator: value => Boolean(value?.trim() && value.trim().length <= 2000) || '请输入 1–2000 字的问题描述',
      })
      summary = result.value.trim()
    } catch { return }
  }
  if (!await confirmAction({
    title: '转接人工支持？',
    message: '系统会把当前问题整理成待处理工单，方便工作人员继续跟进。',
    confirmText: '创建工单',
  })) return
  if (!mounted || sid !== sessionId.value) return
  isTransferring.value = true
  try {
    await transferChatToHuman(sid, summary ? { summary } : {})
    if (!mounted || sid !== sessionId.value) return
    if (summary) {
      messages.value.push({ id: nextMsgId++, role: 'user', content: summary, created_at: new Date().toISOString() })
      inputMessage.value = ''
    }
    showActions.value = false
    sessionTransferred.value = true
    messages.value.push({
      id: nextMsgId++,
      role: 'system',
      content: '已创建人工支持工单。工作人员可在后台查看问题并回复，请保留此页面或通过帮助中心联系支持。',
      created_at: new Date().toISOString()
    })
    scrollToBottom()
    showToast('已转人工客服', 'success')
  } catch (error) {
    if (!mounted || sid !== sessionId.value) return
    showToast(error instanceof Error && error.message.trim() ? error.message : '转接失败，请稍后重试', 'error')
  } finally {
    isTransferring.value = false
  }
}

async function loadHistory() {
  try {
    const res = chatHistorySchema.parse(await getChatHistory(1, 20))
    if (mounted) historySessions.value = res.items
  } catch {
    showToast('加载历史失败', 'error')
  }
}

async function loadSession(sid: string) {
  const sequence = ++sessionSequence
  sessionLoading.value = true
  sessionError.value = ''
  try {
    const res = chatSessionDetailSchema.parse(await getChatSession(sid))
    if (!mounted || sequence !== sessionSequence) return
    sessionId.value = sid
    const cached = sessionMessages.get(sid)
    messages.value = cached?.some(message => message.delivery === 'failed' || message.delivery === 'sending') || sendingSessions.value.has(sid)
      ? cached || [] : (res.messages || []).map(message => ({ ...message, id: nextMsgId++ }))
    sessionMessages.set(sid, messages.value)
    inputMessage.value = ''
    lastAiMessage.value = [...messages.value].reverse().find(message => message.role === 'ai')?.content || null
    showRating.value = false
    sessionResolved.value = res.status === 'resolved'
    sessionTransferred.value = res.status === 'transferred'
    showActions.value = res.status === 'active' && messages.value.some(m => m.role === 'ai')
    showHistory.value = false
    scrollToBottom()
  } catch {
    if (!mounted || sequence !== sessionSequence) return
    sessionError.value = '会话暂时无法加载，请重新选择或重试。'
    showToast('加载会话失败', 'error')
  } finally {
    if (mounted && sequence === sessionSequence) sessionLoading.value = false
  }
}

onMounted(async () => {
  loadHistory()
  const started = await startNewSession()
  if (!started) return
  const purchase = sessionStorage.getItem('toolbox_purchase_inquiry')
  if (purchase) {
    sessionStorage.removeItem('toolbox_purchase_inquiry')
    inputMessage.value = purchase.slice(0, 2000)
    // Leave the request editable; entering the page is not consent to submit it.
    return
  }
  try {
    const context = parseJsonRecord(localStorage.getItem('toolbox_support_context'))
    if (context) {
      localStorage.removeItem('toolbox_support_context')
      const problemCode = typeof context.problem_code === 'string' ? context.problem_code : ''
      const toolName = typeof context.tool_name === 'string' ? context.tool_name : '工具'
      const problem = problemCode ? `，问题编号 ${problemCode}` : ''
      const requiresReview = context.result_requires_review === true
        || (context.execution_mode === 'live' && (context.run_status === 'failed' || context.run_status === 'cancelled'))
      const situation = requiresReview
        ? '本次客户端已停止，当前平台结果待核对'
        : context.record_pending === true ? '本次执行记录仍待同步'
        : context.execution_mode === 'demo' ? '本次本地演示遇到问题'
        : context.execution_mode === 'preflight' ? '本次只读预检遇到问题' : '本次操作遇到问题'
      inputMessage.value = `${toolName}${situation}${problem}，请帮我核对处理。`
      await sendMessage()
    }
  } catch {
    localStorage.removeItem('toolbox_support_context')
  }
})
watch(() => platformStore.currentPlatform, () => {
  sessionId.value = null
  messages.value = []
  inputMessage.value = ''
  void startNewSession()
})
onUnmounted(() => { mounted = false; sessionSequence += 1 })
  return {
    sessionId, messages, inputMessage, isLoading, isTransferring, showActions, showRating, rating,
    sessionResolved, sessionTransferred, lastAiMessage, messagesContainer, showHistory,
    historySessions, quickQuestions, formatTime, getStatusText, askQuickQuestion,
    sendMessage, retryMessage, startNewSession, sessionLoading, sessionError, markResolved, transferToHuman, submitRating, loadSession,
  }
}
