import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseImportFile, noteToMarkdown } from '../src/lib/importExport';
import { noteHtmlDocument } from '../src/lib/html';
import type { Note } from '../src/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1/',
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  Blob: dom.window.Blob,
  File: dom.window.File,
  FileReader: dom.window.FileReader,
  HTMLImageElement: dom.window.HTMLImageElement,
  HTMLElement: dom.window.HTMLElement,
});

async function main() {
  const base64Png = 'data:image/png;base64,iVBORw0KGgo=';
  const markdown = `# 导入标题

正文图片：

![截图](${base64Png})

\`\`\`javascript
console.log('ok')
\`\`\`
`;
  const file = new File([markdown], 'sample.md', { type: 'text/markdown' });
  const [result] = await parseImportFile(file);

  assert.equal(result.title, '导入标题');
  assert.match(result.content, /<img[^>]+src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(result.content, /<code class="language-javascript">/);

  const note: Note = {
    id: 'note-1',
    title: '导出标题',
    content: result.content,
    rawContent: '',
    createdAt: 1,
    updatedAt: 2,
    tags: ['代码片段'],
    pinned: false,
  };

  const exported = noteToMarkdown(note);
  assert.match(exported, /^# 导出标题/);
  assert.match(exported, /!\[截图\]\(data:image\/png;base64,iVBORw0KGgo=\)/);
  assert.match(exported, /```javascript\nconsole\.log\('ok'\)\n```/);

  const html = noteHtmlDocument(note.title, note.content);
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(html, /data-line-numbers="1/);
  assert.match(html, /hljs-/);

  const backup = new File(
    [
      JSON.stringify({
        version: 1,
        exportedAt: 123,
        notes: [
          {
            id: 'full-note',
            title: '完整备份',
            content: '<p>restore me</p>',
            rawContent: 'restore me',
            createdAt: 10,
            updatedAt: 20,
            tags: ['工作'],
            pinned: true,
            deletedAt: 30,
          },
        ],
      }),
    ],
    'backup.json',
    { type: 'application/json' },
  );
  const [restored] = await parseImportFile(backup);
  assert.equal(restored.note?.id, 'full-note');
  assert.equal(restored.note?.pinned, true);
  assert.equal(restored.note?.createdAt, 10);
  assert.equal(restored.note?.updatedAt, 20);
  assert.equal(restored.note?.deletedAt, 30);
  assert.deepEqual(restored.note?.tags, ['工作']);

  console.log('import/export tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
