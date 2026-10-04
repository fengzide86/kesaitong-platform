# V2 营销活动现场 API 补证（2026-10-04）

## 结论与范围

本轮在同一个亚马逊仿真会话中，用已经完成 FBA 转换、且与广告详情完成标识关联的子商品，实际走通一条**秒杀推荐搜索 → 创建 → 列表回读 → 详情 → 编辑 → 回读 → 取消 → 已取消回读**链路。测试活动已取消但仍保留在列表，不是删除。

历史“秒杀没有推荐”只适用于当时对象和查询。**本轮精确搜索当前 FBA 子 ASIN，已返回 1 个候选并成功创建活动；不能继续把无推荐列为当前全局阻塞。**本轮没有控制其他变量，不能据此断言 FBA 转换是推荐出现的唯一原因。

创建、编辑的 POST 和 HTTP 200 已捕获，但导航后响应正文未取回，业务 Code/Msg 仍未知；创建/编辑成功的依据是后续列表和详情对同一对象的回读。取消则取得 HTTP 200、Code=0、Msg=操作成功及已取消回读。

下文仅保存字段、类型、操作顺序、测试内容和脱敏对象关系；不保存账号、原始 SKU/ASIN、商品/变体 ID、活动 ID、图片地址、完整 `paras` 或认证数据。秒杀对象别名为 `lightning-test-20261004`。费用为仿真平台显示值，不代表现实支付。

## 1. 秒杀完整事件链

```text
秒杀列表（空）
→ 创建秒杀推荐页（初始未观察到 POST）
→ 输入已核对的 FBA 子 ASIN，点击搜索
→ 1 个候选，打开高级编辑
→ 填写活动字段，首次提交缺图片被前端拦截
→ 选择现有第一张图片，提交创建
→ 列表显示“即将推出”
→ 打开详情，编辑备注并保存
→ 列表回读新备注
→ 取消按钮及确认
→ 列表显示“已取消”，只保留查看
```

| 动作 | Method / path | 事件请求→响应 | HTTP / 业务结果 | 直接证据 |
|---|---|---|---|---|
| 初始秒杀列表 | POST `/ECrossAmazon/GetPromotionDealsList` | 8210→8215 | 200 / Code=0 | 列表空 |
| 精确子 ASIN 搜索推荐 | POST `/ECrossAmazon/GetSellerProductList` | 8351→8360 | 200 / Code=0 | 返回 1 个候选 |
| 高级编辑初始化 | POST `/ECrossAmazon/GetProductSkuListByProduct` | 8504→8509 | 200 / Code=0 | 返回 1 个 SKU；请求结构同本轮 FBA 读取 |
| 创建活动 | POST `/ECrossAmazon/SavePromotionDealsInfo` | 8525→8532 | 200；Code/Msg 未捕获 | 真实提交已捕获；正文因导航后丢失 |
| 创建后列表回读 | POST `/ECrossAmazon/GetPromotionDealsList` | 8682→8687 | 200 / Code=0 | 列表 1 条，测试活动“即将推出” |
| 打开活动详情 | POST `/ECrossAmazon/GetPromotionDealsDetail` | 8817→8827 | 200 / Code=0 | 同一活动详情；额外商品/变体字段见后文 |
| 编辑备注保存 | POST `/ECrossAmazon/SavePromotionDealsInfo` | 8836→8846 | 200；Code/Msg 未捕获 | 请求为编辑操作；正文因导航后丢失 |
| 编辑后回读 | POST `/ECrossAmazon/GetPromotionDealsList` | 8996→9001 | 200 / Code=0 | 测试活动的新备注可见 |
| 取消确认 | POST `/ECrossAmazon/SavePromotionDealsInfo` | 9010→9016 | 200 / Code=0 / 操作成功 | 独立取消请求与业务返回 |
| 取消后回读 | POST `/ECrossAmazon/GetPromotionDealsList` | 9018→9023 | 200 / Code=0 | 同一活动“已取消”，仅查看 |

“最初推荐页没有 POST”不代表该页永远不发请求；本轮输入并搜索后才取得推荐请求。表中的序号仅关联本次采集，不是可复用业务 ID。

## 2. 秒杀列表与候选查询

### 2.1 GetPromotionDealsList

实际请求是 form 字段：

- `courseId,shopId,status`：线格式为文本，本次样本为数字形态。
- `keyword,startDate,endDate`：字符串。

响应的 `jsonStr` 是 JSON 字符串，二次解析后为数组。已捕获到列表项字段类型：

| 字段 | 类型 |
|---|---|
| `DS1701,DS1702,DS1703,DS1704,DS1705` | number |
| `DS1706,DS1707,DS1708` | string |
| `DS1709` | number |
| `DS1710,DS1711` | string |
| `DS1712,DS1713,DS1714` | number |
| `DS1715` | string |
| `DS1717,DS1718` | number |

本轮只确认界面状态“即将推出/已取消”，未在本文件建立全部状态枚举。不能按字段编号擅自给未映射字段命名。

### 2.2 GetSellerProductList 推荐搜索

外层 `arrayStr` 为字符串，内容是 JSON 数组；内层已观察字段：

- `courseId,shopId,keyword,language:string`
- `opType,productStatus,shipType,showType,maxPrice,minPrice:number`

`keyword` 本次使用已核对的 FBA 子 ASIN，不保存实际值。HTTP 200、Code=0，返回 1 个候选。界面显示商品价格 6、最高秒杀价格 5.10、建议数量 10、库存 0、仿真费用 15。

候选库存 0 与本次活动可创建同时出现，不能拿库存 0 单独判定该平台的秒杀创建必然失败；本次也没有验证活动开始后是否实际运行或有销量。

### 2.3 高级编辑 SKU 读取

`GetProductSkuListByProduct` 请求仍是 `arrayStr` 包裹单元素数组：`courseId,shopId,DS20DS23XmlStr,language`。本次结构沿用 [FBA 补证文档](fba-api-evidence-2026-10-04.md) 中的读取协议；`DS20DS23XmlStr` 为 URI 编码 XML。不同调用方的 `language` 类型差异，不能擅自统一。

## 3. 创建与编辑提交字段

### 3.1 测试填写内容及前端校验

| 页面项 | 本轮填写/选择 | 观察结果 |
|---|---|---|
| 活动备注 | `KST_API_DEAL_20261004` | 创建后可回读；编辑后改为 `KST_API_DEAL_20261004_EDIT` |
| 标题 | `KSTTestDeal` | 保存对象内容 |
| 开始时间 | `2026-10-05 12:00:00` | 本轮输入值；时区定义未独立验证 |
| 结束时间 | `2026-10-05 18:00:00` | 回读被规范化为 `2026-10-05 17:59:59` |
| 秒杀价 | `5.10` | 对应当前候选最高价 |
| 数量 | `10` | 对应当前候选建议数量 |
| 仿真费用 | `15` | 本轮页面值；非现实付款 |
| 图片 | 选择候选的现有第一张图 | 不上传新图，不保存图片原地址 |

第一次提交时没有选择图片，前端提示“至少选择一个秒杀图片”，未产生提交 POST。补选图片后才出现 `SavePromotionDealsInfo`。这应记录为前端阻断分支，不能伪写一个不存在的 HTTP 错误或业务失败码。

### 3.2 SavePromotionDealsInfo 的创建/编辑请求

外层 form `arrayStr` 字符串，解码后的首对象字段：

| 字段 | 类型 | 创建 | 编辑 |
|---|---|---|---|
| `courseId` | string | 当前课程，不保存值 | 同一课程 |
| `shopId` | string | 当前店铺，不保存值 | 同一店铺 |
| `ds1701` | string | `"0"` | 目标活动标识，不保存原值 |
| `optype` | number | `0` | `1` |
| `DS17XmlStr` | string | URI 编码活动 XML | URI 编码更新后的活动 XML |
| `language` | string | 当前语言上下文 | 当前语言上下文 |

注意字段名为小写 `optype`，不要与商品读取的 `opType` 混淆。XML 层级为 `ROOT/DS17_amz`，本轮界面与提交字段映射：

| XML 键 | 已确认含义/关联 |
|---|---|
| `DS1708` | 备注 |
| `DS1716` | 标题 |
| `DS1706` | 开始时间 |
| `DS1707` | 结束时间 |
| `DS1709` | 仿真费用 |
| `DS1712` | 父商品内部 ID |
| `DS1713` | 秒杀价格 |
| `DS1714` | 数量 |
| `DS1715` | 所选图片 |
| `DS1718` | 子变体内部 ID |

本轮实际值交叉核对了 `DS1712/DS1718` 与此前 FBA 提交、广告详情中的同一父商品/子变体 ID 关系。文档只保留关系，不保留原始 ID。

创建和编辑的响应正文均未取回，不能因随后跳转而填入 Code=0。创建以“列表新增 1 条且状态即将推出”确认；编辑以“同一活动新备注可见”确认。返回键的完整类型不从取消响应反推。

## 4. 详情返回结构

`GetPromotionDealsDetail` 本轮 HTTP 200、Code=0。请求的全部字段尚未在本文件逐项归档，不能从路径猜测其形状。

相对列表结构，详情额外观察到：

| 字段 | 类型 |
|---|---|
| `DS1716` | string |
| `DS2001` | number |
| `DS2024,DS2048` | string |
| `DS2301,DS2302,DS2305,DS2306` | number |
| `DS2312` | string |
| `DS2333` | null |
| `DS2334` | number |
| `DS2335` | null |
| `DS2336` | number |

这些是本次样本的实际类型，不是服务端完整 schema 或其他活动状态的保证。

## 5. 取消请求与最终回读

取消使用同一路径 `POST /ECrossAmazon/SavePromotionDealsInfo`，不是按按钮名推断的另一个 Cancel API。

`arrayStr` 首对象：

- `courseId,shopId,language:string`
- `ds1701:number`：目标活动 ID，**不同于创建/编辑时的字符串类型**，不保存原值。
- `optype:number=2`
- `DS17XmlStr:string`：空 `ROOT` XML。
- `DS23XmlStr:string`：新增空 `ROOT` XML 字段。

取消请求 HTTP 200，业务 `Code=0`、`Msg=操作成功`。后续 `GetPromotionDealsList` HTTP 200、Code=0，同一测试对象显示“已取消”，操作区仅有查看。因此该记录仍保留，不得写成已删除或数据清空。

![秒杀取消后回读](evidence-images/lightning-cancelled-2026-10-04.jpg)

## 6. 其他活动的历史观察与后续补证

本文件采集阶段检查了既有优惠券“正在进行”、Prime“展示中”、购买折扣“正在进行”的UI，这些对象当时只露出查看入口。该观察继续保留，但只代表这些对象和状态。隐藏的编辑元素不能当成当前可点击功能，也不能凭DOM中的隐藏按钮宣称完成编辑/取消/删除。

后续2026-10-04的新未来对象已补出可操作分支，因此不能再把“未来活动均未执行”作为当前状态：

- [优惠券补证](coupon-api-evidence-2026-10-04.md)：已创建、编辑、取消并回读；取消后“再次运行”仅打开预填页，未再提交。创建/编辑响应正文仍缺，取消Code0。
- [Prime补证](prime-api-evidence-2026-10-04.md)：已创建活动，验证商品、20%改21%、删除商品关联、重加20%及提交并回读。最终Code0仍“等待中/准备提交”，保存和提交20%的payload相同；不宣称生效，未取消或删除整条活动。
- [购买折扣补证](promotion-api-evidence-2026-10-04.md)：新测试对象的创建、编辑、删除及回读另行归档；只删除本轮测试对象，原有`KST-PROMO-TEST`未动。

这些新样本补充而不改写旧进行中/展示中对象的只读观察；它们也不能证明所有活动状态或失败分支已覆盖。

## 7. 尚未闭合的项

- 秒杀创建、编辑保存的响应正文及业务 Code/Msg。
- 详情请求字段的完整归档，以及未映射状态码/全部 DS 字段语义。
- 活动时区定义、结束时间减一秒的完整规范，以及跨日期边界；本轮仅记录单例输入与回读差异。
- 活动到期后、正式运行、库存变化、重复提交和后端失败分支。
- 秒杀删除是否有独立有效入口；本轮只取消，没有删除。
- 优惠券、Prime、购买折扣后续专项中的剩余项：写响应正文、Prime生效与整单操作、未验证状态/折扣/受众等；已完成的未来对象分支以上述专项为准，不继续笼统列为未执行。

本文件是现场事实和协议线索，不是自动化脚本或全站完成证明；未运行旧 Selenium 脚本，未推送公开 GitHub。
