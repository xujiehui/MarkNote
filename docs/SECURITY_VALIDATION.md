# 安全验证记录

审查日期：2026-10-13（Asia/Shanghai）。本记录针对当前 `package-lock.json` 和本轮整改代码；锁文件 SHA-256、工具版本及依赖路径见 [audit-context.json](security-validation/audit-context.json)。

## 依赖审计

在最终 `npm ci` 完成后复核依赖树，`npm ls` 正常退出。审计使用 npm 官方漏洞数据，保留原始 JSON，未执行自动修复或修改依赖。

```sh
npm audit --omit=dev --json --cache /workspace/.npm-cache
npm audit --json --cache /workspace/.npm-cache
npm ls electron-builder app-builder-lib @electron/get global-agent roarr sprintf-js --all --json --cache /workspace/.npm-cache
```

| 范围 | critical | high | moderate | low / info | 受影响包条目 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 生产 npm 依赖 | 0 | 0 | 0 | 0 | 0 |
| 全部 npm 依赖 | 0 | 0 | 8 | 0 | 8 |

原始结果：[生产依赖](security-validation/npm-audit-production.json)、[全部依赖](security-validation/npm-audit-all.json)、[实际依赖路径](security-validation/dependency-paths.json)。生产审计退出码为 0；全部依赖审计因 moderate 条目退出 1，是审计发现问题的正常状态。

8 个 moderate 包条目来自同一公告 [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)：`sprintf-js` 对超大精度格式字符串缺少边界，可能引起拒绝服务。条目包含沿依赖链传播的上游包，不能解释为 8 个独立漏洞。

锁文件中的主要路径：

```text
electron-builder@26.15.3 [dev]
└─ app-builder-lib@26.15.3 [dev]
   └─ @electron/get@3.1.0 [dev]
      └─ global-agent@3.0.0 [optional, dev]
         └─ roarr@2.15.4 [optional, dev]
            └─ sprintf-js@1.1.3 [optional, dev]
```

### 构建依赖例外记录

此项保留为桌面构建链的临时技术例外，责任角色为发布负责人，复查期限为 2026-10-27。例外范围只包含上述构建依赖，不扩大到应用生产依赖。当前未找到笔记正文、导入文件或分享输入进入该格式字符串 API 的应用调用链；这不构成构建过程不可利用的证明。`roarr` 本身存在把调用参数作为格式字符串传给 `sprintf` 的分支，构建任务仍应使用隔离执行环境和受信任的发布输入。

优先跟进 `electron-builder` / `@electron/get` 的兼容更新，或单独验证受影响传递依赖的修复版本。npm 自动修复建议涉及桌面构建工具版本变化，不能在缺少 Mac/Windows 打包回归的情况下直接采用。出现高危公告、生产路径变化或期限到期时，重新评估例外。此记录不替代正式发布审批。

## 内容与桌面边界

已验证以下行为：

- DOMPurify 清洗 HTML 标签、事件属性、危险协议、SVG/MathML、嵌入文档和资源型样式；重复清洗结果稳定。合法任务、代码、图片、音视频、文件下载和独立附件引用保留。
- URL 与数据 MIME 分类校验拒绝 JavaScript、本地文件、HTML/SVG 数据附件、凭据 URL、跨源 blob 和畸形附件引用；单附件限制为 20 MiB。
- HTML/Markdown/JSON 导入、编辑器粘贴、数据库写入、历史/草稿、远端正文和导出使用清洗边界。HTML 标题转义；代码高亮只处理文本。
- 导出 HTML 的 CSP 禁止脚本。PDF 在 `sandbox="allow-same-origin"` 的 `srcdoc` iframe 内渲染，没有 `allow-scripts`、表单或弹窗权限。
- Electron 外链统一限制为 HTTP(S)/mailto；IPC 校验实际 WebContents、主 frame 和应用 URL；外部导航、嵌入网页和不必要权限受到限制。生产构建包含 CSP，开发构建保留 Vite 所需兼容性。
- 生产 CSP 允许 HTTPS/WSS 连接与 HTTPS 图片/媒体，以支持用户配置的同步服务；当前不按具体服务域名进一步收紧。内联样式用于编辑器布局，内联脚本和 `unsafe-eval` 均未开放。

回归证据：[contentSecurity.test.ts](../tests/contentSecurity.test.ts)、[electronSecurity.test.ts](../tests/electronSecurity.test.ts)。内容测试还在不执行 CSP 的 JSDOM 中触发可能保留的事件，确认生成内容未执行攻击标记；桌面测试覆盖外链、IPC 主 frame、导航 URL、权限和 PDF 预览策略的判定逻辑。

另外使用独立 Chromium profile，在带生产 CSP 的本机测试页面验证了 sandbox PDF iframe 与 html2canvas 兼容：成功生成 540×174 canvas；故意保留的脚本和 `onerror` 未能修改父页面标记。这验证了浏览器 CSP/iframe 组合，不等同于原生 Electron 事件链验收。

## 验证边界与发布前检查

当前清洗器、Electron 策略回归、相关导入/备份回归、代码检查和 Electron TypeScript 编译通过；在已检查的内容执行与 IPC 策略路径中未发现新的立即可利用问题。此前发现的跨标签页草稿、冲突附件、远端删除和 SQL 路径通配问题属于数据可靠性或协议边界，另由对应整改测试覆盖。

以下检查仍是正式发布前置：

1. 在 macOS/Windows 运行真实桌面包，验证导航、IPC 发起 frame、权限回调、正常外链、OAuth 回调、PDF/下载和窗口缩放。
2. 验证桌面安装、签名、升级以及实际 ASAR 的文件/依赖组成；编译通过和 npm 生产审计为 0 都不能代替此检查。
3. 在隔离 Supabase 项目使用两个真实账号验证 JWT/RLS/RPC、存储操作和迁移。模拟接口与独立 PostgreSQL 验证不覆盖实际托管认证和存储配置。

生产审计为 0 只表示当前 npm 公告库未报告生产 JavaScript 依赖漏洞，不保证应用没有逻辑漏洞，也不涵盖操作系统或打包后的 Electron/Chromium 二进制的全部安全状态。
