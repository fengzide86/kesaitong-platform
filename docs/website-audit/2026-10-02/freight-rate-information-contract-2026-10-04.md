# 跨平台物流费率信息契约（V2/V3 预备）

日期：2026-10-04（Asia/Shanghai）

## 目的

本文件只整理物流计算所需的事实、字段和版本边界，不执行平台写入，不把当前 V2 页面或旧 Excel 当成未来平台的固定接口。

目标链路：

```text
原始价目表/平台资料
→ 规范化费率记录
→ 重量与体积重计算
→ 候选渠道过滤
→ 费用报价与渠道选择
→ 平台字段映射
→ 发货或模板脚本的输入
```

## 已确认的资料来源

| 来源 | 当前事实 | 证据边界 |
| --- | --- | --- |
| 旧 `FreightTemplate_v2.xlsx` | 含中国邮政挂号小包、e邮宝、燕文航空挂号小包、UPS 全球快捷四张表 | 是历史本地资料，不等于 V2/V3 的实时费率 |
| 旧 `运费计算器模块.py` | 国家别名归一、重量阶梯、限重过滤、渠道比价、可选人民币转美元 | 只代表旧本地算法，不能直接当作平台 API 契约 |
| 图片中的资料查询页 | 至少包含卖家自行配送、货代、亚马逊 AGL、发往 FBA、FBA 价目表等入口 | 当前只有入口证据，具体表格和规则仍需按版本采集 |
| 当前项目费率包 | 使用 `schemaVersion=1`、`resourceType=freight-rate-pack`、规则数组和人民币兑美元汇率 | 是 KST 内部版本化资源，不代表仿真平台直接接受这些字段 |

## 规范化费率记录

所有 V2/V3 来源最终转换为以下逻辑字段。来源没有提供的值保持 `unknown`，不填零、不猜测。

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `platformVersion` | string | `v2`、`v3` 或未知版本 |
| `sourceId` | string | 来源表/页面的稳定别名 |
| `sourceVersion` | string | 来源文件、页面版本或采集批次 |
| `effectiveFrom` / `effectiveTo` | date/null | 费率生效区间 |
| `carrierId` | string | 规范化物流商标识 |
| `serviceType` | enum | `tiered`、`epacket`、`ups` 或待确认类型 |
| `serviceName` | string | 页面或表格中的服务名称 |
| `originScope` | string | 揽收城市/国内仓范围 |
| `destinationCountry` | string | ISO 国家代码或平台国家代码 |
| `destinationGroup` | string/null | 平台地区组，若有 |
| `weightMin` / `weightMax` | decimal | 重量区间 |
| `weightUnit` | enum | `g`、`kg`、`lb` 或未知 |
| `weightBoundary` | enum | `inclusive`、`exclusive`、`unknown` |
| `actualWeightRule` | string/null | 实际重量计费说明 |
| `volumetricDivisor` | decimal/null | 体积重除数，例如 `5000` |
| `billableWeightRule` | enum | `actual`、`max_actual_volumetric`、`unknown` |
| `baseRate` | decimal | 重量费/阶梯费 |
| `fixedFee` | decimal | 每包裹或每单固定费 |
| `handlingFee` | decimal | 操作处理费 |
| `agentFeeRule` | object/null | 货代服务费比例、最低收费等 |
| `fuelSurchargeRule` | object/null | 燃油费规则 |
| `currency` | string | `CNY`、`USD` 等 |
| `roundingRule` | string/null | 向上取整、按克计费等 |
| `maxWeight` | decimal/null | 渠道限重 |
| `platformCarrierValue` | string/null | 当前平台下拉框真实 value |
| `confidence` | enum | `observed`、`source_document`、`inferred`、`unknown` |

## 当前旧表与旧算法的已知规则

- 中国邮政、燕文存在 0–150g、151–300g、301–2000g 等阶梯；具体边界以原表为准。
- e邮宝按重量资费加包裹处理费，表中有国家限重说明。
- UPS 表包含 1–20kg 等阶梯，并注明体积重按 `长 × 宽 × 高 / 5000`，且报价不含燃油费。
- 旧代码的 `get_cheapest_option` 会过滤不可用渠道并返回最低报价，但旧代码忽略了原表中的部分货代服务费。
- 旧代码的 UPS 计算主要按实际重量向上取整，尚未把尺寸参与的体积重规则完整接入。
- 旧代码的内部物流码不能直接提交当前 V2 页面。现场证据显示当前 V2 下拉值与旧中间码存在差异，必须使用平台页面实际 value。

## V2/V3 适配边界

核心计算只读取规范化字段，不读取页面选择器。每个平台单独维护适配层：

```text
platform-adapters/
  v2/
    carrier-value-map
    page-field-map
    rule-parser
  v3/
    carrier-value-map
    page-field-map
    rule-parser
```

适配层负责：

1. 识别表头和页面字段，不依赖固定列号；
2. 把平台国家、服务和重量单位映射到规范化字段；
3. 将规范化渠道映射回当前版本的页面 value；
4. 保存版本、来源和未确认字段；
5. 在平台字段变化时生成差异记录，不静默覆盖旧规则。

## 计算输出契约

每次报价都应保留一份可追溯结果：

| 输出 | 说明 |
| --- | --- |
| `input` | 国家、实际重量、长宽高、币种和业务上下文 |
| `billableWeight` | 实际/体积重比较后的计费重量及规则来源 |
| `candidates` | 被限重、国家、服务状态或缺字段过滤的渠道及原因 |
| `quotes` | 每个可用渠道的基础费、固定费、附加费、汇率后金额 |
| `selected` | 选择的渠道、平台 value、规则版本和选择原因 |
| `status` | `calculated`、`unavailable`、`needs_review` 或 `blocked` |
| `evidence` | 来源表、页面版本、采集批次和证据等级 |

缺少费率、单位或边界时必须返回 `needs_review`/`unavailable`，不能用 `0` 伪装成免费渠道。

## 进入脚本前的准备清单

- [x] 保留旧 Excel 和旧计算器作为原始参考。
- [x] 明确 V2/V3 不共享页面编码映射。
- [x] 明确实际重量、体积重、限重和费用组成需要分开建模。
- [ ] 从 V2 资料查询页取得卖家自配送价目表的完整字段、更新时间和单位。
- [ ] 取得货代、AGL、发往 FBA、FBA 价目表的原始表或页面证据。
- [ ] 为 0.15kg、0.3kg、2kg、2.5kg 和体积重大于实际重建立边界样例。
- [ ] 核对 V2 当前页面的物流下拉真实 value，并建立 V2 映射文件。
- [ ] V3 出现后新增 V3 映射和差异报告，不修改 V2 原始记录。

## 结论

现在可以先做计算层的字段契约、导入清洗和边界测试；暂不应把旧脚本直接改成 V2/V3 自动提交脚本。等拿到具体版本的完整价目表后，只需补充来源记录和平台适配层，核心计算与审计结构可以复用。
