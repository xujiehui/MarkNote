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
```

### Optional Account Sync

MarkNote is still local-first by default. Account sync is enabled only when Supabase environment variables are present:

```bash
cp .env.example .env.local
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then apply the SQL in `supabase/migrations/202606190001_marknote_sync_schema.sql` to your Supabase project.

The sync layer is adapter-based. Supabase is the first implementation, and the migration plan for custom Postgres APIs, Cloudflare D1/R2, or self-hosted Supabase lives in `docs/sync/backend-adapter-plan.md`.

### Desktop App

```bash
npm run desktop:build
npm run desktop:pack
npm run dist:mac
npm run dist:win
```

`desktop:pack` creates an unpacked app under `release/mac/MarkNote.app` on macOS. `dist:mac` creates distributable macOS archives. `dist:win` is configured for Windows NSIS and portable builds and should be run on Windows or a CI runner with Windows packaging support.

Current macOS outputs:

- `release/mac/MarkNote.app`
- `release/MarkNote-0.1.0.dmg`
- `release/MarkNote-0.1.0-mac.zip`

The local macOS build is unsigned because no valid Developer ID certificate is available in this environment. For public distribution, sign and notarize with an active Apple Developer ID certificate.

### GitHub Actions Packaging

The repository includes `.github/workflows/desktop-build.yml`.

It runs on pushes, pull requests, version tags (`v*`), and manual workflow dispatch. The workflow builds and uploads:

- macOS Intel artifacts from `macos-15-intel`
- macOS Apple Silicon artifacts from `macos-15`
- Windows x64 artifacts from `windows-latest`

Artifacts are available from the workflow run page for 14 days.

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
```

### 可选账号同步

MarkNote 仍然默认本地优先。只有配置 Supabase 环境变量后，账号同步才会启用：

```bash
cp .env.example .env.local
```

设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`，然后将 `supabase/migrations/202606190001_marknote_sync_schema.sql` 中的 SQL 应用到 Supabase 项目。

同步层使用 adapter 设计。Supabase 是第一版实现，未来迁移到自建 Postgres API、Cloudflare D1/R2 或自托管 Supabase 的方案见 `docs/sync/backend-adapter-plan.md`。

### 桌面应用

```bash
npm run desktop:build
npm run desktop:pack
npm run dist:mac
npm run dist:win
```

`desktop:pack` 会在 macOS 上生成未打包发布的 `release/mac/MarkNote.app`。`dist:mac` 会生成可分发的 macOS 压缩包。`dist:win` 配置了 Windows NSIS 安装器和便携版，建议在 Windows 环境或 Windows CI runner 上执行。

当前 macOS 输出：

- `release/mac/MarkNote.app`
- `release/MarkNote-0.1.0.dmg`
- `release/MarkNote-0.1.0-mac.zip`

本地 macOS 构建未签名，因为当前环境没有可用的 Developer ID 证书。如需公开分发，请使用有效的 Apple Developer ID 证书进行签名和 notarize。

### GitHub Actions 打包

仓库包含 `.github/workflows/desktop-build.yml`。

工作流会在 push、pull request、版本标签（`v*`）和手动触发时运行，并构建上传：

- 来自 `macos-15-intel` 的 macOS Intel 产物
- 来自 `macos-15` 的 macOS Apple Silicon 产物
- 来自 `windows-latest` 的 Windows x64 产物

构建产物会在 workflow run 页面保留 14 天。

### PWA 安装

在 macOS 或 Windows 上，用 Chrome 或 Edge 打开应用地址，并通过地址栏或浏览器菜单中的安装入口安装。安装后的数据会通过 IndexedDB 保留在对应浏览器配置中。
