# bjysoft 外部软件：公开入口与登录壳

目标入口：`http://www.bjysoft.cn:8730/User/Welcome6`  
现场时间：2026-10-02（Asia/Shanghai）

## Welcome6 公开页面

- HTML 标题为“国际贸易教学系列软件”，服务器响应为 IIS，页面设置 `ASP.NET_SessionId`、`SystemLanguage=cn`、`ShowLanguage=CN|EN|KO|RU`。
- 页面分为“教学系统”和“虚拟仿真”两组，产品卡片由前端脚本异步填充，不是首屏 HTML 固定内容。
- 加载脚本包括 `/Scripts/common.js`、`/Scripts/User/Welcome6.js` 和字典脚本；样式为 `/Content/skins/skin1/User/Welcome6.css`。
- `Welcome6.js` 调用 `POST ../Common/GetCopyright_2`，请求体包含 `imagesUrl=../Images/User/Welcome6/`，返回 `Rows01`/`Rows02` 等产品清单。当前公开返回含产品类型编号和图片路径；其中 21、22、24、25 会被脚本补充为可点击入口。
- 公开页面的产品点击分支：类型 21、22、24、25 导向同主机 8732 端口的 `/User/loginPage{type}`；其他类型使用 8730 上的 `LoginPageRoute` 分支。

## 8732 登录壳的静态行为

已只读获取 `/User/loginPage21`、`22`、`24`、`25` 的 HTML。它们都加载同一份 `/Scripts/User/LoginPage.js?v=1011`，页面内嵌一个 `#login-iframe`。

- 登录页先根据加密的 `paras` 查询参数恢复上下文，再设置 iframe。
- 默认 iframe 入口由脚本构造为 `../User/Sign?paras=<加密的 loginType>`。
- 公共 `AjaxSend` 使用 POST，并从浏览器本地存储读取登录令牌后放入 `Authorization: Bearer ...`；令牌值未采集。
- 21/22/24/25 使用各自的背景和 Logo 资源，但登录框和公共脚本结构相同。

## 仍未确认

- 学号账号实际对应的产品类型、登录后默认页面和可见权限。
- 登录成功后的完整导航、iframe 内部页面、弹窗、分页和所有分支。
- 每个页面真实触发的请求、请求体、返回结构、失败/超时/权限分支。
- 8730 与 8732 之间登录态、`paras` 上下文、`courseId`、`shopId`、语言和令牌的实际关联。

## 从公开脚本提取的路由候选（未现场触发）

对 Welcome6 与登录壳引用的公开 JavaScript 做了字符串级提取。以下只是候选入口，不能当作当前账号可访问页面：

- 公共/登录：`../Common/GetA11`、`../Common/GetCopyright_2`、`../CommonFilter/Filter`、`../User/Sign?paras=`、`../User/ReLogin?paras=`、`../User/LoginPageRoute?loginType=`、`../User/LoginByZ01`、`../User/LoginOutLog`、`../User/SoftRegister`、`../User/Index?type=back`。
- 教师/课程：`../Teacher/TeacherIndexNew_21`、`../Teacher/TeacherIndexNew_22`、`../Teacher/TeacherIndexNew_24`、`../Teacher/TeacherIndexNew_25`、`../Teacher/Setting_3?paras=`、`../Teacher/Setting_4?paras=`、`../Teacher/Setting_5?paras=`、`../Teacher/Debugger`、`../Teacher/TrialManage`。
- 业务资料：`../Business/BusinessBankList`、`BusinessChargeList1`、`BusinessCustomerList`、`BusinessExchangeRate`、`BusinessFactoryList`、`../Customs/CustomsInfoList`、`../Forwarder/ForwarderInfoList`、`../Inspection/InspectionInfoList`、`../Product/ProductList?isShowTop=1&paras=`。
- 跨境课程/工具：`../ECrossCommon/CourseIndexTrainingCourse`、`../ECrossCommon/ProductList`、`../Helper/H13?paras=`、`../Helper/H14`、`../Helper/HS`、`../Helper/JSQ`、`../User/Encyclopedia`、`../baike/Student/`、`../Demos/`。

这些候选没有被批量请求；下一步要在登录后按页面树逐个确认，避免因为猜测地址而触发权限、状态或业务写入。

## 登录表单的静态请求线索（未发送）

只读获取 `/User/Sign` 后确认登录框字段为 `userName`、`password` 和可选验证码字段。`Sign.js` 的普通登录分支会：

- 对用户名做前端字符过滤；密码通过 RSA 公钥加密；
- 读取浏览器指纹 `deviceId`；
- 以 POST `../User/Login` 发送 `loginType`、用户名、加密密码、验证码、语言和设备指纹；
- 成功后把返回令牌放入本地存储，并按 `userType` 导航；学生类型的静态目标是 `../ECrossCommon/CourseIndexTrainingCourse`。

本轮没有向 `../User/Login` 发送请求，也没有读取或保存验证码、密码、设备指纹、令牌或登录返回值。
