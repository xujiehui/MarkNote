# MarkNote 2.0 Product Design Spec

版本：V2.0  
设计基准：Desktop 1920 x 1080  
产品定位：AI 增强型 Markdown 笔记与知识管理平台  
参考产品：Notion、Obsidian、Craft、Linear

## 1. 产品定位

MarkNote 2.0 面向程序员、产品经理、设计师、内容创作者和知识工作者，提供一个内容优先、快速记录、结构化管理、AI 辅助创作的现代化知识管理工具。

核心理念：

```text
Write Once
Keep Everywhere

内容优先
快速记录
结构化管理
AI辅助创作
```

## 2. 信息架构

一级导航：

```text
全部笔记
资料库
代码片段
归档
回收站
```

标签系统：

```text
工作
个人
代码
学习
灵感
项目
读书
会议
AI
设计
```

标签能力：

- 新建标签
- 修改颜色
- 合并标签
- 删除标签

数据层级：

```text
Workspace
 ├ Folder
 │   ├ Note
 │   ├ Note
 │   └ Note
 │
 └ Tags
      ├ 工作
      ├ 学习
      └ AI
```

## 3. 页面布局

MarkNote 2.0 使用三栏桌面工作台，并在顶部保留全局导航。

```text
┌────────────────────────────────────────────┐
│ Top Navigation                             │
├──────────┬──────────────┬──────────────────┤
│ Sidebar  │ Note List    │ Editor           │
│ 240px    │ 360px        │ Auto             │
└──────────┴──────────────┴──────────────────┘
```

尺寸：

```css
.sidebar {
  width: 240px;
}

.note-list {
  width: 360px;
}

.editor {
  flex: 1;
  min-width: 800px;
}

.page-padding {
  padding: 24px;
}
```

响应式：

- `>= 1920px`：完整三栏布局。
- `1440px - 1919px`：三栏布局，Sidebar 可缩窄至 220px。
- `1024px - 1439px`：Sidebar 支持折叠。
- `<= 1024px`：移动端模式，优先显示当前任务面板。

## 4. Design Token

### Color System

Primary：

```css
--primary-50: #eff6ff;
--primary-100: #dbeafe;
--primary-200: #bfdbfe;
--primary-300: #93c5fd;
--primary-400: #60a5fa;
--primary-500: #3b82f6;
--primary-600: #2563eb;
--primary-700: #1d4ed8;
```

Neutral：

```css
--gray-50: #fafafa;
--gray-100: #f3f4f6;
--gray-200: #e5e7eb;
--gray-300: #d1d5db;
--gray-400: #9ca3af;
--gray-500: #6b7280;
--gray-600: #4b5563;
--gray-700: #374151;
--gray-800: #1f2937;
--gray-900: #111827;
```

Semantic：

```css
--success: #22c55e;
--warning: #f59e0b;
--error: #ef4444;
--info: #3b82f6;
```

Dark Theme：

```css
--dark-background: #0f172a;
--dark-sidebar: #111827;
--dark-card: #1f2937;
--dark-border: #374151;
--dark-text: #f9fafb;
--dark-primary: #60a5fa;
```

## 5. Typography

中文字体：

```css
font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
```

代码字体：

```css
font-family: "JetBrains Mono", monospace;
```

字体层级：

```css
.h1 {
  font-size: 40px;
  font-weight: 700;
  line-height: 1.2;
}

.h2 {
  font-size: 32px;
  font-weight: 700;
}

.h3 {
  font-size: 24px;
  font-weight: 600;
}

.body {
  font-size: 18px;
  line-height: 1.8;
}

.caption {
  font-size: 12px;
}
```

## 6. Sidebar

Logo 区高度为 `72px`，结构为：

```text
[M] MarkNote
Workspace Pro
```

交互：

- 点击 Logo 返回首页。
- 点击 Workspace 切换工作区。

搜索框高度为 `44px`，支持全文搜索、标签搜索、代码搜索和文件搜索。快捷键为 `Cmd + K` 和 `Ctrl + K`。搜索结果分为最近访问、匹配笔记、匹配标签、匹配代码块。

## 7. Note List

顶部工具区包含标题、记录数、排序、筛选和新建入口。

排序：

- 更新时间
- 创建时间
- 标题
- 收藏数

筛选：

- 标签
- 收藏
- 归档
- 最近 7 天
- 最近 30 天

## 8. Note Card

卡片结构：

```text
标题
摘要（2行）
时间
标签
```

状态：

```css
.note-card {
  background: #ffffff;
}

.note-card:hover {
  transform: translateY(-2px);
}

.note-card.is-active {
  border-left: 4px solid var(--primary-500);
}

.note-card.is-selected {
  background: #eff6ff;
}
```

右上角菜单：

- 固定
- 收藏
- 复制
- 导出
- 删除

## 9. Editor

编辑器布局：

```text
标题
标签
正文
```

正文区域：

```css
.editor-canvas {
  max-width: 900px;
  margin: auto;
}
```

## 10. 编辑器工具栏

一级工具：

- Bold
- Italic
- Underline
- Strikethrough

标题：

- H1
- H2
- H3

内容：

- List
- Checklist
- Quote
- Divider

富媒体：

- Image
- Video
- Audio
- File

数据：

- Table
- Code
- Math
- Mermaid

## 11. Slash Command

输入 `/` 弹出命令菜单。菜单内容：

- Text
- Heading
- Todo
- Image
- Video
- Table
- Code
- Quote
- Callout
- Divider
- Mermaid
- Math

搜索支持模糊匹配和快捷键导航。

## 12. Markdown 能力

MarkNote 2.0 支持常用 Markdown 结构并实时渲染：

```markdown
#
##
###

- List

1. Ordered List

> Quote

```js
console.log()
```
```

## 13. 代码块系统

代码块 Header：

```text
JavaScript
复制
折叠
```

复制后显示 `已复制`，持续 `2000ms`。

支持语言：

```text
JavaScript
TypeScript
Python
Go
Rust
Java
C#
SQL
HTML
CSS
JSON
```

## 14. 图片系统

上传方式：

- 拖拽
- 粘贴
- 选择文件

上传中显示进度条和百分比。点击图片出现预览、替换、下载和删除操作。

## 15. AI 功能区

编辑器右上角提供 `AI` 按钮，点击展开：

- 续写
- 总结
- 润色
- 翻译
- 生成标题
- 生成大纲
- 提取待办

支持选中文本后进行 AI 处理。

## 16. 自动保存

停止输入 `1s` 后自动保存。状态显示：

- 保存中...
- 已保存
- 同步失败

同步失败时显示重新同步入口。

## 17. 历史版本

自动快照触发频率为每 `5min`。历史版本分组：

- 今天
- 昨天
- 7 天内
- 30 天内

能力：

- 对比版本
- 恢复版本
- 复制版本

## 18. 分享系统

分享类型：

- 私密
- 公开
- 团队

公开分享链接格式：

```text
https://marknote.app/share/xxxxx
```

权限：

- 只读
- 评论
- 编辑

## 19. 动画规范

Duration：

```css
150ms
200ms
300ms
```

交互：

```css
.hover {
  transition-timing-function: ease-out;
}

.modal {
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}

.page-transition {
  transition-duration: 250ms;
}
```

## 20. 推荐技术架构

```yaml
Frontend:
  Next.js 15
  TypeScript
  TailwindCSS
  shadcn/ui

Editor:
  Tiptap

Markdown:
  remark
  rehype

Syntax Highlight:
  Shiki

Animation:
  Framer Motion

State:
  Zustand

Local Database:
  IndexedDB
  Dexie

Cloud Sync:
  Supabase

Storage:
  S3 Compatible

AI:
  OpenAI API
```

当前实现说明：现有 MarkNote 仓库使用 Vite + React + TypeScript + TailwindCSS + Tiptap + Dexie + Supabase 适配层。2.0 UI 改版优先在现有架构内落地三栏工作台、设计 Token、编辑器工具栏、AI 入口、自动保存状态和分享/历史入口，后续再按需要迁移到 Next.js 15。

## 21. 产品体验目标

性能指标：

```yaml
首次加载: < 1.5s
编辑响应: < 16ms
搜索响应: < 100ms
同步: < 500ms
```

用户体验指标：

```yaml
零学习成本: ★★★★★
写作流畅度: ★★★★★
视觉层级: ★★★★★
AI辅助能力: ★★★★★
专业感: ★★★★★
```

最终目标：打造一个具备 Notion 的内容组织能力、Obsidian 的知识管理能力、Craft 的视觉体验、Linear 的交互品质和 Cursor 的 AI 效率的新一代 AI 笔记平台。
