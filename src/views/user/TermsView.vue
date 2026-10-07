<template>
  <main class="terms-container">
    <div class="terms-card">
      <div class="terms-header">
        <BrandLockup class="terms-brand" audience="login" layout="horizontal" />
        <h1>服务条款</h1>
        <p class="terms-date">最后更新：2026年10月7日</p>
      </div>

      <div class="terms-content">
        <section>
          <h2>1. 服务说明</h2>
          <p>课赛通 KST（以下简称“本工具”）是面向跨境电商比赛与课程实训的效率平台，围绕公司登记、选品、商品发布、物流模板、广告营销、FBA 配送、订单发货和定价与运费比较组织工具，并提供授权管理、本地资料处理、执行记录和使用帮助。</p>
          <p>具体工具的开放状态、适用平台、版本和使用条件以工具说明及当前授权为准。本地计算依据所选资料产生结果；平台检查和操作依据已开放工具的范围执行。开发中功能和历史演示记录不表示对应任务已在目标平台完成。</p>
        </section>

        <section>
          <h2>2. 授权码使用</h2>
          <p>2.1 本工具采用授权码机制进行激活和使用，可绑定的 Windows 设备数量以当前套餐和授权页面显示的额度为准。</p>
          <p>2.2 授权码的有效期以人工确认的套餐记录为准，到期后需续期才能继续使用。</p>
          <p>2.3 严禁将授权码转让、共享或出售给第三方使用。</p>
          <p>2.4 如需更换绑定设备，可先在设备授权页面解绑；无法自助处理时请联系客服。</p>
        </section>

        <section>
          <h2>3. 套餐、人工收款与退款</h2>
          <p>3.1 本工具提供多种套餐，具体内容、价格和设备额度以套餐页面展示及人工确认记录为准。</p>
          <p>3.2 本工具不内置在线支付系统，收款渠道、金额和订单状态由工作人员人工登记。</p>
          <p>3.3 人工确认收款后 24 小时内，如授权码尚未激活使用，可申请全额退款。</p>
          <p>3.4 已激活使用的授权码不支持退款。</p>
          <p>3.5 退款申请由客服人工核对订单记录后处理。</p>
        </section>

        <section>
          <h2>4. 使用规范</h2>
          <p>4.1 用户应合法合规地使用本工具，不得利用本工具从事任何违反法律法规的活动。</p>
          <p>4.2 用户不得对本工具进行逆向工程、反编译或破解。</p>
          <p>4.3 用户不得利用本工具发送垃圾信息、恶意刷单等违规行为。</p>
          <p>4.4 如因用户违规使用导致账号被封或其他损失，由用户自行承担。</p>
        </section>

        <section>
          <h2>5. 隐私保护</h2>
          <p>5.1 本工具会收集用户的设备信息（设备ID、设备名称）用于授权码绑定。</p>
          <p>5.2 本工具会记录必要的运行元数据（工具名称、运行状态、运行时间）用于展示执行记录和定位问题。</p>
          <p>5.3 专业工作台中的客户密码、Cookie 和 Excel 原文仅在本机处理，不上传到服务端。</p>
          <p>5.4 我们不会将用户信息泄露给第三方，法律法规另有要求的除外。</p>
        </section>

        <section>
          <h2>6. 免责声明</h2>
          <p>6.1 本工具按"现状"提供，不保证所有功能在所有环境下均能正常运行。</p>
          <p>6.2 因网络问题、系统兼容性问题或第三方平台政策变更导致的功能异常，开发团队不承担责任。</p>
          <p>6.3 历史演示记录仅用于流程参考。工具的真实执行结果应结合目标平台的相应商品、活动或订单状态核对；结果待核对时，请先确认平台状态再决定后续操作。</p>
        </section>

        <section>
          <h2>7. 联系方式</h2>
          <p>如有疑问或需要帮助，请通过以下方式联系我们：</p>
          <ul>
            <li>客服微信：{{ wechatId }}</li>
            <li>服务时间和处理进度以客服当日回复为准</li>
          </ul>
        </section>
      </div>

      <div class="terms-footer">
        <router-link to="/user/login" class="btn btn-primary" style="text-decoration:none;">返回登录</router-link>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { publicSettingsSchema } from '@/features/auth/model'
import { getPublicSettings } from '@/utils/api'
import BrandLockup from '@/components/brand/BrandLockup.vue'

const wechatId = ref('请在登录页查看最新联系方式')

onMounted(async () => {
  try {
    const settings = publicSettingsSchema.parse(await getPublicSettings())
    const configured = settings.find(item => item.key === 'wechat_id')?.value?.trim()
    if (configured) wechatId.value = configured
  } catch {
    // 联系方式读取失败时保留安全提示，不展示可能已经失效的硬编码账号。
  }
})
</script>

<style scoped>
.terms-container {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem;
  background: var(--color-canvas);
}
.terms-card {
  background: var(--color-surface);
  border-radius: var(--radius-xl);
  padding: 3rem;
  max-width: 800px;
  width: 100%;
  box-shadow: var(--shadow-medium);
  border: 1px solid var(--color-border);
}
.terms-header {
  text-align: left;
  margin-bottom: 2.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--color-border);
}
.terms-brand { margin-bottom: 24px; }
.terms-header h1 {
  font-family: var(--font-family);
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 0.5rem;
}
.terms-date {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}
.terms-content section {
  margin-bottom: 2rem;
}
.terms-content h2 {
  font-family: var(--font-family);
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 0.75rem;
  padding-left: 0.75rem;
  border-left: 3px solid var(--color-primary);
}
.terms-content p {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  line-height: 1.7;
  margin-bottom: 0.5rem;
}
.terms-content ul {
  padding-left: 1.5rem;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  line-height: 1.7;
}
.terms-footer {
  text-align: left;
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--color-border);
}
@media (max-width: 640px) {
  .terms-card { padding: 1.5rem; }
  .terms-container { padding: 1rem; }
}
</style>
