# 业务网页版下线：独立官网只读验收

验收日期：2026-10-08（Asia/Shanghai）。对象为真实公开站点 `https://kesaitong.top`，未修改官网代码、配置、内容或发布记录。该记录是本次下线过程中的独立官网观察；服务器策略切换结果由下线部署验收记录单独确认。

## 实测结果

使用 Playwright 驱动本机 Microsoft Edge 无头浏览器，分别以 1440×1000 与 390×844 视口打开线上页面，并实际打开保存的截图检查视觉表现。

| 检查 | 结果 |
| --- | --- |
| 官网首页 | 两种视口 HTTP 200，标题为“跨境电商赛训效率平台 · 课赛通 KST”，未出现页面脚本异常 |
| 首页横向布局 | `scrollWidth` 分别为 1440、390，与对应视口一致，无横向溢出 |
| 工具介绍与申请使用区 `/tools#start` | 两种视口 HTTP 200，无横向溢出；Windows 下载按钮可用 |
| 390 宽手机导航 | 展开后为不透明白底菜单，文字清晰；点击“工具介绍”进入 `/tools`，菜单自动关闭 |
| 主要导航可点击性 | 1440 宽导航链接与 390 宽菜单按钮中心命中自身，无遮挡层阻止点击 |
| 视觉检查 | 已查看首页首屏、完整页面、手机任务卡片和 FAQ、手机展开导航、两种视口的申请使用区；未见本次所检查区域文字重叠、控件裁切或异常覆盖 |
| 其他官网入口 | `/competition`、`/course`、`/terms` 均 HTTP 200；本轮未逐页进行完整视觉验收 |

初次手机菜单截图拍到了 CSS 过渡帧；重新使用禁用动画的稳定截图后复核通过，交付路径上的图片已替换为稳定状态。

## 官网版本与下载链路

`https://kesaitong.top/marketing-version.json` 返回 HTTP 200、JSON；仅记录公开发布摘要：

- `kind`：`kst-marketing`
- `version`：`1.8.12`
- `commitSha`：`8d1d1b8c3032fc8bc34adaedec2e17977b9723a7`
- `builtAt`：`2026-10-07T04:57:13.716Z`
- `publicUrl`：`https://kesaitong.top`
- `sourcePolicy`：`marketing-only-v1`
- `sourceModuleCount`：`32`
- `downloadUrl`：`https://8.130.113.104/updates/KST%20Setup%201.8.12.exe`

1440、390 两种视口的“下载 Windows 桌面端”按钮均触发上述真实安装包 URL，与公开版本文件一致。为避免下载整个安装包，按钮点击产生的 `.exe` 请求在浏览器传输前主动中止；该中止产生的 `ERR_FAILED` 是验收拦截结果，不用于判断线上文件故障。随后独立请求真实服务器验证：

| 请求 | 结果 |
| --- | --- |
| 安装包 HEAD | HTTP 200，`Content-Type: application/octet-stream`，`Content-Length: 110664273` |
| 安装包 `Range: bytes=0-15` | HTTP 206，`Content-Range: bytes 0-15/110664273`，实际只读取 16 字节 |

本轮确认官网现有下载仍可用；官网当前仍指向 1.8.12，不能据此声称官网已同步到系统新版本。没有修改该下载目标，也没有下载完整 EXE 或执行安装。

## 截图证据

证据目录：`D:\AmazonToolboxData\acceptance\kst-web-retirement`。PNG 为本地验收产物，不包含账号登录或授权数据。

| 文件名 | 内容 |
| --- | --- |
| `official-1440.png` | 官网首页完整长图，1440 宽 |
| `official-390.png` | 官网首页完整长图，390 宽 |
| `official-1440-hero.png` | 桌面首页首屏 |
| `official-390-hero.png` | 手机首页首屏 |
| `official-390-menu.png` | 手机导航展开的稳定状态 |
| `official-390-section-1.png` | 手机任务卡片区 |
| `official-390-section-2.png` | 手机 FAQ 区 |
| `official-tools-1440.png` | 桌面申请使用区与 Windows 下载入口 |
| `official-tools-390.png` | 手机申请使用区与 Windows 下载入口 |

## 适用边界

这些结果证明独立官网可在桌面和手机尺寸下浏览、导航并找到 Windows 安装包，不代表存在 Android/iOS 应用，也不代表手机可登录原业务网页版或执行工具、Runner、亚马逊仿真流程。本轮没有使用真实手机设备，手机结论限于 Edge 的 390 宽视口验收。
