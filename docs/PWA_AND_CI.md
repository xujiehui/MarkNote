# PWA、移动布局与质量门禁

本次实现让生产版本在首次完整在线安装后，使用 CacheStorage 中的应用壳离线打开。开发服务器不注册 Service Worker；Electron 的 `file:` 页面也不注册。私有笔记、草稿、历史及附件记录继续由工作区数据库管理。

## 构建与离线缓存

```sh
node --version
npm --version
npm ci
npm run build
node tests/pwaOffline.test.cjs --distribution dist
npm run test:e2e
```

构建在 Vite 输出完成后运行 `scripts/generate-pwa-precache.mjs`。清单包含 `index.html`、应用清单、图标及 `assets` 内的公共 JavaScript、CSS、字体和图片，其中包括独立的搜索 Worker 和懒加载代码；排除 source map、任意 `.json` 文件、环境配置和认证数据。清单嵌入 `dist/sw.js`，同时生成用于验收的 `dist/offline-manifest.json`。每个文件带 SHA-256 摘要，缓存版本由清单和 Worker 模板共同生成。

安装必须下载并校验全部清单文件才算成功。失败的安装删除自身的部分缓存，保留正在使用的旧版本。每个部署路径使用独立缓存前缀，清理不会影响同域其他应用。导航始终读取当前 Worker 对应的应用壳，避免新 HTML 和旧 JavaScript 混用；导航参数不会写入响应缓存。

请求缓存仅限清单中的精确公共资源 URL；保留的旧缓存可以响应旧页面请求的原版本静态代码/Worker。认证头、非 GET、跨域、带参数的静态请求以及运行时 API 不进入缓存。应用壳路由外的导航也不被拦截。在线配置接口、Supabase、附件下载和笔记请求继续使用各自原有的数据/网络流程。

运行时通过 MessageChannel 询问当前 Worker 是否持有完整清单缓存。`registration.active` 或 `navigator.serviceWorker.ready` 本身不能证明老版本 Worker 已具备离线能力。首次安装仍需要网络，缓存可能被浏览器或用户清理，应用不会把这两种情况宣称为已支持离线。

## 更新行为

- 新 Worker 完整安装后进入等待，不在 install 中调用 `skipWaiting`。
- “保存并更新”首先等待应用保存协调器成功提交草稿，随后请求激活；保存失败保持页面和编辑器打开。
- 收到新 Worker 的控制事件后，只有主动接受更新的标签页才重载。激活超时会重新提供重试；晚到的控制事件不会突然重载已经继续编辑的页面。
- 其他标签页保留当前编辑并显示自己的更新入口。存在多个应用标签页时保留旧静态缓存，供旧页面继续加载原版本的懒加载代码；后续只有一个应用标签页时的激活可清理旧缓存。
- 本方案校验离线缓存清单格式。数据库及同步协议的迁移/回滚仍需工作区与同步协议的兼容性验收，不能通过旧前端缓存直接回退已经写入的新数据库。

## 窄屏与键盘操作

960px 及以下使用笔记列表/编辑器单栏和导航抽屉；961–1279px 使用列表与编辑器两栏及导航抽屉；1280px 起显示完整三栏。不强制 1180px 页面宽度。笔记列表通过 ResizeObserver 测量实际容器宽高，短屏不再强制 320px 列表高度。笔记选择使用原生按钮，与还原、删除和菜单按钮互为兄弟；Enter/Space 可由浏览器原生触发选择。搜索和折叠导航具有可访问名称，浮动菜单可用 Escape 关闭，支持系统减少动画偏好。窄屏 Ctrl/Cmd+F、K 会先打开导航再聚焦搜索。

已经移除 Pro 徽标、虚构头像和仅修改名称的工作区切换入口。显示的空间由实际访客/账号工作区决定。

## CI 与桌面制品

Node 固定为 `.node-version` / `.nvmrc` 中的 24.19.0。质量、Pages 和 Desktop 的 Node 作业显式安装 npm 11.9.0，质量作业还验证实际版本。本地 `package.json` 的兼容范围为 Node `>=24.19.0 <25`、npm `>=11 <12`；CI 采用上述固定版本。

Pages 和 Desktop 的 build job 分别调用 `quality.yml`，共用检查定义，依次执行锁文件安装、lint、完整测试、Web/Electron 编译、离线制品校验和 Chromium 浏览器回归。共享流程也可手工执行，浏览器失败时上传保留 7 天的 trace。Pages 原有的线上同步/OAuth 配置检查仍是独立发布门禁。保存工作流与本机检查通过并不表示 GitHub runner、原生打包或线上配置已经验证。

原生打包 job 在上传制品前调用 `npm run check:desktop-package`。检查器自动查找 release 目录中的 `app.asar`，兼容 macOS Intel、Apple Silicon 和 Windows 的 unpacked 输出。也可显式指定：

```sh
node scripts/check-desktop-package.mjs --asar /path/to/app.asar --dist dist
```

检查器比较当前 dist 的全部文件内容，检查所有懒加载 renderer chunk、CSP、Electron 安全策略文件、OAuth bridge、离线清单校验和及凭据排除规则。它验证的是制品内容；原生安装、签名/公证、启动、真实登录回调和升级保留数据仍须在目标平台验收。本云环境的 Web/Electron 编译与模拟 ASAR 检查不能替代该验收。

## 回归覆盖

| 用例 | 验证点 |
|---|---|
| `pwaOffline.test.cjs` | 清单确定性、完整校验、纯 CacheStorage 离线启动、私有请求绕过、失败更新保留旧缓存、多标签旧 chunk |
| `serviceWorkerRuntime.test.cjs` | 完整缓存就绪、等待更新、跨标签不强制重载、激活超时和晚到事件 |
| `pwaUpdate.test.tsx` | 保存失败禁止激活，保存成功后更新，渲染故障恢复界面 |
| `noteListAccessibility.test.tsx` | 原生选择按钮、操作不误触选择、ResizeObserver 宽高和清理 |
| `desktopPackageCheck.test.cjs` | 三种 unpacked 输出发现、懒加载 chunk 完整性、缺失策略文件、凭据和离线校验失败 |
| `qualityWorkflow.test.cjs` | 共用质量门禁、Node/npm 版本与浏览器/桌面制品检查路径 |
| `searchIndex.test.ts` / `indexedSearchHook.test.tsx` / `searchWorker.test.cjs` | 搜索增改删、过期结果排除、Worker 回退及 10,000 项查询取消 |
| `e2e/workspace.spec.ts` | Chromium 中清空并禁用 HTTP 缓存的生产离线重载/新页面、保存/草稿恢复/写入失败、真实表格与窄屏流程 |

搜索 Worker 的接入和验证边界见 [本地搜索索引](SEARCH_INDEX.md)。大库启动、读模型生成、附件与历史容量、索引回退和实际设备性能还需独立基准；10,000 项正确性用例不代表性能预算已经达标。
