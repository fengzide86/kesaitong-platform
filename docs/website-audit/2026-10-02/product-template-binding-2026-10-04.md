# V2 商品配送模板绑定现场证据（2026-10-04）

## 结论与范围

本轮通过已有测试商品的编辑页，完成 **原 0.3kg 模板 → 0.5kg 模板 → 恢复原 0.3kg 模板**，各次写入均有详情回读。测试对象匿名为 `TEST-PRODUCT`，只改变配送模板；页面保存实际发送整个表单，其余既有字段原样提交，没有新建商品或模板。

真正的商品模板关系写入发生在 **`POST /ECrossAmazon/SaveProduct`**，不是模板列表页的独立 SKU 分配 API。页面报价区域的 `merchant_shipping_group_name` 对应 `DS2061`，提交值为模板 ID。详情中 `jsonStr5.DS2061` 与模板选项 `jsonStr2.DS0701` 实值相等，`DS0705` 提供模板名；最终原 0.3kg 模板的关联比较为 true。

本样本确认的是单个商品编辑表单的绑定。**没有验证同一父商品下不同子 SKU 能否分别绑定不同模板**，也没有证明批量 SKU 分配接口存在。

本文件只保存字段名、类型、匿名对象关系、事件序号及测试状态，不保存商品、SKU、ASIN、模板或账户的原始 ID 值。事件序号属于恢复后新建的 IAB 采集段，与 [优惠券](coupon-api-evidence-2026-10-04.md)、[Prime](prime-api-evidence-2026-10-04.md) 本轮补证同段；不要与早期标签页中的同号事件混用。

## 1. 真实动作与回读

```text
管理库存 → 打开已有测试商品编辑页 → 报价
→ 将配送模板从原 0.3kg 改为 0.5kg
→ 点击“保存”，oPType=0，进入草稿状态
→ 从草稿重新打开，详情读回 0.5kg
→ 点击“保存并完成”，oPType=1
→ 管理库存与详情读回 0.5kg
→ 改回原 0.3kg，点击“保存并完成”
→ 库存列表和最终详情独立回读原 0.3kg
```

| 动作 | 方法与路径 | 请求 → 响应序号 | HTTP / 业务结果 | 验证结果 |
|---|---|---|---|---|
| 初始商品详情 | POST `/ECrossAmazon/GetProductAllList` | 4897 → 4913 | 200 / Code=0 | 记录原模板关系及处理时间 |
| 选择 0.5kg，点击保存 | POST `/ECrossAmazon/SaveProduct` | 5031 → 5041 | 200 / Code=0 / 保存成功 | `oPType=0`，商品进入草稿 |
| 草稿列表 | POST `/ECrossAmazon/GetSellerProductList` | 5358 → 5370 | 200 / Code=0 | 返回 1 条草稿 |
| 草稿重新打开 | POST `/ECrossAmazon/GetProductAllList` | 5531 → 5547 | 200 / Code=0 | 读回 0.5kg 模板 |
| 保存并完成 | POST `/ECrossAmazon/SaveProduct` | 5623 → 5632 | 200 / Code=0 / 保存成功 | `oPType=1` |
| 完成后库存列表 | POST `/ECrossAmazon/GetSellerProductList` | 5789 → 5803 | 200 / Code=0 | 库存返回 9 条，页面对应 3 个父商品、9 个子项 |
| 完成后详情 | POST `/ECrossAmazon/GetProductAllList` | 6000 → 6011 | 200 / Code=0 | 再次读回 0.5kg 模板 |
| 恢复原模板并完成 | POST `/ECrossAmazon/SaveProduct` | 6090 → 6093 | 200 / Code=0 / 保存成功 | 原 0.3kg 模板，`oPType=1` |
| 恢复后库存列表 | POST `/ECrossAmazon/GetSellerProductList` | 6250 → 6268 | 200 / Code=0 | 返回 9 条库存记录 |
| 最终详情回读 | POST `/ECrossAmazon/GetProductAllList` | 6461 → 6472 | 200 / Code=0 | 原 0.3kg 模板恢复，模板 ID 关联比较为 true |

`SaveProduct` 的成功信息与详情中的实际模板关系相互印证；不是依据点击成功或 HTTP 200 单独判定持久化成功。表中“保存成功”为业务信息摘要，不用作精确标点匹配规则。

## 2. 页面字段与业务字段映射

| 页面位置及控件 | 提交字段 | 回读字段 | 已确认含义与边界 |
|---|---|---|---|
| 商品编辑报价区域，配送设置 `id=merchant_shipping_group_name` | 商品 XML 内 `DS2061`，文本形式的模板 ID | `jsonStr5[].DS2061:number` | 当前商品的配送模板关系；不是模板名称文本 |
| 同一控件的选项数据 | 选择后提交模板 ID | `jsonStr2[].DS0701:number`、`DS0705:string` | ID 与模板名的映射；通过实值比较确认 `DS2061 === DS0701` |
| 报价区域处理时间，spin 控件 `id=fulfillment_latency` | 商品 XML 内 `DS2046`，本轮文本 `"5"` | `jsonStr5[].DS2046:number`，本轮为 5 | 页面处理时间映射已确认；本轮未改变其值，未测试单位、范围和校验 |

处理时间控件位于商品编辑页，不能据此称配送模板设置页提供同样控件。`DS2046` 也不能与模板中的运输时效 `DS0813` 混为同一字段。

## 3. SaveProduct 请求与返回

路径为 `POST /ECrossAmazon/SaveProduct`。外层为表单，`arrayStr` 是 JSON 数组字符串；本轮解析后数组包含一个对象。内层字段如下：

| 解析后的字段 | 类型 | 说明 |
|---|---|---|
| `courseId, shopId` | string | 当前课程和店铺上下文，值不落盘 |
| `b3001, ds0101, ds2001` | string | 表单对象上下文；仅确认字段及类型，不扩展未核对的业务含义 |
| `followup, ds2001Foll, ds2302Foll` | string | 跟卖相关上下文字段，本轮未切换此流程 |
| `DS20XmlStr` | string | 商品 XML；本轮目标模板字段为 `DS2061`，处理时间为 `DS2046` |
| `DS20AttrXmlStr` | string | 动态属性 XML，保留既有值 |
| `DS23XmlStr` | string | 子项 XML，保留既有值；不据此声称逐变体模板已验证 |
| `DS20AttrXmlStr5keys` | string | 表单随请求提交的属性数据，未单独改动 |
| `DS20AttrXmlStrkeywords` | string | 表单随请求提交的关键词数据，未单独改动 |
| `oPType` | number | 本轮 `0` 为保存为草稿，`1` 为保存并完成 |
| `language` | number | 语言上下文 |

这些字段为实际请求结构，不是建议直接重放的请求模板。特别是 XML 内容在线格式中为文本，不能将返回 JSON 的 number 类型直接当作 XML 数据类型。

响应的 `result` 为 JSON 字符串，再次解析后形状为：

```text
Code: number
Msg: string
RedirectUrl: null
Token: null
```

两次保存及一次恢复均捕获到业务成功。未采集字段校验失败、重复保存冲突或部分字段失败的返回，不推测这些异常的 Code/Msg。

## 4. GetProductAllList 读取结构

路径为 `POST /ECrossAmazon/GetProductAllList`。外层表单字段 `courseId, shopId, categoryId, DS2001, language` 在线格式均为数字形态的文本。

响应的 `result` 为 JSON 字符串，解析后含 `Code:number, Msg:null, RedirectUrl:null, Token:null`。`jsonStr1` 至 `jsonStr6` 也各自为 JSON 字符串，需分别解析；以下仅记录实际样本形状，不代表完整平台 schema。

| 数据块 | 样本数 | 已观察字段和类型 |
|---|---:|---|
| `jsonStr1` 枚举 | 1247 | `B0101, B0107, B0108, B0114, B0159, B0160, B0720, B01111, valueTextCn, valueTextEn:string; B0707:number` |
| `jsonStr2` 模板选项 | 5 | `DS0701:number; DS0705:string` |
| `jsonStr3` 分类 | 1 | `PID:number; productType, PStr_EN, PStr_CN:string` |
| `jsonStr4` 动态属性 | 54 | `AID, PType, nav, title, types, helptext, Exp:string; must, addMore:number; cataAttrsValues:array`；本文件未定义未核对的数组元素结构 |
| `jsonStr5` 商品 | 1 | 关键字段：`DS2001, DS2046, DS2061:number; DS2024, DS2048:string`；不保存原始值，不补齐其他 DS20 字段语义 |
| `jsonStr6` 子 SKU | 1 | `DS2301, DS2302, DS2305, DS2306, DS2311, DS2316, DS2318, DS2330:number; DS2309, DS2310, DS2312, DS2320, DS2324, DS2325, DS2326, DS2327, DS2328, DS2329, DS2339:string; DS2331, DS2332:null` |

商品 ID、模板 ID、父子 SKU ID 只用于现场关系比对，不保存具体值。`null` 样本也不证明该字段只允许 null。

## 5. 保存与保存并完成的差异

本轮实测两个按钮不能互相代替：

- **保存**：`oPType=0`，该商品进入草稿，从草稿列表重新打开才能继续核对报价。
- **保存并完成**：`oPType=1`，随后从管理库存和商品详情回读到已保存模板。
- 普通保存后继续使用原报价定位器时曾无匹配。现场按草稿页面入口重新打开后恢复；该次是页面状态和导航变化，**不是已确认的登录失效**。

后续脚本如仅依据“保存成功”就沿用原页面控件，可能走错状态。应先读取当前页面与列表状态，再决定进入草稿编辑或管理库存；不得将本样本的定位失配统一诊断为掉线。

## 6. 完成项与未确认项

已确认：商品编辑入口、配送模板控件、真实 `SaveProduct` 字段、草稿和完成两种操作、商品—模板 ID 关联、处理时间控件映射，以及测试变更后的恢复闭环。

仍未确认：

- 同一父商品不同子 SKU 分别设置模板，或独立/批量 SKU 分配写入接口。
- 删除被商品引用的模板时的行为，以及模板不可用、跨店铺、不存在 ID 等失败分支。
- 处理时间取值范围、单位、缺省行为与校验错误；本轮只读取并保留 5。
- 模板限重、币种、价格分段等规则，参见 [配送模板证据](template-api-evidence-2026-10-04.md) 的剩余缺口；商品绑定通过不代表这些规则已完成验证。

交付图片说明：原详情截图含商品原文，未纳入 r8 分享包。恢复为原 `0.3kg` 的结论以事件 6461 → 6472 的详情请求和页面选择值回读为准。

## 保存后的履约状态核对

后续 `POST /ECrossAmazon/GetSellerProductList`（7581 → 7606，新 IAB 采集段）HTTP200 / Code0，9 条变体数据。现场按同一子 SKU 匹配，`DS0705` 为原 `0.3kg`，`DS2307` 非空；展开该变体后仍提供“转换为卖家自行配送”“发/补货”“查看亚马逊货件”，可售 0，说明本样本仍处于 FBA 配送状态。

该列表没有 `DS2304` 键，不能把 FBA 写入字段硬套为此读取接口的返回字段。本次 `SaveProduct.DS23XmlStr` 也未携带 `DS2304`。核验的是模板与履约状态，不声称已逐字段比较全商品保存前后的所有默认值或规范化结果。
