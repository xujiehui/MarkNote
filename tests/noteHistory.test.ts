import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import { addNoteHistory, createImageAttachment, createNote, db, getNoteHistory, hydrateNoteHistoryContent, migrateLegacyNoteHistory, permanentlyDeleteNote, updateImageAttachment, updateNote } from '../src/lib/db';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://marknote.test/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, HTMLElement: dom.window.HTMLElement });

async function main() {
  await db.delete();
  await db.open();
  const note = await createNote({ id: 'history-note', content: '<p>Original</p>' });
  await addNoteHistory({ id: 'first', noteId: note.id, title: note.title, content: note.content, createdAt: 1 });
  await addNoteHistory({ id: 'duplicate', noteId: note.id, title: note.title, content: note.content, createdAt: 310_001 });
  assert.equal((await getNoteHistory(note.id)).length, 1, 'identical content does not consume a history slot');
  await addNoteHistory({ id: 'same-window', noteId: note.id, title: note.title, content: '<p>Newer</p>', createdAt: 2 });
  assert.equal((await getNoteHistory(note.id))[0]?.id, 'first', 'automatic history keeps the pre-edit version in a five minute window');
  await addNoteHistory({ id: 'forced', noteId: note.id, title: note.title, content: '<p>Forced</p>', createdAt: 3 }, { force: true });
  assert.equal((await getNoteHistory(note.id)).length, 2, 'explicit restore checkpoints are retained immediately');

  const image = await createImageAttachment({ id: 'historical-image', noteId: note.id,
    data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png', storagePath: 'a/historical-image' });
  const original = `<p>With picture</p><img data-attachment-id="${image.id}" src="${image.data}">`;
  await updateNote(note.id, { content: original });
  await addNoteHistory({ id: 'picture-version', noteId: note.id, title: note.title, content: original, createdAt: 4 }, { force: true });
  const historicalVersion = (await db.noteHistory.get('picture-version'))!;
  assert.doesNotMatch(historicalVersion.content, /data:image/);
  const historyImageId = new DOMParser().parseFromString(historicalVersion.content, 'text/html').querySelector('img')!.getAttribute('data-attachment-id')!;
  assert.notEqual(historyImageId, image.id, 'immutable saved bytes are independent of mutable current attachment metadata');
  assert.equal((await db.images.get(historyImageId))?.data, image.data);
  assert.equal((await db.images.get(historyImageId))?.historyOnly, true);
  await updateImageAttachment(image.id, { data: 'data:image/png;base64,d29ybGQ=' });
  const oldBytes = new DOMParser().parseFromString(await hydrateNoteHistoryContent(historicalVersion.content, note.id), 'text/html').querySelector('img')!.getAttribute('src');
  assert.equal(oldBytes, image.data, 'current attachment replacement cannot change a saved picture');
  await updateNote(note.id, { content: '<p>Picture removed</p>' });
  assert.equal((await db.images.get(historyImageId))?.data, image.data, 'saved historical pictures retain their bytes once');
  assert.equal((await db.images.get(historyImageId))?.retainedForHistory, true);
  assert.equal((await db.images.get(historyImageId))?.deletedAt, null, 'history-only attachments do not queue premature remote deletion');
  assert.equal(await db.syncQueue.where('[entity+entityId]').equals(['attachment', historyImageId]).count(), 0);

  await updateNote(note.id, { content: await hydrateNoteHistoryContent(historicalVersion.content, note.id) });
  const firstRestoredId = new DOMParser().parseFromString((await db.notes.get(note.id))!.content, 'text/html').querySelector('img')!.getAttribute('data-attachment-id')!;
  assert.notEqual(firstRestoredId, historyImageId, 'restoring a history-only image creates a mutable current clone');
  assert.equal((await db.images.get(historyImageId))?.historyOnly, true, 'saved history remains immutable after restore');
  assert.equal((await db.images.get(firstRestoredId))?.historyOnly, false);
  await updateImageAttachment(firstRestoredId, { data: 'data:image/png;base64,d29ybGQ=' });
  assert.equal(new DOMParser().parseFromString(await hydrateNoteHistoryContent(historicalVersion.content, note.id), 'text/html').querySelector('img')?.getAttribute('src'), image.data, 'replacing the restored current image cannot mutate the old saved version');
  await assert.rejects(() => updateImageAttachment(historyImageId, { data: 'data:image/png;base64,d29ybGQ=' }), /historical attachment bytes are immutable/);
  await updateNote(note.id, { content: '<p>Picture removed again</p>' });

  // A purge on another device cannot destroy this device's historical picture.
  await db.images.update(historyImageId, { deletedAt: 100, storagePath: undefined, remoteRevision: 5, syncStatus: 'synced' });
  await db.tombstones.put({ id: `attachment:${historyImageId}`, entity: 'attachment', entityId: historyImageId, deletedAt: 100, remoteRevision: 5 });
  await updateNote(note.id, { content: await hydrateNoteHistoryContent(historicalVersion.content, note.id) });
  const restoredContent = (await db.notes.get(note.id))!.content;
  const restoredDoc = new DOMParser().parseFromString(restoredContent, 'text/html');
  const restoredId = restoredDoc.querySelector('img')!.getAttribute('data-attachment-id')!;
  assert.notEqual(restoredId, historyImageId, 'a remotely purged ID is restored as a new attachment');
  assert.equal((await db.images.get(restoredId))?.data, image.data);
  assert.equal((await db.images.get(restoredId))?.remoteRevision, 0);
  assert.ok(await db.tombstones.get(`attachment:${historyImageId}`), 'old purge marker is preserved');

  await updateNote(note.id, { content: '<p>No picture</p>' });
  for (let i = 0; i < 25; i += 1) {
    await addNoteHistory({ id: `bounded-${i}`, noteId: note.id, title: note.title, content: `<p>Version ${i}</p>`, createdAt: 1000 + i }, { force: true });
  }
  assert.equal((await getNoteHistory(note.id)).length, 24, 'history storage is bounded per note');
  assert.equal(await db.images.get(historyImageId), undefined, 'unreferenced local-only historical bytes are collected after retention expires');

  const richNote = await createNote({ id: 'deduplicated-history', content: '<p>Current text</p>' });
  const largeData = `data:image/png;base64,${Buffer.alloc(64 * 1024, 3).toString('base64')}`;
  for (let i = 0; i < 24; i += 1) {
    await addNoteHistory({ id: `rich-${i}`, noteId: richNote.id, title: richNote.title,
      content: `<p>Version ${i}</p><img src="${largeData}">`, createdAt: 1000 + i }, { force: true });
  }
  const richVersions = await getNoteHistory(richNote.id);
  const richBlobs = await db.images.where('noteId').equals(richNote.id).toArray();
  assert.equal(richVersions.length, 24);
  assert.equal(richBlobs.length, 1, '24 versions of an unidentified embedded picture share one immutable byte record');
  assert.equal(richBlobs[0]?.data, largeData);
  assert.ok(richVersions.reduce((total, version) => total + version.content.length, 0) < 10_000, 'history HTML size no longer grows by 24 copies of Base64');
  assert.equal(new DOMParser().parseFromString(await hydrateNoteHistoryContent(richVersions[0].content, richNote.id), 'text/html').querySelector('img')?.getAttribute('src'), largeData);
  await assert.rejects(() => hydrateNoteHistoryContent('<img src="marknote-attachment://missing">', richNote.id), /missing attachment bytes/);

  dom.window.localStorage.setItem('marknote-note-snapshots', JSON.stringify({
    [note.id]: [{ id: 'legacy-private', title: 'Private', content: '<p>erase me</p>', createdAt: 1 }],
  }));
  await migrateLegacyNoteHistory();
  await permanentlyDeleteNote(note.id);
  const oldHistory = JSON.parse(dom.window.localStorage.getItem('marknote-note-snapshots')!);
  assert.equal(oldHistory[note.id], undefined, 'permanent purge removes retained legacy history copies');
  assert.equal(await db.noteHistory.where('noteId').equals(note.id).count(), 0);
  assert.equal(await db.images.where('noteId').equals(note.id).count(), 0);
  console.log('note history tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { db.close(); });
