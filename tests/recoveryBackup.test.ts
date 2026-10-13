import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { db, MarkNoteDatabase } from '../src/lib/db';
import { createRecoveryPackage } from '../src/lib/recoveryBackup';
import { buildRestorePlan, parseImportFile, parseImportPackage, restoreImportPackage } from '../src/lib/importExport';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, File: dom.window.File });

async function main() {
  await db.delete(); await db.open();
  const content = '<p>sole orphan rescue text</p><img src="marknote-attachment://missing" alt="lost picture" data-attachment-id="missing" onerror="window.canary=1"><script>window.canary=1</script>';
  await db.editorDrafts.bulkPut([
    { id: 'orphan:editor-a', editorId: 'editor-a', noteId: 'orphan', title: 'Foreign A', content, updatedAt: 10, revision: 10, baseVersion: 2, accessToken: 'not-a-real-token' } as never,
    { id: 'orphan:editor-b', editorId: 'editor-b', noteId: 'orphan', title: 'Foreign B', content: '<p>second same-ms editor</p>', updatedAt: 10, revision: 10, baseVersion: 2 },
  ]);
  await db.drafts.put({ noteId: 'orphan', title: 'Legacy candidate', content: '<p>legacy orphan body</p>', updatedAt: 10, revision: 10 });
  const memory = [{ noteId: 'memory-only', title: 'Memory candidate', content: '<p>only memory body</p>', updatedAt: 10, revision: 10, secret: 'not-a-real-secret' }];
  const before = await rawBusinessState();
  const recovery = await createRecoveryPackage(db, memory);
  assert.equal(recovery.complete, false);
  assert.equal(recovery.notes.length, 4, 'same millisecond never deduplicates independent draft sources');
  assert.equal(recovery.recovery.editorDrafts.length, 2);
  assert.equal(recovery.recovery.legacyDrafts.length, 1);
  assert.equal(recovery.recovery.memoryDrafts.length, 1);
  assert.equal(recovery.recovery.editorDrafts[0].content, content, 'original source bytes retained for later repair');
  assert.equal(recovery.recovery.missingMediaCount, 1);
  assert.match(recovery.warnings[0], /不是完整 V2 备份/);
  assert.match(recovery.notes.find((note) => note.title.startsWith('Foreign A'))!.content, /sole orphan rescue text/);
  assert.match(recovery.notes.find((note) => note.title.startsWith('Foreign A'))!.content, /媒体缺失/);
  assert.equal(new Set(recovery.notes.map((note) => note.id)).size, 4);
  assert.equal(recovery.notes.some((note) => ['orphan', 'memory-only'].includes(note.id)), false);
  for (const note of recovery.notes) assert.doesNotMatch(note.content, /<script|onerror=|marknote-attachment:\/\/|data-attachment-id/);
  const text = JSON.stringify(recovery);
  assert.equal(text.includes('not-a-real-token'), false);
  assert.equal(text.includes('not-a-real-secret'), false);
  assert.equal((dom.window as unknown as { canary?: number }).canary, undefined);
  assert.deepEqual(await rawBusinessState(), before, 'rescue export neither creates recovered copies nor consumes persisted drafts');
  const file = new File([text], 'marknote-recovery.json', { type: 'application/json' });
  const flat = await parseImportFile(file);
  assert.equal(flat.length, 4);
  assert.ok(flat.some((item) => item.content.includes('sole orphan rescue text')));
  const parsed = await parseImportPackage(file);
  await restoreImportPackage(buildRestorePlan(parsed));
  assert.equal(await db.notes.count(), 4);
  assert.equal(await db.editorDrafts.count(), 2, 'import must leave original foreign candidates intact');

  const data = 'data:image/png;base64,aGVsbG8=';
  await db.notes.add({ id: 'available-note', title: 'Saved image', content: '<p>available bytes</p><img src="marknote-attachment://available-image" data-attachment-id="available-image">', folderId: 'folder-library', createdAt: 1, updatedAt: 2, tags: [], pinned: false });
  await db.images.add({ id: 'available-image', noteId: 'available-note', data, mimeType: 'image/png', storagePath: 'signed-path-must-not-export', sizeBytes: 5 });
  const withMedia = await createRecoveryPackage(db);
  const restoredImage = withMedia.notes.find((note) => note.title === 'Saved image')!;
  assert.match(restoredImage.content, /src="data:image\/png;base64,aGVsbG8="/);
  assert.doesNotMatch(restoredImage.content, /marknote-attachment|data-attachment-id/);
  assert.equal(withMedia.recovery.attachments[0].data, data);
  assert.equal(JSON.stringify(withMedia).includes('signed-path-must-not-export'), false);
  assert.deepEqual((await parseImportFile(new File([JSON.stringify(withMedia)], 'media-recovery.json', { type: 'application/json' }))).find((item) => item.title === 'Saved image')?.content, restoredImage.content);
  const foreign = new MarkNoteDatabase('different-recovery-workspace');
  await assert.rejects(createRecoveryPackage(foreign), /空间已切换/);
  foreign.close();
  await db.delete();
  console.log('emergency read-only recovery export tests passed (orphan/foreign/legacy/memory, missing media, import, no credentials)');
}

async function rawBusinessState() {
  const [notes, folders, images, history, legacyDrafts, editorDrafts] = await Promise.all([db.notes.toArray(), db.folders.toArray(), db.images.toArray(), db.noteHistory.toArray(), db.drafts.toArray(), db.editorDrafts.toArray()]);
  return { notes, folders, images, history, legacyDrafts, editorDrafts };
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
