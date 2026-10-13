import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import Dexie from 'dexie';
import {
  addNoteHistory, createImageAttachment, createNote, db, getEditorDrafts, recoverAllEditorDrafts, recoverEditorDrafts, permanentlyDeleteNote,
  removeEditorDraft, saveDraft, saveEditorDraft, updateNote, MarkNoteDatabase,
} from '../src/lib/db';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://marknote.test/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, HTMLElement: dom.window.HTMLElement });

async function main() {
  const v4 = new Dexie('editor-draft-v4-fixture');
  v4.version(4).stores({
    folders: '&id, sortOrder, updatedAt, deletedAt, syncStatus',
    notes: '&id, folderId, updatedAt, createdAt, pinned, deletedAt, syncStatus, *tags',
    images: '&id, noteId, updatedAt, deletedAt, syncStatus',
    syncQueue: '&id, entity, entityId, [entity+entityId], operation, updatedAt, createdAt',
    syncStates: '&id, provider, userId, deviceId, lastSyncedAt', syncDevices: '&id, provider, lastSeenAt',
    drafts: '&noteId, updatedAt', noteHistory: '&id, noteId, [noteId+createdAt], createdAt',
    tombstones: '&id, [entity+entityId], entity, entityId, deletedAt', localMetadata: '&id',
  });
  await v4.open();
  await v4.table('drafts').put({ noteId: 'v4-orphan', title: 'v4 kept', content: '<p>Saved before upgrade</p>', revision: 1, updatedAt: 1 });
  v4.close();
  const upgraded = new MarkNoteDatabase('editor-draft-v4-fixture');
  await upgraded.open();
  assert.equal((await upgraded.drafts.get('v4-orphan'))?.content, '<p>Saved before upgrade</p>', 'v5 never rewrites the v4 recovery source');
  assert.equal(await upgraded.editorDrafts.count(), 0);
  const v4Recovery = await recoverAllEditorDrafts('v5-editor', { database: upgraded });
  assert.equal(v4Recovery.recoveredNoteIds.length, 1);
  assert.equal((await upgraded.notes.get(v4Recovery.recoveredNoteIds[0]))?.content, '<p>Saved before upgrade</p>');
  await upgraded.delete();

  await db.delete();
  await db.open();
  const note = await createNote({ id: 'two-tabs', title: 'Original', content: '<p>Committed original</p>' });
  const attachment = await createImageAttachment({ id: 'draft-only-image', noteId: note.id,
    data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' });
  const imageHtml = `<img data-attachment-id="${attachment.id}" src="${attachment.data}">`;
  const a = { noteId: note.id, title: 'Tab A', content: `<p>A unsaved</p>${imageHtml}`, revision: 42, updatedAt: 100, baseVersion: 1 };
  const b = { noteId: note.id, title: 'Tab B', content: `<p>B unsaved</p>${imageHtml}`, revision: 42, updatedAt: 100, baseVersion: 1 };
  await Promise.all([saveEditorDraft(a, 'editor-a'), saveEditorDraft(b, 'editor-b')]);
  let rows = await getEditorDrafts(note.id);
  assert.equal(rows.length, 2, 'same-millisecond revisions belong to independent editor slots');
  assert.deepEqual(rows.map((row) => row.title).sort(), ['Tab A', 'Tab B']);
  await assert.rejects(() => saveEditorDraft({ ...a, content: '<p>Different same generation</p>' }, 'editor-a'), /same editor draft revision/);
  assert.equal(await removeEditorDraft(note.id, 'editor-a', 41), false);
  assert.equal(await removeEditorDraft(note.id, 'editor-unknown', 42), false, 'foreign tab cannot acknowledge another editor slot');

  await updateNote(note.id, { content: '<p>Other tab committed</p>' });
  assert.equal((await db.images.get(attachment.id))?.data, attachment.data, 'all editor candidates retain their referenced bytes');
  const restarted = await recoverAllEditorDrafts('restarted-editor');
  assert.equal(restarted.recoveredNoteIds.length, 2, 'both unflushed candidates become visible after restart');
  assert.equal((await db.notes.get(note.id))?.content, '<p>Other tab committed</p>', 'recovery cannot overwrite the committed original');
  for (const id of restarted.recoveredNoteIds) {
    const copy = (await db.notes.get(id))!;
    const image = new DOMParser().parseFromString(copy.content, 'text/html').querySelector('img')!;
    const ownImageId = image.getAttribute('data-attachment-id')!;
    assert.notEqual(ownImageId, attachment.id);
    assert.equal((await db.images.get(ownImageId))?.noteId, copy.id);
    assert.equal((await db.images.get(ownImageId))?.data, attachment.data, 'each visible recovery owns independent attachment bytes');
  }
  rows = await getEditorDrafts(note.id);
  assert.equal(rows.length, 2, 'foreign live editors never lose ownership during recovery');
  assert.ok(rows.every((row) => row.recoveredNoteId));
  assert.deepEqual((await recoverAllEditorDrafts('another-restart')).recoveredNoteIds, [], 'recovery copies are idempotent');
  assert.equal((await recoverEditorDrafts(note.id, 'editor-a')).draft?.title, 'Tab A');

  await saveEditorDraft({ ...a, title: 'A later', content: '<p>A newest unsaved</p>', revision: 43, updatedAt: 101 }, 'editor-a');
  await saveEditorDraft({ ...a, revision: 41 }, 'editor-a');
  const latest = await recoverEditorDrafts(note.id, 'next-restart');
  assert.equal(latest.recoveredNoteIds.length, 1, 'newer unsaved generations need a fresh recovery copy');
  assert.equal((await db.notes.get(latest.recoveredNoteIds[0]))?.content, '<p>A newest unsaved</p>');
  assert.equal(await removeEditorDraft(note.id, 'editor-a', 42), false, 'old ack cannot clear a newer editor generation');
  assert.equal(await removeEditorDraft(note.id, 'editor-a', 43), true);
  assert.equal((await getEditorDrafts(note.id))[0]?.editorId, 'editor-b');

  // v4's original row is retained and even a remotely removed original can be recovered.
  await saveDraft({ noteId: 'removed-legacy-note', title: 'Orphan legacy', content: '<p>Legacy unsaved text</p>', revision: 1, updatedAt: 1 });
  const legacy = await recoverAllEditorDrafts('legacy-restart');
  assert.equal(legacy.recoveredNoteIds.length, 1);
  assert.equal((await db.notes.get(legacy.recoveredNoteIds[0]))?.content, '<p>Legacy unsaved text</p>');
  assert.equal((await db.drafts.get('removed-legacy-note'))?.content, '<p>Legacy unsaved text</p>');
  assert.equal((await db.drafts.get('removed-legacy-note'))?.recoveredNoteId, legacy.recoveredNoteIds[0]);
  assert.deepEqual((await recoverAllEditorDrafts('legacy-restart-again')).recoveredNoteIds, []);

  const purgeImageId = 'local-purge-image';
  const purgeContent = `<p>Committed picture</p><img data-attachment-id="${purgeImageId}" src="${attachment.data}">`;
  const purgeNote = await createNote({ id: 'local-purge-note', title: 'Committed', content: purgeContent });
  await createImageAttachment({ id: purgeImageId, noteId: purgeNote.id, data: attachment.data, mimeType: 'image/png' });
  await addNoteHistory({ id: 'committed-purge-history', noteId: purgeNote.id, title: 'Earlier history', content: purgeContent, createdAt: 1 });
  await saveEditorDraft({ noteId: purgeNote.id, title: 'Foreign still typing', content: `<p>Foreign pending</p>${purgeContent}`, revision: 1, updatedAt: 1, baseVersion: 1 }, 'foreign-live-editor');
  await saveEditorDraft({ noteId: purgeNote.id, title: purgeNote.title, content: purgeNote.content, revision: 1, updatedAt: 1, baseVersion: 1 }, 'matching-committed-editor');
  const beforePurge = await db.notes.count();
  await permanentlyDeleteNote(purgeNote.id);
  assert.equal(await db.notes.get(purgeNote.id), undefined);
  assert.equal(await db.notes.count(), beforePurge, 'purge replaces only one truly uncommitted candidate, without restoring committed history/content');
  const foreignCopy = (await db.notes.filter((row) => row.content.includes('Foreign pending')).toArray())[0];
  assert.ok(foreignCopy, 'local purge saves another editor\'s durable candidate as a visible independent note');
  const foreignImageId = new DOMParser().parseFromString(foreignCopy.content, 'text/html').querySelector('img')!.getAttribute('data-attachment-id')!;
  assert.notEqual(foreignImageId, purgeImageId);
  assert.equal(await db.images.get(purgeImageId), undefined);
  assert.equal((await db.images.get(foreignImageId))?.noteId, foreignCopy.id);
  assert.equal((await db.images.get(foreignImageId))?.data, attachment.data);
  assert.equal((await getEditorDrafts(purgeNote.id)).length, 0);
  assert.equal(await db.noteHistory.where('noteId').equals(purgeNote.id).count(), 0);
  db.close();
  await db.open();
  assert.equal((await db.notes.get(foreignCopy.id))?.content, foreignCopy.content, 'foreign input survives purge followed by a full database reopen');

  await saveEditorDraft({ noteId: 'broken-ref', title: 'Missing bytes', content: '<img src="marknote-attachment://missing">', revision: 1, updatedAt: 1 }, 'broken-tab');
  const countBefore = await db.notes.count();
  await assert.rejects(() => recoverEditorDrafts('broken-ref', 'restart'), /附件字节缺失/);
  assert.equal(await db.notes.count(), countBefore, 'failed recovery cannot leave a partial note copy');
  assert.equal((await getEditorDrafts('broken-ref'))[0]?.recoveredNoteId, undefined);
  assert.match((await getEditorDrafts('broken-ref'))[0]?.content || '', /marknote-attachment:\/\/missing/, 'unrecoverable candidates remain intact for manual recovery');
  await saveEditorDraft({ noteId: 'broken-ref', title: 'Healthy other tab', content: '<p>Healthy peer text</p>', revision: 1, updatedAt: 1 }, 'healthy-peer');
  await saveEditorDraft({ noteId: 'z-healthy-orphan', title: 'Healthy later note', content: '<p>Healthy later text</p>', revision: 1, updatedAt: 1 }, 'healthy-later');
  const continued = await recoverAllEditorDrafts('restart-after-corrupt-first');
  assert.equal(continued.recoveredNoteIds.length, 2, 'a broken first candidate cannot block healthy peers on the same or later notes');
  assert.equal(continued.errors.length, 1);
  assert.equal(continued.errors[0]?.noteId, 'broken-ref');
  assert.equal((await db.notes.filter((row) => row.content === '<p>Healthy peer text</p>').count()), 1);
  assert.equal((await db.notes.filter((row) => row.content === '<p>Healthy later text</p>').count()), 1);
  assert.equal((await getEditorDrafts('broken-ref')).find((row) => row.editorId === 'broken-tab')?.recoveredNoteId, undefined);
  const repeated = await recoverAllEditorDrafts('repeat-corrupt-startup');
  assert.deepEqual(repeated.recoveredNoteIds, [], 'successful peers remain idempotent even while a broken candidate remains');
  assert.equal(repeated.errors.length, 1);
  console.log('editor draft storage tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { db.close(); });
