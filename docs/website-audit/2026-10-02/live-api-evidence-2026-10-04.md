# V2 现场 API 补证与会话恢复（2026-10-04）

## 结论与边界

本轮在 **Codex 内置浏览器 IAB** 实际采集，不是 KST Electron。当前 IAB 的 `Network.enable` 和 `Network.getResponseBody` 均可用；KST 的源码修改不能作为 IAB 修复证明。

本轮已补齐一笔模拟订单的：管理订单打开确认页 → 国内仓分拣 → 打包 → 立即发货 → 发货记录 → 卖家确认 → 已发运列表回读。四次写入都有真实请求、HTTP 200、业务 Code=0 和下游回读。不重复处理此前已完成的订单。本轮对象使用匿名别名 `shipping-sample-20261004-02`；原始订单号、SKU、地址、电话、运单、账号及完整 URL 参数不落盘。

这只关闭了该样本的**发货成功分支**，不代表 FBA、配送模板、营销活动等所有流程已采集完成，也不代表所有异常分支已覆盖。

## 1. 会话和采集异常

1. 旧订单页初次读取出现空列表和 0 计数，但两条真实 POST：`/ECrossAmazon/GetOrderStatusNum`、`/ECrossAmazon/GetOrderList` 均 HTTP 200，解析 `result` 后 `Code=10`、`Msg=上次登录已失效，请重新登录(101)。`。返回键还包括 `RedirectUrl`、`Token`，不保留其值。**不能把空 UI 当成业务空数据。**
2. 从 Welcome6 的“亚马逊仿真”卡片进入 `loginPage24`，登录成功返回课程首页。`loginPage21` 是其他平台，不用于恢复亚马逊会话。登录时关闭 Network 采集，取消记住账号/密码，不保存登录请求。
3. 登录页最初记忆选项点击未改变状态；重新加载后控件恢复响应。没有证据证明根因，不归结为平台权限或 KST 代码。
4. 一次全页刷新产生大量静态资源事件，初批 `truncated=true`、`hasMore=true`；续读只拿到仍保留事件，**不能恢复已经被淘汰的事件**。之后每个动作前取 cursor、动作后及时分批读取，成功链各批均 `truncated=false`、`hasMore=false`。
5. 新弹出卖家标签曾出现采集归属失效；未改浏览器或复制认证数据，而是在原任务标签中使用已观察的 `Page.windowOpen` URL 继续导航。所有完整 URL 只留在当前浏览器运行内存，文档仅保留 path。
6. 页面刚导航时会先渲染 0/空表，再异步填充；首次快照不是最终状态。应等待业务返回和目标行出现，不能盲目重复点击提交。

## 2. 请求与响应编码

- 本节字段类型来自现场解码后的请求值，不是服务端 schema 声明。form 字段的线格式仍是文本；解析 `arrayStr` JSON 后的内层类型另外列出。
- 多数写入采用外层 `arrayStr` 文本，内容是含一个对象的 JSON 数组。
- `orderIDXML`、`DS42XmlStr` 又是 URI 编码的 XML 字符串；必须先解 URI 再读 XML，不能只记录外层 arrayStr 就宣称字段齐全。
- 响应是 JSON；`result` 与 `jsonStr` 本轮为 JSON 字符串，需要二次解析。本节响应类型是解析后结构。
- 成功共享 `result={Code:number, Msg:null|string, RedirectUrl:null, Token:null}`。只记录键和类型，不采集认证头或令牌。
- 表中序号是本次标签 CDP 事件序号，便于关联请求与返回，不是可跨会话复用的业务 ID。

## 3. 订单读取和表单初始化

| 动作 | POST path | 请求字段 | 响应/回读 |
|---|---|---|---|
| 订单计数 | `/ECrossAmazon/GetOrderStatusNum` | `shopId,courseId,shipType`：form 文本，样本为数字形态 | HTTP200/Code0；`jsonStr` 数组项 `DS4004:number,DS4005:number`；页面未发货26、已发运10、全部36 |
| 未发货列表/已发运筛选 | `/ECrossAmazon/GetOrderList` | arrayStr 对象：`courseId,shopId,shipType,searchType,keyword,status,RefundStartDate,RefundEndDate,startDate,endDate:string`；`ds4001,RefundStatus,RefundShipType:number` | HTTP200/Code0；jsonStr 数组；成功前26笔未发货，成功后目标行在11笔已发运中显示“订单完成” |
| 承运人选项 | `/ECrossAmazon/GetFreightList` | arrayStr：`courseId,shopId:string` | HTTP200/Code0；jsonStr 数组4项，`DS1001:number,DS1003:string,DS1004:string` |
| 确认页订单读取 | `/ECrossAmazon/GetOrderDetail` | arrayStr：`courseId,shopId,ds4001:string` | HTTP200/Code0；jsonStr 数组1项；页面显示该订单、商品行、国家、数量；原文不保存 |

确认页控件：`#txtShippingService` 为配送服务，`#txtShippingNum` 为运单；承运人 select。入口 `goConfirmShipment(...)` 是前端动作，不是提交 API。进入确认页不等于订单已发货。

## 4. 国内仓库读取

四个仓库子页都在本轮真实观察到 `POST /ECrossAmazonHome/GetOrderList`，不是由页面名字推断。页面路由为 `/ECrossAmazonHome/CompanyOrderList`，通过不同上下文筛选。请求 arrayStr 内：

- `courseId,shopId,orderType,searchType,keyword:string`
- `language:number`
- 分拣/打包/立即发货样本 `status:number`；发货记录样本 `status:string`。不能统一强转而忽略页面差异。

响应 HTTP200/Code0；jsonStr 数组元素包括：

- 字符串：`DS2019,DS2024,DS2047,DS2048,DS2083,DS2303,DS2312,DS4014,DS4017,DS4040,DS4071,DS4085`。
- 数字：`DS4201,DS4001,DS4003,DS4006,DS4011,DS40100`。
- 状态变化字段：`DS4262` 从 null→number、`DS4265` 从 null→string 出现在分拣后；`DS4267` 从 null→string 出现在打包后；发货后 `DS4228,DS4263:number`、`DS4241,DS4268:string`。只依据本轮差异标记，不把全部 DS 字段猜成业务含义。
- 发货记录额外出现 `DS1001:number,DS1003:string,DS1004:string`；页面同一订单行有承运人、运单、运费、分拣/打包/发货时间。

## 5. 四个写入 API 与回读

| 步骤 | POST path | arrayStr 内层字段 | HTTP / Code / Msg | 事件请求→响应 | 回读 |
|---|---|---|---|---|---|
| 分拣单笔 | `/ECrossAmazonHome/EditOrderSorting` | `courseId,shopId,orderIDXML:string; language:number` | 200 / 0 / 成功分拣1个订单！ | 2245→2253 | 确定后目标移出待分拣；打包列表出现目标及分拣时间 |
| 打包单笔 | `/ECrossAmazonHome/EditOrderPack` | 同上 | 200 / 0 / 成功打包1个订单！ | 2433→2441 | 目标移出待打包；立即发货列表出现同一订单和打包时间 |
| 仓库立即发货 | `/ECrossAmazonHome/EditOrderDelivery` | 上述字段加 `ds1001:string` | 200 / 0 / 成功发货1个订单！ | 2615→2623 | 目标移出待发货；发货记录同订单生成运单、承运人、运费和时间 |
| 卖家最终确认 | `/ECrossAmazon/SaveDeliverGoods` | `courseId,shopId,ds4001,DS42XmlStr,language:string` | 200 / 0 / 操作成功. | 3008→3011 | 已发运筛选 GetOrderList（3184→3187）Code0；同一订单“订单完成”，未发货26→25、已发运10→11 |

仓库 XML 结构（三步相同，只示意占位符）：

```xml
<ROOT><DS42><DS4201><![CDATA[ORDER_ID]]></DS4201></DS42></ROOT>
```

卖家确认 XML 键：`ROOT/DS42/{DS4234,DS4255,DS4270,DS4271,DS4272,DS4273}`，每个值均 CDATA 包裹，再 URI 编码传入 arrayStr。当前界面与提交值对应：

| XML键 | 本轮可确认映射 |
|---|---|
| DS4270 | 承运人下拉 value |
| DS4271 | 承运人显示名称 |
| DS4272 | 从同一订单仓库发货记录读取的运单 |
| DS4273 | 配送服务文本 |
| DS4234、DS4255 | 样本为数字形态；精确语义仍待验证，不从单例推断 |

## 6. 已核对的标识关系

- 当前仓库和卖家两处承运人 option 均为：中邮 `10001`、E邮宝 `10002`、燕文 `10003`、UPS `20001`。旧运费模块内部码不是当前页面 value。
- 当前样本仓库展示 SKU 与卖家子 SKU **不同**；订单 ID 一致。必须以同一订单上下文关联，不能只用商品名称、商品编号或第一个 SKU 匹配。
- 仅处理一个明确未发货样本，不批量、未重发已有完成订单、未提交真实电商订单。

## 7. 验收状态与未完成项

- 已确认：正确入口恢复、有效会话读取、四个写入的字段/编码/返回、逐步回读、一条完整成功链。
- 仍未确认：失败/重复提交/库存不足/承运人不可达的完整结构；DS4234/DS4255 语义；全部 DS 字段含义；跨会话持久恢复。
- 仍待继续：FBA/危险品、配送模板完整规则、商品推广、优惠券/Prime/购买折扣变更分支。不得将本文件当作全站 API 完成证明。
- 历史 r7 包存在已撤回的稳定性结论，请以本轮更正文档为准；没有推送公开 GitHub。

验收截图仅保留页面标题与计数，不包含账号、买家、订单/运单原文：

![已发运计数回读](evidence-images/order-shipped-count-2026-10-04.jpg)
