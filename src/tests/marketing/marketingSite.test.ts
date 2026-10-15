import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import LandingView from '@/views/LandingView.vue'
import ScenarioView from '@/views/ScenarioView.vue'
import MarketingToolsView from '@/views/MarketingToolsView.vue'
import MarketingTermsView from '@/marketing/MarketingTermsView.vue'
import MarketingNotFound from '@/marketing/MarketingNotFound.vue'
import MetricComparison from '@/components/landing/MetricComparison.vue'
import ScenarioIdentity from '@/components/landing/ScenarioIdentity.vue'
import ScenarioPainComparison from '@/components/landing/ScenarioPainComparison.vue'
import MarketingToolsOverview from '@/components/landing/MarketingToolsOverview.vue'
import { marketingTasks, statusLabels } from '@/marketing/task-catalog'
import { createMarketingRouter, marketingRoutes } from '@/marketing/router'
import { isMarketingSource, marketingHeaders, marketingRedirects, publicHttpsUrl } from '@/marketing/build-policy'

describe('independent marketing site information architecture', () => {
  let wrappers: VueWrapper[] = []

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  })

  afterEach(() => {
    wrappers.forEach(wrapper => wrapper.unmount())
    wrappers = []
    vi.unstubAllGlobals()
  })

  it('exposes only the public marketing routes and preserves a true catch-all 404', () => {
    const router = createMarketingRouter(createMemoryHistory())
    expect(marketingRoutes).toHaveLength(6)
    expect(router.resolve('/').name).toBe('Landing')
    expect(router.resolve('/competition').name).toBe('MarketingCompetition')
    expect(router.resolve('/course').name).toBe('MarketingCourse')
    expect(router.resolve('/tools').name).toBe('MarketingTools')
    expect(router.resolve('/terms').name).toBe('MarketingTerms')
    expect(router.resolve('/user/terms/').name).toBe('MarketingTerms')
    for (const target of ['/user/login', '/business/workspace', '/admin/login', '/not-a-page']) {
      expect(router.resolve(target).name).toBe('MarketingNotFound')
    }
  })

  it('resolves public views without deferring a page chunk until a later navigation', () => {
    const router = createMarketingRouter(createMemoryHistory())
    for (const [path, component] of [
      ['/', LandingView], ['/competition', ScenarioView], ['/course', ScenarioView],
      ['/tools', MarketingToolsView], ['/terms', MarketingTermsView], ['/not-a-page', MarketingNotFound],
    ] as const) {
      expect(router.resolve(path).matched[0]?.components?.default).toBe(component)
    }
  })

  it('keeps the homepage CTA focused on the scene chooser and links both scene cards', async () => {
    const router = createMarketingRouter(createMemoryHistory())
    await router.push('/')
    const wrapper = mount(LandingView, { props: { marketingOnly: true }, global: { plugins: [router] } })
    wrappers.push(wrapper)
    expect(wrapper.find('#scenes').exists()).toBe(true)
    expect(wrapper.find('a[href="#scenes"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/competition"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/course"]').exists()).toBe(true)
    expect(wrapper.findAll('button').some(button => /下载 Windows 桌面端/.test(button.text()))).toBe(false)
    expect(wrapper.findAll('a').some(link => /^\/(?:user|admin|business)(?:\/|$)/.test(link.attributes('href') || ''))).toBe(false)
    expect(wrapper.find('[data-testid="consultation-trigger"]').exists()).toBe(false)
    expect(wrapper.findAll('#scenes [data-testid="scenario-identity"]')).toHaveLength(2)
    const taskCards = wrapper.findAll('[data-testid="landing-task-map"] [data-task-id]')
    expect(taskCards.map(card => card.attributes('data-task-id'))).toEqual(marketingTasks.map(task => task.id))
    taskCards.forEach((card, index) => expect(card.attributes('href')).toBe(`/tools#tool-${marketingTasks[index]!.id}`))
    taskCards.forEach(card => expect(card.find('.landing-task-card-action').text()).toBe('查看工具说明'))
    expect(wrapper.text()).not.toContain('前置条件')
    const hero = wrapper.find('[data-testid="marketing-hero"]')
    expect(hero.findAll('a')).toHaveLength(1)
    expect(hero.find('.landing-identity').text()).toBe('跨境电商比赛与亚马逊仿真实训工具')
    expect(hero.find('a[href="#scenes"]').text()).toBe('看看适合我的场景')
    expect(hero.find('h1 span').text()).toBe('按要求做完了，')
    expect(hero.find('h1 em').text()).toBe('分数还是上不去？')
    for (const pain of ['照着要求做，隐性得分点还是会漏', '重复填写，挤占研究时间', '哪些配置有用，还在反复试']) expect(hero.text()).toContain(pain)
    expect(wrapper.find('#scenes').element.compareDocumentPosition(wrapper.find('#impact').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const oldCopy of ['看不懂要求', '页面完成了，关键项不一定', '痛点示意', '不了解比赛，也能看懂']) expect(wrapper.text()).not.toContain(oldCopy)
    expect(wrapper.text()).toContain('适用于哪个实训平台？')
    expect(wrapper.findAll('a a')).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows three reported task results on every scenario, with scoring support only on the homepage', async () => {
    const router = createMarketingRouter(createMemoryHistory())
    await router.push('/')
    const homepage = mount(LandingView, { props: { marketingOnly: true }, global: { plugins: [router] } })
    const competition = mount(ScenarioView, { props: { kind: 'competition' }, global: { plugins: [createMarketingRouter(createMemoryHistory())], stubs: { RouterLink: true } } })
    const course = mount(ScenarioView, { props: { kind: 'course' }, global: { plugins: [createMarketingRouter(createMemoryHistory())], stubs: { RouterLink: true } } })
    wrappers.push(homepage, competition, course)
    const support = homepage.find('[data-testid="marketing-score-support"]')
    expect(support.exists()).toBe(true)
    expect(support.text()).toContain('需要关注的得分细节')
    expect(support.text()).toContain('一键配置')
    for (const scenario of [competition, course]) expect(scenario.find('[data-testid="marketing-score-support"]').exists()).toBe(false)
    for (const wrapper of [homepage, competition, course]) {
      const comparison = wrapper.find('[data-testid="metric-comparison"]')
      const results = comparison.findAll('[data-testid="metric-result"]')
      expect(results).toHaveLength(3)
      expect(results.every(result => result.isVisible())).toBe(true)
      expect(results.map(result => result.find('[data-testid="before-number"]').text())).toEqual(['21分钟', '33分钟', '15分钟'])
      expect(results.map(result => result.find('[data-testid="after-number"]').text())).toEqual(['2分钟', '2分钟', '3分钟'])
      expect(results.map(result => result.find('[data-testid="delta-number"]').text())).toEqual(['19', '31', '12'])
      expect(comparison.find('[role="tablist"]').exists()).toBe(false)
      expect(comparison.find('.metric-source').text()).toContain('用户提供')
      expect(comparison.text()).not.toMatch(/已实测|平均用时|平均节省/)
    }
  })

  it('renders different before/after comparisons and supports pain-point interaction', async () => {
    const competitionRouter = createMarketingRouter(createMemoryHistory())
    const courseRouter = createMarketingRouter(createMemoryHistory())
    const competition = mount(ScenarioView, { props: { kind: 'competition' }, global: { plugins: [competitionRouter], stubs: { RouterLink: true } } })
    const course = mount(ScenarioView, { props: { kind: 'course' }, global: { plugins: [courseRouter], stubs: { RouterLink: true } } })
    wrappers.push(competition, course)
    for (const wrapper of [competition, course]) {
      expect(wrapper.find('[data-testid="scenario-comparison"]').exists()).toBe(true)
      expect(wrapper.findAll('[data-testid="scenario-identity"]')).toHaveLength(1)
      expect(wrapper.findAll('.pain-selector button')).toHaveLength(8)
      expect(wrapper.find('.comparison-body').attributes('data-active-pain')).toBe('company')
      expect(wrapper.find('.pain-selector button').attributes('data-testid')).toBe('pain-company')
      expect(wrapper.find('.pain-selector button').attributes('aria-pressed')).toBe('true')
      expect(wrapper.findAll('.pain-selector button[aria-pressed="true"]')).toHaveLength(1)
      expect(wrapper.text()).toContain('自己操作时')
      expect(wrapper.find('.desktop-comparison .after-panel').text()).toContain('后续辅助方式')
      expect(wrapper.find('.desktop-comparison .after-panel').text()).toContain('这一项暂未开放')
      await wrapper.find('[data-testid="pain-products"]').trigger('click')
      expect(wrapper.find('.comparison-body').attributes('data-active-pain')).toBe('products')
      expect(wrapper.find('.desktop-comparison .after-panel').text()).toContain('课赛通辅助后')
    }
    const competitionContent = competition.find('[data-testid="scenario-comparison"]').text()
    const courseContent = course.find('[data-testid="scenario-comparison"]').text()
    expect(competitionContent).toContain('比赛时间短')
    expect(competitionContent).toContain('分数却没上去')
    expect(competitionContent).toContain('隐性得分点要摸清')
    expect(competitionContent).not.toContain('课程实训，')
    expect(courseContent).toContain('课程实训')
    expect(courseContent).toContain('门道却没弄明白')
    expect(courseContent).toContain('评分细节和每一步的作用')
    expect(courseContent).not.toContain('比赛时间短')
    expect(competition.find('.comparison-body').attributes('data-active-pain')).toBe('products')
    for (const wrapper of [competition, course]) {
      expect(wrapper.findAll('.comparison-panels > article')).toHaveLength(2)
      expect(wrapper.findAll('.desktop-comparison .action-steps li')).toHaveLength(6)
      expect(wrapper.findAll('[data-testid="scenario-mobile-details"] .action-steps li')).toHaveLength(6)
      expect(wrapper.findAll('.human-note')).toHaveLength(1)
      expect(wrapper.find('.task-preview').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('保留学习目标')
    }
    await competition.find('[data-testid="pain-rates"]').trigger('click')
    expect(competition.find('.comparison-body').attributes('data-active-pain')).toBe('rates')
    await competition.find('[data-testid="pain-selection"]').trigger('click')
    expect(competition.find('.desktop-comparison .after-panel').text()).toContain('后续辅助方式')
    expect(competition.find('.desktop-comparison .after-panel').text()).toContain('这一项暂未开放')
    expect(competition.find('[data-testid="scenario-tool-link"]').attributes('to')).toBe('/tools#tool-sourcing')
  })

  it('resets the selected task to company whenever the scenario kind changes', async () => {
    const wrapper = mount(ScenarioPainComparison, { props: { kind: 'competition' }, global: { plugins: [createMarketingRouter(createMemoryHistory())], stubs: { RouterLink: true } } })
    wrappers.push(wrapper)
    const expectFirstTask = () => {
      expect(wrapper.find('.comparison-body').attributes('data-active-pain')).toBe('company')
      expect(wrapper.find('.pain-selector button').attributes('data-testid')).toBe('pain-company')
      expect(wrapper.find('.pain-selector button').attributes('aria-pressed')).toBe('true')
      expect(wrapper.findAll('.pain-selector button[aria-pressed="true"]')).toHaveLength(1)
      expect(wrapper.find('.desktop-comparison .after-panel').text()).toContain('后续辅助方式')
      expect(wrapper.find('.desktop-comparison .after-panel').text()).toContain('这一项暂未开放')
      expect(wrapper.find('[data-testid="scenario-tool-link"]').attributes('to')).toBe('/tools#tool-company')
    }
    expectFirstTask()
    await wrapper.find('[data-testid="pain-rates"]').trigger('click')
    expect(wrapper.find('.comparison-body').attributes('data-active-pain')).toBe('rates')
    await wrapper.setProps({ kind: 'course' })
    expectFirstTask()
    await wrapper.find('[data-testid="pain-settings"]').trigger('click')
    expect(wrapper.find('.comparison-body').attributes('data-active-pain')).toBe('settings')
    await wrapper.setProps({ kind: 'competition' })
    expectFirstTask()
  })

  it.each(['competition', 'course'] as const)('labels all six unavailable tasks plainly in the %s scenario', async kind => {
    const wrapper = mount(ScenarioPainComparison, { props: { kind }, global: { plugins: [createMarketingRouter(createMemoryHistory())], stubs: { RouterLink: true } } })
    wrappers.push(wrapper)
    const unavailableTopics = ['company', 'selection', kind === 'competition' ? 'rates' : 'settings', 'ads', 'fba', 'pricing']
    for (const topic of unavailableTopics) {
      await wrapper.find(`[data-testid="pain-${topic}"]`).trigger('click')
      for (const selector of ['.desktop-comparison .after-panel', '.compact-comparison .after-panel', '.mobile-step-panels .after-panel']) {
        const panel = wrapper.find(selector)
        expect(panel.classes()).toContain('planned-panel')
        expect(panel.find('.availability-label').text()).toBe('暂未开放')
        expect(panel.text()).not.toMatch(/开发中|验证中|课赛通辅助后/)
      }
      expect(wrapper.find('.desktop-comparison .planning-note').text()).toBe('这一项暂未开放，以下为辅助方式示意。')
    }
  })

  it('resets expanded mobile workflow details when the selected task changes', async () => {
    const wrapper = mount(ScenarioView, { props: { kind: 'competition' }, global: { plugins: [createMarketingRouter(createMemoryHistory())], stubs: { RouterLink: true } } })
    wrappers.push(wrapper)
    const details = wrapper.find<HTMLDetailsElement>('[data-testid="scenario-mobile-details"]')
    expect(details.element.open).toBe(false)
    // Native opening is covered in the browser test; model the open DOM state here.
    details.element.open = true
    await wrapper.find('[data-testid="pain-rates"]').trigger('click')
    const nextDetails = wrapper.find<HTMLDetailsElement>('[data-testid="scenario-mobile-details"]')
    expect(nextDetails.element).not.toBe(details.element)
    expect(nextDetails.element.open).toBe(false)
    expect(nextDetails.text()).toContain('对着规则表一格一格填')
  })

  it('shows tools disclosure, authorization entry and a download action', () => {
    const router = createMarketingRouter(createMemoryHistory())
    const wrapper = mount(MarketingToolsView, { global: { plugins: [router], stubs: { RouterLink: true } } })
    wrappers.push(wrapper)
    expect(wrapper.find('[data-testid="marketing-tools-overview"]').exists()).toBe(true)
    expect(wrapper.find('#start').exists()).toBe(true)
    expect(wrapper.find('#start > div > p > strong').text()).toBe('申请使用')
    expect(wrapper.find<HTMLInputElement>('#marketing-wechat-account').element.value).toBe('Moweiiong')
    expect(wrapper.text()).toContain('授权')
    expect(wrapper.findAll('button').some(button => /下载 Windows 桌面端/.test(button.text()))).toBe(true)
    expect(wrapper.find('.tool-card-title h3').exists()).toBe(true)
    expect(wrapper.findAll('.tool-card .tool-status')).toHaveLength(8)
    expect(wrapper.findAll('.tool-card').map(card => card.attributes('data-task-id'))).toEqual(marketingTasks.map(task => task.id))
    expect(wrapper.text()).not.toContain('开始前准备')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find('.team-note').text()).toContain('带队或多人使用')
    for (const id of ['company', 'sourcing', 'shipping', 'marketing', 'fba', 'pricing']) {
      expect(wrapper.find(`#tool-${id} .tool-status`).text()).toBe('暂未开放')
    }
    for (const id of ['product', 'orders']) {
      expect(wrapper.find(`#tool-${id} .tool-status`).text()).toBe('需安装电脑端，使用前请咨询')
    }
    expect(wrapper.text()).not.toMatch(/指定条件下验证中|桌面端使用·需确认条件|开发中|仍在开发|正在开发/)
    expect(statusLabels['interactive-demo']).toBe('在线体验（模拟操作）')
  })

  it.each(['copied', 'manual'] as const)('keeps the public WeChat contact usable when copying is %s', async state => {
    const writeText = state === 'copied' ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new DOMException('Clipboard denied', 'NotAllowedError'))
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent, clipboard: { writeText } })
    const wrapper = mount(MarketingToolsOverview, { global: { plugins: [createMarketingRouter(createMemoryHistory())], stubs: { RouterLink: true } } })
    wrappers.push(wrapper)
    const contact = wrapper.find('[data-testid="marketing-wechat-contact"]')
    const input = contact.find<HTMLInputElement>('#marketing-wechat-account')
    expect(input.element.value).toBe('Moweiiong')
    expect(input.element.readOnly).toBe(true)
    await contact.find('button').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Moweiiong')
    expect(contact.find('[role="status"]').text()).toContain(state === 'copied' ? '微信号已复制' : '请选择上方微信号手动复制')
    expect(contact.find('button').attributes('disabled')).toBeUndefined()
    if (state === 'manual') {
      await input.trigger('focus')
      expect(input.element.selectionStart).toBe(0)
      expect(input.element.selectionEnd).toBe('Moweiiong'.length)
      expect(contact.find('[role="status"]').text()).not.toContain('微信号已复制')
    }
  })

  it('does not invent comparison results before paired measurements exist', () => {
    const empty = mount(MetricComparison, { props: { metrics: [] } })
    const baseline = mount(MetricComparison, {
      props: {
        metrics: [{ metric: 'time', before: 18, after: null, unit: '分钟', sampleSize: 1, taskScope: '同一商品发布任务', measuredAt: '待补测试日期', source: 'manual' }],
      },
    })
    wrappers.push(empty, baseline)
    expect(empty.find('.metric-comparison').exists()).toBe(false)
    expect(baseline.text()).toContain('辅助数据暂未公开')
    expect(baseline.text()).not.toContain('待补充')
    expect(baseline.text()).toContain('人工基线')
  })

  it('renders the full course scenario identity with a platform badge and four practice tasks', () => {
    const wrapper = mount(ScenarioIdentity, { props: { kind: 'course' } })
    wrappers.push(wrapper)
    expect(wrapper.classes()).toContain('identity-course')
    expect(wrapper.classes()).not.toContain('compact')
    const platform = wrapper.find('.identity-platform')
    expect(platform.find('img').attributes('width')).toBe('120')
    expect(platform.find('img').attributes('height')).toBe('120')
    expect(platform.find('img').attributes('alt')).toBe('亚马逊仿真实训图标')
    expect(platform.find('img').attributes('loading')).toBe('eager')
    expect(platform.text()).toContain('实训平台')
    expect(platform.text()).toContain('亚马逊仿真实训')
    expect(wrapper.find('.identity-headline').text()).toContain('从商品上架，')
    expect(wrapper.find('.identity-headline').text()).toContain('到订单发货。')
    const tasks = wrapper.find('[aria-label="实训练习内容"]')
    expect(tasks.findAll('li').map(task => task.text())).toEqual(['商品发布', '物流配置', '广告营销', '订单发货'])
    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.find('[data-testid="scenario-official-source"]').exists()).toBe(false)
  })

  it('renders the full competition scenario identity with one real source link and no nested fake controls', () => {
    const wrapper = mount(ScenarioIdentity, { props: { kind: 'competition' } })
    wrappers.push(wrapper)
    expect(wrapper.classes()).toContain('identity-competition')
    expect(wrapper.classes()).not.toContain('compact')
    expect(wrapper.text()).toContain('比赛赛项')
    expect(wrapper.text()).toContain('第九届全国数字贸易技能大赛')
    expect(wrapper.find('.identity-headline').text()).toBe('跨境电商数字化运营')
    expect(wrapper.find('[aria-label="比赛经营任务"]').findAll('span').map(topic => topic.text())).toEqual(['商品', '物流', '营销', 'FBA'])
    const source = wrapper.find('[data-testid="scenario-official-source"]')
    expect(source.element.tagName).toBe('A')
    expect(source.attributes('href')).toBe('https://www.idtrade.cn/User/Contest')
    expect(source.attributes('target')).toBe('_blank')
    expect(source.attributes('rel').split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(source.text()).toContain('查看赛事来源')
    expect(source.find('img').attributes('width')).toBe('960')
    expect(source.find('img').attributes('height')).toBe('704')
    expect(source.find('img').attributes('alt')).toBe('第九届全国数字贸易技能大赛跨境电商数字化运营赛项官方卡片')
    expect(source.find('img').attributes('loading')).toBe('eager')
    expect(source.find('img').attributes('src')).not.toMatch(/^https?:\/\//)
    expect(wrapper.findAll('a')).toHaveLength(1)
    expect(source.findAll('a, button, input, select, textarea, [role="button"], [role="link"]')).toHaveLength(0)
  })

  it.each(['course', 'competition'] as const)('keeps the compact %s scenario identity limited to recognition content', kind => {
    const wrapper = mount(ScenarioIdentity, { props: { kind, compact: true } })
    wrappers.push(wrapper)
    expect(wrapper.classes()).toContain('compact')
    expect(wrapper.classes()).toContain(`identity-${kind}`)
    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.find('img').attributes('loading')).toBe('lazy')
    expect(wrapper.find('img').attributes('width')).toBe(kind === 'course' ? '120' : '960')
    expect(wrapper.find('img').attributes('height')).toBe(kind === 'course' ? '120' : '704')
    expect(wrapper.find('.scenario-identity-copy').text()).toContain(kind === 'course' ? '实训平台' : '比赛赛项')
    expect(wrapper.find('.scenario-identity-copy strong').text()).toBe(kind === 'course' ? '亚马逊仿真实训' : '第九届全国数字贸易技能大赛')
    expect(wrapper.find('.scenario-identity-copy small').text()).toBe(kind === 'course' ? '商品、物流、广告与发货练习' : '跨境电商数字化运营')
    expect(wrapper.find('.identity-headline').exists()).toBe(false)
    expect(wrapper.find('.identity-tasks').exists()).toBe(false)
    expect(wrapper.find('.identity-event-topics').exists()).toBe(false)
    expect(wrapper.findAll('a, button')).toHaveLength(0)
  })

  it.each(['course', 'competition'] as const)('preserves the %s scenario identity on image failure and restores its image when the scenario changes', async kind => {
    const wrapper = mount(ScenarioIdentity, { props: { kind } })
    wrappers.push(wrapper)
    await wrapper.find('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.scenario-identity-media').exists()).toBe(false)
    expect(wrapper.text()).toContain(kind === 'course' ? '亚马逊仿真实训' : '第九届全国数字贸易技能大赛')
    expect(wrapper.find('.identity-headline').exists()).toBe(true)
    if (kind === 'competition') {
      const source = wrapper.find('[data-testid="scenario-official-source"]')
      expect(source.attributes('href')).toBe('https://www.idtrade.cn/User/Contest')
      expect(source.text()).toContain('查看赛事来源')
    } else {
      expect(wrapper.find('.identity-tasks').findAll('li')).toHaveLength(4)
      expect(wrapper.findAll('a')).toHaveLength(0)
    }
    const nextKind = kind === 'course' ? 'competition' : 'course'
    await wrapper.setProps({ kind: nextKind, compact: true })
    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.find('img').attributes('width')).toBe(nextKind === 'course' ? '120' : '960')
    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.text()).toContain(nextKind === 'course' ? '实训平台' : '比赛赛项')
  })

  it('allows only exact marketing views and rejects application dependencies', () => {
    for (const source of ['src/views/LandingView.vue?vue&type=script', 'src/views/ScenarioView.vue', 'src/views/MarketingToolsView.vue']) {
      expect(isMarketingSource(source)).toBe(true)
    }
    for (const source of ['src/main.ts', 'src/App.vue', 'src/router/index.ts', 'src/stores/user.ts', 'src/utils/api/index.ts', 'src/views/admin/ExpensesView.vue']) {
      expect(isMarketingSource(source)).toBe(false)
    }
  })

  it('requires explicit stable public URLs and route-specific static rewrites', () => {
    expect(publicHttpsUrl('https://downloads.example.test/KST%20Setup%201.8.8.exe', 'download')).toContain('1.8.8.exe')
    expect(publicHttpsUrl(undefined, 'download', false)).toBe('')
    for (const value of [undefined, 'http://downloads.example.test/setup.exe', 'https://localhost/setup.exe', 'https://user:password@downloads.example.test/setup.exe', 'https://downloads.example.test/candidate-50f48d5/setup.exe', 'https://downloads.example.test/setup.exe?token=temporary']) {
      expect(() => publicHttpsUrl(value, 'download')).toThrow()
    }
    expect(marketingHeaders).toContain("connect-src 'none'")
    for (const route of ['competition', 'course', 'tools']) expect(marketingRedirects).toContain(`/${route} /${route}/index.html 200`)
    expect(marketingRedirects).not.toContain('/* /index.html')
  })
})
