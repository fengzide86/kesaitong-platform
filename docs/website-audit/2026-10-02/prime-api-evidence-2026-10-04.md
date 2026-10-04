# V2 Prime 折扣现场 API 补证（2026-10-04）

## 结论与范围

本轮新建未来的 Prime 测试活动 `KST_API_PRIME_20261004`，实际执行**保存活动 → 添加并验证商品 → 保存折扣 → 修改折扣 → 删除商品行 → 重新添加 → 提交折扣 → 列表和详情回读**。商品折扣从 20% 改为 21% 后读回一致；删除后商品列表为空，重新添加后恢复为 1 行 20%。删除的是测试活动的商品关联，不是库存商品。

**最终“提交折扣”返回 HTTP 200、Code=0、Msg=`操作成功.`，但活动列表仍为“等待中”，详情商品仍显示“准备提交”。不能据按钮名称或 Code=0 宣称活动已经生效。**本轮对比首次保存 20% 与最终提交 20% 的请求，payload 逐字段完全相同；尚未发现可区分“保存”和“提交生效”的请求字段。

最终保留这条未来“等待中”的测试活动，含 1 行 20% 商品折扣。未找到整条活动的取消或删除按钮，没有执行整单取消/删除，也没有强制操作隐藏编辑控件。

本文件只保存字段、类型、测试名称和脱敏关系，不保存账号、真实活动 ID、库存商品 ID、SKU、ASIN、完整 `paras` 或认证数据。对象别名为 `prime-test-20261004`，商品为此前已转换 FBA 的同一子 SKU。事件序号沿用运行时重置后恢复的新 IAB 采集段，与 [优惠券补证](coupon-api-evidence-2026-10-04.md) 属于同一段，不能与重建前同号事件混用。

## 1. 实际事件链

```text
创建未来 Prime 折扣活动
→ 保存并添加商品
→ 第 2 步输入 FBA 子 SKU 和 20% 折扣，验证商品
→ 详情显示“准备提交”
→ 尝试改为 21%，普通 fill 被重置成 20%
→ 保存折扣，活动列表“等待中”，商品回读仍为 20%
→ 逐键输入 21 并按 Tab，保存后回读 21%
→ 删除测试活动的商品行，回读商品列表为空
→ 重新添加同一 SKU 和 20%，回读 1 行
→ 提交折扣，返回 Code=0
→ 活动列表仍“等待中”，详情商品仍“准备提交”20%
```

| 动作 | Method / path | 本采集段请求→响应序号 | HTTP / 业务结果 | 已观察结果 |
|---|---|---|---|---|
| 保存活动并进入添加商品 | POST `/ECrossAmazon/SavePromotionInfo` | 1795→1805 | 200；Code/Msg 未捕获 | 导航后正文未取回，进入第 2 步 |
| 输入 SKU 和 20%，验证商品 | POST `/ECrossAmazon/SavePromotionProductInfo` | 1982→1984 | 200；Code/Msg 未捕获 | 导航后正文未取回 |
| 初次详情回读 | POST `/ECrossAmazon/GetPromotionDetail` | 2125→2137 | 200 / Code=0 | 同一测试活动 |
| 初次商品回读 | POST `/ECrossAmazon/GetPromotionProductList` | 2139→2144 | 200 / Code=0 | 商品“准备提交” |
| 保存折扣，实际仍为 20% | POST `/ECrossAmazon/SavePromotionProductInfo` | 2158→2161 | 200 / Code=0 / `操作成功.` | 此前 fill 21 未保持，实际请求仍为 20 |
| 保存后活动列表 | POST `/ECrossAmazon/GetPromotionList` | 2319→2331 | 200 / Code=0 | 活动“等待中” |
| 重新打开详情 | POST `/ECrossAmazon/GetPromotionDetail` | 2472→2490 | 200 / Code=0 | 同一测试活动 |
| 折扣值核对 | POST `/ECrossAmazon/GetPromotionProductList` | 2492→2497 | 200 / Code=0 | 仍为 20% |
| 逐键输入 21 并失焦后保存 | POST `/ECrossAmazon/SavePromotionProductInfo` | 2514→2522 | 200 / Code=0 | 保存新折扣 |
| 修改后详情 | POST `/ECrossAmazon/GetPromotionDetail` | 2839→2851 | 200 / Code=0 | 同一测试活动 |
| 修改后商品回读 | POST `/ECrossAmazon/GetPromotionProductList` | 2853→2858 | 200 / Code=0 | 折扣 21% 已读回 |
| 删除商品行 | POST `/ECrossAmazon/SavePromotionProductInfo` | 2871→2876 | 200 / Code=0 | 删除测试活动内的商品关联 |
| 删除后回读 | POST `/ECrossAmazon/GetPromotionProductList` | 2878→2883 | 200 / Code=0 | 返回空数组 `[]` |
| 重新添加同一 SKU 和 20%，验证商品 | POST `/ECrossAmazon/SavePromotionProductInfo` | 3062→3065 | 200；Code/Msg 未捕获 | 导航后正文未取回 |
| 重新添加后详情 | POST `/ECrossAmazon/GetPromotionDetail` | 3207→3219 | 200 / Code=0 | 同一测试活动 |
| 重新添加后商品回读 | POST `/ECrossAmazon/GetPromotionProductList` | 3221→3226 | 200 / Code=0 | 恢复 1 行商品 |
| 最终提交折扣 | POST `/ECrossAmazon/SavePromotionProductInfo` | 3239→3242 | 200 / Code=0 / `操作成功.` | 返回成功提示，不能代替状态回读 |
| 最终活动列表 | POST `/ECrossAmazon/GetPromotionList` | 3400→3412 | 200 / Code=0 | 仍为“等待中” |
| 最终详情 | POST `/ECrossAmazon/GetPromotionDetail` | 3558→3570 | 200 / Code=0 | 同一测试活动 |
| 最终商品回读 | POST `/ECrossAmazon/GetPromotionProductList` | 3572→3577 | 200 / Code=0 | 仍为“准备提交”、20% |

表中三个导航后未取回响应正文的写入，均不反填 Code=0。对应对象/商品是否保存，以后续读取为依据；不是因为 HTTP 200 就默认成功。

## 2. 活动信息与 SavePromotionInfo

### 2.1 页面值与 XML 映射

| 字段 | 已确认含义 | 本轮输入 / 样本值 |
|---|---|---|
| `DS1505` | 本轮 Prime 活动类型值 | `4`；不扩展为完整活动类型枚举 |
| `DS1537` | 活动名称 | `KST_API_PRIME_20261004` |
| `DS1535` | 开始时间 | `2026-10-05 12:00:00` |
| `DS1536` | 结束时间 | 输入 `2026-10-05 18:00:00`，回读 `2026-10-05 17:59:59` |

时区定义及结束时间减一秒的完整规则未验证，本文件只记录该样本的输入与回读差异。

### 2.2 创建活动请求

路径为 `POST /ECrossAmazon/SavePromotionInfo`。外层 form `arrayStr` 是字符串，内容为 JSON 数组；内层字段：

| 字段 | 类型 | 本轮语义 |
|---|---|---|
| `courseId` | string | 当前课程，不保存原值 |
| `shopId` | string | 当前店铺，不保存原值 |
| `ds1501` | string | 活动上下文标识，不保存原值 |
| `DS15XmlStr` | string | URI 编码 XML，层级 `ROOT/DS15_amz` |
| `language` | string | 当前语言上下文 |
| `optype` | number | `0`，本轮新建活动 |

XML 已观察字段为 `DS1505,DS1537,DS1535,DS1536`。活动保存请求 HTTP 200，但因随后的页面导航，未取回业务返回正文；之后进入商品步骤并能读取同名活动，才形成实际已保存证据。

## 3. 商品输入与 SavePromotionProductInfo

### 3.1 可见输入选项

商品步骤初始提供 3 行 SKU 输入，界面显示最多可添加 30 个商品；本轮只验证 1 个商品，没有验证批量 30 行。

| 页面选项 / 字段 | 已观察可选值 | 本轮覆盖 |
|---|---|---|
| 折扣类型 `discountType` | `AmountOff=1`、`PercentageOff=2`、`FixedPrice=3` | 百分比 `2` |
| 行操作 `Action` | `Add=0`、`Edit=1`、`Delete=2` | 新增、编辑、删除均真实提交 |
| SKU | 既有 FBA 子商品 SKU | 与请求 `DS1606` 的实际值已比对相等；不保存原值 |
| 折扣值 | 百分比数值 | 20 → 21 → 删除 → 重新添加 20 |

输入可靠性不是“fill 成功即可”：首次尝试填写 21 后，实际被页面重置为 20，保存与后续回读仍为 20。改为逐键输入 21 并按 Tab 后，再次保存和商品回读才确认 21。后续脚本应检查失焦后的值、请求值和回读值，不只检查输入方法是否抛错。

### 3.2 外层协议

新增/验证、保存编辑、商品行删除和最终提交都观察到 `POST /ECrossAmazon/SavePromotionProductInfo`。

外层 form `arrayStr` 字符串，解析后对象字段：

| 字段 | 类型 | 本轮样本 |
|---|---|---|
| `courseId,shopId,ds1501,language` | string | 当前课程、店铺、活动、语言，不保存实际标识 |
| `DS16XmlStr` | string | URI 编码 XML，层级 `ROOT/DS16_amz` |
| `type` | number | `2`；其完整枚举语义未确认 |
| `optype` | number | 本轮各商品操作均为 `0` |
| `ds1601` | number | 商品关联记录上下文，不保存原值 |

不能用外层 `optype=0` 单独判断是新增：本轮编辑、删除、最终提交同样取 `0`，行级变化在 XML 内的 `ActionType`。

### 3.3 行级 XML 字段

| XML 字段 | 已确认映射 / 样本 | 证据边界 |
|---|---|---|
| `DS1605` | 折扣类型，本轮 `2` 百分比 | 未提交其他折扣类型 |
| `DS1606` | SKU 文本 | 已与本轮输入的子 SKU 实际比对相等 |
| `DS1611` | 折扣数值：新增 20、编辑 21、删除样本 0 | 删除的 0 不表示库存价格被置零 |
| `DS1612` | 本轮样本 `0` | 语义未确认，不擅自命名 |
| `ActionType` | 新增 `0`、编辑 `1`、删除 `2` | 最终“提交折扣”样本也是 `1` |

新/编辑/删除都作用于活动商品关联。商品列表从 1 行变为空数组，证明活动关联被删除；这不证明库存商品已删除，也没有执行库存商品删除。

## 4. 保存与提交没有形成可区分的生效证据

对比对象是本轮第一次实际保存 20% 的请求与重新添加同一 SKU 后最终提交 20% 的请求。**两个 payload 逐字段比较完全相同**，最终提交的 `ActionType` 仍为编辑值 `1`。

| 检查点 | 第一次保存 20% 后 | 最终提交 20% 后 |
|---|---|---|
| API 结果 | HTTP 200、Code=0、Msg=`操作成功.` | HTTP 200、Code=0、Msg=`操作成功.` |
| 活动列表 | 等待中 | 等待中 |
| 商品详情 | 准备提交，20% | 准备提交，20% |
| 请求 payload | 与最终提交逐字段相同 | 与首次保存逐字段相同 |

能够确认的是活动存在、商品关联存在、折扣可保存/修改/删除。不能确认的是“提交折扣”已使活动进入生效、展示中或另一提交状态。该现象可能涉及页面实现、未来开始时间或服务端流程，但本轮没有隔离这些因素，不能给出确定原因，也不能靠猜 API、修改隐藏字段或点击隐藏按钮制造生效结论。

## 5. 列表和详情返回结构

以下为已归档的同接口样本字段类型，不是服务端完整契约。form 中数字形态字段仍按文本传输；`jsonStr` 是字符串，须二次 JSON 解析后才能得到数组。

### 5.1 GetPromotionList

请求 form 字段：

- `courseId,shopId,advertisingType,status`：数字形态文本。
- `keyword,startDate,endDate`：字符串。

本轮相关列表回读均为 HTTP 200、Code=0。同接口已有采样结构中的列表项为：

| 字段 | 类型 |
|---|---|
| `DS1501,DS1505,DS1506` | number |
| `DS1535,DS1536,DS1537` | string |
| `DS1538,DS1541` | null |
| `DS1554` | string |

不从这些字段编号猜测全部状态码映射；本轮状态结论来自列表可见“等待中”。

### 5.2 GetPromotionDetail

请求 form 字段 `courseId,shopId,ds1501,opType` 为数字形态文本，注意这里是大写 `T` 的 `opType`。响应 `result` 为 JSON 字符串，本轮解析得到 Code=0。

`jsonStr` 二次解析后为 1 个活动项：

| 字段 | 类型 |
|---|---|
| `DS1501,DS1505,DS1506` | number |
| `DS1537` | string |
| `DS1511` | null |
| `DS1535,DS1536,DS1553,DS1554` | string |

### 5.3 GetPromotionProductList

请求 form 字段：

- `courseId,shopId,ds1501`：数字形态文本。
- `keyword,startDate,endDate`：字符串。

`jsonStr` 二次解析后为数组。删除后为 `[]`；重新添加后为 1 行。商品项的已观察字段：

| 字段 | 类型 |
|---|---|
| `DS1601,DS1602,DS1603,DS1604,DS1605` | number |
| `DS1606,DS1607` | string |
| `DS1608` | null |
| `DS1609,DS1610` | string |
| `DS1611,DS1612,DS1613,DS1614,DS1615,DS1616` | number |
| `DS2305` | number |

字段名相同不代表所有活动类型语义相同。除已实际比对的 SKU、折扣类型与折扣值外，不给未确认字段强加业务名称。

## 6. 最终对象状态与保留边界

- 测试活动保留，开始时间在未来，列表为“等待中”。
- 测试活动保留 1 个既有 FBA 子 SKU 的 20% 折扣，商品详情显示“准备提交”。
- 21% 修改与商品行删除均已取得独立读回；随后按本轮测试流程重新添加为 20%。
- 没有删除库存商品；没有取消或删除整条活动。
- 没有强制显示/点击隐藏控件，没有运行旧 Selenium 脚本，没有直接调用猜测的接口。

交付图片说明：Prime 状态截图同时包含商品原始标识，未纳入 r8 分享包。最终“等待中／准备提交”的结论依据上述请求与同对象列表/详情回读，不补造生效截图。

## 7. 尚未闭合的项

- 活动创建、两次验证商品写入的响应正文和业务 Code/Msg；已保留 HTTP 200 与后续回读，未伪造缺失码。
- 保存与提交 payload 相同、状态不变的确切原因，以及真正进入生效/展示中的条件。
- 整条 Prime 活动的取消/删除入口与真实请求；本轮只验证商品行删除。
- 活动时区、结束时间减一秒规则、临界时间与到期行为。
- 固定金额减免、固定价格、批量 SKU、无效 SKU、重复商品等未覆盖分支。
- `DS1612`、其他未映射 DS 字段及状态数字的准确语义。

本文件是页面行为与 API 事实记录，不是“Prime 全功能通过”的声明，也不是自动化脚本。未修改 KST 产品代码，未推送公开 GitHub。
