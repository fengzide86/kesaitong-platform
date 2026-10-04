# V2 页面动作与网络事件链路（2026-10-03）

> 2026-10-04 最新覆盖：[商品模板绑定](product-template-binding-2026-10-04.md)已实际保存并恢复；[价格分段](template-price-band-2026-10-04.md)已取得非空 DS08A 提交与回读，测试模板已删除。请求 DS08A06 是页面规则序号，返回 DS08A06 是规则 ID；地址开关仍有未持久化异常。下方将这些整体列为“未采集”的描述仅属较早批次，以新专项和[当前总览](DELIVERY-2026-10-04.md)为准。

## 2026-10-04 当前链路

当前交付见 [DELIVERY-2026-10-04.md](DELIVERY-2026-10-04.md)。以下链路已实际执行；后文旧批次的空态/未执行/缺路径保留作历史，不能覆盖本节或触发重跑已完成对象。旧 r7 不作为当前证据包。

| 链路 | 实际事件顺序 | 证据与边界 |
|---|---|---|
| 订单与仓库 | 管理订单打开确认页→分拣EditOrderSorting→打包EditOrderPack→仓库EditOrderDelivery→同订单发货记录→卖家SaveDeliverGoods→已发运回读 | 四写HTTP200/Code0，已发运10→11；只关闭单笔成功分支。[字段及事件](live-api-evidence-2026-10-04.md) |
| 模板 | 列表5条→创建SaveTemplate→列表6条→编辑→设默认→恢复原默认→删除DeleteSetDefaultTempalte→列表5条 | 均有业务码与回读；fill后值未进入请求的分支也保留；SKU分配未完成。[证据](template-api-evidence-2026-10-04.md) |
| 商品模板绑定 | 报价模板0.3kg→0.5kg→保存oPType0进草稿→详情回读→保存完成oPType1→恢复0.3kg→详情同值关联 | 商品级绑定完成并恢复；非逐子SKU/批量证明，DS2046处理时间5未改。[证据](product-template-binding-2026-10-04.md) |
| FBA | 展开父商品→子SKU行转换→GetProductSkuListByProduct返回1个→危险品iframe→只观察到图片GET及UI已完成→SaveDeliveryWay→同SKU库存FBA/FNSKU回读 | 保存HTTP200，正文未取回；不推断危险品独立持久化。[证据](fba-api-evidence-2026-10-04.md) |
| 商品推广 | 已有组编辑→GetProductSKUList全部9个/SKU与ASIN搜索各1个→保留原商品并加入1个→竞价0.54→SaveAdvertisingActivity Code0→组列表和详情 | 2个商品/0.54及父子ID同值关联；不证明FBA资格因果。[证据](ad-api-evidence-2026-10-04.md) |
| 秒杀 | ASIN搜索GetSellerProductList→1推荐→高级编辑→缺图前端阻断→选图→SavePromotionDealsInfo创建→列表→详情/编辑→列表→取消→已取消回读 | 创建/编辑HTTP200但正文未知；取消Code0；不是删除。[证据](activity-api-evidence-2026-10-04.md) |
| 优惠券 | 未来对象四步表单→30小时保存Code1拒绝→改6小时创建→即将推出回读→编辑→回读→取消→已取消 | 创建/编辑正文未知；取消Code0；再次运行仅查看未提交。[证据](coupon-api-evidence-2026-10-04.md) |
| Prime | 创建活动→验证FBA子SKU20%→编辑21%并回读→删除商品关联回读[]→重加20%→最终提交Code0→仍等待中/准备提交 | 保存20%与提交20%payload相同；不声明生效，删除的是关联而非库存商品。[证据](prime-api-evidence-2026-10-04.md) |
| 购买折扣 | 创建未来促销→待生效列表1条→详情/编辑内部描述→列表回读→删除Code0→待生效列表[] | 只删新KST_API_PROMO_20261004_EDIT，原KST-PROMO-TEST未动；不是全状态清空。[证据](promotion-api-evidence-2026-10-04.md) |

剩余活动完整生命周期、时区、异常/重复提交、模板SKU分配等不由这些成功样本外推。首次空白/0计数应结合异步业务返回判断；写入后正文缺失时先回读同对象，不盲目重试。

## 历史链路记录

本文件把已经验证的动作写成“页面 → 请求 → 状态 → 回读”链路，供后续技术设计使用。没有把旧脚本点击日志当作业务成功。

> 2026-10-04 最新状态：新样本发货四次写入均已真实捕获 HTTP200/Code0、字段/编码和逐步回读，见 7.7 与 `live-api-evidence-2026-10-04.md`。第5节及7.4–7.6保留历史阶段，不代表当前仍未发货，也不要求重发已完成订单。

## 1. 商品发布链路

```text
SellerProductCategory
→ 选择叶子类目
→ SearchIsCanAddPruduct / GetProductAllList
→ SellerProductEdit 动态字段与变体
→ ImgFileUpload（可选图片）
→ SaveProduct
→ GetSellerProductList / GetProductListRepeat
→ Detail / GetProModelByProId / GetComputeTotalPriceInfo
→ 买家侧页面回读
```

### 2026-10-04 续采：登录后 FBA 列表被单账号会话冲突拦截

```text
Welcome6 → 亚马逊仿真 /24 → loginPage24 → 页面内登录
→ 进入 SellerStockFBAList 外壳
→ XHR GetFBAPlanShipmentList（请求路径已脱敏记录）
→ HTTP 200，但业务 Code=10，Msg 为“已登录另一个账号，暂时下线(102)”
→ 响应携带 User/Sign 重定向信息
→ 不把空表格当作无货件；暂停本轮写入抓包
```

这条是本轮真实 Network 证据，且与旧标签残留的“登录失效”页面分开记录。当前阻塞属于平台单账号会话冲突，不是 FBA 货件数据为空；待单一会话稳定后再继续入库计划、货件提交与状态回读。

已验证：测试商品保存返回业务 `Code:0`，库存列表出现记录，买家详情能回读价格、描述、尺寸、重量和图片。

## 2. 配送模板链路

```text
SellerShippingTemplateSetting
→ GetTemplateList / GetFeightBasicsList / GetFeightRelationList
→ 新建模板与规则
→ SaveTemplate
→ GetTemplateList
→ 基础配置与关系回读
```

历史已验证：`Smart_Precise_V34_0.15kg` 保存返回 `Code:0` 并出现在列表。后来新测试对象默认/恢复/删除已补证，SKU分配及部分精确规则仍缺，见顶部当前链路。

## 3. FBA 链路（现场已验证）

```text
SellerProductList
→ 选择“转换为亚马逊配送”
→ 只转换
→ 危险品信息 iframe
→ 保存并继续
→ 管理亚马逊库存回读 SKU/ASIN/FNSKU
```

已验证：FBA 只转换完成并回读；Prime 在 FBA SKU 上验证、保存并显示“等待中”。

## 4. 商品推广链路（独立证据，不与 FBA 转换建立因果）

```text
SellerAdvertisingActivityAdd
→ GetProductSKUList
→ 选择商品推广候选
→ SaveAdvertisingActivity
→ 活动列表/广告组商品详情回读
```

历史广告早于该次 FBA 转换创建，因此不能据此证明“转换后新建广告”的因果关系。商品推广页没有额外 FBA 开关，需做精确候选映射。历史秒杀无推荐已被2026-10-04另一子SKU搜索的有推荐分支补充，不作为当前全局阻塞。

旧脚本边界：`FULFILLMENT=value=2` 是列表筛选；V7.1 扫描广告页全部 ASIN，V5.4 按 FBA `inventory_map` 精确选择，后续技术接入只能采用后者的精确映射思路。

## 5. 订单与国内仓库链路（历史只读阶段）

```text
SellerOrderList
→ GetOrderStatusNum / GetOrderList
→ 订单详情与商品重量/买家国家
→ CompanyStockIndex / CompanyStockList
→ GetStockList
→ [未执行/流程候选] 分拣 → 打包 → 立即发货 → 发货记录
→ [未执行/流程候选] 卖家订单确认与结果回读
```

当前已验证订单列表/详情、库存和仓库 iframe 壳的只读层；未执行分拣、打包、填写运单、确认发货或导出。旧发货脚本存在失败继续发货、旧单号回读和无幂等检查点风险。

## 6. 本轮现场只读补抓

### 6.1 库存 → FBA → 货件

```text
SellerProductList（所有库存）
→ 筛选“亚马逊”
→ GetSellerProductList / GetProductListRepeat
→ 亚马逊库存（SellerProductList 的 FBA 视图）
→ 读取 SKU、ASIN、FNSKU、可售数量、费用、价格、体积
→ 货件处理进度（SellerStockFBAList）
→ GetFBAPlanShipmentList
```

现场结果：筛选动作与 FBA 视图均返回 HTTP 200；货件页显示已有货件及“即将发货”状态；已打开第一条既有货件的只读详情并观察到详情请求。未执行详情页的设置数量、预处理、贴标、检查货件、发货或取消操作。

### 6.2 广告与订单只读入口

```text
广告
→ SellerAdvertisingActivityList
→ GetAdvertisingActivityListOrDetail

订单
→ SellerOrderList
→ GetOrderStatusNum
→ GetOrderList
→ SellerOrderDetails
→ GetOrderDetail
→ 订单一览/商品行/收益/备注区块只读回读
```

现场结果：广告列表、订单列表和一条订单详情均可加载并返回 HTTP 200；只查看已有活动、计数、列表和详情，没有确认发货、取消订单、保存备注或修改广告。

### 6.3 配送设置只读入口

```text
设置
→ 卖家账户信息
→ 配送设置
→ SellerShippingTemplateSetting
→ GetTemplateList / GetFeightBasicsList / GetFeightRelationList
```

现场结果：配送模板、美国国内地区规则、国际地区规则和模板关系均可回读；未重复保存模板。

### 6.4 既有货件详情（只读）

```text
SellerStockFBAList
→ 点击已有货件“查看货件”
→ SellerProductFBAStep2
→ GetFBAPlanDetail / GetFBAPlanShipmentDetail
→ 回读货件状态、目的地、箱数、追踪信息和数量摘要
```

历史现场结果：详情页返回 HTTP 200 并展示只读货件信息。2026-10-04 登录恢复后的 UI 补证中，列表显示两条已有“即将发货”样本，本次只打开其中第一条详情；没有同步采集网络，不能将历史 HTTP 200 作为本次返回值。仍未执行设置数量、预处理、贴标、检查货件或预处理货件的写入动作；在 Step4 上下文点击“预处理货件”“一览”未观察到步骤推进，不能记为两个后续分区均已访问。页面脚本端点、状态分支和 XML 字段仅为静态线索，另见 [FBA货件只读补证](fba-shipment-readonly-evidence-2026-10-04.md)。以下分区观察保留原历史采集记录，不作为这次 UI 补证的新网络事实。

本轮继续观察了详情页的三个只读分区：

- “货件内商品”在同一详情页切换内容，展示 MSKU、ASIN、FNSKU、状态和已发货数量；未产生新的 XHR。
- “追踪货件”展示箱号、追踪编码、重量和尺寸；未产生新的 XHR。
- “一览”切换后页面回到空的货件摘要壳，并触发一次同一详情读取和验证码资源请求；这说明该分区存在客户端状态/上下文依赖，不能仅凭页面空壳判定货件数据为空。

## 6. 登录恢复链路

```text
Welcome6
→ 虚拟仿真/24（卡片文字：亚马逊仿真）
→ loginPage24 / login-iframe
→ Login
→ `/ECrossAmazonHome/CourseIndexTraining_1`
```

2026-10-03 先前从 `/21` 误入敦煌网登录，出现试用权提示；重新核对卡片后从 `/24` 进入亚马逊登录并成功到达课程首页。`/21` 的提示不再作为亚马逊权限阻塞证据。

正确的 `/24` 会话现在可继续做页面和请求采集；后续若该会话失效，应从 Welcome6 重新选择 `/24`，而不是复用 `/21`。

## 7. 本轮受控测试追加

### 7.1 配送模板保存→列表回读

```text
配送设置
→ 创建新配送模板
→ 填写测试名称与默认规则
→ 保存
→ SaveTemplate (200)
→ 页面“保存成功”
→ GetTemplateList / GetFeightBasicsList / GetFeightRelationList
→ 列表未显示刚创建名称
```

结论：这是“UI 成功但即时回读不一致”的证据，不能作为稳定成功协议，也不重复提交同名对象。

### 7.2 广告商品搜索空状态

```text
商品推广创建
→ 输入已有测试 ASIN/SKU/商品编码
→ 点击搜索
→ 0 商品
→ 保持表单，不启动广告活动
```

结论：脚本必须校验可选商品数量，不能只判断搜索按钮或输入框动作成功。

### 7.3 卖家配送→FBA 资格空状态

```text
管理库存
→ 配送类型=卖家
→ 选择测试变体组
→ 批量动作=转换为“亚马逊配送”
→ 转换页
→ 0 个 SKU
→ 未点击“只转换/转换并发送库存”
```

结论：当前对象未形成可提交 SKU；真实转换、危险品和状态回读仍待明确可转单 SKU。

### 7.4 确认发货表单初始化

```text
订单列表
→ 选择一条未发货订单的“确认发货”入口
→ SellerOrderShipping 表单
→ GetFreightList (200)
→ GetOrderDetail (200)
→ 展示承运人、配送服务、运单号字段与订单商品上下文
→ 未提交确认发货
```

结论：表单与读取依赖已确认；提交和发货后状态回读保持未确认，避免误把打开表单当作发货成功。

### 7.5 确认发货提交→登录失效→未变更

```text
订单列表
→ 同一未发货订单的确认发货表单
→ 填写承运人/配送服务/一次性测试运单号
→ SaveDeliverGoods (HTTP 200)
→ 业务 Code:10：账号已在其它地方登录，暂时下线(103)
→ User/Sign / 登录失效弹窗
→ 订单列表/详情仍为未发货
```

这是失败证据，不是发货成功。后续只允许在单一会话恢复后对同一订单做一次受控重试，且必须同时记录提交响应和列表/详情回读。

### 7.6 管理订单→国内仓库→卖家确认成功

```text
管理订单（同一未发货订单）
→ 打开确认发货上下文（不先提交）
→ 国内仓库分拣 → UI success + list readback
→ 开始打包 → UI success + next list readback
→ 立即发货（carrier selected）→ UI success
→ 发货记录 readback (carrier/tracking/freight/time)
→ 回填 warehouse tracking into SellerOrderShipping
→ SaveDeliverGoods (HTTP 200)
→ “操作成功.”
→ 管理订单 18 unshipped / 10 shipped; order status “订单完成”
```

此前直接确认时出现“请先线下实际发货，再来完成该笔订单！”；这次成功说明该提示对应严格前置条件，而不是随机登录错误。

### 7.7 新样本完整 API 成功分支（2026-10-04）

匿名样本 `shipping-sample-20261004-02` 是另一笔明确未发货模拟订单，没有重复发货7.6已完成对象。实际链路为：

```text
管理订单 → GetOrderStatusNum/GetOrderList (HTTP200, Code0)
→ 打开 SellerOrderShipping，只建立同订单上下文，不先提交
→ GetFreightList/GetOrderDetail (HTTP200, Code0)
→ 国内仓待分拣 → POST EditOrderSorting [2245→2253, 200/Code0]
→ 目标移出待分拣，待打包列表回读同订单和分拣时间
→ POST EditOrderPack [2433→2441, 200/Code0]
→ 目标移出待打包，立即发货列表回读同订单和打包时间
→ 选择承运人 → POST EditOrderDelivery [2615→2623, 200/Code0]
→ 发货记录回读同订单承运人/系统运单/运费/时间
→ 回填同订单系统运单与配送服务
→ POST SaveDeliverGoods [3008→3011, 200/Code0]
→ 已发运筛选 POST GetOrderList [3184→3187, 200/Code0]
→ 目标“订单完成”；未发货26→25，已发运10→11
```

仓库三写入位于 `/ECrossAmazonHome/`，卖家确认位于 `/ECrossAmazon/`；四个仓库子页实际均读取 `POST /ECrossAmazonHome/GetOrderList`。请求外层 `arrayStr` 包 JSON 数组，仓库 `orderIDXML` 与卖家 `DS42XmlStr` 又包含 URI 编码 XML，本轮已记录内层字段。详细类型、返回及 XML 映射以 `live-api-evidence-2026-10-04.md` 为准。

本次每步先取游标再及时分批读取，成功链各批均 `truncated=false,hasMore=false`；早前截断批次已淘汰记录不能由续读找回。仓库和卖家 SKU 不同而订单 ID 相同，应按同订单上下文回读，不能取第一个商品/运单。当前只关闭这一条成功分支；失败/重复/库存/承运人边界、DS4234/DS4255语义、跨会话恢复及其他模块仍待验证。

### 2026-10-04 会话恢复后的 FBA 只读链

```text
Welcome6 → 亚马逊仿真 /24 → 重新登录
→ 使用课程上下文进入 SellerIndex
→ SellerStockFBAList / 货件页签
→ GetFBAPlanShipmentList：HTTP200，result.Code=0，jsonStr/jsonStr1=[]
→ 点击“入库计划”
→ GetFBAPlanList：HTTP200，result.Code=0，jsonStr=[]
```

该条与同轮先前的 Code10 会话冲突分开记录；没有在空列表上继续猜测详情或提交动作。
