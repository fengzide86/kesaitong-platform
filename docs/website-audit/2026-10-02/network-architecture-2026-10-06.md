# V2 网站网络架构底稿（2026-10-06）

本文件把已经观察到的页面层、共享资源层、异步请求层和状态恢复层放在一起。它是审计资料，不是 SDK、接口重放器或自动化脚本。

## 1. 页面到请求的分层

```text
Welcome6:8730
  └─ 产品卡片 24（亚马逊仿真）
      └─ loginPage24:8732
          └─ login-iframe / User/Sign
              └─ ECrossAmazonHome/CourseIndexTraining_1
                  ├─ 课程首页主页面
                  ├─ Kendo 弹窗 + iframe.k-content-frame
                  │   └─ CompanySellerAmazonIndex
                  │       ├─ 选品工具
                  │       ├─ 1688 订货平台
                  │       └─ 亚马逊卖家后台
                  └─ 新标签页 ECrossAmazon/SellerIndex
                      └─ 业务页面：SellerProductList / SellerOrderList / ...
```

页面地址上的 `paras` 只代表动态上下文存在。本底稿不保存其值，也不把它当作固定参数。

## 2. 共享资源层

卖家后台页面普遍加载以下共享资源：

- `AmazonSellerLayout.js` 与 `AmazonSellerLayout.css`：卖家后台公共壳；
- `SellerStyle.css`、Kendo UI、语言 CSS/JS、水印脚本：公共显示和控件层；
- 页面专属脚本，例如 `SellerIndex.js`、`SellerProductList.js`、`SellerUploadImaging.js`；
- 部分页面还加载 WebUploader、Amazon 字体和图片资源；
- 课程首页另有 `ECrossAmazonHomeLayout.js`、`CourseIndexTraining_1.js` 和 SignalR 客户端。

这些资源只能证明页面实现的组成，不能证明某个接口对当前账号一定可写或可重放。

## 3. 异步接口层

| 层 | 典型请求 | 当前证据 |
| --- | --- | --- |
| 课程首页初始化 | `POST /ECrossAmazonHome/GetPage` | 现场 HTTP 200；外层结果还需二次解析 |
| SignalR 协商 | `POST /signalrHub/negotiate` | 现场 HTTP 200；不等同业务数据接口 |
| 卖家首页统计 | `POST /ECrossAmazon/GetSellerProductNum` | 现场 HTTP 200；返回 `jsonStr` 统计结构 |
| 商品/库存读取 | `POST /ECrossAmazon/GetSellerProductList`、`GetProductListRepeat` | 现场 HTTP 200；请求上下文和页面 tab 不同，不能只按路径复用 |
| 订单读取 | `GetOrderStatusNum`、`GetOrderList`、`GetOrderDetail`、`GetFreightList` | 现场读取及部分写后回读 |
| 业务写入 | `SaveProduct`、`SaveTemplate`、`SaveDeliveryWay`、活动与发货保存接口 | 只对特定测试对象有受控证据；不代表全量稳定 |
| 文件/图片层 | WebUploader 相关资源和图片 GET | 上传页面只读打开时没有触发上传 POST |

通常的请求形状是：外层 form 文本 → `arrayStr` JSON → URI 编码 XML 节点。响应外层也可能把 `result`、`jsonStr`、`jsonStr1` 作为字符串返回，需要分层解析。完整字段值、Token、Cookie、Authorization 和原始业务对象不落盘。

## 4. 页面容器关系

已观察到三种容器关系：

1. **同页导航**：卖家后台顶部导航和分组菜单通过 `OnclickUrl` / `OnclickUrlSpecial` 打开业务页。
2. **新标签页**：从课程首页的 Amazon 弹窗进入 `SellerIndex`，从卖家后台菜单进入库存、上传图片等业务页时也可能新开标签。
3. **Kendo 弹窗/iframe**：课程首页的 Amazon 模块先加载 `CompanySellerAmazonIndex`，二级入口在 iframe 内部继续分支。

因此页面索引必须同时记录 `parent_page_key`、容器类型、frame 路径、是否新标签、关闭/返回关系和最终 canonical path。

## 5. 会话和异常层

已观察到的会话异常包括：

- HTTP 200 但业务 `Code:10`，提示账号在其它地方登录，随后出现登录失效弹窗；
- 首批网络事件可能出现 `truncated=true`、`hasMore=true`，必须按游标继续读取；
- 空数组可能是当前对象、筛选或上下文为空，不能直接解释成权限不足；
- 页面显示成功、HTTP 200 或 Code0 仍需看列表/详情回读，才能判断对象是否真正改变；
- KST Electron WebView 的网络捕获能力与 Codex IAB 是不同宿主，不能把一个宿主的测试结果当成另一个宿主的现场证明。

## 6. 证据等级和当前限制

| 证据 | 可支持的结论 | 不能支持的结论 |
| --- | --- | --- |
| 页面 DOM/静态脚本 | 页面入口、控件、资源和请求候选 | 当前账号授权、业务成功和稳定重放 |
| IAB 网络元数据 | 本次会话的 method/path/HTTP 状态/资源类型 | 完整请求体、响应正文、长期稳定性 |
| 现场业务 Code/Msg | 当前对象当前分支的业务结果 | 所有对象、所有异常分支 |
| 写后列表/详情回读 | 指定对象的状态变化 | 其他对象和无人值守能力 |

## 7. 采集阶段收口与后续顺序

2026-10-06 已把现有对象和范围内的核心页面地图、容器关系、主要读取请求和按 SKU FBA 空状态补入总览。后续不再为了“全量”重复打开已有专项页面；只在出现明确测试对象和授权动作时补证。

1. 若继续只读，优先补不在排除表中的一级导航首层页面，并只记录入口、容器、初始化请求、空态和权限状态。
2. 商品、模板、订单、FBA、广告和活动的成功对象不重复执行；异常分支必须使用独立对象并记录回读。
3. 每个网络批次继续记录 `cursor / truncated / hasMore`；事件不完整时保留“未知”，不补猜测。
4. 货件创建、改价、报告下载等会改变对象或产生敏感文件的动作，只有在明确对象、范围和回读判据后才进入。
5. 自动化脚本仍暂不编写；页面和网络底稿的当前剩余项见 [remaining-gaps-2026-10-06.md](remaining-gaps-2026-10-06.md)。

## 8. Canonical operation 拆分

现有历史目录是事件叙事汇总，同一路径可能在不同页面、不同 `optype` 或不同会话状态下出现。后续查询应按下面的操作单元读取，不按裸 path 合并 schema。

| operation_id | 页面上下文 | method/path | 动作/状态 | 当前证据 | 备注 |
| --- | --- | --- | --- | --- | --- |
| inventory.list | `SellerProductList` 普通库存 | POST `/ECrossAmazon/GetSellerProductList` | 列表加载/筛选 | live-read，HTTP 200 | 与 FBA 视图、秒杀推荐分开 |
| inventory.repeat | `SellerProductList` | POST `/ECrossAmazon/GetProductListRepeat` | 辅助读取 | live-read，HTTP 200 | 可能为空，不等于权限不足 |
| inventory.pricing | `SellerProductList` 定价 tab | POST `/ECrossAmazon/GetSellerProductList` | 定价列表/费用预览上下文 | live-read，HTTP 200；重复检查曾 502 | 必须保留 `pagemark=3` 与定价筛选，费用值当前为空 |
| fba.inventory.list | `SellerProductList` 亚马逊库存 tab | POST `/ECrossAmazon/GetSellerProductList` | FBA 列表加载 | live-read，HTTP 200 | 返回字段和筛选上下文不同 |
| fba.shipment.sku | `SellerStockFBAListBySku` | POST `/ECrossAmazon/GetFBAPlanShipmentSKUList` | 按 SKU 货件查询/状态筛选 | live-read，HTTP 200，空结果 | `status` 值为 10/0/2/3/4/5；当前没有真实货件 |
| inventory.planning | `SellerInventoryPlanning` | 页面首层读取 | 库龄报告/库存规划空态 | live-read，页面空态 | 当前 0 件商品；移除订单和匹配最低价菜单禁用 |
| buyer.message.list | `SellerMessageList` | 页面首层读取 | 消息类型、搜索、分页 | live-read，空态 | 不打开正文、不发送或回复 |
| fba.settings | `SellerAmazonFulfillment` | 页面首层读取 | 亚马逊物流设置展示 | live-read，状态字段 | 编辑入口只登记，不执行保存 |
| imaging.upload.page | `SellerUploadImaging` | 页面首层读取 | 图片要求/上传控件 | live-read，未触发上传 | WebUploader 动态接管文件选择，当前无文件对象 |
| deal.recommendation | `SellerAdvertisingLightningDealsSelect` | POST `/ECrossAmazon/GetSellerProductList` | ASIN 推荐搜索 | live-read，HTTP 200 | 不能复用普通库存 schema |
| order.seller.list | `SellerOrderList` | POST `/ECrossAmazon/GetOrderList` | 卖家订单列表 | live-read/回读 | 与仓库订单列表分开 |
| warehouse.order.list | 国内仓库四子页 | POST `/ECrossAmazonHome/GetOrderList` | 分拣/打包/发货/记录列表 | live-read/回读 | 旧批次 GET 记录保留为 historical |
| order.report.list | `SellerOrderReport` | POST `/ECrossAmazon/GetOrderReportList` | 新订单/未发货报告列表 | live-read，HTTP 200 | 下载另走 GET，当前未下载客户信息文件 |
| shipment.status | `SellerOrderList` | POST `/ECrossAmazon/GetOrderStatusNum` | 状态计数 | live-read | Code0 与 Code10 按 session batch 区分 |
| template.lifecycle | `SellerShippingTemplateSetting` | POST `/ECrossAmazon/SaveTemplate` | 创建/编辑 | controlled-write + readback | 特定样本有 Code0；旧“即时列表未见名称”样本不能删除 |
| promotion.prime | `SellerPrimeDiscounts` | POST `/ECrossAmazon/SavePromotionInfo` | Prime 创建/编辑 | controlled-write，响应正文缺失 | 使用 Prime XML schema |
| promotion.discount | `SellerAdvertisingPromotionSelect` | POST `/ECrossAmazon/SavePromotionInfo` | 购买折扣创建/编辑/删除 | controlled-write，响应正文缺失 | 使用另一套 DS15 schema |
| deal.lifecycle | 秒杀 | POST `/ECrossAmazon/SavePromotionDealsInfo` | optype 0/1/2 创建/编辑/取消 | controlled-write + readback | 创建/编辑正文未知，取消 Code0 |
| coupon.lifecycle | 优惠券 | POST `/ECrossAmazon/SaveCouponsInfo` | optype 0/1/2 创建/编辑/取消 | controlled-write + readback | 创建/编辑正文未知，30 小时样本被业务校验拒绝 |
| fba.convert | FBA 转换页 | POST `/ECrossAmazon/SaveDeliveryWay` | 子 SKU 卖家配送转 FBA | controlled-write + readback | 保存正文缺失，不能外推所有 SKU |

每个 operation 还要保留 `evidence_date/batch`、`evidence_level`、HTTP 状态、业务 `Code/Msg`、下一页面状态、同对象回读、`truncated/hasMore` 和 `session_state`。历史文档不删除，但在总览中应引用这张 canonical 表，避免同一路径的旧记录覆盖新证据。

## 9. 当前明确的历史状态

- `GetOrderList` 的旧 GET 发货记录观察和后续仓库 POST 成功样本属于不同页面上下文，不能合并为一个接口。
- `SaveTemplate` 的生命周期成功样本与“页面提示成功但即时列表未见名称”的样本同时存在，应按对象和批次保留。
- `SavePromotionInfo` 在 Prime 和购买折扣中共用路径但不是同一个业务 schema。
- 首批 IAB 事件出现 `truncated=true/hasMore=true` 的登录失效批次已经是历史不完整批次；成功发货链的批次另有 `truncated=false/hasMore=false` 证据，不能互相替代。
