# V2 平台只读网络观察（2026-10-03）

> 2026-10-04 最新覆盖：[商品模板绑定](product-template-binding-2026-10-04.md)已实际保存并恢复；[价格分段](template-price-band-2026-10-04.md)已取得非空 DS08A 提交与回读，测试模板已删除。请求 DS08A06 是页面规则序号，返回 DS08A06 是规则 ID；地址开关仍有未持久化异常。下方将这些整体列为“未采集”的描述仅属较早批次，以新专项和[当前总览](DELIVERY-2026-10-04.md)为准。

## 2026-10-04 当前网络证据入口

文件名和下文保留早期只读/写入阶段记录；当前已不止只读。最新交付见 [DELIVERY-2026-10-04.md](DELIVERY-2026-10-04.md)，字段与返回正文以对应专项文件为准。历史无推荐、0 SKU、0 候选、模板未回读与仓库路径未知，只适用于原批次，不能当作现在的全局状态。

| 链路 | 本次真实请求与结果 | 字段级来源 |
|---|---|---|
| 仓库到卖家确认 | `POST /ECrossAmazonHome/EditOrderSorting`、`EditOrderPack`、`EditOrderDelivery`、`POST /ECrossAmazon/SaveDeliverGoods` 均 HTTP200/Code0，有逐步回读 | [发货补证](live-api-evidence-2026-10-04.md) |
| 模板 | `POST /ECrossAmazon/SaveTemplate` 新建/编辑 Code0；`POST /ECrossAmazon/DeleteSetDefaultTempalte` 默认/恢复/删除 Code0；最终 5 条、原默认恢复 | [模板补证](template-api-evidence-2026-10-04.md) |
| 商品模板绑定 | `POST /ECrossAmazon/SaveProduct`改变DS2061，`GetProductAllList`回读0.5kg并最终恢复0.3kg，均Code0；保存oPType0进草稿、1保存完成 | [商品绑定](product-template-binding-2026-10-04.md) |
| 国家选择 | `POST /ECrossAliexpress/GetFreightCountryList` 为 Amazon 模板实际调用的共享接口，HTTP200/Code0 | [模板补证](template-api-evidence-2026-10-04.md) |
| FBA 子 SKU 转换 | `POST /ECrossAmazon/GetProductSkuListByProduct` 1 个候选；`SaveDeliveryWay` HTTP200；后置库存 Code0、FBA/FNSKU 回读 | [FBA 补证](fba-api-evidence-2026-10-04.md) |
| 商品推广 | `GetProductSKUList` 候选 9 个，SKU/ASIN 搜索各 1 个；`SaveAdvertisingActivity` Code0；`GetAdvertisingActivityGroupDetail` Code0、2 个商品、竞价0.54 | [广告补证](ad-api-evidence-2026-10-04.md) |
| 秒杀 | `GetSellerProductList` 推荐1个；`SavePromotionDealsInfo` 创建/编辑 HTTP200并回读；取消同接口 Code0，`GetPromotionDealsList` 回读已取消 | [营销活动补证](activity-api-evidence-2026-10-04.md) |
| 优惠券 | `POST /ECrossAmazon/SaveCouponsInfo` 创建/编辑/取消，30小时Code1、改6小时后回读成立，取消Code0；`GetCouponsList/GetCouponsDetail`确认同券 | [优惠券补证](coupon-api-evidence-2026-10-04.md) |
| Prime | `POST /ECrossAmazon/SavePromotionInfo`创建；`SavePromotionProductInfo`验证、编辑、删商品关联、重加及提交；最终Code0仍等待中/准备提交 | [Prime补证](prime-api-evidence-2026-10-04.md) |
| 购买折扣 | `POST /ECrossAmazon/SavePromotionInfo`创建/编辑/删除；前两项正文未知但对象回读成立，删除Code0；待生效列表为空，不代表全状态清空 | [促销补证](promotion-api-evidence-2026-10-04.md) |

优惠券新增未来样本已创建/编辑/取消并回读已取消；30小时保存返回Code1“活动时间不能超过24小时”，改6小时后成立，取消Code0，详见[优惠券专项](coupon-api-evidence-2026-10-04.md)。不把UI“1–90天”提示直接当作后端规则。

FBA保存及秒杀/优惠券创建编辑的响应正文在导航后取回失败，**业务 Code/Msg 仍未知**，不能从回读或取消响应补造。危险品表单本次提交只观察到图片 GET，没有独立写 POST；UI“已完成”不证明问卷单独持久化。事件截断、正文丢失、登录失效是不同问题，未被宣布全面修复。旧 r7 包不代表这些更正后的证据。

Prime活动创建和两次商品验证也发生导航后正文未取回；后续保存、编辑、删除关联和最终提交取得Code0，但“保存20%”与“提交20%”payload完全相同且后置状态不变。该事实只证明相应存储/关联操作，不能把成功码升级为活动生效。

购买折扣创建/编辑也保留正文缺口，删除的Code0不反填前两次操作。其XML含27个DS字段：可见DS1534/DS1548本次没发送，disabled的DS1545却发送；展示文案与6/10、12/15实际档位不一致，不能仅按DOM可见性或展示文字推断请求及优惠规则。

## 历史批次记录

本文只记录登录后页面加载期间看到的请求名称、类型和 HTTP 状态。所有查询串、账号上下文、学生/公司/商品标识均已脱敏，不保存 Cookie、Token、密码或完整 `paras`。

| 页面 | 请求 | 类型 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| 课程首页 | `/ECrossAmazonHome/GetPage?<redacted>` | XHR | 200 | 首页页面数据 |
| 课程首页 | `/signalrHub/negotiate?negotiateVersion=1` | XHR | 200 | 页面实时通道协商 |
| 公司信息 | `/Business/BusinessCompanyInfo?<redacted>` | XHR | 200 | 账户/公司信息读取 |
| 仲裁列表 | `/ArbitrateSystem/GetArbitrateSystemList?<redacted>` | XHR | 200 | 仲裁列表读取 |
| 商品分类 | `/ECrossAmazon/GetProductCategory?<redacted>` | XHR | 200 | 分类树展开 |
| 库存/定价 | `/ECrossAmazon/GetSellerProductList?<redacted>` | XHR | 200 | 商品列表读取 |
| 库存/定价 | `/ECrossAmazon/GetProductListRepeat?<redacted>` | XHR | 200 | 商品列表辅助读取 |
| 订单 | `/ECrossAmazon/GetOrderStatusNum?<redacted>` | XHR | 200 | 订单状态计数 |
| 订单 | `/ECrossAmazon/GetOrderList?<redacted>` | XHR | 200 | 订单列表读取 |
| 卖家首页 | `/ECrossAmazon/GetSellerProductNum?<redacted>` | XHR | 200 | 商品/首页计数 |
| 品牌旗舰店 | `/ECrossAmazon/GetShopMsg?<redacted>` | XHR | 200 | 店铺信息读取 |
| 账户设置 | `/Business/BusinessCompanyInfo?<redacted>` | XHR | 200 | 公司信息读取 |
| 业务报告 | `/ECrossAmazon/GetReportBusinessList?<redacted>` | XHR | 200 | 销售报告读取 |
| 配送设置 | `/ECrossAmazon/GetTemplateList?<redacted>` | XHR | 200 | 模板列表读取 |
| 配送设置 | `/ECrossAmazon/GetFeightBasicsList?<redacted>` | XHR | 200 | 运费基础配置读取 |
| 配送设置 | `/ECrossAmazon/GetFeightRelationList?<redacted>` | XHR | 200 | 运费关系/模板关联读取 |
| 管理定价 | `/ECrossAmazon/GetSellerProductList?<redacted>` | XHR | 200 | 定价列表读取 |
| 管理定价 | `/ECrossAmazon/GetProductListRepeat?<redacted>` | XHR | 200 | 定价/商品列表辅助读取 |
| 秒杀 | `/ECrossAmazon/GetPromotionDealsList?<redacted>` | XHR | 200 | 秒杀列表读取 |
| 优惠券 | `/ECrossAmazon/GetShopMsg?<redacted>` | XHR | 200 | 页面公共/店铺信息读取；主列表首屏未稳定呈现 |
| Prime 专享折扣 | `/ECrossAmazon/GetPromotionList?<redacted>` | XHR | 200 | Prime 折扣列表读取 |
| 亚马逊物流设置 | `/ECrossAmazon/GetLogisticsSettingMsg?<redacted>` | XHR | 200 | FBA 设置摘要读取 |
| 广告活动主列表 | `/ECrossAmazon/GetAdvertisingActivityListOrDetail?<redacted>` | XHR | 200 | 广告活动列表读取 |
| FBA 货件处理进度 | `/ECrossAmazon/GetFBAPlanShipmentList?<redacted>` | XHR | 200 | 货件列表读取 |
| 国内仓库壳 | `/ECrossAmazonHome/CompanyStockIndex?<redacted>` | document | 200 | 国内仓库分区与 iframe 壳 |
| 国内库存子页 | `/ECrossAmazonHome/CompanyStockList?<redacted>` | document | 200 | 国内库存列表页面 |
| 国内库存 | `/ECrossAmazonHome/GetStockList?<redacted>` | XHR | 200 | 库存列表读取 |
| 广告创建表单 | `/ECrossAmazon/SellerAdvertisingActivityAdd?<redacted>` | document | 200 | 商品推广提交前表单 |

## 正确亚马逊入口与卖家首页补抓（2026-10-03）

| 页面/动作 | 请求 | 类型 | 状态 | 脱敏响应结构 |
| --- | --- | --- | --- | --- |
| Welcome6 → 亚马逊仿真 | `/User/loginPage24` | document/iframe | 200 | 登录后进入课程首页；`21` 为敦煌入口，不混用 |
| 课程首页刷新 | `/ECrossAmazonHome/GetPage?<redacted>` | XHR POST | 200 | 外层 `result(Code:number, Msg/RedirectUrl/Token:null)` + `jsonStr/jsonStr1` 字符串 |
| 卖家首页刷新 | `/ECrossAmazon/GetSellerProductNum?<redacted>` | XHR POST | 200 | 外层 `result(Code:number, Msg/RedirectUrl/Token:null)` + `jsonStr`；内层数组元素含 `num1`–`num4` 数值字段 |

| 管理库存刷新 | `/ECrossAmazon/GetSellerProductList?<redacted>` | XHR POST | 200 | 外层 `result(Code:number, Msg/RedirectUrl/Token:null)` + `jsonStr` 数组；元素含 DS2301–DS2329/DS2343 等页面模型键名 |
| 管理库存辅助读取 | `/ECrossAmazon/GetProductListRepeat?<redacted>` | XHR POST | 200 | 外层 `result(Code:number, Msg/RedirectUrl/Token:null)` + `jsonStr` 空数组（当前首屏） |

| 配送类型筛选=亚马逊（会话失效分支） | `/ECrossAmazon/GetSellerProductList` | POST/XHR | 200 | 业务 `Code:10`，`Msg` 为“您的账号已在其它地方登录，暂时下线(103)”；随后页面显示重新登录弹窗 |
| 会话失效资源提示 | `/User/LoadVerificationCode` | POST/XHR | 200 | 触发登录失效弹窗；不把 HTTP 200 当作业务成功 |
| 重新登录后的库存回读 | `/ECrossAmazon/GetSellerProductList` | POST/XHR | 200 | 当前库存页恢复，配送类型仍为“亚马逊”；未保存完整重定向参数 |
| 按 SKU 查看亚马逊货件 | `/ECrossAmazon/GetFBAPlanShipmentSKUList` | POST/XHR | 200 | FBA 商品货件查询；当前测试 SKU 返回空列表并显示“无相关数据” |
| 订单状态计数 | `/ECrossAmazon/GetOrderStatusNum` | POST/XHR | 200 | `jsonStr` 为 24 条状态计数对象；只读 |
| 订单列表 | `/ECrossAmazon/GetOrderList` | POST/XHR | 200 | `jsonStr` 当前为 15 条订单对象；字段名/类型已脱敏记录，不保存订单原文 |
| 国内仓库外层 | `/ECrossAmazonHome/CompanyStockIndex` | document | 200 | 仓库模块壳；包含库存、运输、出入库、分拣、打包、发货记录入口 |
| 国内仓库库存页 | `/ECrossAmazonHome/CompanyStockList` | document | 200 | 库存列表页面 |
| 国内仓库库存 | `/ECrossAmazonHome/GetStockList` | POST/XHR | 200 | `jsonStr` 为库存对象数组；字段名/类型已脱敏记录 |

以上仅记录正确 `/24` 会话的页面与读取请求；不保存账号值、密码、Cookie、Authorization、完整 `paras` 或计数原值。

## 商品发布写入实测（2026-10-03）

| 动作 | 请求 | 类型 | 状态 | 结果 |
| --- | --- | --- | --- | --- |
| 变体图片上传 | `/FileUpload/ImgFileUpload` | POST | 200 | 返回后页面显示变体图片；随后读取同源 `/Resource/Upload/StoreCommon/...png` 为 200 |
| 商品保存并完成 | `/ECrossAmazon/SaveProduct` | POST | 200 | 响应业务体 `Code: 0`、`Msg: 保存成功！`；响应中无重定向 |
| 保存后库存列表 | `/ECrossAmazon/GetSellerProductList` | POST | 200 | 列表出现新商品记录 |
| 保存后列表辅助读取 | `/ECrossAmazon/GetProductListRepeat` | POST | 200 | 库存列表辅助请求 |
| 商品详情回读 | `/ECrossAmazon/Detail` | GET | 200 | 商品详情页显示价格、五点、描述、尺寸、重量和图片 |
| 商品详情读模型 | `/ECrossAmazon/GetProModelByProId` | POST | 200 | 详情页商品模型 |
| 商品详情费用计算 | `/ECrossAmazon/GetComputeTotalPriceInfo` | POST | 200 | 详情页价格/费用摘要 |
| 买家首页关联商品 | `/ECrossAmazon/GetIndexProdList` | POST | 200 | 详情页公共商品列表读取 |
| 详情页购物车 | `/ECrossAmazon/GetCartDataList` | POST | 200 | 详情页公共购物车读取 |

## 配送模板写入实测（2026-10-03）

| 动作 | 请求 | 类型 | 状态 | 结果 |
| --- | --- | --- | --- | --- |
| 创建配送模板并保存 | `/ECrossAmazon/SaveTemplate` | POST | 200 | 响应业务体 `Code: 0`、`Msg: 保存成功！` |
| 保存后模板列表 | `/ECrossAmazon/GetTemplateList` | POST | 200 | 列表出现 `Smart_Precise_V34_0.15kg` |
| 保存后运费基础配置 | `/ECrossAmazon/GetFeightBasicsList` | POST | 200 | 页面重新读取基础配送数据 |
| 保存后运费关系 | `/ECrossAmazon/GetFeightRelationList` | POST | 200 | 页面重新读取模板/运费关系 |

## 商品推广写入实测（2026-10-03）

| 动作 | 请求 | 类型 | 状态 | 结果 |
| --- | --- | --- | --- | --- |
| 广告活动列表 | `/ECrossAmazon/GetAdvertisingActivityListOrDetail` | POST | 200 | 读取现有活动并刷新列表 |
| 商品候选读取 | `/ECrossAmazon/GetProductSKUList` | POST | 200 | 广告编辑页读取可添加商品 |
| 启动商品推广 | `/ECrossAmazon/SaveAdvertisingActivity` | POST | 200 | 页面弹窗显示“操作成功” |
| 启动后的列表回读 | `/ECrossAmazon/GetAdvertisingActivityListOrDetail` | POST | 200 | 列表出现 `KST 商品推广测试`，状态“已安排” |

## 只读补抓增量（2026-10-03）

本节来自此前已授权的单一 Amazon 仿真标签页；只保存脱敏 method/path/status，不保存请求值、Cookie、Authorization、完整 `paras` 或页面原文。

| 页面/动作 | 请求 | 类型 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| 库存首次加载 | `/ECrossAmazon/GetSellerProductList` | POST/XHR | 200 | 列表查询对象数组字段为 `arrayStr` |
| 库存首次加载辅助 | `/ECrossAmazon/GetProductListRepeat` | POST/XHR | 200 | 列表辅助读取 |
| 配送类型=亚马逊筛选 | `/ECrossAmazon/GetSellerProductList` | POST/XHR | 200 | 通过列表查询对象中的配送类型筛选；不是转换动作 |
| 亚马逊库存视图 | `/ECrossAmazon/GetSellerProductList`、`/ECrossAmazon/GetProductListRepeat` | POST/XHR | 200 | 回读 FBA 视图字段（SKU、ASIN、FNSKU、可售、体积等） |
| 广告活动列表 | `/ECrossAmazon/GetAdvertisingActivityListOrDetail` | POST/XHR | 200 | 只读活动列表 |
| 订单状态计数 | `/ECrossAmazon/GetOrderStatusNum` | POST/XHR | 200 | 订单状态计数 |
| 订单列表 | `/ECrossAmazon/GetOrderList` | POST/XHR | 200 | 只读订单列表 |
| 配送模板 | `/ECrossAmazon/GetTemplateList`、`/ECrossAmazon/GetFeightBasicsList`、`/ECrossAmazon/GetFeightRelationList` | POST/XHR | 200 | 模板、地区规则和关系读取 |
| 货件处理进度 | `/ECrossAmazon/GetFBAPlanShipmentList` | POST/XHR | 200 | 既有货件/入库计划列表 |
| 货件详情 | `/ECrossAmazon/GetFBAPlanDetail` | POST/XHR | 200 | 点击既有货件“查看货件”后的摘要读取 |
| 货件箱/商品明细 | `/ECrossAmazon/GetFBAPlanShipmentDetail` | POST/XHR | 200 | 详情页箱号、追踪、数量等只读明细 |

### 货件详情分区补充

- “货件内商品”和“追踪货件”是同一详情页的客户端分区切换，本轮切换未产生新的 XHR；可见字段分别包括 MSKU/ASIN/FNSKU/状态/数量，以及箱号/追踪编码/重量/尺寸。
- “一览”切换触发了同一 `GetFBAPlanDetail` 读取和 `/User/LoadVerificationCode` 资源请求，页面短暂显示空摘要壳；该现象标记为上下文/客户端状态异常，未执行任何写入动作。

## 秒杀、Prime、促销与优惠券补充观察（2026-10-03）

| 动作 | 页面/请求证据 | 结果 |
| --- | --- | --- |
| 秒杀 ASIN 搜索 | `SellerAdvertisingLightningDealsSelect` 页面搜索控件 | 页面返回“目前无推荐”，并提示只有 FBA 配送 SKU 才能参与；未产生创建提交请求 |
| Prime 折扣提交校验 | `SellerPrimeDiscountsEditProduct` 商品行提交 | 第一次卖家自配送状态下被业务校验为无效或没有可用 FBA 商品；完成 FBA 转换后同一链路验证并保存成功，列表回读“等待中” |
| 购买折扣保存 | `SellerAdvertisingPromotionEdit` 表单保存后返回促销列表 | 页面保存成功并可在“全部”筛选中回读 1 条测试记录；本次未把未观测的内部请求名写成确定接口 |
| 优惠券四步提交 | `SellerCouponsEdit` 四步表单提交后返回优惠券列表 | 列表回读 3 条记录，并可进入新记录详情；本次未把未观测的内部请求名写成确定接口 |

说明：促销和优惠券的写入结果由页面跳转、列表计数、记录字段和详情页共同确认；当前资料没有可安全复用的请求名/响应体，因此不凭猜测补写接口。后续若要做脚本，应在受控调试记录中捕获脱敏后的 method/path/status，而不是从页面路由反推。

## FBA 转换与 FBA 商品推广补充观察（2026-10-03）

| 动作 | 页面/请求证据 | 结果 |
| --- | --- | --- |
| 库存切换亚马逊配送 | 管理库存顶部批量动作“转换为‘亚马逊配送’” | 进入转换表单，选中历史测试商品；当前页提供“只转换”和“转换并发送库存”，本次选择“只转换”，没有创建货件 |
| 危险品信息 | 转换流程中的 iframe 模态表单 | 按商品实际情况选择无电池、无危险品并提交，回到“已完成 - 编辑表单” |
| FBA 状态回读 | `SellerProductList` 的“管理亚马逊库存”视图 | 回读同一测试商品 SKU/ASIN/FNSKU，状态“在售”、可售 0、费用预览 `$0.90`、体积 `0.042`；此处不保存原始标识 |
| FBA 商品与广告组映射 | `SellerAdvertisingActivityList` → 现有商品推广活动 → 广告组“查看” | 广告组商品明细回读同一 ASIN/SKU，与 FBA 转换后的库存行一致；商品推广页没有额外 FBA 开关。该广告创建早于本次转换，只作为映射/回读证据，不作为因果实验 |
| Prime 重新验证 | FBA 转换后 `SellerPrimeDiscountsEditProduct` | 同一测试 SKU、Percentage Off 20%，验证后保存弹窗“操作成功”，列表状态“等待中” |
| 秒杀重新搜索 | FBA 转换后 `SellerAdvertisingLightningDealsSelect` | 仍显示“目前无推荐”，并提示只有 FBA 配送 SKU 才能参与；这是推荐资格/活动条件未满足，不代表 FBA 转换失败 |

旧脚本对照：`FULFILLMENT=value=2` 只是库存页的“亚马逊配送”筛选，不是转换动作。`广告板块自动化脚本.py` 在筛选行读取 SKU/ASIN/价格；`FBA自动化发货脚本.py` 先读普通库存父级 SKU，切到 FBA 后主要读取 ASIN/价格。商品推广 P1 前者扫描创建页全部 `span.asin` 后分批，存在混入非 FBA 候选的风险；后者使用 `inventory_map` 中的 FBA ASIN 精确勾选。后续复现优先采用精确映射，并以广告组详情回读为准。

登录失效对照：此前失效会话对 `/ECrossCommon/GetSystemProductImage` 返回 HTTP 200，但业务体为“上次登录已失效，请重新登录(101)”，随后图片地址出现 `/undefined` 的 404。该平台不能只看 HTTP 状态判断成功，必须解析业务 `Code/Msg` 和页面状态。

## 解释与边界

- 这些是页面现场观察到的读取请求，不代表完整接口清单，也不代表可以安全调用任意写入接口。
- 秒杀在完成 FBA 转换后仍无推荐；Prime 已在 FBA 商品上完成验证、保存并回读“等待中”。本批已触发并回读商品推广、购买折扣和优惠券写入结果；仍没有触发发货、提现、第三方应用安装或账户变更请求。商品上传/保存只针对用户明确选择的 `ALE-000226`，物流写入只创建了一个未分配的新模板，广告/促销/优惠券/Prime 写入均为短周期测试记录。
- 后续若用户确认要研究某一页面，仍先区分“读取字段”“可编辑字段”“提交动作”和“评分/业务规则”，不会把可见按钮直接当成可执行脚本。

## 国内仓库剩余页面只读补抓（2026-10-03）

| 页面/动作 | 请求 | 类型 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| 货物运输/出入库/分拣/打包/立即发货页 | 页面结构已现场观察 | — | — | 本轮没有为每个子页单独建立事件游标，因此不把页面名推断为接口名；请求待下一批按页抓取 |
| 发货记录页刷新 | `/ECrossAmazonHome/CompanyOrderList` | GET/document | 200 | 运单号状态筛选和记录列表壳；当前无数据 |
| 发货记录列表 | `/ECrossAmazonHome/GetOrderList` | GET/XHR | 200 | 发货记录读取；不等于已发货 |

说明：`CompanyOrderList` 与 `GetOrderList` 的 200 证据来自“发货记录”子页刷新，不代表其余子页一定复用同一路径。分拣、打包、物流单号、确认发货的写入请求及回读仍未执行；下一次需对每个子页单独建立事件游标再记录。

## 订单详情只读补抓（2026-10-03）

| 页面/动作 | 请求 | 类型 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| 订单详情页面 | `/ECrossAmazon/SellerOrderDetails?<redacted>` | GET/document | 200 | 详情页壳与只读字段 |
| 订单详情读取 | `/ECrossAmazon/GetOrderDetail` | POST/XHR | 200 | 订单一览、商品行、收益等详情读取；请求值与订单原文不保存 |

说明：详情页存在卖家备注保存按钮，但本轮未填写、未保存；确认发货、取消、打印装箱单等写入/副作用动作仍未执行。

## 受控测试追加（2026-10-03）

| 页面/动作 | 脱敏请求或事件 | 状态 | 结论 |
|---|---|---:|---|
| 创建配送模板 | `POST /ECrossAmazon/SaveTemplate` | 200 | UI 显示保存成功；即时 `GetTemplateList` 未回读测试名称，标记为持久化不一致 |
| 广告商品搜索 | 表单搜索事件 | — | 已有测试 ASIN/SKU/商品编码均为 0 商品；未提交广告 |
| 卖家配送→FBA | `/ECrossAmazon/SellerProductList` 转换上下文 | 页面可达 | 转换页显示 0 SKU，未执行只转换/发送库存 |

本节只记录可复核的脱敏信息；未把缺少监听的请求名、完整参数或凭据补写成推断。

## 发货表单初始化补抓（2026-10-04）

| 页面/动作 | 脱敏请求 | 类型 | 状态 | 说明 |
|---|---|---|---:|---|
| 确认发货表单加载 | `POST /ECrossAmazon/GetFreightList` | XHR | 200 | 承运人/配送选项读取；字段值不落盘 |
| 确认发货表单加载 | `POST /ECrossAmazon/GetOrderDetail` | XHR | 200 | 当前未发货订单商品上下文读取；订单原文不落盘 |
| 发货页面资源 | `GET /Scripts/ECross/amazon/SellerOrderShipping.js` | Script | 200 | 表单交互脚本；不是业务写入 |

上述初始化观察阶段未填写或提交承运人、服务和运单号；后续写入和状态变化见下方受控提交与成功闭环，不再将这一历史阶段解释为当前未发货。

## 确认发货受控提交（2026-10-04）

| 页面/动作 | 脱敏请求 | 类型 | 状态 | 业务结果/后续 |
|---|---|---|---:|---|
| 确认发货提交 | `POST /ECrossAmazon/SaveDeliverGoods` | XHR | 200 | 业务 `Code:10`；账号在其它地方登录，暂时下线(103) |
| 登录失效恢复 | `GET /User/Sign` | document/redirect | — | 页面显示“登录失效，请重新登录” |
| 登录失效恢复 | `POST /User/LoadVerificationCode` | XHR | 200 | 登录弹窗资源；不代表重新登录成功 |

首次提交后订单页仍为“未发货”，未记录为成功发货。请求体只保留字段边界，不保存运单值、完整上下文参数或订单原文；当时的恢复待办随后由下方成功闭环更新，不应据此重复发货。

## 国内仓库→卖家确认成功闭环（2026-10-04）

本节为第一笔历史闭环，前三个请求未留全的状态只描述当时采集；新样本的四条完整成功请求见文末补证，不改写旧批次证据。

| 页面/动作 | 事件/请求证据 | HTTP/业务结果 | 回读 |
| --- | --- | --- | --- |
| 分拣产品 | 真实按钮提交（写入路径未被 CDP 监听器稳定捕获） | 页面“成功分拣1个订单！” | 同一订单移出分拣待处理列表 |
| 开始打包 | 真实按钮提交（写入路径未被 CDP 监听器稳定捕获） | 页面“成功打包1个订单！” | 立即发货页出现该订单并显示分拣/打包时间 |
| 立即发货 | 真实按钮提交；承运人值已按页面选项选择 | 页面“成功发货1个订单！” | 发货记录显示承运人、系统运单号、运费、发货时间 |
| 卖家确认发货 | `POST /ECrossAmazon/SaveDeliverGoods` 真实触发 | 页面“操作成功.” | 管理订单已发运列表显示该订单“订单完成” |

分拣、打包和立即发货的写入路径没有被本次 CDP 监听器稳定保留，因此不猜测 endpoint；只保留真实页面成功提示和后续列表/记录回读。请求记录仍只保存脱敏字段形状，不保存订单号、运单号或完整上下文。

## 采集稳定性结论更正（2026-10-04）

### 宿主身份与因果更正

此前将 KST 工程的 Electron WebView 缺少 Network 监听，误写为本次 Codex 内置浏览器（IAB）现场采集不稳定的根因，现撤回该因果结论。这是两种不同宿主，没有证据表明修改 KST 文件会改变当前 IAB 的采集行为。国内仓库三个写入请求未完整留证的事实保留；未证明是页面刷新、跳转或 iframe 切换导致，不补写未经验证的原因。

### 独立 KST 代码增强记录（不是 IAB 修复证明）

- `electron/automation/embedded-browser-host.cts` 在 `browser.prepare` 时为当前唯一 WebView 启用 `Network` 调试域并持续监听请求、响应和失败事件。
- 新增内部动作 `browser.network.snapshot` 与 `browser.network.clear`，使用固定大小 2000 条环形缓冲，超出部分只计数不无限增长；快照中的 `dropped` 大于 0 时不得把证据当作完整链路。
- 只保留脱敏后的 pathname、method、HTTP 状态、资源类型和 MIME 类型；查询参数、请求体、Cookie、Authorization、Token 和密码不进入缓冲区。
- `release`、`detach`、WebView 销毁和重新注册都会移除监听器并清空上一任务证据，避免跨任务串线或使用陈旧事件。
- Runner 在成功或失败收尾前会请求一次 `browser.network.snapshot`，以 0600 权限把当前任务的脱敏事件保存为本地 `.network.json` 证据，并通过 artifact 事件返回路径；不会把请求体或凭据上传为业务字段。
- Network 域不可用时预检返回 `networkCapture: "unavailable"`，不会伪装成已采集；页面扫描和 Demo 流程仍可继续。
- 上述 KST 事件只保留请求元数据，没有请求字段名/类型、响应结构或业务 `Code/Msg`，也不把请求关联 ID 写入快照；即便后续使用该宿主实测，也不能仅靠该快照补全字段级 API 契约。

### KST 既有测试记录与现场验证边界

- Electron TypeScript 编译通过。
- `src/tests/electron/embeddedBrowserHost.test.ts` 通过 5/5：包含 Network.enable、请求/响应事件脱敏、快照和清空验证。
- 上述本地验证不能证明 Codex IAB 的网络采集已修复；也不构成改用 KST、重复提交已完成订单或关闭现有字段级缺口的依据。

### Codex IAB 新现场证据

- `Network.enable` 已成功。重新加载后观察到 `POST /ECrossAmazon/GetOrderStatusNum` 和 `POST /ECrossAmazon/GetOrderList`，两者均 HTTP 200。
- 响应外层 `result` 是字符串；解析后键为 `Code`、`Msg`、`RedirectUrl`、`Token`。两者业务结果均为 `Code:10`、`Msg:上次登录已失效，请重新登录(101)`；不保存 `RedirectUrl` 或 `Token` 的值。这证明两条读取命中登录失效，而非成功业务返回。
- 首次事件批次 `truncated=true`、`hasMore=true`；继续读取下一批后队列清空。后续须按游标及时读取直到无后续批次，不能将首批当作完整事件链。
- 随后已从正确的 `loginPage24` 恢复课程首页（页面显示处理订单 10 笔），并打开 Amazon → 卖家后台；尚未完成有效会话下跨页面、写入和回读的稳定性验收。完整增量见 `live-api-evidence-2026-10-04.md`。历史 r7 压缩包含本节已撤回结论，不推荐继续使用。

## 发货 P0 成功分支网络补证（2026-10-04）

对象为新匿名样本 `shipping-sample-20261004-02`，不是此前已完成订单。以下均是当前 Codex IAB 实际记录，不由页面路由或旧脚本猜测。

| 动作 | POST path | 请求→响应序号 | HTTP/业务结果 | 回读 |
| --- | --- | --- | --- | --- |
| 分拣 | `/ECrossAmazonHome/EditOrderSorting` | 2245→2253 | 200 / Code0 / 成功分拣1个订单！ | 移出待分拣，打包列表出现同订单与分拣时间 |
| 打包 | `/ECrossAmazonHome/EditOrderPack` | 2433→2441 | 200 / Code0 / 成功打包1个订单！ | 移出待打包，立即发货列表出现同订单与打包时间 |
| 仓库发货 | `/ECrossAmazonHome/EditOrderDelivery` | 2615→2623 | 200 / Code0 / 成功发货1个订单！ | 同订单发货记录含承运人、运单、运费与时间 |
| 卖家确认 | `/ECrossAmazon/SaveDeliverGoods` | 3008→3011 | 200 / Code0 / 操作成功. | `GetOrderList` 3184→3187 Code0，目标订单完成；未发货26→25、已发运10→11 |

- 外层 `arrayStr` 为文本，解码后是含一个对象的 JSON 数组。仓库三步字段为 `courseId,shopId,orderIDXML:string; language:number`，发货另含 `ds1001:string`；`orderIDXML` URI 解码后为 `ROOT/DS42/DS4201`，值在 CDATA 中。
- 卖家确认字段为 `courseId,shopId,ds4001,DS42XmlStr,language:string`。`DS42XmlStr` URI 解码后键为 `ROOT/DS42/{DS4234,DS4255,DS4270,DS4271,DS4272,DS4273}`，均 CDATA；其中 DS4270/DS4271=承运人值/名称，DS4272=同订单仓库运单，DS4273=配送服务。DS4234/DS4255 精确语义未确认。
- `result`、`jsonStr` 本轮为 JSON 字符串，需二次解析；成功结果包含 `Code:number,Msg:null|string,RedirectUrl:null,Token:null`。只记录结构，不保存认证值、订单或运单原文。
- 仓库四子页均真实观察到 `POST /ECrossAmazonHome/GetOrderList`；不再只是发货记录页的孤立线索。仓库和卖家 SKU 不同而订单 ID 一致，关联必须按同一订单上下文。
- 成功链按动作读游标，各批 `truncated=false`、`hasMore=false`；首次刷新阶段已经淘汰的事件不可恢复。该成功分支已关闭，失败/重复/库存不足/承运人不可达、剩余 DS 语义与跨会话恢复仍待验证。完整字段、差异及序号见 `live-api-evidence-2026-10-04.md`。
