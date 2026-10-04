# V2 商品编辑页只读字段证据（2026-10-04）

本轮从库存列表的现有测试商品进入编辑页，只读切换各分页；没有点击保存、保存并完成、删除或上传文件。所有商品标识和原始内容均不在本文保存。

## 1. 入口与页面结构

- 入口：库存列表行级“编辑”。
- 路由：`/ECrossAmazon/SellerProductEdit`。
- 页面顶部摘要：UPC/商品编号、商品名称、品牌、类目、市场、价格，以及“在亚马逊上查看商品信息”。
- 分页：重要信息、变体、报价、合规信息、图片、描述、关键字、更多详情。
- 页面底部固定动作：保存、保存并完成。

本次切换分页没有在 Network 事件窗口捕获新增 XHR；当前证据只确认页面字段已经由编辑页载入，不把“未捕获”解释为“绝对没有请求”。

## 2. 重要信息

现场可见字段：

- 商品编号（1688 来源选择器，当前为禁用列表框）；
- 商品名称；
- 品牌；
- 制造商；
- 制造商零件号。

这些字段与旧脚本的标题、品牌、制造商、制造商零件号输入逻辑直接对应；是否为必填由字段旁的星号和后端校验共同决定，不能只按 UI 星号推断得分或提交成功。

## 3. 变体

变体页字段/动作：

- 变体主题：颜色、尺寸、颜色-尺寸、图案、风格等；
- 变体术语输入和“添加变体”；
- 变体表格：变体术语、色卡、卖家 SKU、商品编码、商品编码类型、状况、状况说明、价格、数量、SKU 图片；
- 商品编码类型枚举包含 GTIN、EAN、GCID、UPC；
- 状况枚举包含 New、Used 和 Collectible 多种状态；
- 行级保存、应用更改、删除已选、恢复已选；
- SKU 图片支持本地上传。

本次商品存在多条变体行，卖家 SKU、商品编码、价格、数量均在表格中独立出现。后续脚本必须以变体行作为最小操作单元，不能只使用父商品 ID。

## 4. 报价/配送字段

报价页现场可见：

- 订单商品最大数量（整数）；
- 配送设置（配送模板下拉）；
- 制造商建议零售价；
- 处理时间；
- 补货日期；
- 产品税代码；
- 是否提供礼品信息；
- 是否提供礼品包装；
- 开始销售日期。

配送模板下拉当前能读取多个已存在模板名称；本文不保留模板原始名称。字段说明显示配送模板是报价级关联，不应与全局物流模板管理页混为一条接口。

## 5. 合规信息与危险品字段

合规页现场可见两大类：

### 5.1 重量/电池

- 商品重量及单位；
- 电池重量及单位；
- 每个电池瓦时数及单位；
- 锂含量及单位；
- 容量及容量单位；
- 电池平均寿命及时间单位；
- 锂电池电压及单位；
- 电池类型/尺寸；
- 电池数量；
- 是否附带电池；
- 商品是否使用电池或商品本身是电池；
- 电池成分；
- 锂电池包装；
- 锂离子电池单元数量、锂金属电池单元数量。

### 5.2 危险品/法规

- 危险品相关法规：GHS、Storage、Waste、Not Applicable、Transportation、Other、Unknown；
- 联合国危险货物编号；
- 安全数据表（SDS）URL；
- 闪点（°C）；
- 分类/GHS 图形符号，可添加多项；
- California Proposition 65 Warning Type；
- California Proposition 65 Chemical Names 及多个 Additional Chemical Name 字段。

这些字段是商品编辑页的合规数据，不等同于 FBA 入库页的危险品确认表。后续采集必须分别记录商品编辑保存请求和 FBA 货件流程中的危险品步骤，不能合并。

## 6. 图片、描述与关键字

### 6.1 图片

- 支持本地上传；
- 页面说明：主图白底、产品占比、像素、文件大小、JPG/PNG/JPEG 等限制；
- 可查看已存在图片并删除；
- 当前商品页面显示图片数量上限提示和已上传图片列表。

本轮未上传、删除或覆盖图片。

### 6.2 描述

- Key Product Features：多条要点输入，可添加/删除；
- Product Description：长文本描述；
- Cpsia Warning；
- CPSIA Warning Description。

### 6.3 关键字

- Target Audience；
- Intended Use；
- Other Attributes；
- Subject Matter；
- Search Terms；
- Platinum Keywords。

以上字段含多选枚举和可重复行。旧脚本若只填单一文本框，会漏掉重复字段/枚举字段，需在字段清单中保留“可重复”和“枚举”标记。

## 7. 更多详情

更多详情页现场可见字段组：

- Shipping Weight 及单位；
- Country/Region of Origin；
- Launch Date；
- Fabric Type；
- Import Designation；
- Metal Stamp；
- Number Of Stones；
- Clasp Type；
- Chain Type；
- Certificate Number；
- Stone Cut、Total Diamond Weight、Stone Color、Stone Clarity、Stone Shape；
- Stone Creation Method、Stone Treatment Method、Certificate Type；
- Pearl Type、Pearl Minimum Color、Pearl Luster、Pearl Shape；
- Total Gem Weight、Pearl Uniformity、Pearl Surface Blemishes、Pearl Stringing Method；
- Size Per Pearl、Number Of Pearls；
- Style Name、Release Date、Package Quantity、Maximum Aggregate Ship Quantity；
- Is Discontinued by Manufacturer；
- Stone Dimensions Unit Of Measure；
- Part Number / Model Number、Catalog Number；
- Item Dimensions（长/宽/高）及单位；
- Package Dimensions（长/宽/高）及单位；
- Weight、Stone Weight、Item Display Weight；
- Item Display Dimensions（长/宽/高/直径）及单位；
- Model Number。

该页枚举非常多，后续脚本不能把“页面能看到”当作“每次都必填”；应以类目、接口返回和实际校验错误决定字段是否送出。

## 8. 对后续 API/脚本的价值与边界

当前可以直接用于：

1. 建立商品父项 → 变体 → SKU/商品编码 → 报价/配送模板的字段映射；
2. 设计编辑页只读预检，检查必要字段、枚举和重复行；
3. 将 FBA 相关的库存配送类型、商品数量、SKU 与编辑页字段分层处理；
4. 识别危险品字段属于商品合规页，另行对待 FBA 货件危险品步骤。

当前仍未确认：

- 商品编辑保存/保存并完成的真实请求路径、方法、请求体和业务 Code/Msg；
- 图片上传/删除的接口与文件字段；
- 分页切换是否有延迟请求；
- 商品编辑保存后的列表/详情回读；
- 类目变化时字段集合如何变化。

本文件不代表已修改商品，也不代表商品编辑接口已可直接自动化。
