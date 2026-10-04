# V2 API 与请求上下文目录（2026-10-03）

> 2026-10-04 最新覆盖：[商品模板绑定](product-template-binding-2026-10-04.md)已实际保存并恢复；[价格分段](template-price-band-2026-10-04.md)已取得非空 DS08A 提交与回读，测试模板已删除。请求 DS08A06 是页面规则序号，返回 DS08A06 是规则 ID；地址开关仍有未持久化异常。下方将这些整体列为“未采集”的描述仅属较早批次，以新专项和[当前总览](DELIVERY-2026-10-04.md)为准。

## 2026-10-04 当前字段级接口索引

最新交付见 [DELIVERY-2026-10-04.md](DELIVERY-2026-10-04.md)。下表和专项文件覆盖后文历史批次中的未提交/空候选/缺路径状态；不使用新请求倒填历史缺失正文。旧 r7 不是当前证据版本。

| 方法与路径 | 触发及已确认结果 | 字段与返回结构来源 |
|---|---|---|
| POST `/ECrossAmazonHome/EditOrderSorting`、`EditOrderPack`、`EditOrderDelivery` | 分拣/打包/仓库发货，均HTTP200/Code0，同订单下游回读 | [发货第4至6节](live-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SaveDeliverGoods` | 仓库运单回填后卖家确认，HTTP200/Code0，订单完成 | [发货第5节](live-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SaveTemplate` | 创建、编辑；arrayStr内8个字符串键，URI编码DS08Xml/DS08AXml，Code0 | [模板第3节](template-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SaveProduct`、`GetProductAllList` | 单商品DS2061模板绑定、回读及恢复；oPType0保存为草稿/1保存并完成；DS2046处理时间5只读 | [商品绑定第2至5节](product-template-binding-2026-10-04.md) |
| POST `/ECrossAmazon/DeleteSetDefaultTempalte` | OPType文本1设默认/恢复，2删除，均Code0及回读；保留路径原拼写 | [模板第4节](template-api-evidence-2026-10-04.md) |
| POST `/ECrossAliexpress/GetFreightCountryList` | Amazon模板国际国家弹窗的共享读取，Code0 | [模板第2节](template-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/GetProductSkuListByProduct` | FBA转换及危险品iframe读取，Code0、1个SKU；调用方language类型不同 | [FBA第2至3节](fba-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SaveDeliveryWay` | 子SKU卖家配送转FBA，DS23XMLStr及convertType已抓；HTTP200，正文未知，后置回读确认 | [FBA第3至5节](fba-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/GetProductSKUList` | 广告候选9个，SKU/ASIN搜索各1个；Code0 | [广告第1及3.1节](ad-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SaveAdvertisingActivity` | 广告组编辑actionType字符串1/optype数字1，Code0，商品1→2/竞价0.53→0.54 | [广告第3.2节](ad-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/GetAdvertisingActivityGroupListOrDetail`、`GetAdvertisingActivityGroupDetail` | 保存后列表/详情Code0、2行商品，父子ID与FBA交叉核对 | [广告第3.3至4节](ad-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/GetSellerProductList` | 秒杀精确ASIN推荐搜索，Code0/1候选；上下文和字段类型不可直接套用普通库存查询 | [活动第2.2节](activity-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SavePromotionDealsInfo` | optype数字0创建/1编辑/2取消；创建编辑正文未知但回读完成；取消Code0 | [活动第3及5节](activity-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/GetPromotionDealsList`、`GetPromotionDealsDetail` | 同活动创建/编辑/取消回读，Code0；最终已取消 | [活动第2及4节](activity-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SaveCouponsInfo` | optype数字0创建/1编辑/2取消；30小时Code1，6小时创建/编辑正文缺失但回读成立，取消Code0 | [优惠券第3节](coupon-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/GetCouponsList`、`GetCouponsDetail` | 新未来券创建/编辑/取消回读；再次运行只读详情并进入预填页，未提交 | [优惠券第4至5节](coupon-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SavePromotionInfo` | Prime未来活动创建，arrayStr内DS15XmlStr为ROOT/DS15_amz；HTTP200、正文未取回，后续活动回读 | [Prime第2节](prime-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SavePromotionProductInfo` | Prime验证、编辑、删商品关联、重加及提交；外层optype均0，行级ActionType区分Add0/Edit1/Delete2 | [Prime第3至4节](prime-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/GetPromotionList`、`GetPromotionDetail`、`GetPromotionProductList` | Prime活动及商品回读；21%、删除后[]、重加1行20%分别确认，最终仍等待中/准备提交 | [Prime第5节](prime-api-evidence-2026-10-04.md) |
| POST `/ECrossAmazon/SavePromotionInfo` | 购买折扣optype0创建/1编辑/2删除；ROOT/DS15_amz有27个字段；创建/编辑正文未知，删除Code0 | [购买折扣第2至3节](promotion-api-evidence-2026-10-04.md) |

新请求的外层form为文本；arrayStr中的JSON类型与URI解码XML节点必须分层记录。广告DS03XmlStr含重复节点，不能用单值字典去重；秒杀取消ds1701为number而创建/编辑为string。未捕获的响应不能借用相邻操作的Code0。未列出的字段、时区、错误枚举及SKU模板分配仍为待确认，不从路径命名猜测。

优惠券另有[当前专项补证](coupon-api-evidence-2026-10-04.md)：创建/编辑/取消均使用SaveCouponsInfo，arrayStr内含URI编码DS48XmlStr（ROOT/DS48_amz）；取消ds4801为number而创建/编辑为string。DS4810/DS4824父子身份映射和选品查询完整结构尚缺。该文件的事件序号来自重置后新采集段，不能与其他同日文件中同号事件合并。创建/编辑正文未取回，不声称对应业务Code0。

Prime商品请求外层optype=0不能单独判新增；DS16XmlStr的行级ActionType才体现本次新增/编辑/删关联。保存20%和最终提交20%payload逐字段相同，最终Code0后状态仍不变；不能由“提交”按钮或成功码推断已生效。

SavePromotionInfo在Prime和购买折扣中使用不同活动字段，不能凭同名端点套同一业务schema。购买折扣删除ds1501为number、创建/编辑为string；可见但未发送和disabled却发送的字段都应按真实XML记录。模板绑定DS2061与GetProductAllList模板选项DS0701同值；不是独立SKU分配API。

## 历史目录

本表只收录已从当前页面、公开前端资源或现场请求中确认的接口线索。`静态` 不等于当前账号已授权；`现场` 才表示在有效会话中看到过请求。所有查询串、认证头、完整业务对象和客户数据均已脱敏。表格中的“HTTP 200”只代表网络层响应；除明确写出 `Code/Msg` 或页面回读的行外，业务结果统一记为“未单独抓取/未知”，不能等同业务成功。

> 2026-10-04 最新发货成功分支已补证，见 2.6 和 `live-api-evidence-2026-10-04.md`。2.1–2.5 保留历史批次事实，其“未提交/前三条路径未知”不再代表当前状态，也不得用新样本结果倒填旧批次。

## 1. 共享请求约束

- 页面通常通过共享 `AjaxSend` 发起 POST；页面上下文会从当前 URL 读取加密 `paras`，并继续携带课程、店铺、语言等上下文。
- 登录令牌由浏览器会话提供 Bearer Authorization；本目录不保存令牌。
- API 记录必须同时保留页面入口、触发动作、HTTP 状态和业务 `Code/Msg`，不能只看 200。
- 不能把加密 `paras`、`courseId`、`shopId` 或动态 SKU/ASIN 写成固定脚本常量。

## 2. 已确认接口

| 业务域 | 脱敏路径 | 方法/类型 | 触发动作 | 证据状态 |
| --- | --- | --- | --- | --- |
| 登录壳 | `/User/Login` | POST | 登录表单提交 | 公开前端静态线索；正确亚马逊入口 `loginPage24` 已现场登录成功 |
| 首页 | `/ECrossAmazonHome/GetPage` | XHR | 课程首页加载 | 现场 200 |
| 类目 | `/ECrossAmazon/GetProductCategory` | POST | 展开类目 | 现场 200 |
| 类目搜索 | `/ECrossAmazon/GetProductCategorySearch` | POST | 搜索类目 | 静态/现场候选 |
| 类目权限 | `/ECrossAmazon/SearchIsCanAddPruduct` | POST | 进入叶子类目前检查 | 静态确认 |
| 商品列表 | `/ECrossAmazon/GetSellerProductList` | POST | 库存/商品列表加载 | 现场 200 |
| 商品列表辅助 | `/ECrossAmazon/GetProductListRepeat` | POST | 列表辅助读取 | 现场 200 |
| 商品编辑读取 | `/ECrossAmazon/GetProductAllList` | POST | 编辑页加载 | 静态确认；字段由动态模型返回 |
| 商品保存 | `/ECrossAmazon/SaveProduct` | POST | 保存/保存并完成 | 现场 200，业务 `Code:0` |
| 图片上传 | `/FileUpload/ImgFileUpload` | POST | 变体图片上传 | 现场 200 |
| 商品详情 | `/ECrossAmazon/Detail` | GET | 买家侧详情回读 | 现场 200 |
| 商品模型 | `/ECrossAmazon/GetProModelByProId` | POST | 详情模型读取 | 现场 200 |
| 费用摘要 | `/ECrossAmazon/GetComputeTotalPriceInfo` | POST | 详情价格/费用摘要 | 现场 200 |
| 模板列表 | `/ECrossAmazon/GetTemplateList` | POST/XHR | 配送模板列表 | 现场 200 |
| 运费基础 | `/ECrossAmazon/GetFeightBasicsList` | POST/XHR | 配送基础数据 | 现场 200 |
| 运费关系 | `/ECrossAmazon/GetFeightRelationList` | POST/XHR | 模板/规则关联 | 现场 200 |
| 模板保存 | `/ECrossAmazon/SaveTemplate` | POST | 保存配送模板 | 现场 200，业务 `Code:0` |
| 订单计数 | `/ECrossAmazon/GetOrderStatusNum` | XHR | 订单页加载 | 现场 200 |
| 订单列表 | `/ECrossAmazon/GetOrderList` | XHR | 订单筛选/分页 | 现场 200 |
| 国内库存 | `/ECrossAmazonHome/GetStockList` | XHR | 仓库库存加载 | 现场 200 |
| 广告列表 | `/ECrossAmazon/GetAdvertisingActivityListOrDetail` | POST | 广告列表/详情 | 现场 200 |
| 广告候选 | `/ECrossAmazon/GetProductSKUList` | POST | 商品推广商品候选 | 现场 200 |
| 商品推广保存 | `/ECrossAmazon/SaveAdvertisingActivity` | POST | 启动商品推广 | 现场 200，列表显示“已安排” |
| 秒杀列表 | `/ECrossAmazon/GetPromotionDealsList` | XHR | 秒杀列表/搜索 | 历史现场200；当时无推荐。当前有推荐及创建/编辑/取消补证见顶部 |
| Prime 列表 | `/ECrossAmazon/GetPromotionList` | XHR | Prime 列表 | 现场 200 |
| FBA 设置 | `/ECrossAmazon/GetLogisticsSettingMsg` | XHR | FBA 设置摘要 | 现场 200 |
| FBA 货件列表 | `/ECrossAmazon/GetFBAPlanShipmentList` | XHR | 货件/入库计划列表 | 现场 200 |
| 货件详情 | `/ECrossAmazon/GetFBAPlanDetail` | POST/XHR | 点击已有货件“查看货件” | 现场 200；只读详情摘要 |
| 货件箱/商品详情 | `/ECrossAmazon/GetFBAPlanShipmentDetail` | POST/XHR | 货件详情页加载 | 现场 200；只读箱号/追踪/数量明细 |
| FBA 计划商品读取 | `/ECrossAmazon/GetSellerProductList` | 方法待实测（此上下文） | 静态调用线索：设置数量/预处理步骤初始化 | 仅补录脚本端点与字段键；不能用普通库存列表的历史请求证明 FBA 步骤请求已验证 |
| 头程物流商读取 | `/ECrossAmazon/GetFBAWuLiuList` | 方法待实测 | 静态调用线索：预处理货件步骤初始化 | 仅补录脚本端点与 `freightType`；本轮未采集该请求/响应 |
| 新建/确认 FBA 货件 | `/ECrossAmazon/CreateFBAPlanShipmentInfo`、`/ECrossAmazon/SureFBAPlanShipmentInfo` | 方法待实测 | 静态调用线索：货件创建与名称确认 | 脚本端点与 XML 键已补录；本轮未执行，未核实 `AjaxSend` 实现 |
| 修改货件商品/箱子/删除货件 | `/ECrossAmazon/SaveFBAPlanShipmentInfo` | 方法待实测 | 静态调用线索：数量、标签数、箱重/尺寸或删除货件 | `optype`、`DS23XMLStr`、`DS75XMLStr` 已补录；本轮未执行，未核实 `AjaxSend` 实现 |
| 完成 FBA 货件 | `/ECrossAmazon/CompleteFBAPlanShipmentInfo` | 方法待实测 | 静态调用线索：选择承运人并完成货件 | `DS7516/DS7517` XML 已补录；本轮未执行，未核实 `AjaxSend` 实现 |
| 店铺公共信息 | `/ECrossAmazon/GetShopMsg` | XHR | 多个营销/店铺页面公共数据 | 现场 200 |

### 2.1b 正确亚马逊会话首页补抓

| 页面/动作 | 方法与路径 | 响应结构（只记键名/类型） | 证据状态 |
| --- | --- | --- | --- |
| 课程首页刷新 | POST `/ECrossAmazonHome/GetPage` | 外层 `result(Code:number, Msg/RedirectUrl/Token:null)`、`jsonStr:string`、`jsonStr1:string` | 正确 `loginPage24` 会话现场 |
| 卖家首页刷新 | POST `/ECrossAmazon/GetSellerProductNum` | 外层 `result(Code:number, Msg/RedirectUrl/Token:null)`、`jsonStr:string`；内层数组元素含 `num1`–`num4` 数值字段 | 正确 `/SellerIndex` 会话现场 |
| 管理库存刷新 | POST `/ECrossAmazon/GetSellerProductList` | 外层 `result(Code:number, Msg/RedirectUrl/Token:null)`、`jsonStr:string`；内层数组元素为 DS2301–DS2329/DS2343 等页面模型键名 | 正确 `/SellerProductList` 会话现场 |
| 管理库存辅助读取 | POST `/ECrossAmazon/GetProductListRepeat` | 外层 `result(Code:number, Msg/RedirectUrl/Token:null)`、`jsonStr:string`；当前首屏内层为空数组 | 正确 `/SellerProductList` 会话现场 |

### 2.1a 入口映射与当前登录复核

- Welcome6 现场映射：`21=敦煌网仿真`，`22=速卖通仿真`，`24=亚马逊仿真`，`25=Wish 仿真`；映射由卡片图标和页面文字共同确认。
- 误入口结果：从 `21` 进入 `/User/loginPage21` 曾出现“您没有申请该软件的试用权”，该结果不能归因于亚马逊账号。
- 正确入口：从 `24` 进入 `/User/loginPage24`，在内嵌登录表单提交账号后进入 `/ECrossAmazonHome/CourseIndexTraining_1` 课程首页。
- 证据等级：`live`。不保存账号值、密码或完整上下文参数。

### 2.1 本轮现场补抓（已授权旧会话，仅只读）

| 页面/动作 | 方法与路径 | 脱敏请求字段 | HTTP/业务结果 | 下一状态 |
| --- | --- | --- | --- | --- |
| 库存首次加载 | POST `/ECrossAmazon/GetSellerProductList` | `arrayStr`（列表查询对象数组） | 200；商品列表可渲染 | 管理库存 |
| 库存首次加载辅助 | POST `/ECrossAmazon/GetProductListRepeat` | `arrayStr`（列表辅助对象数组） | 200 | 管理库存 |
| 配送类型筛选=亚马逊 | POST `/ECrossAmazon/GetSellerProductList` | `arrayStr`；配送类型、商品状态、价格范围、关键词等字段 | 200 | 列表收敛为亚马逊配送商品 |
| 亚马逊库存页加载 | POST `/ECrossAmazon/GetSellerProductList` + `/ECrossAmazon/GetProductListRepeat` | `arrayStr`（FBA 列表上下文） | 均 200 | 管理亚马逊库存；返回 SKU/ASIN/FNSKU/可售/体积展示字段 |
| 广告列表首次加载 | POST `/ECrossAmazon/GetAdvertisingActivityListOrDetail` | 列表分页/筛选对象 | 200 | 所有广告活动 |
| 订单状态计数 | POST `/ECrossAmazon/GetOrderStatusNum` | 订单页上下文 | 200 | 等待中/未发货/已取消/已发运/全部计数 |
| 订单列表首次加载 | POST `/ECrossAmazon/GetOrderList` | 状态、分页、搜索类型等字段 | 200 | 管理订单；未执行发货 |
| 订单详情页面 | GET `/ECrossAmazon/SellerOrderDetails` | 脱敏 `paras` 上下文 | 200 | 订单详情页壳 |
| 订单详情读取 | POST `/ECrossAmazon/GetOrderDetail` | 详情上下文字段（值不落盘） | 200 | 订单一览、商品行、收益只读读取 |
| 配送模板页加载 | POST `/ECrossAmazon/GetTemplateList` | 店铺/模板上下文 | 200 | 配送模板列表 |
| 配送基础数据 | POST `/ECrossAmazon/GetFeightBasicsList` | 店铺/模板上下文 | 200 | 地区、地址类型、运输时间等规则数据 |
| 配送关系数据 | POST `/ECrossAmazon/GetFeightRelationList` | 模板/配送关系上下文 | 200 | 模板与规则关联 |
| 货件处理进度 | POST `/ECrossAmazon/GetFBAPlanShipmentList` | 状态筛选、货件搜索、分页对象 | 200 | 货件/入库计划列表；只读 |
| 配送类型筛选=亚马逊（失效分支） | POST `/ECrossAmazon/GetSellerProductList` | `arrayStr`；配送类型与列表筛选字段 | 200；业务 `Code:10`、`Msg` 为“您的账号已在其它地方登录，暂时下线(103)” | 登录失效弹窗；重新登录后回到库存页 |
| 登录失效提示资源 | POST `/User/LoadVerificationCode` | 登录弹窗上下文 | 200 | 伴随重新登录弹窗；不代表验证码校验成功 |
| 按 SKU 查看亚马逊货件 | POST `/ECrossAmazon/GetFBAPlanShipmentSKUList` | SKU/店铺/课程上下文 | 200；当前对象为空列表 | 页面显示“无相关数据”；只读分支 |
| 配送模板字段形状 | POST `/ECrossAmazon/GetTemplateList` | `jsonStr` 数组：DS0701/DS0705/DS0707 | 200；外层 `result` 正常 | 现有模板列表 |
| 配送基础规则字段形状 | POST `/ECrossAmazon/GetFeightBasicsList` | `jsonStr` 数组：DS1101–DS1117（含 null 字段） | 200；外层 `result` 正常 | 基础配送规则读取 |
| 配送关系字段形状 | POST `/ECrossAmazon/GetFeightRelationList` | `jsonStr1` 模板关系、`jsonStr2` 规则数组、`jsonStr3` 空数组 | 200；外层 `result` 正常 | 模板/规则关联读取 |
| 商品推广列表字段形状 | POST `/ECrossAmazon/GetAdvertisingActivityListOrDetail` | `jsonStr` 数组：DS0301、DS0304–DS0311、DS0328–DS0334（含 null 字段） | 200；外层 `result` 正常 | 广告活动列表读取 |
| 订单状态计数字段形状 | POST `/ECrossAmazon/GetOrderStatusNum` | `jsonStr` 数组：DS4004、DS4005 | 200；外层 `result` 正常 | 订单状态计数读取 |
| 订单列表字段形状 | POST `/ECrossAmazon/GetOrderList` | `jsonStr` 数组：DS4001–DS4056、DS4074、DS4093、DS2001、DS2024/DS2029、DS2047/DS2048、DS2083、DS2303/DS2305/DS2312/DS2320 等 | 200；外层 `result` 正常 | 当前 15 条订单列表读取；未执行发货 |
| 订单详情字段形状 | POST `/ECrossAmazon/GetOrderDetail` | 订单一览、配送、商品行、收益、备注区块；具体 DS 字段值未保存 | 200；页面成功展示 | 只读详情；未保存备注、未确认发货 |
| 国内仓库库存字段形状 | POST `/ECrossAmazonHome/GetStockList` | `jsonStr` 数组：DS5604/DS5605/DS5611/DS5617/DS5618、B0101/B0114/B0159/B0159E/B01112/B01113/B01114/B01116 | 200；外层 `result` 正常 | 国内仓库库存读取；分拣/打包/发货接口未补 |
| 国内仓库发货记录壳 | GET `/ECrossAmazonHome/CompanyOrderList` | 页面上下文（不保存完整参数） | 200；发货记录页可渲染 | 只读观察；不要据此推断其他仓库子页复用同一请求 |
| 国内仓库发货记录列表 | GET `/ECrossAmazonHome/GetOrderList` | 页面上下文（不保存完整参数） | 200；当前为空列表 | 运单号状态筛选与记录表可渲染；不等于已发货 |
| 国内仓库其余子页 | 页面结构已见，接口未逐页建立事件游标 | — | — | 货物运输、出入库、分拣、打包、立即发货的请求名与写入接口待下一批逐页补抓 |

### 2.2 本轮受控测试追加

| 页面/动作 | 方法与路径 | 请求字段边界 | 结果 | 可靠性结论 |
| --- | --- | --- | --- | --- |
| 新配送模板保存 | POST `/ECrossAmazon/SaveTemplate` | 模板表单字段；值不落盘 | HTTP 200，页面“保存成功” | 立即列表未回读测试名称，标记为待确认，不可直接复用为成功协议 |
| 广告商品搜索 | 当前监听窗口未保留稳定 method/path | 搜索词为已有测试标识；值不写入文档 | 0 商品 | 必须以结果数量判断，不得在 0 商品时启动活动 |
| 卖家配送→FBA 转换入口 | 页面上下文 `/ECrossAmazon/SellerProductList`、`convertType=2` | 选择状态与列表上下文 | 转换页 0 SKU | 当前对象没有可提交 SKU；转换请求、危险品和回读仍缺现场证据 |

本节只保留字段名、路径和结果摘要；不保存完整 `paras`、请求值、Cookie、Authorization、订单原文或商品原始内容。

### 2.3 确认发货表单初始化（2026-10-04）

| 页面 | 触发 | 方法/路径 | 请求键边界 | HTTP/业务结果 | 写入 |
|---|---|---|---|---|---|
| `SellerOrderShipping` | 从未发货订单点击“确认发货” | `POST /ECrossAmazon/GetFreightList` | 订单/店铺上下文；值不落盘 | 200；承运人选项可渲染 | read |
| `SellerOrderShipping` | 表单初始化 | `POST /ECrossAmazon/GetOrderDetail` | 订单详情上下文；订单原文不落盘 | 200；ASIN、SKU、数量等字段可渲染 | read |

最终确认发货的提交方法、业务返回和订单状态回读仍未记录；必须绑定明确测试订单后再补抓，不能从按钮文字推断。

### 2.4 确认发货受控提交（2026-10-04）

| 页面 | 触发 | 方法/路径 | 请求键边界 | HTTP/业务结果 | 写入 |
| --- | --- | --- | --- | --- | --- |
| `SellerOrderShipping` | 用户授权填写承运人、配送服务和一次性测试运单号后点击确认 | `POST /ECrossAmazon/SaveDeliverGoods` | 当前订单、承运人、配送服务、运单号等字段名；值不落盘 | HTTP 200；业务 `Code:10`，会话被判定为其它地方登录(103) | controlled_write（未形成成功） |
| 登录失效分支 | 保存请求失败后平台跳转 | `GET /User/Sign` | 脱敏上下文 | 页面显示重新登录；订单状态未变 | read/recovery |

该接口已被真实触发，但由于业务失败且列表/详情仍为未发货，不能作为可复用的成功协议。重试前必须重新建立单一 Amazon 会话，并使用同一订单做一次提交后回读。

### 2.5 国内仓库→卖家确认成功闭环（2026-10-04）

| 页面 | 触发 | 方法/路径 | 请求键边界 | HTTP/业务结果 | 写入 |
| --- | --- | --- | --- | --- | --- |
| 国内仓库-分拣产品 | 管理订单同一订单进入仓库后勾选并提交 | 未稳定捕获；不推断 | 订单上下文/选择集合；值不落盘 | 页面成功分拣，列表移出待分拣 | controlled_write + live_readback |
| 国内仓库-开始打包 | 分拣列表选择同一订单并提交 | 未稳定捕获；不推断 | 订单上下文/选择集合；值不落盘 | 页面成功打包，下一列表出现分拣/打包时间 | controlled_write + live_readback |
| 国内仓库-立即发货 | 选择承运人后提交同一订单 | 未稳定捕获；不推断 | 订单上下文、承运人选择；值不落盘 | 页面成功发货，发货记录回读运单/运费/时间 | controlled_write + live_readback |
| `SellerOrderShipping` | 回填仓库生成的运单并确认 | `POST /ECrossAmazon/SaveDeliverGoods` | 当前订单、承运人、配送服务、运单号等字段名；值不落盘 | HTTP 200；页面“操作成功.”，已发运列表显示订单完成 | controlled_write + live_readback |

严格因果规则：卖家确认发货不能先于国内仓库发货。此前直接提交出现“请先线下实际发货，再来完成该笔订单！”；完成分拣→打包→立即发货并回读发货记录后，同一确认接口才形成业务成功。

### 2.6 新样本发货 P0 成功分支字段级补证（2026-10-04）

对象匿名别名 `shipping-sample-20261004-02`；不是前一笔已完成订单。以下全为 Codex IAB 真实 POST，HTTP200、Code0，`arrayStr` 外层为 form 文本，内层是 JSON 对象数组。字段类型只描述本次解码样本，不声称服务端 schema 已证明。

| 动作 | path | arrayStr 内层字段与样本类型 | result.Msg | 请求→响应序号 | 回读 |
| --- | --- | --- | --- | --- | --- |
| 分拣 | `/ECrossAmazonHome/EditOrderSorting` | `courseId,shopId,orderIDXML:string; language:number` | 成功分拣1个订单！ | 2245→2253 | 移出待分拣，待打包列表出现同订单和分拣时间 |
| 打包 | `/ECrossAmazonHome/EditOrderPack` | 同上 | 成功打包1个订单！ | 2433→2441 | 移出待打包，待发货列表出现同订单和打包时间 |
| 仓库发货 | `/ECrossAmazonHome/EditOrderDelivery` | 上述字段加 `ds1001:string` | 成功发货1个订单！ | 2615→2623 | 发货记录回读同订单的承运人、运单、运费、时间 |
| 卖家确认 | `/ECrossAmazon/SaveDeliverGoods` | `courseId,shopId,ds4001,DS42XmlStr,language:string` | 操作成功. | 3008→3011 | 已发运列表3184→3187 Code0，目标订单完成；已发运10→11 |

- 三个仓库请求的 `orderIDXML` 是 URI 编码 XML，解码后键层级 `ROOT/DS42/DS4201`，值以 CDATA 包裹。卖家 `DS42XmlStr` 同样需 URI 解码，键层级为 `ROOT/DS42/{DS4234,DS4255,DS4270,DS4271,DS4272,DS4273}`。
- 已确认 UI 映射：`DS4270`=承运人 value、`DS4271`=名称、`DS4272`=同订单仓库运单、`DS4273`=配送服务。`DS4234/DS4255` 样本为数字形态，精确语义未确认。
- 响应 `result` 和 `jsonStr` 为 JSON 字符串，需二次解析；成功 result 键/类型为 `Code:number, Msg:null|string, RedirectUrl:null, Token:null`。不存认证值、原始订单/运单或完整URL上下文。
- 仓库分拣、打包、发货、记录四子页均现场确认 `POST /ECrossAmazonHome/GetOrderList`，数组内 `courseId,shopId,orderType,searchType,keyword:string; language:number`；前三页 `status:number`，记录页 `status:string`。这一新证据不是根据页面名猜测，也不改写旧批次的 GET 观察记录。
- 卖家读取：`GetOrderStatusNum` 字段为 `shopId,courseId,shipType`（form文本）；`GetOrderList` 内层筛选字段、`GetFreightList` 和 `GetOrderDetail` 字段/返回结构已补在新证据文档。最终未发货26→25、已发运10→11，全部36。
- 仓库 SKU 与卖家子 SKU 不同但订单 ID 一致，必须使用同一订单上下文关联；不能仅凭 SKU/商品名称匹配。成功链事件批次均 `truncated=false,hasMore=false`；失败、重复提交、库存不足、承运人不可达和跨会话恢复仍待验证。

## 3. 历史待补清单与当前增量边界

以下仅保留早期清单，不是当前待办。仓库成功分支已由2.6补齐；模板生命周期、FBA提交体、广告组字段/ID关联及秒杀创建编辑取消也已有顶部专项补证。当前剩余缺口以 `DELIVERY-2026-10-04.md` 和 `v2-evidence-gaps-2026-10-03.md` 顶部表为准，不重复执行已成功对象。

- 每个核心写入按钮的真实请求体字段名、业务返回结构和失败码；已有 `SaveProduct`、`SaveTemplate`、`SaveAdvertisingActivity` 只保留脱敏摘要。
- 优惠券、购买折扣、Prime 保存、FBA 转换、危险品信息的完整写入事件链，以及广告组详情的字段级回读。
- 新配送模板“保存成功但即时列表为空”的一致性复核；广告搜索无结果时的真实请求路径；FBA 转换页 0 SKU 分支的选择上下文与资格字段。
- 订单/仓库只读分支的 iframe 请求顺序、分页、空状态和权限错误；当前仅确认发货记录页的两个读取路径，其他子页不由路由名推断。
- 登录失效、重新登录、试用权不足和同账号多标签页的状态变化。

已完成的读链不再列为未完成：库存配送筛选、亚马逊库存视图、FBA 货件列表以及既有货件首层/箱商品明细请求均已有现场 200 证据；待补的是对应写入字段/失败码、更多分页和因果实验。

## 4. API 记录格式

### 4.1 FBA 货件页续采实时只读证据（2026-10-04）

```text
SellerStockFBAList → 页面默认“货件”页签
→ XHR GetFBAPlanShipmentList
→ HTTP 200 / result.Code=0
→ result 外 jsonStr、jsonStr1 均为数组；本次均为空数组

点击“入库计划”页签
→ XHR GetFBAPlanList
→ HTTP 200 / result.Code=0
→ result 外 jsonStr 为空数组
```

该批次使用登录后课程上下文进入卖家后台，未保存完整参数值。空数组只说明本次上下文/筛选下无记录；不要据此推断所有账号没有货件，也不要与前一条 Code10 会话冲突混淆。

后续每条请求统一使用：

```text
page: 页面路由/业务域
trigger: 用户动作
method: GET/POST/...
path: 脱敏路径
request_keys: 字段名与类型，不保存值
response_status: HTTP 状态
business_result: Code/Msg/状态摘要
next_state: 页面、弹窗、列表或详情变化
write: read | controlled_write | destructive
evidence: static | live | live_readback
```
