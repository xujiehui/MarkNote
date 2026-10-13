# 本地搜索索引

工作区可以用 `useIndexedSearch(records, query)` 将全文匹配移到专用 Worker。输入是不可变且通过 `useMemo` 保持引用稳定的 `{ id, text, version? }[]`；`text` 应由已准备好的正文文本、标题、标签、文件夹名称等组成，避免每次键入时解析 HTML 或复制媒体数据。

在 Vite 入口配置一次 Worker 创建器：

```ts
configureSearchWorker(() => new Worker(
  new URL('./workers/search.worker.ts', import.meta.url),
  { type: 'module' },
));
```

返回值的含义：

- `matches === null && pending === false`：查询为空；继续原有文件夹/标签等筛选。
- `matches === null && pending === true`：新查询或新数据尚未完成；显示加载状态，不用旧命中集合或重新执行逐篇 HTML 全文扫描。
- `matches instanceof Set && pending === false`：当前数据与查询的命中笔记 ID；列表顺序仍由原有排序决定。

匹配保留原有 `trim().toLowerCase().includes(...)` 语义，支持中文、部分词和连续跨词子串，保持重音敏感；没有增加分词、模糊匹配、去重音或服务端搜索。

同一记录数组的查询变化只传输查询，不遍历或重新发送全部索引。记录发生变化时，主线程计算增量，只发送新增/修改项和删除 ID。Worker 预先保存小写文本，并在扫描每 500 项后让出执行权；新的查询或索引更新会取消旧扫描。结果必须同时匹配索引 generation 与查询 sequence，旧结果不能覆盖当前界面。Hook 在收到新 props 的第一次渲染就隐藏旧结果，覆盖发送新消息之前的窗口。

Worker 不可用、创建失败、发生加载/消息错误时，使用同一子串索引在本机同步回退。组件卸载会终止 Worker 并清空索引；账号空间切换应保持原有按空间 key 重建组件的行为。Worker 不连接网络，不持久化笔记；生产构建预缓存其静态代码，笔记数据不会因此进入响应缓存。

验证包含真实索引增改删、序号/代次交叉过期结果、StrictMode 清理、不可用回退及 10,000 项扫描的分批取消。该测试证明正确性和取消行为，未证明任意设备上的性能预算。数据库读模型的首次全表读取、摘要构建、应用排序以及侧边栏代码预览仍须单独测量和优化；不能把增加 Worker 当作所有大库性能问题已经解决。
