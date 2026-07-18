# MarkNote

[English](#english) | [中文](#中文)

## English

MarkNote is a cross-platform note workspace for macOS, Windows, and the web. It is built with React, TypeScript, Tailwind CSS, Tiptap, Dexie/IndexedDB, html2canvas, jsPDF, FileSaver, and Electron.

The app is local-first by default, supports rich text, images, code blocks, folders, tags, import/export, and now includes a Chinese/English language switch for both the note workspace and the public landing page.

### Features

- Three-column note workspace with a folder sidebar, note list, and rich editor.
- Chinese and English UI, persisted in local storage.
- Local-first persistence through IndexedDB via Dexie.
- Full-text search across note titles and stripped HTML content.
- Default folders and tags with localized display names.
- Folder context menu, inline folder rename, and note move actions.
- Soft-delete trash with restore and permanent delete actions.
- Tiptap rich text editor with headings, bold, italic, quotes, ordered lists, and unordered lists.
- Base64 image insertion through toolbar upload, paste, and drag/drop.
- Image alignment controls, right-click image menu, and proportional image resizing.
- Dark code blocks with syntax highlighting, line numbers, language selection, and copy-code buttons.
- Export current notes as HTML, PDF, and Markdown.
- Export all notes as a JSON backup.
- Import Markdown, HTML, and JSON backups.
- Keyboard shortcuts for new note, save, search, image insert, and code block insert.

### Run Locally

```bash
npm install --cache ./.npm-cache
npm run dev
```

Open `http://127.0.0.1:5173/` for the landing page, or `http://127.0.0.1:5173/?app=1` for the app workspace.

### Build And Verify

```bash
npm run lint
npm test
npm run build
npm run verify:release:local
```

`verify:release:local` runs the local release gate: the full test suite, desktop packaging, and packaged-app verification. It does not replace the online Supabase release gate; run `verify:release:online` with real Supabase project credentials when network access is available.

### Optional Account Sync

MarkNote is still local-first by default. Account sync is enabled only when a sync configuration backend endpoint is present:

```bash
cp .env.example .env.local
```

Set `VITE_SYNC_CONFIG_URL` to your backend endpoint. The distributed app should not contain Supabase project details; the endpoint stores and returns them at runtime:

```json
{
  "provider": "supabase",
  "supabase": {
    "url": "https://your-project.supabase.co",
    "publishableKey": "sb_publishable_or_anon_key",
    "authRedirectUrl": "http://127.0.0.1:5173/?app=1"
  }
}
```

`VITE_SUPABASE_*` and `MARKNOTE_SUPABASE_*` runtime fallbacks are intentionally unsupported. The endpoint must return a publishable key only; never return a Supabase secret/service-role key. Publishable keys are expected to be visible to a client at runtime, so production protection still comes from Supabase Auth, RLS, and Storage policies.

Then apply the SQL in `supabase/migrations/202606190001_marknote_sync_schema.sql` to your Supabase project. You can print the migration for the Supabase SQL Editor with `npm run print:supabase-migration`.

After pasting the migration into the Supabase SQL Editor, you can print a read-only readiness query with `npm run print:supabase-readiness-check` and run it in the same editor. Every row should return `ok = true`; then run `npm run verify:release:online:manual` on this machine.

If you have a Supabase personal access token, you can apply and verify the checked-in migration through the Management API instead of using the SQL Editor:

```bash
SUPABASE_MANAGEMENT_TOKEN=sbp_... npm run check:supabase-migration
SUPABASE_MANAGEMENT_TOKEN=sbp_... npm run apply:supabase-migration
```

`check:supabase-migration` is the schema readiness gate: it lists migration history, checks for the five sync tables, confirms `authenticated` grants, verifies RLS and required policies, verifies the private `attachments` bucket and storage policies, and exits non-zero when the backend is not ready. `apply:supabase-migration` sends the checked-in SQL to the Supabase Management API, then runs the same readiness checks again.

In Google Cloud, create a Web application OAuth client and add your Supabase callback URL as an Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. In Supabase Auth, enable the Google provider and paste that OAuth Client ID and Client Secret. Then add your local and production MarkNote URLs to Supabase Auth redirect URLs, for example `http://127.0.0.1:5173/?app=1`. For CLI OAuth release checks, also allow `http://127.0.0.1:**/auth/callback`; for the packaged desktop app, add `marknote://auth/callback`. If the web app is not served from the current browser URL, return `supabase.authRedirectUrl` from the sync configuration endpoint.

Before testing the button in the app, run:

```bash
npm run check:google-oauth
npm run check:supabase-sync
```

This verifies that the configured Supabase project URL resolves, Supabase Auth redirects the Google provider flow to Google, and Google accepts the configured OAuth client. A DNS failure means the project URL is wrong, inactive, or not reachable yet. `invalid_client` means the Google OAuth Client ID or Client Secret configured in Supabase Auth does not match a valid Google Cloud Web OAuth client.

`check:supabase-sync` verifies the Supabase project is reachable and probes the sync tables, including `profiles`, `devices`, `folders`, `notes`, and `attachments`. MarkNote sync is login-only, so anonymous table probes may report `PGRST205` or permission errors. If you set `SUPABASE_ACCESS_TOKEN` to a signed-in user's access token, the script also verifies authenticated table access, inserts/updates/deletes temporary folder/note/attachment rows, and runs an attachment Storage canary: upload, overwrite, download, and delete.

For release verification, run the online gate after the migration is applied. It verifies Google OAuth configuration, Supabase schema readiness, authenticated Data API writes, and attachment Storage:

```bash
npm run verify:release:online
```

If you applied the migration manually in the Supabase SQL Editor and do not have a Supabase personal access token on this machine, run the manual online gate instead. It skips the Management API schema-readiness check and proves the app-facing path with Google OAuth, authenticated Data API writes, and attachment Storage:

```bash
npm run verify:release:online:manual
```

If you want the gate to apply the checked-in migration first, use the apply variant with a Supabase personal access token:

```bash
SUPABASE_MANAGEMENT_TOKEN=sbp_... npm run verify:release:online:apply
```

For CI or headless environments, provide a fresh signed-in access token instead:

```bash
SUPABASE_ACCESS_TOKEN=eyJ... npm run check:supabase-sync:auth
# CI can also set MARKNOTE_REQUIRE_SUPABASE_ACCESS_TOKEN=1 and provide SUPABASE_ACCESS_TOKEN separately.
```

`check:supabase-sync:auth` fails when `SUPABASE_ACCESS_TOKEN` is missing so authenticated Data API and Storage checks cannot be accidentally skipped. `check:supabase-sync:oauth` avoids copying tokens by running the same authenticated check after a browser login. You can also sign in inside MarkNote and click Diagnose sync to run the signed-in table and Storage canaries with the current app session. If the in-app Diagnose sync button reports `PGRST205` after signing in, run `npm run check:supabase-migration` if you have a Supabase personal access token; then either run `npm run apply:supabase-migration` with that token, or run `npm run print:supabase-migration`, paste the SQL into Supabase SQL Editor, optionally run the SQL from `npm run print:supabase-readiness-check`, and finish with `npm run verify:release:online:manual`.

The migration can be rerun on existing Supabase projects. If older tables already exist, newly backfilled foreign keys are added as `NOT VALID` so legacy orphaned rows do not stop deployment; new sync writes are still constrained. After cleaning old orphaned rows, validate `notes_user_folder_fk` and `attachments_user_note_fk` manually if needed.

The sync layer is adapter-based. Supabase is the first implementation, and the migration plan for custom Postgres APIs, Cloudflare D1/R2, or self-hosted Supabase lives in `docs/sync/backend-adapter-plan.md`.

### Desktop App

```bash
npm run desktop:build
npm run desktop:pack
npm run check:desktop-package
npm run dist:mac
npm run dist:win
```

`desktop:pack` creates an unpacked app under `release/mac/MarkNote.app` on macOS. `dist:mac` creates distributable macOS archives. `dist:win` is configured for Windows NSIS and portable builds and should be run on Windows or a CI runner with Windows packaging support.

Run `check:desktop-package` after `desktop:pack` to verify that `release/mac/MarkNote.app` contains the current frontend bundle, Electron OAuth callback bridge, sync table write diagnostics, attachment Storage canary, and attachment hydration code.

Current macOS outputs:

- `release/mac/MarkNote.app`
- `release/MarkNote-0.1.0-mac-x64.dmg`
- `release/MarkNote-0.1.0-mac-x64.zip`
- `release/MarkNote-0.1.0-mac-arm64.dmg`
- `release/MarkNote-0.1.0-mac-arm64.zip`

The local macOS build is unsigned because no valid Developer ID certificate is available in this environment. For public distribution, sign and notarize with an active Apple Developer ID certificate.

### GitHub Actions Packaging

The repository includes `.github/workflows/desktop-build.yml`.

It runs on pushes, pull requests, version tags (`v*`), and manual workflow dispatch. The workflow builds and uploads:

- macOS Intel artifacts from `macos-15-intel`
- macOS Apple Silicon artifacts from `macos-15`
- Windows x64 artifacts from `windows-latest`

Artifacts are available from the workflow run page for 30 days.

### PWA Install

On macOS or Windows, open the app URL in Chrome or Edge and use the browser install action from the address bar or browser menu. Installed data remains local to that browser profile through IndexedDB.

## 中文

MarkNote 是一款面向 macOS、Windows 和 Web 的跨平台笔记工作台，使用 React、TypeScript、Tailwind CSS、Tiptap、Dexie/IndexedDB、html2canvas、jsPDF、FileSaver 和 Electron 构建。

应用默认本地优先，支持富文本、图片、代码块、文件夹、标签、导入导出，并已为笔记工作区和官网落地页加入中文/英文语言切换。

### 功能

- 三栏笔记工作区：文件夹侧边栏、笔记列表和富文本编辑器。
- 中文和英文界面，语言选择会保存在本地。
- 通过 Dexie 使用 IndexedDB 做本地优先持久化。
- 支持按标题和正文纯文本进行全文搜索。
- 默认文件夹和标签支持本地化显示名称。
- 支持文件夹右键菜单、行内重命名和笔记移动。
- 回收站软删除，支持还原和彻底删除。
- Tiptap 富文本编辑器支持标题、加粗、斜体、引用、有序列表和无序列表。
- 支持通过工具栏上传、粘贴、拖拽插入 Base64 图片。
- 支持图片对齐、图片右键菜单和等比拖拽缩放。
- 深色代码块支持语法高亮、行号、语言选择和一键复制。
- 支持将当前笔记导出为 HTML、PDF 和 Markdown。
- 支持将全部笔记导出为 JSON 备份。
- 支持导入 Markdown、HTML 和 JSON 备份。
- 支持新建笔记、保存、搜索、插入图片和插入代码块快捷键。

### 本地运行

```bash
npm install --cache ./.npm-cache
npm run dev
```

打开 `http://127.0.0.1:5173/` 查看官网落地页，或打开 `http://127.0.0.1:5173/?app=1` 进入笔记工作区。

### 构建与校验

```bash
npm run lint
npm test
npm run build
npm run verify:release:local
```

`verify:release:local` 会运行本地发布门禁：完整测试、桌面打包，以及打包应用自检。它不能替代在线 Supabase 发布门禁；网络可用时仍需要用真实项目凭据运行 `verify:release:online`。

### 可选账号同步

MarkNote 仍然默认本地优先。只有配置同步配置后端接口后，账号同步才会启用：

```bash
cp .env.example .env.local
```

设置 `VITE_SYNC_CONFIG_URL` 指向你的后端接口。分发应用里不应包含 Supabase 项目信息；这些信息由后端接口保存，并在运行时返回：

```json
{
  "provider": "supabase",
  "supabase": {
    "url": "https://your-project.supabase.co",
    "publishableKey": "sb_publishable_or_anon_key",
    "authRedirectUrl": "http://127.0.0.1:5173/?app=1"
  }
}
```

`VITE_SUPABASE_*` 和 `MARKNOTE_SUPABASE_*` 本地回退配置已被明确禁用。接口只能返回 publishable key，不能返回 Supabase secret/service-role key。publishable key 在客户端运行时可见是正常的，生产环境仍必须依靠 Supabase Auth、RLS 和 Storage policies 保护数据。

GitHub Actions 不读取构建机上的 `.env.local`。要让 macOS/Windows 分发产物启用云同步，请在仓库的 Actions Variables 中设置 `MARKNOTE_SYNC_CONFIG_URL`；工作流会把它作为 `VITE_SYNC_CONFIG_URL` 传给 Vite。未设置时构建仍会成功，但产物明确运行在本地模式。

然后将 `supabase/migrations/202606190001_marknote_sync_schema.sql` 中的 SQL 应用到 Supabase 项目。可以用 `npm run print:supabase-migration` 打印要粘贴到 Supabase SQL Editor 的迁移 SQL。

在 Supabase SQL Editor 中粘贴迁移后，可以用 `npm run print:supabase-readiness-check` 打印只读 readiness 查询，并在同一个 SQL Editor 中执行。每一行都应返回 `ok = true`；然后在本机运行 `npm run verify:release:online:manual`。

如果你有 Supabase personal access token，也可以通过 Management API 应用并校验仓库里的迁移，不必手动打开 SQL Editor：

```bash
SUPABASE_MANAGEMENT_TOKEN=sbp_... npm run check:supabase-migration
SUPABASE_MANAGEMENT_TOKEN=sbp_... npm run apply:supabase-migration
```

`check:supabase-migration` 是 schema readiness gate：它会读取迁移历史，检查五张同步表、`authenticated` grants、RLS 和所需 policies，以及私有 `attachments` bucket 和 Storage policies；后端未就绪时会非零退出。`apply:supabase-migration` 会把仓库里的 SQL 发送到 Supabase Management API，然后再次运行同一组 readiness checks。

在 Google Cloud 中创建 Web application 类型的 OAuth client，并把 Supabase callback URL 加到 Authorized redirect URI：`https://<project-ref>.supabase.co/auth/v1/callback`。然后在 Supabase Auth 中启用 Google provider，填入这个 OAuth Client ID 和 Client Secret。接着把本地和生产 MarkNote URL 加到 Supabase Auth redirect URLs，例如 `http://127.0.0.1:5173/?app=1`。CLI OAuth 发布检查还需要允许 `http://127.0.0.1:**/auth/callback`；如果使用打包后的桌面应用，还要加入 `marknote://auth/callback`。如果 Web 应用不是从当前浏览器 URL 提供服务，请从同步配置接口返回 `supabase.authRedirectUrl`。

在应用里点击登录前，先运行：

```bash
npm run check:google-oauth
npm run check:supabase-sync
```

它会验证已配置的 Supabase 项目 URL 是否可解析、Supabase Auth 的 Google provider 是否会跳转到 Google，以及 Google 是否接受当前 OAuth client。这里如果出现 DNS 失败，说明项目 URL 错误、项目未激活，或当前网络还访问不到；如果出现 `invalid_client`，说明 Supabase Auth 中配置的 Google OAuth Client ID 或 Secret 没有对应到有效的 Google Cloud Web OAuth client。

`check:supabase-sync` 会验证 Supabase 项目可达，并探测 `profiles`、`devices`、`folders`、`notes`、`attachments` 等同步表。MarkNote 同步只面向登录用户，所以匿名探测出现 `PGRST205` 或权限错误可能是正常的；如果把 `SUPABASE_ACCESS_TOKEN` 设置为已登录用户的 access token，脚本还会验证 authenticated 表访问，临时插入/更新/删除 folder/note/attachment 行，以及附件 Storage 的上传、覆盖、下载和删除 canary。

发布验收时，在迁移应用后运行 online gate。它会验证 Google OAuth 配置、Supabase schema readiness、authenticated Data API 写入，以及附件 Storage：

```bash
npm run verify:release:online
```

如果你是在 Supabase SQL Editor 中手动应用迁移，并且本机没有 Supabase personal access token，请运行 manual online gate。它会跳过 Management API 的 schema readiness 检查，用 Google OAuth、authenticated Data API 写入和附件 Storage 证明应用侧链路：

```bash
npm run verify:release:online:manual
```

如果希望门禁先自动应用仓库里的迁移，请带 Supabase personal access token 使用 apply variant：

```bash
SUPABASE_MANAGEMENT_TOKEN=sbp_... npm run verify:release:online:apply
```

CI 或无头环境可以改用新鲜的已登录 access token：

```bash
SUPABASE_ACCESS_TOKEN=eyJ... npm run check:supabase-sync:auth
# CI 也可以设置 MARKNOTE_REQUIRE_SUPABASE_ACCESS_TOKEN=1，并单独提供 SUPABASE_ACCESS_TOKEN。
```

`check:supabase-sync:auth` 缺少 `SUPABASE_ACCESS_TOKEN` 时会失败，避免 authenticated Data API 与 Storage 检查被静默跳过。`check:supabase-sync:oauth` 则通过浏览器登录避免手工复制 token。也可以在 MarkNote 内登录并点击“诊断同步”，用当前应用会话运行已登录表写入和 Storage canary。如果登录后应用内“诊断同步”仍显示 `PGRST205`，有 Supabase personal access token 时先运行 `npm run check:supabase-migration`；然后用该 token 运行 `npm run apply:supabase-migration`，或运行 `npm run print:supabase-migration` 并把 SQL 粘贴到 Supabase SQL Editor，可选地继续运行 `npm run print:supabase-readiness-check` 打印出的 SQL，最后用 `npm run verify:release:online:manual` 验收。

迁移可以在已有 Supabase 项目上重复执行。如果旧表已经存在，后补的外键会以 `NOT VALID` 添加，避免历史孤儿数据中断部署；新的同步写入仍会被外键约束保护。清理旧孤儿数据后，可以按需手动 validate `notes_user_folder_fk` 和 `attachments_user_note_fk`。

同步层使用 adapter 设计。Supabase 是第一版实现，未来迁移到自建 Postgres API、Cloudflare D1/R2 或自托管 Supabase 的方案见 `docs/sync/backend-adapter-plan.md`。

### 桌面应用

```bash
npm run desktop:build
npm run desktop:pack
npm run check:desktop-package
npm run dist:mac
npm run dist:win
```

`desktop:pack` 会在 macOS 上生成未打包发布的 `release/mac/MarkNote.app`。`dist:mac` 会生成可分发的 macOS 压缩包。`dist:win` 配置了 Windows NSIS 安装器和便携版，建议在 Windows 环境或 Windows CI runner 上执行。

`desktop:pack` 后运行 `check:desktop-package`，确认 `release/mac/MarkNote.app` 内含当前前端 bundle、Electron OAuth 回调桥、同步表写入诊断、附件 Storage canary，以及附件水合代码。

当前 macOS 输出：

- `release/mac/MarkNote.app`
- `release/MarkNote-0.1.0-mac-x64.dmg`
- `release/MarkNote-0.1.0-mac-x64.zip`
- `release/MarkNote-0.1.0-mac-arm64.dmg`
- `release/MarkNote-0.1.0-mac-arm64.zip`

本地 macOS 构建未签名，因为当前环境没有可用的 Developer ID 证书。如需公开分发，请使用有效的 Apple Developer ID 证书进行签名和 notarize。

### GitHub Actions 打包

仓库包含 `.github/workflows/desktop-build.yml`。

工作流会在 push、pull request、版本标签（`v*`）和手动触发时运行，并构建上传：

- 来自 `macos-15-intel` 的 macOS Intel 产物
- 来自 `macos-15` 的 macOS Apple Silicon 产物
- 来自 `windows-latest` 的 Windows x64 产物

构建产物会在 workflow run 页面保留 30 天。

### PWA 安装

在 macOS 或 Windows 上，用 Chrome 或 Edge 打开应用地址，并通过地址栏或浏览器菜单中的安装入口安装。安装后的数据会通过 IndexedDB 保留在对应浏览器配置中。
