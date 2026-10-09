# 独立营销官网

## 内容与边界

`src/marketing` 是独立构建的宣传官网，包含产品场景、品牌、咨询、下载及隔离模拟体验，不是业务网页版。当前验收源码与上线记录见 [当前工程与成果](project-materials/2026-10-09/current-status.md)，实际页面从所选源码的路由确认；正式 main 中较早的官网源码不能冒充最新已发布静态站。

官网不包含 C/B/Admin 业务路由、真实账号登录、授权、业务 API、Runner、后台或 PWA。模拟只使用虚构数据和自己的存储，不能作为真实工具执行结果。咨询仅使用已经确认可公开的联系渠道，不能因历史示意文案就把当前咨询说成假演示，也不能凭空补邮箱或联系方式。用户入口与地址边界见 [地址说明](DOMAIN_ONBOARDING.md)，AI 修改与填写规则见 [接手指南](../AI_GUIDE.md)。

## 构建与预览

生产构建必须显式注入两项公开配置（发布工具可读取被 Git 忽略的 `.env.marketing.local` 后注入）：

- `VITE_DESKTOP_DOWNLOAD_URL`：实际已发布的稳定 HTTPS 安装包地址，不接受候选包或本地测试目录。
- `KST_MARKETING_SITE_URL`：实际 Pages 正式网址或已验证的域名 origin，用于 canonical、分享链接与版本证明。

构建不会自动读取共享 `.env.production`、`.env.deploy` 或其他 VITE 环境变量。`RELEASE_COMMIT` / `GITHUB_SHA` 可提供精确提交；未设置时读取本地 Git HEAD。

```text
npm run build:marketing
npm run marketing:audit
npm run preview:marketing
```

输出仅为 `dist-marketing/`，与桌面 `dist/`、安装包 `release/` 分离。`TOOLBOX_MARKETING_DIR` 可指定审计其他候选输出目录。不要将 `.env.marketing.local` 或整个仓库上传到 Pages。

## Pages 静态托管

发布通道由 `.env.marketing.local` 的 `KST_MARKETING_PROVIDER` 选择：默认 `cloudflare`；`github-pages` 使用 `GITHUB_PAGES_REPOSITORY=账号/账号.github.io` 和匹配的根网址。GitHub 通道只接受已启用 main 根目录 Pages 的现有 KST 宣传站；不自动创建仓库、更改可见性或修改 Pages 设置。

GitHub 通道将已审计宣传制品提交到独立静态仓库，保留 Git 历史、不强推、不上传项目源码；拒绝覆盖含未知文件或其他站点的仓库。发布临时克隆保存在 D 盘数据目录。由于 GitHub 不执行 Cloudflare 的 `_headers` / `_redirects`，适配器提供 `.nojekyll`、真实条款路径文件与 HTML CSP；不宣称 GitHub 可提供相同的自定义响应头和缓存策略。

下载 URL 可以留空。普通构建/预览会读取当前已发布清单；正式发布器仍要求线上清单版本与本次源码版本相同，不会把预览构建直接当作正式发布。

- 构建命令对应 `build:marketing`；发布目录为 `dist-marketing`。可在有授权后由统一发布工具上传已审计目录，不需要 Pages Functions。
- 当前检出分支的早期 `_redirects` 规则只覆盖 `/terms`，不能据此证明已发布新版的全部场景和 `/demo` 直达可用。路由产物必须按本次所选源码与静态托管通道核对，已存在的新入口不得因为沿用旧构建丢失。未知 URL 返回真实 404，不把 `/api/` 等误请求掩盖为 HTML 200。
- `_headers` 为 HTML 设置重新验证，为哈希资源设置长期缓存，禁止页面发起 API/遥测连接。未启用 Service Worker，不涉及旧桌面更新器。
- `marketing-version.json` 包含产品版本、提交 SHA、构建时间、公开官网地址和下载地址，可识别同版本官网小改。它不是桌面 `latest.yml`，不驱动桌面更新。
- 下载直接导航到已配置的正式安装包，不跨域 fetch 清单，不需修改旧 API 或更新目录的 CORS。
- 每次系统新版本正式发布后，先确认安装包可下载，再更新官网配置并发布；不得先把官网指向尚不存在的版本。
- 旧 IP 的 API、更新地址与证书续期保持，不将控制面 URL 改成 Pages 网址。境外官网不代表国内既有服务的主体或备案要求自动解决。

## 验收

`npm run verify:marketing` 固定执行发布配置单测、独立构建、产物审计及桌面/手机浏览器 E2E，已纳入 `verify:release` 与 CI。`npm run marketing:publish -- --check-account` 只验证账号、现有项目及站点域名归属；`--check` 还核验干净且已通过 CI 的最新 main、正式系统版本和安装包可下载。两者均不上传。Wrangler 登录配置与缓存位于 D 盘 Cloudflare 数据目录，Windows 使用凭据库保护的加密配置，不进入源码。

正式发布后还需在公网验证首页、已存在场景页、`/terms`、`/demo` 直达与刷新、未知路径真实 404、CSP 下交互及正式安装包下载。Vite preview 不执行托管通道的生产路由规则，不能代替这一层验收；GitHub Pages 与 Cloudflare 的头部/缓存能力不同，不能套用另一通道结论。

执行营销构建审计，检查模块白名单、无业务 API、无源码/secret/source map、正确版本证明和对应通道的缓存规则。浏览器检查电脑与手机布局、导航、咨询关闭、条款、404、下载和失败反馈；模拟同时检查人工与一键操作结果一致、必填/重复操作、开始/暂停/继续/停止/重置、刷新保留状态及减少动态。网络检查覆盖首页与模拟操作，证明没有真实平台、业务 API、Runner 或遥测请求。缺失的实机或网络检查写为未验证。

官方说明：[Cloudflare Pages Headers](https://developers.cloudflare.com/pages/configuration/headers/)、[Redirects](https://developers.cloudflare.com/pages/configuration/redirects/)、[Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)。
