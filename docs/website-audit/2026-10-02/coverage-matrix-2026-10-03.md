# 现场页面覆盖矩阵（2026-10-03）

状态定义：`页面已加载` = 文档或首屏可打开；`首屏控件已见` = 已读取可见控件/字段；`只读请求已见` = 记录到页面读取请求；`分支完整` = 详情、筛选、空/错/权限分支也已观察；`待观察` = 目前只有导航候选或静态资料；`禁止动作` = 写入类动作只登记不执行。旧的“现场已观察”只作为概括，不等同于分支完整。

| 区域 | 页面/入口 | 页面 | 控件/字段 | 网络线索 | 状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| 首页 | `CourseIndexTraining_1` | 现场已观察 | 任务要求、资料查询、流程图、新手入门 | `GetPage`、SignalR negotiate | 现场已观察 | 逐模块打开只读详情 |
| 公司 | `CompanyInfoIndex` / `MyCompanyInfo` | 现场已观察 | 公司/登记/银行/成员字段，均只记录标签 | iframe 页面加载 | 现场已观察 | 公司财务只读页 |
| 成绩 | `EvaluateView_24` | 现场已观察 | 排名、分数（原值不落盘） | 页面加载 | 现场已观察 | 评分明细来源 |
| 仲裁 | `ArbitrateList_S` | 现场已观察 | 仲裁列表、申请仲裁按钮 | `GetArbitrateSystemList` | 现场已观察 | 只观察已有详情；不申请 |
| Amazon 目录 | `SellerProductCategory` | 现场已观察 | 分类树、搜索框、分类节点状态 | `GetProductCategory` | 现场已观察 | 其他商品类型/叶子表单 |
| Amazon 添加商品 | `SellerProductCreate` | 页面已加载 / 首屏控件已见 | ASIN/商品搜索、批量发布/变体/GTIN 帮助；未进入叶子字段表单 | 页面加载 | 首屏控件已见 | 具体叶子表单（需单独风险确认） |
| 卖家首页 | `SellerIndex` | 页面已加载 / 首屏控件已见 / 只读请求已见 | 余额/订单、存款方式提醒、各业务分区入口 | `GetSellerProductNum` | 首屏控件已见 | 只读状态与快捷入口 |
| 库存 | `SellerProductList` 等 | 页面已加载 / 首屏控件已见 / 只读请求已见 | 管理库存、筛选、分页、库存规划/货件/图片/视频入口 | `GetSellerProductList`、`GetProductListRepeat` | 已补抓“配送类型=亚马逊”筛选与 FBA 视图入口 | 详情与错误/权限分支 |
| 定价 | `SellerProductList` tab 3/4 等 | 页面已加载 / 首屏控件已见 / 只读请求已见 | 管理定价、警告、自动/协议定价入口 | `GetSellerProductList`、`GetProductListRepeat` | 首屏控件已见 | 详情与计算字段 |
| 订单 | `SellerOrderList`、`SellerOrderDetails`、`SellerOrderShipping` | 页面已加载 / 列表、详情与确认发货请求已见 | 订单筛选、状态统计、订单一览、商品行、收益、卖家备注、承运人/服务/运单号 | `GetOrderStatusNum`、`GetOrderList`、`GetOrderDetail`、`GetFreightList`、`SaveDeliverGoods` | 已补抓状态计数、列表/详情读取；同一订单已完成仓库发货后确认发货并回读“订单完成” | 取消、打印、备注保存仍未执行 |
| 广告（首轮概括行） | `SellerAdvertisingActivityList` 等 | 页面已加载 / 首屏控件已见 | 活动、草稿、设置、报告；创建按钮未触发 | 页面文档 | 历史概括行；具体主流程见“广告核心”专行 | 以专行的商品推广写入和广告组回读为准；报告入口仍按排除范围处理 |
| 品牌旗舰店 | `SellerStores` | 页面已加载 / 首屏控件已见 / 只读请求已见 | 品牌门槛、店铺说明、洞察样例 | `GetShopMsg` | 首屏控件已见 | 仅查看已有店铺 |
| 增长 | `SellerFBAPrograms` / `SellerRecommendedPrograms` | 页面已加载 / 首屏控件已见 | 配送计划、推荐方案与行动入口 | 页面文档 | 首屏控件已见 | 只读计划状态 |
| 数据报告 | `SellerReportPaymentList` / `SellerReportBusinessList` 等 | 页面已加载 / 首屏控件已见 / 只读请求已见 | 付款、业务报告筛选和概览；付款动作未触发 | `GetReportBusinessList` | 首屏控件已见 | 继续只读其他报告 |
| 绩效 | `SellerAccountHealth` 等 | 页面已加载 / 首屏控件已见 | 账户状况、客服/合规/配送指标 | 页面加载 | 首屏控件已见 | 只读状态/通知 |
| 应用商店 | `SellerAppsStore` / `SellerMobileApp` 等 | 页面已加载 / 首屏控件已见 | 发现应用分类、官方移动应用说明 | 页面文档、`GetShopMsg`（官方移动应用） | 首屏控件已见 | 不安装第三方应用 |
| 账户与消息 | `SellerAccountSetting` / `SellerMessageList` | 页面已加载 / 首屏控件已见 / 只读请求已见 | 账户、付款/税务/配送/权限分区；消息筛选、搜索、分页和空态 | `BusinessCompanyInfo`、`GetShopMsg`；`SellerMessageList.js` | 消息页只读补证已完成 | 不进入保存/回复 |
| 旧脚本核心：配送设置 | `SellerShippingTemplateSetting` | 页面已加载 / 首屏控件已见 / 只读请求已见 / 新模板写入实测已完成 / 列表回读已完成 | 一般配送设置、配送模板、国内/国际服务锚点、模板创建表单 | `GetTemplateList`、`GetFeightBasicsList`、`GetFeightRelationList`、`SaveTemplate` | 新建 `Smart_Precise_V34_0.15kg` 返回 `Code:0` 并在列表显示 | 精确国家规则、编辑、SKU 分配、设为默认、删除仍未验证 |
| 定价核心 | `SellerProductList`（管理定价） | 页面已加载 / 首屏控件已见 / 只读请求已见 | 定价筛选、搜索/分页、定价列表；相邻库存/货件入口 | `GetSellerProductList`、`GetProductListRepeat` | 首屏控件已见 | 不进入编辑和保存；价格计算字段待观察 |
| 广告核心 | `SellerAdvertisingLightningDealsList` → `SellerAdvertisingLightningDealsSelect` | 页面已加载 / 首屏控件已见 / ASIN 搜索已验证 / FBA 转换后复测 | 秒杀状态、备注搜索、日期范围、创建入口、ASIN 搜索与 FBA 资格提示 | `GetPromotionDealsList` | FBA 转换后仍无推荐 | 当前无推荐商品；已确认不是简单的“未转 FBA”，费用、日期和提交仍待平台给出推荐 |
| 广告核心 | `SellerCoupons` → `SellerCouponsEdit` | 页面已加载 / 四步创建已完成 / 列表与详情回读已完成 | 商品搜索、预算、百分比折扣、目标买家、兑换限制、日期、预览、提交与查看 | 页面公共读取 `GetShopMsg`；写入请求名未在本批安全捕获 | 单条短周期测试写入+列表/详情回读完成（非全分支） | 不取消/删除已保存记录；后续补编辑/取消的只读回归 |
| 广告核心 | `SellerPrimeDiscounts` → `SellerPrimeDiscountsEditProduct` | 页面已加载 / 首屏控件已见 / 卖家自配送校验已验证 / FBA 转换后保存与列表回读已完成 | 折扣名称、日期、SKU/折扣行、资格说明、验证、保存与列表状态 | `GetPromotionList` | FBA SKU `ID-KY21-1APR` 验证并保存成功，列表“等待中” | 不代表订单或成绩；仍未做取消/编辑/结束 |
| 广告核心 | `SellerAdvertisingPromotionSelect` → `SellerAdvertisingPromotionEdit` | 页面已加载 / 购买折扣表单已填写 / 保存与列表回读已完成 | 购买条件、优惠值、商品分类、日期、内部描述、跟踪 ID、保存、查看/编辑/删除入口 | 写入请求名未在本批安全捕获；列表回读已观察 | 单条短周期测试写入+列表回读完成（非全分支） | 不删除已保存记录；买一赠一分支仍待单独验证 |
| FBA 设置 | `SellerAmazonFulfillment` | 页面已加载 / 首屏控件已见 / 只读请求已见 | FBA 设置分区、只读摘要、编辑入口 | `GetLogisticsSettingMsg`、`SellerAmazonFulfillment.js` | 只读状态和编辑边界已补证 | 不编辑；保存字段仍需独立授权对象 |
| 广告核心 | `SellerAdvertisingActivityList` | 页面已加载 / 首屏控件已见 / 商品推广写入与广告组商品回读已完成 | 广告活动、草稿、设置、报告入口；搜索与状态列；广告组 ASIN/SKU 明细 | `GetAdvertisingActivityListOrDetail`、广告组商品详情读取 | `KST 商品推广测试` 已安排；广告组明细回读 ASIN `10098F798A`、SKU `ID-KY21-1APR`，与 FBA 转换后库存行一致 | 商品推广无额外 FBA 开关；这条广告在 FBA 转换前创建，不能单独证明因果；后续按 FBA ASIN 精确选择，报告入口按排除范围处理 |
| 库存核心 | `SellerInventoryPlanning` | 页面已加载 / 首屏控件已见 | 库存设置、库龄、筛选、库龄与 LTSF 列、移除订单入口 | 页面文档；当前脚本列表未见独立页面脚本 | 只读补证已完成；0 件商品空态 | 不创建移除订单；非空商品对象仍需独立条件 |
| FBA 核心 | `SellerStockFBAList` → `SellerProductFBAStep2` / `SellerStockFBAListBySku` | 页面已加载 / 首屏控件已见 / 只读请求已见 / 按 SKU 空状态已观察 | 货件/入库计划、状态筛选、货件列表、仓储监视器、既有货件详情、SKU 货件入口 | `GetFBAPlanShipmentList`、`GetFBAPlanDetail`、`GetFBAPlanShipmentDetail`、`GetFBAPlanShipmentSKUList`；按 SKU 字段已由页面脚本补齐 | 已补抓货件列表、第一条既有货件详情、按 SKU 请求形状和“无相关数据”空状态 | 不执行设置数量、预处理、贴标、补货或发货 |
| 国内仓库核心 | `CompanyStockIndex` / `CompanyStockList` / 运输/出入库/分拣/打包/立即发货/发货记录子页 | 页面与各子页结构已观察；同一订单已真实走通分拣→打包→立即发货→记录回读 | 库存、运输状态、出入库类型、订单筛选、分拣/打包选择、承运人、运单号状态、分页与空状态 | `GetStockList`；发货记录页确认 `CompanyOrderList`、`GetOrderList`；前三步写入 path 未稳定捕获 | 仓库三步均有成功提示和下一列表/记录回读；随后 `SaveDeliverGoods` 成功并在订单列表回读“订单完成” | 导出、取消、删除等非本轮目标未执行；前三步稳定 API path/body 仍待补抓 |
| 广告核心 | `SellerAdvertisingActivityAdd` | 页面已加载 / 首屏控件已见 / 商品推广写入实测已完成 / 列表与广告组商品回读已完成 | 商品推广创建表单：广告组、商品搜索、投放方式、竞价、否定定向、日期、国家/地区、预算、保存草稿、启动；无额外 FBA 字段 | `GetProductSKUList`、`SaveAdvertisingActivity`、保存后 `GetAdvertisingActivityListOrDetail` 均 HTTP 200；页面显示“操作成功”且新活动为“已安排” | 一个短周期、$10/天测试活动已完成，广告组回读 FBA ASIN/SKU | 先在库存页 FBA 视图确认 SKU/ASIN，再在商品推广页按 ASIN 选择；秒杀/买一赠一等仍分别验证 |
| 商品发布核心 | `SellerProductCategory` → `SellerProductEdit` → `Detail` | 页面已加载 / 首屏控件已见 / 写入实测已完成 / 详情回读已完成 | 美容和个人护理叶子分类、重要信息、1 个颜色变体、报价、合规、图片、描述、关键词、更多详情、保存入口、买家详情展示 | `FileUpload/ImgFileUpload`、`SaveProduct`、保存后 `GetSellerProductList` / `GetProductListRepeat`；详情 `Detail`、`GetProModelByProId`、`GetComputeTotalPriceInfo`、`GetIndexProdList`、`GetCartDataList` 均 200；业务保存 `Code:0` | 一个商品路径已完成且可回读 | 继续补其他本地商品类型；广告/促销/物流/发货仍按范围单独处理 |

## 明确排除

截图中确认不需要的入口统一见 `scope-exclusions-2026-10-03.md`，后续状态不再写成“待观察”，而是“明确排除”。

## 本批未完成项

- 尚未验证不同产品类型、课程、店铺上下文和其他角色的菜单差异。
- 尚未逐页收集列表筛选、分页、详情抽屉、空状态、权限不足和错误分支。
- 尚未完成不同商品类型、FBA 推荐资格满足后的秒杀、买一赠一、发货、提现等写入分支；Prime 已在 FBA SKU `ID-KY21-1APR` 上验证并保存为“等待中”。本批完成一个商品 `ALE-000226`、FBA 转换回读、一个新物流模板、一个商品推广测试活动、一个购买折扣、一个优惠券和一个 Prime 测试记录，并完成相应列表/详情回读。物流精确规则、SKU 分配、促销编辑/取消和其他写入分支仍未完成。
- 尚未把平台现场页面与本地赛训资料的字段逐一对照；后续对照必须标出“平台现场已观察 / 资料推断 / 尚未验证”。
