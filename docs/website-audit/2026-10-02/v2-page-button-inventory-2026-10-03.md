# V2 页面与按钮技术目录（2026-10-03）

本目录是后续 API 追踪和脚本接入的页面事实层，不是自动化脚本。页面状态分为：

- `已现场观察`：当前或此前有效会话实际打开过；
- `静态候选`：来自公开前端资源或旧资料，尚未证明当前账号可访问；
- `权限阻塞`：需要平台试用权恢复后继续；
- `明确排除`：用户已确认不进入该入口。

## 1. 公共登录与课程入口

| 区域 | 页面/入口 | 页面与关键动作 | 触发/依赖 | 当前状态 |
| --- | --- | --- | --- | --- |
| 公开入口 | `/User/Welcome6` | 教学系统、虚拟仿真产品卡片 | `GetCopyright_2` 产品清单 | 已现场观察 |
| 仿真登录 | `/User/loginPage24` → `#login-iframe` | 用户名、密码、可选验证码、登录 | 登录类型 24、浏览器会话、亚马逊仿真上下文 | 已现场登录成功 |
| 课程首页 | `ECrossAmazonHome/CourseIndexTraining_1` | 仿真、成绩、仲裁、任务要求、资料查询 | 登录成功后的课程上下文 | 已现场观察 |
| 流程导航 | `/baike/24/help/index.html?jmptopg=flow.html` | 卖家、FBA、营销、发货流程说明 | 教程页面，不等于业务接口 | 已现场观察 |

## 2. 核心深挖页面

| 业务域 | 页面/入口 | 关键控件或按钮 | 主要依赖 | 状态 |
| --- | --- | --- | --- | --- |
| 商品类目 | `SellerProductCategory` | 浏览/搜索类目、叶子类目 | `GetProductCategory`、`GetProductCategorySearch`、类目权限检查 | 已现场观察；需权限恢复补分支 |
| 商品编辑 | `SellerProductEdit` | 重要信息、变体、报价、合规、图片、描述、关键词、更多详情、保存/保存并完成 | `GetProductAllList`、动态属性模型、上传资源 | 已完成一个测试商品保存与回读 |
| 库存 | `SellerProductList` | 搜索、分页、履约筛选、管理亚马逊库存、批量动作 | `GetSellerProductList`、`GetProductListRepeat` | 已现场观察；本轮补抓“配送类型=亚马逊”只读筛选 |
| FBA | `SellerStockFBAList`、转换表单、`SellerProductFBAStep2` | 亚马逊配送筛选、只转换、转换并发送库存、危险品信息、货件入口、查看货件详情 | FBA 状态、商品 SKU/ASIN、货件详情请求 | 已完成只转换回读；本轮补抓既有货件详情，只读未创建/处理货件 |
| 商品推广 | `SellerAdvertisingActivityList`、`SellerAdvertisingActivityAdd` | 类型选择、商品搜索、投放、竞价、预算、日期、草稿、启动、广告组详情 | `GetProductSKUList`、`SaveAdvertisingActivity`、列表/详情回读 | 已完成一条测试活动与详情回读 |
| 秒杀 | `SellerAdvertisingLightningDealsList`、`...Select` | ASIN 搜索、推荐、创建、编辑 | FBA 资格、推荐列表 | 已观察；FBA 转换后仍无推荐 |
| 优惠券 | `SellerCoupons`、`SellerCouponsEdit` | 添加商品、折扣、预算、目标买家、预览、提交、详情 | ASIN、日期、资格 | 已完成测试记录回读 |
| Prime | `SellerPrimeDiscounts`、`...EditProduct` | SKU、折扣类型、验证、保存、状态 | FBA SKU | 已完成验证/保存，列表“等待中” |
| 促销 | `SellerAdvertisingPromotionSelect`、`...Edit` | 促销类型、商品范围、日期、内部描述、跟踪 ID | 促销规则 | 已完成购买折扣测试回读；买一赠一未补 |
| 配送模板 | `SellerShippingTemplateSetting` | 模板、服务类型、国家规则、重量/价格、保存、关联 | `GetTemplateList`、`GetFeightBasicsList`、`GetFeightRelationList`、`SaveTemplate` | 已完成一条模板保存/回读 |
| 订单 | `SellerOrderList`、`SellerOrderDetails` | 状态筛选、分页、订单详情、配送类型、订单一览/商品行/收益/备注 | `GetOrderStatusNum`、`GetOrderList`、`GetOrderDetail` | 列表和详情只读请求已确认；未执行发货、取消、打印或备注保存 |
| 国内仓库 | `CompanyStockIndex`、`CompanyStockList`、运输/出入库/分拣/打包/立即发货/发货记录子页 | 库存、运输状态、出入库、订单选择、分拣、打包、承运人、运单号、发货记录 | `GetStockList`；发货记录页已确认 `CompanyOrderList`/`GetOrderList`；分拣/打包/立即发货写入路径本轮未被稳定监听 | 同一订单已现场完成分拣、打包、立即发货并回读记录；不把未知 path 伪造成契约 |

## 现场状态修正（2026-10-04）

“国内仓库”相关按钮已不再只是页面目录：分拣、打包、立即发货三个动作均完成一次真实受控提交，并以后续列表或发货记录回读确认；卖家确认发货另在 `SellerOrderShipping` 通过 `SaveDeliverGoods` 成功回读。未稳定捕获的前三步 method/path/body 继续保留为未知。
| 评分/仲裁 | `EvaluateView_24`、`ArbitrateList_S` | 分数、排名、仲裁列表/申请 | 课程成绩上下文 | 已观察；评分明细仍待权限恢复 |

## 3. 明确排除

应用商店、库存报告、无关绩效/品牌辅助入口等按照 `scope-exclusions-2026-10-03.md` 登记为排除，不再把“菜单可见”当作需要接入的业务范围。

## 4. 当前阻塞

入口纠正：Welcome6 的 `21` 卡片是敦煌网仿真，`24` 卡片才是亚马逊仿真。本轮从 `loginPage24` 成功登录并进入课程首页；此前 `loginPage21` 的试用权提示只保留为误入口异常，不作为亚马逊权限阻塞。现在应沿正确 `/24` 会话继续按本目录补齐核心按钮的请求和回读。
