# V2 配送模板 API 现场证据（2026-10-04）

## 范围与证据边界

本文件记录 Codex 内置浏览器（IAB）中配送模板的实际页面操作、请求和回读；不是运行旧 Selenium 脚本所得，也不是 KST Electron 网络采集测试。只保留请求路径、字段名、类型、业务返回和事件关联，不保存账号、业务对象 ID、完整 `paras`、Cookie 或 Token。

首次重量/件数模式采集新建一个可识别的模拟测试模板 `KST_API_AUDIT_20261004`。编辑、默认切换和删除均使用该测试模板；设为默认后恢复原默认模板。后续价格分段补证另建一次性模板 `KST_API_PRICE_BAND_20261004`，保存和详情回读后已删除，未设默认、未绑定商品。不能把这两个样本扩大解释为全部配送规则、全部异常分支已覆盖。

重量/件数模式闭环结果：模板数 **5 → 6 → 5**；测试模板已删除，默认模板恢复为 `Smart_Precise_V34_0.5kg`。后续价格分段测试同样 **5 → 6 → 5**，最后一次 `GetTemplateList` 返回 `Code=0`，共 5 条且两个测试模板均已删除，原默认未变。原有模板未删除。价格分段的独立事件段和详细证据见 [价格分段补证](template-price-band-2026-10-04.md)。

## 1. 编码、返回结构与证据口径

- 请求线格式为 URL 编码表单。数字形态的表单值仍是**文本**，不是 JSON 数字；采集工具对其进行数字解释，不改变真实传输类型。
- `SaveTemplate` 的外层 `arrayStr` 是文本。解析其 JSON 后，本轮条目中的 8 个字段均为字符串；`DS08Xml` 和 `DS08AXml` 还需要 URI 解码才能得到 XML。
- 响应外层 `result`、`jsonStr` 为 JSON 字符串，需再次解析；关系接口对应 `jsonStr1`、`jsonStr2`、`jsonStr3`。下文数组和字段类型均指解析后的结构。
- 解析后的 `result` 包含 `Code`、`Msg`、`RedirectUrl`、`Token`。只记录键及非敏感业务结果，不保存 Token 或重定向参数值。
- 事件序号是本次标签采集序列的“请求 → 响应”，不是业务 ID，也不能跨会话复用。只列真实观察事件，不补造丢失事件。
- 下文“成功”同时要求业务返回和列表/详情回读；仅 HTTP 200、按钮点击成功或页面提示不够。

## 2. 初始读取与国家弹窗

初始页为 `/ECrossAmazon/SellerShippingTemplateSetting`。以下均由真实页面动作触发，未直接调用猜测的 API。

| 动作 | 方法与路径 | 表单字段（线格式均为文本） | HTTP / Code / Msg | 事件序号 | 解析后的响应 |
|---|---|---|---|---|---|
| 模板列表初始化 | POST `/ECrossAmazon/GetTemplateList` | `courseId, shopId` | 200 / 0 / null | 3493 → 3498 | `jsonStr` 数组 5 项 |
| 模板基础规则读取 | POST `/ECrossAmazon/GetFeightBasicsList` | `courseId, shopId, ds0701, language` | 200 / 0 / null | 3500 → 3505 | `jsonStr` 数组 6 项 |
| 模板关系与规则读取 | POST `/ECrossAmazon/GetFeightRelationList` | `courseId, shopId, ds0701, language` | 200 / 0 / null | 3507 → 3512 | `jsonStr1` 数组 1 项、`jsonStr2` 数组 44 项、`jsonStr3` 空数组 |
| 国际国家选择弹窗读取 | POST `/ECrossAliexpress/GetFreightCountryList` | `courseId, eType, language` | 200 / 0 / Msg 本轮摘要未单列 | 3740 → 3748 | `jsonStr` 数组 6 项、`jsonStrChild` 数组 50 项 |

国家弹窗页面路由为 `SellerShippingTemplateSettingCountryGJ`。亚马逊模板页面真实调用了 `/ECrossAliexpress/GetFreightCountryList` 这一共享接口；保留原路径，不能因为控制器名称不同就改写为猜测的 Amazon 接口。

响应字段形状：

| 数据块 | 解析后字段与类型 |
|---|---|
| 模板列表 `jsonStr` | `DS0701:number, DS0705:string, DS0707:number` |
| 基础规则 `jsonStr` | `DS1101–DS1104:number; DS1105–DS1109:string; DS1110–DS1111:number; DS1112:string; DS1113–DS1115:number; DS1116–DS1117:null` |
| 模板关系 `jsonStr1` | `DS0701–DS0704:number; DS0705:string; DS0706:null; DS0707–DS0708:number; DS0709–DS0710:string` |
| 规则数组 `jsonStr2` | `DS0801–DS0806:number; DS0807:string; DS0808–DS0809:number; DS0810:string; DS0811–DS0812:number; DS0813:string; DS0814–DS0817:number` |
| 价格分段 `jsonStr3` | 本节早期重量样本为空数组；后续已捕获 8 条非空价格分段，结构见 [价格分段补证](template-price-band-2026-10-04.md) |
| 国家弹窗 `jsonStr` | 每项 `B0203:string` |
| 国家弹窗 `jsonStrChild` | 每项 `B0201:string, B0202:string, B0203:string, B0230:string, B0215:number` |

除下文已核对的字段外，DS/B 字段仅确认名称和类型，不从编号或单个样本猜其业务含义；`null` 也不是空字符串类型的证明。

## 3. 新建与编辑的真实提交

`POST /ECrossAmazon/SaveTemplate` 的外层表单包含 `arrayStr`。解析后条目中的完整键如下，本轮全部为 **string**：

```text
courseId
shopId
DS0701
DS0705
DS0708
DS08Xml
DS08AXml
language
```

其中 `DS0705` 对应模板名称；编辑时沿用同一测试对象上下文，实际 ID 不保存。`DS0708` 在本节重量/件数样本中为 `"0"`；后续独立价格分段样本已确认 `"1"`，请求为字符串、详情回读为 number 1。

`DS08Xml` URI 解码后为 `ROOT` 下重复的 `DS08` 规则节点。每条规则的完整子节点为：

```text
ROOT
└─ DS08（重复）
   ├─ DS0805
   ├─ DS0809
   ├─ DS0810
   ├─ DS0811
   ├─ DS0812
   ├─ DS0813
   ├─ DS0814
   ├─ DS0815
   ├─ DS0816
   └─ DS0817
```

以上是节点结构，不是可直接重放的完整请求。XML 节点内容在线格式中为文本，不能把返回 JSON 中的 number 类型套用到 XML 请求。

`DS08AXml` 在本节重量/件数样本中解码为 `<ROOT></ROOT>`。后续价格模式已提交并回读 8 条非空 `DS08A`：`DS08A05` 服务 code、`DS08A06` 请求规则序号、`DS08A09` 起点、`DS08A10` 终点、`DS08A11` 费用。特别注意响应 `DS08A06` 已转为 `jsonStr2.DS0801` 的持久化规则 ID，而 `DS0817` 仍为页面规则序号，详见 [价格分段补证](template-price-band-2026-10-04.md)。

| 动作 | 方法与路径 | HTTP / Code / Msg | 事件序号 | 实际结果与回读 |
|---|---|---|---|---|
| 新建唯一测试模板 | POST `/ECrossAmazon/SaveTemplate` | 200 / 0 / 保存成功！ | 3760 → 3762 | 随后 `GetTemplateList`（3905 → 3909）Code0，列表共 6 条，出现测试模板 |
| `fill` 后第一次编辑保存 | POST `/ECrossAmazon/SaveTemplate` | 200 / 0 / 保存成功！ | 4084 → 4087 | 请求 XML 仍为原 `4.99`、`0.5`；没有按预期提交新金额，不能记为金额修改成功 |
| 逐字输入并 Tab 后编辑保存 | POST `/ECrossAmazon/SaveTemplate` | 200 / 0 / 保存成功！ | 4404 → 4407 | XML 为 `DS0814=1.23, DS0815=0.45, DS0816=1`；详情界面回读同值，单位为每商品 |

## 4. 设默认、恢复与删除

三个动作都使用实际接口 **`POST /ECrossAmazon/DeleteSetDefaultTempalte`**。`Tempalte` 是现场路径的原拼写，不能擅自改成 `Template`。

外层 form 的完整字段为 `courseId, shopId, ds0701, OPType, language`，本轮均为数字形态的字符串。`OPType="1"` 是设为默认，`OPType="2"` 是删除；业务对象值不落盘。

| 动作 | OPType | HTTP / Code / Msg | 事件序号 | 回读 |
|---|---|---|---|---|
| 将测试模板设为默认 | `"1"` | 200 / 0 / 操作成功. | 4579 → 4582 | 默认切换通过模板列表回读验证 |
| 恢复原默认模板 | `"1"` | 200 / 0 / 操作成功. | 4618 → 4621 | `GetTemplateList` 确认原 `Smart_Precise_V34_0.5kg` 的 `DS0707=1`，测试模板为 0 |
| 删除测试模板 | `"2"` | 200 / 0 / 删除成功！ | 5151 → 5153 | 最终列表不含测试模板，不仅依赖删除弹窗 |
| 最终独立列表回读 | 不适用 | 200 / 0 | 5161 → 5164 | `POST /ECrossAmazon/GetTemplateList` 返回 5 条，测试模板不存在，默认仍是原 `0.5kg` 模板 |

这次删除只针对本轮新建的测试模板；原默认已恢复。删除成功后不再重复创建同名模板，也不重新执行删除来获取重复证据。

![模板删除及默认恢复回读](evidence-images/template-restored-2026-10-04.jpg)

## 页面操作与回读原则

### 金额输入不等于表单模型已更新

本轮观察到：金额控件执行 `fill` 后，看似填写成功，但 `SaveTemplate` 实际请求仍携带原金额。随后改为逐字输入（`pressSequentially`），并按 Tab 触发离焦后，实际提交金额才变为 `1.23` 和 `0.45`；详情回读也确认了这两个值。

这只能证明当前控件的实际输入事件路径存在差异，不能据此断言其内部框架或事件绑定实现。后续接入必须同时验证可见输入、提交字段和详情回读，不能以 `fill` 无异常、按钮点击完成或“保存成功”弹窗代替字段持久化验证。

### 已确认的字段映射

| 字段 | 本轮确认含义 | 边界 |
|---|---|---|
| `DS0805` | 配送服务 code | 国内：10001 标准、10002 加急、10003 两日、10004 一日；国际：20001 标准、20002 加急；不扩展到未见服务 |
| `DS0810` | 地区文本 | 已与规则行对照；不是国家弹窗所有 B 字段的完整映射 |
| `DS0813` | 运输时效文本 | 不是处理时间 |
| `DS0814` | 每单金额 | 本轮编辑提交及回读 `1.23` |
| `DS0815` | 单位价 | 本轮编辑提交及回读 `0.45`，须结合 `DS0816` 的单位 |
| `DS0816=1` | 单位商品 | 已通过控件与请求对照 |
| `DS0816=2` | `Lb` | 已通过控件与请求对照；不代表已验证 `kg` |
| `DS0708=0 / 1` | 重量/件数模式 / 价格分段模式 | 两种模式均已实际保存和回读；请求 JSON 内为 string，详情为 number |
| `DS0817` | 本轮价格样本的页面规则序号 | 目标规则为 2；请求 `DS08A06=2` 与其关联，而响应 `DS08A06` 对应 `DS0801` 规则 ID |
| `DS0707=1` | 默认模板标记 | 切换后通过 `GetTemplateList` 回读；恢复后原 `0.5kg` 模板为 1，测试模板为 0 |
| `OPType=1` | 设为默认模板 | 用于现场观察的 `DeleteSetDefaultTempalte`，保留服务器实际拼写 |
| `OPType=2` | 删除模板 | 同一接口的另一动作；不能与默认切换混用 |

仍待确认的请求字段：`DS0809` 疑与服务序号相关，但未建立精确语义；`DS0811`、`DS0812` 是地址标记候选，国内样本为 1、国际为空。后续价格样本取消“邮政信箱”后，实际提交仍为 `1/1`，详情仍包含两种地址，因此尚未建立可靠的独立开关映射。`DS0817` 在价格分段样本中已与规则序号关联，但不扩大到未见模式或异常输入。旧脚本含义不能替代当前表单证据。

### 商品模板绑定已补证 逐子 SKU 分配仍未确认

页面的 SKU 分配入口跳转到管理库存。早期展开子 SKU 后点击模板名，实际进入原模板编辑页；该路径当时没有完成商品绑定提交。

后续已通过已有测试商品的编辑页完成 **原 0.3kg → 0.5kg → 恢复原 0.3kg**。报价区域 `merchant_shipping_group_name` 对应商品 XML 字段 `DS2061`，通过 `POST /ECrossAmazon/SaveProduct` 提交，`GetProductAllList` 详情回读确认 `jsonStr5.DS2061 === jsonStr2.DS0701`，由 `DS0705` 对应模板名。不是独立 SKU 分配 API，也没有验证同一父商品各子 SKU 能分别绑定模板。

完整请求结构、保存为草稿与保存并完成的 `oPType` 差异、恢复证明见 [商品配送模板绑定现场证据](product-template-binding-2026-10-04.md)。因此应将“单商品模板绑定”标为已确认，将“逐子 SKU 独立绑定或批量分配”保留为待确认，不能再把两者笼统合并为未提交或全部完成。

## 待确认项

- 价格分段 `DS08A` 的非空提交、字段结构、两段详情回读及删除已完成；仍缺价格精度、全部边界/冲突校验和真实计费验证，见 [价格分段补证](template-price-band-2026-10-04.md)。
- `DS0809` 的精确语义与枚举、`DS0811/DS0812` 的可靠独立开关映射仍待确认。`DS0708` 两种模式及价格样本中的 `DS0817` 规则序号关联已有实证，不再列为完全未采集。
- 逐子 SKU 独立绑定或批量分配尚未确认；单商品编辑页的模板绑定提交及商品关系回读已完成，见上述补证。
- 当前配送模板表单未看到限重、`kg`、币种切换或处理时间输入，不能猜测 DS 字段映射，也不能据此断言平台所有页面都不存在这些能力。后续已在商品编辑报价页确认 `fulfillment_latency` 对应 `DS2046`：请求 XML 文本 `"5"`、商品回读 number 5；本轮未修改此值，也未验证范围或单位。
- 页面只显示“运输时间不包括处理时间”提示，不能把运输时间字段误写成处理时间字段。
- 尚未覆盖全部校验错误、重复提交、使用中的模板不可删除等失败分支。

本文不是评分规则证明；费用、国家和服务字段存在，不等于已验证它们的得分条件。
