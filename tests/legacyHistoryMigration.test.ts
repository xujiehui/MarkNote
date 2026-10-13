import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { createBackupPackage, parseJsonImportPackage, readBackupData } from '../src/lib/backup';
import { attachmentRefUrl } from '../src/lib/attachmentContent';
import { createImageAttachment, createNote, db, ensureDefaultFolders, getEditorDrafts, migrateLegacyNoteHistory, recoverAllEditorDrafts, saveEditorDraft } from '../src/lib/db';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://marknote.test/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, HTMLElement: dom.window.HTMLElement });

async function main() {
  await db.delete();
  await db.open();
  await ensureDefaultFolders();
  const live = await createNote({ id: 'live-note', title: 'Current', content: '<p>Keep current content</p>' });
  const lost = await createImageAttachment({ id: 'old-orphan-image', noteId: 'previously-purged-note',
    data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' });
  await saveEditorDraft({ noteId: 'previously-purged-note', title: 'Unsaved orphan draft',
    content: `<p>Unsaved after old history</p><img src="${attachmentRefUrl(lost.id)}">`, revision: 1, updatedAt: 3 }, 'old-editor');
  const source = JSON.stringify({
    [live.id]: [{ id: 'live-version', title: 'Earlier live version', content: '<p>Live history</p>', createdAt: 1 }],
    'previously-purged-note': [
      { id: 'older', title: 'Old note', content: `<p>Older picture</p><img data-attachment-id="${lost.id}" src="${lost.data}">`, createdAt: 1 },
      { id: 'latest', title: 'Latest removed version', content: `<p>Latest picture</p><img src="${attachmentRefUrl(lost.id)}">`, createdAt: 2 },
    ],
  });
  dom.window.localStorage.setItem('marknote-note-snapshots', source);
  await migrateLegacyNoteHistory();
  assert.equal((await db.notes.get(live.id))?.content, live.content, 'live note migration never replaces current content');
  assert.equal(await db.notes.get('previously-purged-note'), undefined, 'purged original IDs are never resurrected');
  const recovered = (await db.notes.filter((note) => note.title.includes('（历史恢复）')).toArray())[0];
  assert.ok(recovered, 'orphan history becomes an explicitly named fresh note');
  assert.match(recovered.content, /Latest picture/);
  assert.equal(await db.noteHistory.where('noteId').equals(recovered.id).count(), 2);
  assert.equal(await db.noteHistory.where('noteId').equals('previously-purged-note').count(), 0);
  assert.equal(await db.images.where('noteId').equals('previously-purged-note').count(), 0, 'orphan source metadata cannot poison future backups');
  assert.ok((await db.syncQueue.where('[entity+entityId]').equals(['attachment', lost.id]).first())?.snapshot, 'old outbox metadata remains recoverable');
  const draftRecoveryId = (await getEditorDrafts('previously-purged-note'))[0]?.recoveredNoteId;
  assert.ok(draftRecoveryId, 'migration atomically recovers orphan drafts before removing their source attachment IDs');
  const draftCopy = (await db.notes.get(draftRecoveryId))!;
  assert.match(draftCopy.content, /Unsaved after old history/);
  const draftImageId = new DOMParser().parseFromString(draftCopy.content, 'text/html').querySelector('img')!.getAttribute('data-attachment-id')!;
  assert.notEqual(draftImageId, lost.id);
  assert.equal((await db.images.get(draftImageId))?.data, lost.data);
  const startupAfterMigration = await recoverAllEditorDrafts('fresh-startup-editor');
  assert.deepEqual(startupAfterMigration.errors, [], 'migration-first startup order cannot create missing-byte draft failures');
  assert.deepEqual(startupAfterMigration.recoveredNoteIds, [], 'already saved migration recovery is idempotent');
  const payload = await createBackupPackage(await readBackupData());
  const parsed = await parseJsonImportPackage(JSON.stringify(payload));
  assert.equal(parsed.notes.length, 3);
  assert.equal(parsed.history.length, 3);
  assert.ok(parsed.attachments.every((attachment) => parsed.notes.some((note) => note.id === attachment.noteId)));
  await migrateLegacyNoteHistory();
  assert.equal(await db.notes.count(), 3, 'migration is idempotent after creating recovery notes');
  assert.equal(dom.window.localStorage.getItem('marknote-note-snapshots'), source, 'original browser source remains untouched for recovery');

  await db.delete();
  await db.open();
  await ensureDefaultFolders();
  await createNote({ id: 'healthy-current', content: '<p>Healthy current note</p>' });
  const broken = JSON.stringify({ orphan: [{ id: 'broken', title: 'Missing bytes', content: '<img src="marknote-attachment://gone">', createdAt: 1 }] });
  dom.window.localStorage.setItem('marknote-note-snapshots', broken);
  await assert.rejects(() => migrateLegacyNoteHistory(), /附件字节缺失/);
  assert.equal(await db.noteHistory.count(), 0, 'failed orphan migration cannot insert invalid business history');
  assert.equal(await db.notes.count(), 1);
  assert.equal(dom.window.localStorage.getItem('marknote-note-snapshots'), broken);
  assert.equal((await createBackupPackage(await readBackupData())).notes.length, 1, 'a failed orphan recovery cannot block healthy current-data backups');
  console.log('legacy history migration tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { db.close(); });
