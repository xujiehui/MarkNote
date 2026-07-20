# MarkNote 完整自测报告

## 结论

本轮自测发现并修复了 3 个实际产品问题，并补充了 1 个发布门禁：

1. 新建笔记后 live query 尚未返回新记录时，编辑器会错误回到欢迎笔记。
2. 笔记操作菜单在窗口底部会越界，删除操作不可见或不可点击。
3. 系统偏好深色时，应用切回浅色仍会保留深色 body 背景。
4. GitHub Pages 构建现在会额外检查 Supabase 同步后端，而不只检查 OAuth。

修复后的本地代码通过了自动化测试、生产构建、Electron 打包检查和浏览器主流程自测。当前工作区的修复尚未推送，因此线上 Pages 仍是上一版 bundle；推送后需要重新观察 Pages 三个阶段。

## 测试环境

- 日期：2026-07-20
- 平台：macOS x86_64，Darwin 21.6.0
- 本机 Node：v20.19.6
- 本机 npm：9.7.2
- GitHub Actions Node：22.12.0
- 本地构建：Vite production build + Electron macOS x64 unpacked package
- 浏览器地址：`http://127.0.0.1:4178/?app=1`
- 线上地址：`https://xujiehui.github.io/MarkNote/?app=1`

## 自动化结果

全部通过：

- `npm test`
- `npm run lint`
- `npm run build`，使用 Pages 同等的 `MARKNOTE_REQUIRE_SYNC_CONFIG=1` 和 `VITE_SYNC_CONFIG_URL`
- `npm run desktop:pack`
- `npm run check:desktop-package`
- `git diff --check`

`npm test` 包含数据库、导入导出、编辑器、附件、同步引擎、OAuth 回调、Pages 工作流、Supabase migration、同步诊断和侧边栏折叠回归测试。

桌面包检查结果：

```text
Desktop package: ok (release/mac/MarkNote.app/Contents/Resources/app.asar)
Verified sync diagnostics, attachment hydration, OAuth callback bridge, and current dist entry.
```

## 浏览器主流程

已在本地生产构建中验证：

- 首屏加载、演示数据和空编辑状态
- 新建笔记，并确认新笔记立即成为当前编辑目标
- 修改标题和正文，确认自动保存及列表预览更新
- 通过标题/正文搜索笔记
- 搜索标签并跳转到标签筛选
- 列表排序/筛选入口，收藏筛选和清除筛选
- 笔记置顶
- 笔记删除、回收站查看、恢复和永久删除
- 创建、重命名和删除临时文件夹
- 打开/关闭标签管理器
- 插入代码块
- 中英文切换
- 深色/浅色切换
- 侧边栏收起和展开
- 打开同步面板并运行同步诊断
- 浏览器控制台 `error`/`warning` 日志为空

测试期间创建的临时笔记、回收站记录和临时文件夹均已清理，HTTP 静态服务器也已停止。

## 在线检查

### Supabase

通过：

- `npm run check:google-oauth`
- `npm run check:supabase-sync`

结果包括：Supabase 项目 DNS 正常、Auth health HTTP 200、Google OAuth provider 可达、同步配置后端可读、同步表匿名探测可达。

注意：`npm run check:supabase-sync` 默认不会伪造登录状态，因此登录后的表写入、Storage 上传/覆盖/下载/删除 canary 被跳过。应用内“Diagnose sync”也明确显示：项目可达，但需要先登录才能检查同步表。这不是已确认的产品缺陷，而是当前自测环境缺少真实用户会话。

完成正式发布前，必须使用真实 Google 登录执行：

```bash
npm run check:supabase-sync:oauth
```

或设置新鲜的 `SUPABASE_ACCESS_TOKEN` 后执行带认证检查的命令，并确认表和 Storage 的 insert/update/delete 全部成功。

### GitHub Pages

当前线上旧版本通过：

```bash
MARKNOTE_PAGES_URL='https://xujiehui.github.io/MarkNote/?app=1' \
MARKNOTE_SYNC_CONFIG_URL='https://wgagahicbbmqbqttedjy.supabase.co/storage/v1/object/public/marknote-config/sync-config.json' \
npm run check:pages-deployment
```

已验证线上 bundle 包含后端配置端点，没有嵌入 Supabase secret/service-role key，配置端点 CORS 正常，Google provider 已启用。该结果对应部署前的旧 bundle，不能替代本次修复推送后的线上验证。

## 已修复问题

### 新建笔记选择竞态

原因：`createNote()` 完成后立即设置 `activeNoteId`，但 Dexie live query 尚未把新记录放入 `notes`；可见笔记清理 effect 将新 ID 当作无效值，回退到第一条笔记。

处理：增加待确认的 active note ID，live query 返回新记录前保留用户刚选择的笔记；新增选择逻辑回归断言。

相关文件：`src/App.tsx`、`src/lib/activeNoteSelection.ts`、`tests/editorDraft.test.ts`

### 笔记操作菜单越界

原因：`ContextMenu` 直接使用鼠标坐标，没有视口夹紧；默认文件夹和标签较多时菜单高度超过窗口，底部 Delete 不可见。

处理：增加统一坐标夹紧、最大高度和纵向滚动；Delete 操作固定在菜单底部可见区域；新增位置计算回归断言。

相关文件：`src/components/ContextMenu.tsx`、`src/lib/contextMenuPosition.ts`、`tests/editorDraft.test.ts`

### 系统深色偏好覆盖应用浅色主题

原因：CSS 的 `prefers-color-scheme: dark` 无条件设置 `body` 深色背景，与应用内主题开关脱节。

处理：保留深色系统下的选区变量，但移除对 `body` 背景的强制覆盖。

相关文件：`src/styles.css`

## 仍需处理的问题

### P1：macOS 正式分发缺少有效签名证书

本机 Electron 打包成功，但 electron-builder 报告当前钥匙串没有有效的 Developer ID Application 证书，发现的 Apple Development 证书均已过期，因此生成的是未签名包。未签名包不适合作为正式 macOS 发布物，可能触发 Gatekeeper 警告。

处理建议：配置有效的 Developer ID Application 证书、`CSC_LINK`/`CSC_KEY_PASSWORD`，并补充 notarization 流程；完成后重新运行 `npm run dist:mac:x64` 和 `npm run dist:mac:arm64`。

### P2：认证后的真实云同步仍缺一次人工 E2E

OAuth provider、配置 API、Auth health 和匿名同步探测均通过，但本轮没有可用的真实登录会话，因此没有完成“Google 登录 → authenticated 表写入 → Storage canary → 清理”的真实链路。该项必须由用户在浏览器中完成登录后再验证。

### P2：Renderer 主 bundle 过大

当前主入口约 1.13 MB，gzip 约 339 KB，Vite 提示 chunk 大于 500 KB。功能正常，但会增加 Pages 首次加载和低端设备启动时间。

处理建议：将 PDF、html2canvas、导入导出、编辑器扩展和非首屏面板继续改为动态 import，并建立首屏 bundle 预算。

### P2：本机 Node 与 CI Node 版本不一致

本机使用 Node 20.19.6，GitHub Actions 固定 Node 22.12.0；本轮两者均能通过，但项目尚未在 `package.json` 声明 engines。建议声明受支持 Node 范围，并在本地开发文档中统一版本。

## GitHub Actions 证据

最近一次 `dde0d25` 对应的 Desktop Build：

- Lint and test：success
- Build macOS Intel：success
- Build macOS Apple Silicon：success
- Build Windows x64：success
- Publish GitHub release：skipped，因为该次不是 version tag

本轮新增了 Pages 的 `Verify Supabase sync backend` 步骤。推送后应确认 Pages 的 Build、Deploy、Verify deployed cloud sync 三个 job 全部 success，并重新运行上面的认证 E2E。

## 发布前清单

- [x] 本地全量测试、Lint、生产构建
- [x] Electron app.asar 内容检查
- [x] 浏览器核心流程和控制台检查
- [x] OAuth provider、Supabase health、Pages 配置/CORS 检查
- [x] Pages 增加同步后端构建门禁
- [ ] 使用真实 Google 登录完成 authenticated table + Storage canary
- [ ] 配置并验证 macOS 签名和 notarization
- [ ] 推送本轮修复并验证新的 Pages workflow
- [ ] 评估 renderer code splitting 和 bundle budget
