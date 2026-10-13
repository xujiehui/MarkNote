import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createBackupPackage, parseJsonImportPackage, buildRestorePlan, restoreImportPackage } from '../src/lib/backup';
import { attachmentRefUrl, extractAttachmentRefIds, replaceAttachmentDataUrlsWithRefs, restoreAttachmentRefs } from '../src/lib/attachmentContent';
import { db, getWorkspaceEpoch, hydrateNoteHistoryContent, MarkNoteDatabase, permanentlyDeleteNote } from '../src/lib/db';
import type { Folder, ImageAttachment, Note } from '../src/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, HTMLElement: dom.window.HTMLElement });

async function main() {
  const folders: Folder[] = [
    { id: 'folder-1', name: '目录', sortOrder: 0, createdAt: 1, updatedAt: 2, version: 3 },
    { id: 'folder-empty', name: '空目录', sortOrder: 1, createdAt: 1, updatedAt: 2 },
    { id: 'folder-deleted', name: '已删除目录', sortOrder: 2, createdAt: 1, updatedAt: 2, deletedAt: 3 },
  ];
  const notes: Note[] = [
    { id: 'note-1', title: '笔记', content: `<p>正文</p><img data-attachment-id="image-1" src="${attachmentRefUrl('image-1')}"><a download="a.pdf" data-attachment-id="pdf-1" href="${attachmentRefUrl('pdf-1')}">附件</a>`, folderId: 'folder-1', tags: ['工作'], pinned: true, createdAt: 1, updatedAt: 2, version: 7 },
    { id: 'note-trash', title: '回收站', content: '<p>保留回收站内容</p>', folderId: 'folder-deleted', tags: [], pinned: false, createdAt: 1, updatedAt: 2, deletedAt: 3 },
  ];
  const attachments: ImageAttachment[] = [
    { id: 'image-1', noteId: 'note-1', data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png', storagePath: 'old-account/private/object', sizeBytes: 5, createdAt: 1, updatedAt: 2 },
    { id: 'pdf-1', noteId: 'note-1', data: 'data:application/pdf;base64,cGRm', mimeType: 'application/pdf', createdAt: 1, updatedAt: 2 },
  ];
  const backup = await createBackupPackage({
    folders, notes, attachments,
    history: [{ id: 'history-1', noteId: 'note-1', title: '旧标题', content: notes[0].content, createdAt: 1 }],
    preferences: { customTags: ['工作'], tagColors: { 工作: '#ff0000' }, token: 'not-a-real-secret' } as never,
  });
  assert.equal(JSON.stringify(backup).includes('old-account'), false, 'remote ownership paths never enter a restore package');
  assert.equal(JSON.stringify(backup).includes('not-a-real-secret'), false, 'unknown preference fields cannot export credentials');
  assert.equal(backup.notes[0].version, 7);
  assert.equal(backup.integrity.attachments['image-1'].length, 64);
  const parsed = await parseJsonImportPackage(JSON.stringify(backup));
  assert.equal(parsed.integrityVerified, true);
  assert.equal(parsed.folders.length, 3);
  assert.equal(parsed.notes[1].deletedAt, 3);
  assert.equal(parsed.history.length, 1);

  // A changed record or a single changed byte cannot pass the restore preflight.
  const tampered = structuredClone(backup);
  tampered.notes[0].title = 'changed';
  await assert.rejects(parseJsonImportPackage(JSON.stringify(tampered)), /完整性校验失败/);
  const corrupted = structuredClone(backup);
  corrupted.attachments[0].data = 'data:image/png;base64,Zm9ybGQ=';
  await assert.rejects(parseJsonImportPackage(JSON.stringify(corrupted)), /完整性校验失败/);
  await assert.rejects(parseJsonImportPackage('{"version":99,"notes":[]}'), /不支持/);
  await assert.rejects(parseJsonImportPackage('{"notes":[{"content":123}]}'), /正文/);
  await assert.rejects(parseJsonImportPackage('{"notes":[{"id":"same","content":""},{"id":"same","content":""}]}'), /重复/);

  const copy = buildRestorePlan(parsed, { existingNoteIds: ['note-1'] });
  assert.notEqual(copy.notes[0].id, notes[0].id);
  assert.notEqual(copy.folders[0].id, folders[0].id);
  assert.equal(copy.notes[0].folderId, copy.folders[0].id);
  assert.equal(copy.attachments[0].noteId, copy.notes[0].id);
  assert.equal(copy.history[0].noteId, copy.notes[0].id);
  assert.equal(copy.notes[1].deletedAt, 3);
  assert.deepEqual(Array.from(extractAttachmentRefIds(replaceAttachmentDataUrlsWithRefs(copy.notes[0].content))).sort(), copy.attachments.map((attachment) => attachment.id).sort());
  assert.match(copy.notes[0].content, /src="data:image\/png;base64,aGVsbG8="/, 'offline restored content hydrates attachment bytes immediately');
  assert.doesNotMatch(copy.history[0].content, /data:image/, 'restored history retains compact references instead of repeating bytes');
  assert.match(restoreAttachmentRefs(copy.history[0].content, copy.attachments), /src="data:image\/png;base64,aGVsbG8="/, 'offline history still resolves readable media');
  assert.match(restoreAttachmentRefs(copy.notes[0].content, copy.attachments), /data:image\/png;base64,aGVsbG8=/);
  assert.equal(copy.attachments[0].storagePath, undefined);
  const historicalSource = structuredClone(parsed);
  historicalSource.attachments[0].deletedAt = 99;
  assert.equal(buildRestorePlan(historicalSource).attachments[0].deletedAt, null, 'new attachment IDs preserve historical bytes rather than inherit remote deletion');
  const skip = buildRestorePlan(parsed, { strategy: 'skip-existing', existingNoteIds: ['note-1'] });
  assert.equal(skip.skippedNotes, 1);
  assert.equal(skip.notes.length, 1);
  assert.equal(skip.attachments.length, 0);
  assert.equal(skip.history.length, 0);

  const before = await db.notes.count();
  await assert.rejects(restoreImportPackage(copy, { epoch: getWorkspaceEpoch() + 1 }), /空间已切换/);
  const foreignDatabase = new MarkNoteDatabase('backup-foreign-target');
  await assert.rejects(restoreImportPackage(copy, { database: foreignDatabase }), /空间已切换/);
  foreignDatabase.close();
  const restored = await restoreImportPackage(copy);
  assert.equal(restored.noteIds.length, 2);
  assert.equal(await db.notes.count(), before + 2);
  assert.equal(await db.images.where('noteId').equals(copy.notes[0].id).count(), 2);
  assert.equal(await db.noteHistory.where('noteId').equals(copy.notes[0].id).count(), 1);
  const copiedBackup = await createBackupPackage({
    notes: await db.notes.toArray(), folders: await db.folders.toArray(), attachments: await db.images.toArray(), history: await db.noteHistory.toArray(),
  });
  assert.equal((await parseJsonImportPackage(JSON.stringify(copiedBackup))).notes.length, 2);
  // A duplicate plan is rejected atomically and never replaces content or adds part of a package.
  await assert.rejects(restoreImportPackage(copy));
  assert.equal(await db.notes.count(), before + 2);
  const collision = buildRestorePlan(parsed);
  collision.notes[0].id = copy.notes[0].id;
  const folderCount = await db.folders.count();
  await assert.rejects(restoreImportPackage(collision));
  assert.equal(await db.folders.count(), folderCount, 'folder inserts rollback if a note collides');

  const historyOnlyBackup = await createBackupPackage({
    folders: [folders[0]], notes: [{ ...notes[0], content: '<p>Current text without the old picture</p>' }],
    attachments: [{ ...attachments[0], historyOnly: true, retainedForHistory: true }],
    history: [{ id: 'history-only-version', noteId: notes[0].id, title: 'Old picture', content: `<img src="${attachmentRefUrl(attachments[0].id)}">`, createdAt: 1 }],
  });
  const historyOnlyParsed = await parseJsonImportPackage(JSON.stringify(historyOnlyBackup));
  assert.equal(historyOnlyParsed.attachments[0].historyOnly, true, 'backup manifest retains local immutable historical attachment classification');
  const historyOnlyPlan = buildRestorePlan(historyOnlyParsed);
  assert.equal(historyOnlyPlan.attachments[0].historyOnly, true);
  assert.equal(historyOnlyPlan.attachments[0].syncStatus, 'local');
  assert.doesNotMatch(historyOnlyPlan.history[0].content, /data:image/);
  await restoreImportPackage(historyOnlyPlan);
  const historyOnlyAttachment = historyOnlyPlan.attachments[0];
  assert.equal(await db.syncQueue.where('[entity+entityId]').equals(['attachment', historyOnlyAttachment.id]).count(), 0, 'restoring a historical attachment does not upload it automatically');
  assert.equal(new DOMParser().parseFromString(await hydrateNoteHistoryContent(historyOnlyPlan.history[0].content, historyOnlyPlan.notes[0].id), 'text/html').querySelector('img')?.getAttribute('src'), attachments[0].data);
  const noFlag = structuredClone(historyOnlyParsed);
  delete noFlag.attachments[0].historyOnly;
  assert.equal(buildRestorePlan(noFlag).attachments[0].historyOnly, true, 'older packages infer history-only assets from complete reference ownership');
  const activeFlag = structuredClone(parsed);
  activeFlag.attachments[0].historyOnly = true;
  assert.equal(buildRestorePlan(activeFlag).attachments[0].historyOnly, false, 'an imported flag cannot suppress a current note attachment');
  await permanentlyDeleteNote(historyOnlyPlan.notes[0].id);
  assert.equal(await db.images.get(historyOnlyAttachment.id), undefined);
  assert.equal(await db.noteHistory.where('noteId').equals(historyOnlyPlan.notes[0].id).count(), 0);

  const missingData = attachments.map((attachment) => ({ ...attachment, data: '' }));
  await assert.rejects(createBackupPackage({ notes, folders, attachments: missingData }), /尚未下载/);
  await assert.rejects(createBackupPackage({ notes, folders: [], attachments }), /文件夹/);
  const remoteMedia = await createBackupPackage({ notes: [{ ...notes[0], content: '<img src="https://example.invalid/external.png">' }], folders, attachments: [] });
  assert.match((await parseJsonImportPackage(JSON.stringify(remoteMedia))).warnings[0], /外部媒体引用/);
  await assert.rejects(createBackupPackage({ notes: [{ ...notes[0], content: '<img src="blob:http://127.0.0.1/orphan">' }], folders, attachments: [] }), /临时媒体/);
  await assert.rejects(createBackupPackage({ notes: [], folders: [], attachments: [{ id: 'bad', noteId: 'n', data: 'data:image/svg+xml;base64,PHN2Zy8+', mimeType: 'image/svg+xml' }] }), /附件类型/);
  const legacy = await parseJsonImportPackage(JSON.stringify({ version: 1, notes }));
  assert.equal(legacy.integrityVerified, false);
  assert.equal(legacy.folders.length, 2);
  assert.equal(legacy.warnings.length, 2);
  const malicious = await parseJsonImportPackage(JSON.stringify({ notes: [{ title: 'safe', content: '<p onclick="window.bad=1">text</p><script>window.bad=1</script>' }] }));
  assert.doesNotMatch(malicious.notes[0].content, /onclick|<script/);
  db.close();
  console.log('backup integrity/atomic restore tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
