import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createImageAttachment, createNote, db, DEFAULT_FOLDER_ID, ensureDefaultFolders, hydrateNoteHistoryContent, permanentlyDeleteNote, updateImageAttachment } from '../src/lib/db';
import { cloneNoteAttachments, createLocalConflictCopy } from '../src/lib/cloneNoteAttachments';
import { createBackupPackage, parseJsonImportPackage, readBackupData } from '../src/lib/backup';
import { replaceAttachmentDataUrlsWithRefs, extractAttachmentRefIds } from '../src/lib/attachmentContent';
import { createDatabaseSaveStore, NoteSaveCoordinator } from '../src/services/noteSave';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, localStorage: dom.window.localStorage });

async function main() {
  await db.delete(); await db.open(); await ensureDefaultFolders();
  const imageData = 'data:image/png;base64,aGVsbG8=';
  const pdfData = 'data:application/pdf;base64,cGRm';
  const media = `<img src="${imageData}" data-attachment-id="source-image"><a download="a.pdf" href="${pdfData}" data-attachment-id="source-file">文件</a>`;
  const source = await createNote({ id: 'source', title: '原笔记', content: `<p>原文</p>${media}` });
  await createImageAttachment({ id: 'source-image', noteId: source.id, data: imageData, mimeType: 'image/png', storagePath: 'old/private.png', remoteRevision: 9 });
  await createImageAttachment({ id: 'source-file', noteId: source.id, data: pdfData, mimeType: 'application/pdf', storagePath: 'old/private.pdf', remoteRevision: 7 });
  const first = new NoteSaveCoordinator(createDatabaseSaveStore(db));
  const copyIds: string[] = [];
  const second = new NoteSaveCoordinator(createDatabaseSaveStore(db), (event) => {
    if (event.state === 'saved' && event.savedNoteId) copyIds.push(event.savedNoteId);
  });
  first.stage(source.id, '第一标签', `<p>第一份修改</p>${media}`, source.version);
  second.stage(source.id, '第二标签', `<p>第二份修改</p>${media}`, source.version);
  await first.flushAll();
  await second.flushAll();
  assert.equal(copyIds.length, 1);
  assert.notEqual(copyIds[0], source.id);
  const copy = (await db.notes.get(copyIds[0]))!;
  assert.match(copy.content, /第二份修改/);
  const copyAttachments = await db.images.where('noteId').equals(copy.id).toArray();
  const cloned = copyAttachments.filter((attachment) => !attachment.historyOnly);
  const historical = copyAttachments.filter((attachment) => attachment.historyOnly);
  assert.equal(cloned.length, 2, 'local CAS conflict must clone every referenced attachment');
  assert.deepEqual(cloned.map((attachment) => attachment.data).sort(), [imageData, pdfData].sort());
  for (const attachment of cloned) {
    assert.notEqual(attachment.id, 'source-image');
    assert.notEqual(attachment.id, 'source-file');
    assert.equal(attachment.storagePath, undefined);
    assert.equal(attachment.remoteRevision, 0);
    assert.equal(attachment.deletedAt, null);
    assert.equal((await db.syncQueue.where('[entity+entityId]').equals(['attachment', attachment.id]).first())?.operation, 'upsert');
  }
  assert.deepEqual(Array.from(extractAttachmentRefIds(replaceAttachmentDataUrlsWithRefs(copy.content))).sort(), cloned.map((attachment) => attachment.id).sort());
  const historyBeforePurge = await db.noteHistory.where('noteId').equals(copy.id).toArray();
  assert.ok(historyBeforePurge.length > 0, 'the conflict copy must have a recoverable saved snapshot');
  const historicalRefs = new Set(historyBeforePurge.flatMap((snapshot) => Array.from(extractAttachmentRefIds(snapshot.content))));
  assert.equal(historicalRefs.size, 2, 'saved image and file need their own immutable history references');
  assert.deepEqual(Array.from(historicalRefs).sort(), historical.map((attachment) => attachment.id).sort());
  assert.deepEqual(historical.map((attachment) => attachment.data).sort(), [imageData, pdfData].sort());
  for (const attachment of historical) {
    assert.equal(attachment.noteId, copy.id);
    assert.equal(cloned.some((current) => current.id === attachment.id), false, 'history must not alias mutable current attachment IDs');
    assert.equal(attachment.storagePath, undefined);
    assert.equal(attachment.syncStatus, 'local');
    assert.equal(await db.syncQueue.where('[entity+entityId]').equals(['attachment', attachment.id]).count(), 0, 'local history bytes must not be uploaded');
  }
  for (const snapshot of historyBeforePurge) {
    assert.equal(snapshot.content.includes(imageData) || snapshot.content.includes(pdfData), false, 'history stores stable references, not repeated Base64');
    const hydrated = await hydrateNoteHistoryContent(snapshot.content, copy.id, { database: db });
    assert.ok(hydrated.includes(imageData) && hydrated.includes(pdfData), 'immutable history must restore both media kinds');
  }
  await assert.rejects(updateImageAttachment(historical[0].id, { data: 'data:image/png;base64,ZmFrZQ==' }, { database: db }), /immutable/);
  await permanentlyDeleteNote(source.id);
  assert.equal(await db.images.where('noteId').equals(source.id).count(), 0);
  const copyAfterPurge = await db.images.where('noteId').equals(copy.id).toArray();
  assert.deepEqual(copyAfterPurge.filter((attachment) => !attachment.historyOnly), cloned, 'original purge cannot remove or change current copy bytes');
  assert.deepEqual(copyAfterPurge.filter((attachment) => attachment.historyOnly), historical, 'original purge cannot remove or change immutable copy history bytes');
  const historyAfterPurge = await db.noteHistory.where('noteId').equals(copy.id).toArray();
  assert.deepEqual(historyAfterPurge, historyBeforePurge, 'history references stay stable after source purge');
  for (const snapshot of historyAfterPurge) {
    const hydrated = await hydrateNoteHistoryContent(snapshot.content, copy.id, { database: db });
    assert.ok(hydrated.includes(imageData) && hydrated.includes(pdfData));
  }
  const restored = await parseJsonImportPackage(JSON.stringify(await createBackupPackage(await readBackupData(db))));
  assert.equal(restored.notes.length, 1);
  assert.equal(restored.attachments.filter((attachment) => !attachment.historyOnly).length, 2);
  assert.deepEqual(restored.attachments.filter((attachment) => attachment.historyOnly).map((attachment) => attachment.id).sort(), Array.from(historicalRefs).sort());
  assert.equal(restored.history.every((snapshot) => snapshot.noteId === copy.id), true);

  // A recoverable embedded draft can survive source purge without reusing old server IDs.
  const recovered = await createLocalConflictCopy(source, '恢复的离线草稿', `<p>草稿</p>${media}`, db);
  assert.equal(await db.images.where('noteId').equals(recovered.id).count(), 2);
  const reused = await cloneNoteAttachments(source.id, recovered.id, recovered.content, db);
  assert.equal(reused, recovered.content);
  assert.equal(await db.images.where('noteId').equals(recovered.id).count(), 2, 'already remapped target IDs reuse independent bytes');
  const moved = await createLocalConflictCopy({ ...source, folderId: 'folder-removed-remotely' }, '目录已删除的草稿', '<p>可恢复</p>', db);
  assert.equal(moved.folderId, DEFAULT_FOLDER_ID);
  const before = { notes: await db.notes.count(), images: await db.images.count(), queue: await db.syncQueue.count() };
  await assert.rejects(createLocalConflictCopy(source, '缺少附件', '<img src="marknote-attachment://missing-image" data-attachment-id="missing-image">', db), /附件字节缺失/);
  assert.deepEqual({ notes: await db.notes.count(), images: await db.images.count(), queue: await db.syncQueue.count() }, before, 'failed clone rolls back all copy writes');
  await db.delete();
  console.log('local conflict attachment clone tests passed (two tabs, source purge, independent backup, missing-byte rollback)');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
