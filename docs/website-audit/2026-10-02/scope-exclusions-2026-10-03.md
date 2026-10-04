# V2 平台明确排除范围（2026-10-03）

用户已确认：本文件列出的菜单、页面和功能与当前项目无关，不进入核心页面采集、字段映射、脚本设计或产品需求。它们仍保留为平台导航证据，不从外部平台删除。

## 已明确排除的入口

| 分区 | 排除页面/入口 | 路由线索 |
| --- | --- | --- |
| 应用商店 | 官方移动应用、发现应用、管理您的应用、探索服务 | `SellerMobileApp`、`SellerAppsStore`、`SellerManageYourApps`、`SellerExploreServices` |
| 绩效 | 账户状况、反馈、亚马逊商城交易保障索赔、信用卡拒付索赔、业绩通知、买家之声、卖家大学 | `SellerAccountHealth`、`SellerFeedback`、`SellerGuaranteeClaims`、`SellerChargebacks`、`SellerPerformanceNotifications`、`SellerReviewsList`、帮助页 |
| 数据报告 | 付款、亚马逊销售指导、业务报告、库存和销售报告、报告中的广告、退货报告、自定义报告、税务文件库 | `SellerReportPaymentList`、`SellerReportFulfillmentList`、`SellerReportBusinessList`、`SellerFulfillment`、`SellerAdvertisingActivityList`（报告入口）、`SellerReturnsReport`、`SellerCustomizedReports`、`SellerTaxLibrary` |
| 增长 | 配送计划、推荐计划 | `SellerFBAPrograms`、`SellerRecommendedPrograms` |
| 品牌旗舰店 | 管理店铺 | `SellerStores` |
| 广告旧功能 | 早期评论者计划、控制面板、常见问题 | `SelleRearlyReviewerProgram` 及其同页分区 |
| 订单辅助 | 上传订单相关文件、管理退货、管理 SAFE-T 索赔 | `SellerUploadOrderRelatedFiles`、`SellerReturnManager`、`SellerSafetClaims` |
| 定价辅助 | 修复价格警告、自动定价、协议定价 | `SellerProductList` 定价警告分支、`SellerAutomatePricing`、`SellerNegotiatedPricing` |
| 库存辅助 | 改进商品信息质量、全球销售、上传和管理视频、管理商品文档 | `SellerImproveListingQuality`、`SellerSellGlobally`、`SellerVideoManagerList`、`SellerProductImageTextList` |
| 库存/报告辅助 | 库存报告 | `SellerInventoryReports` |
| 目录辅助 | 补全您的草稿、查看销售申请 | `SellerProductListDraft`、`SellerSellingApplications` |
| 账户辅助 | 通知首选项、登录设置、退货设置、礼品选项、税务设置、用户权限、用户权限历史记录、您的信息和政策 | `SellerNotificationsPreferences`、`SellerAccountSettingEditUserInfo`、`SellerReturnSetting`、`SellerGiftOptions`、`SellerAccountSettingBusinessInfo`、`SellerAccountManager`、`SellerAccountAudit`、`SellerHelpContent` |

## 范围解释

- “排除”只影响本项目的产品、脚本和页面研究范围，不会修改、删除或停用外部平台上的菜单。
- 这些入口即便在现场可以打开，也不再做字段逐项采集、网络响应形状分析或自动化设计。
- 旧脚本直接使用的物流模板、商品目录/发布、商品列表/价格、订单/发货、国内仓库/FBA 和广告活动主流程不在本次排除表中，继续单独核对。
- 外部平台样例数字、状态和文案不会被当作真实经营成绩或评分规则。
