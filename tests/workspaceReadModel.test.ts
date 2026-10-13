import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { MarkNoteDatabase } from '../src/lib/db';
import { readAttachmentSummaries, readNoteSummaries } from '../src/lib/workspaceReadModel';
import type { ImageAttachment, Note } from '../src/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, { DOMParser: dom.window.DOMParser });

async function main() {
  const database = new MarkNoteDatabase('test-workspace-read-model');
  const bytes = 'aGVsbG8=';
  const media = `data:image/png;base64,${bytes}`;
  const notes: Note[] = Array.from({ length: 1000 }, (_, index) => ({
    id: `note-${index}`, title: `笔记 ${index}`, folderId: 'folder-library',
    content: `<p>正文 ${index}</p><img src="${media}" data-attachment-id="image-${index}"><pre><code class="language-typescript" onclick="bad()">${'code'.repeat(250)} &lt;script&gt;safe&lt;/script&gt;</code></pre>`,
    rawContent: `正文 ${index} ${'code'.repeat(250)} 搜索完整尾部`,
    tags: ['tag'], pinned: index === 0, createdAt: 1, updatedAt: 2, version: 3,
  }));
  const attachments: ImageAttachment[] = notes.map((note, index) => ({
    id: `image-${index}`, noteId: note.id, data: media, mimeType: 'image/png', sizeBytes: 999,
    createdAt: 1, updatedAt: 2, deletedAt: index === 999 ? 3 : null, storagePath: `object/${index}`, version: 4,
  }));
  await database.notes.bulkAdd(notes);
  await database.images.bulkAdd(attachments);
  const summaries = await readNoteSummaries(database);
  const attachmentSummaries = await readAttachmentSummaries(database);
  assert.equal(summaries.length, 1000);
  assert.equal(attachmentSummaries.length, 1000);
  assert.equal(JSON.stringify(summaries).includes(media), false, 'React note lists must not hold media payloads');
  assert.equal(JSON.stringify(attachmentSummaries).includes(bytes), false, 'React attachment lists must not hold Base64');
  const first = summaries.find((note) => note.id === 'note-0')!;
  assert.equal(first.rawContent, notes[0].rawContent, 'full-text search stays complete despite preview truncation');
  assert.match(first.content, /<code class="language-typescript">/);
  assert.doesNotMatch(first.content, /onclick|<img|<script/);
  assert.ok(first.content.length < 2500, 'code previews have a bounded representation');
  assert.equal(first.version, 3);
  assert.equal(first.pinned, true);
  assert.equal(attachmentSummaries.find((attachment) => attachment.id === 'image-0')?.sizeBytes, 5, 'actual bytes override stale capacity metadata');
  assert.equal(attachmentSummaries.find((attachment) => attachment.id === 'image-999')?.deletedAt, 3);

  // The separately selected record still has its original content and media.
  const selected = await database.notes.get('note-0');
  assert.equal(selected?.content, notes[0].content);
  assert.equal((await database.images.get('image-0'))?.data, media);
  await database.notes.put({ ...notes[0], id: 'no-search-cache', rawContent: undefined, content: `<p>未缓存正文</p><img src="${media}">` });
  const uncached = (await readNoteSummaries(database)).find((note) => note.id === 'no-search-cache')!;
  assert.equal(uncached.rawContent, '未缓存正文');
  assert.equal(uncached.content, '');
  await database.notes.put({ ...notes[0], id: 'empty-search-cache', rawContent: '', content: '<p>空缓存也保留完整搜索文本</p>' });
  const emptyCached = (await readNoteSummaries(database)).find((note) => note.id === 'empty-search-cache')!;
  assert.equal(emptyCached.rawContent, '空缓存也保留完整搜索文本');
  const maliciousCode = { ...notes[0], id: 'malicious-code', content: '<pre><code class="language-javascript" onerror="bad()">&lt;img src=x onerror=bad()&gt;</code></pre>'.repeat(20) };
  await database.notes.put(maliciousCode);
  const bounded = (await readNoteSummaries(database)).find((note) => note.id === 'malicious-code')!;
  const preview = new DOMParser().parseFromString(bounded.content, 'text/html');
  assert.equal(preview.querySelectorAll('pre code').length, 5);
  assert.equal(preview.querySelector('img'), null);
  assert.equal(preview.querySelector('[onerror]'), null);
  database.close();
  console.log('workspace lightweight read-model tests passed (1000 note/attachment records)');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
