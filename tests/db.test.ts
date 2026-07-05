import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import {
  createFolder,
  createImageAttachment,
  createNote,
  db,
  DEFAULT_FOLDER_ID,
  deleteFolder,
  ensureDefaultFolders,
  ensureSeedNote,
  moveNoteToFolder,
  permanentlyDeleteNote,
  purgeExpiredTrash,
  renameFolder,
  softDeleteNote,
  updateImageAttachment,
  updateNote,
  upsertNote,
} from '../src/lib/db';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.assign(globalThis, {
  DOMParser: dom.window.DOMParser,
  HTMLElement: dom.window.HTMLElement,
});

async function main() {
  await db.delete();
  await db.open();

  const seedId = await ensureSeedNote();
  const seed = await db.notes.get(seedId);
  assert.equal(seed?.title, '欢迎使用 MarkNote');
  assert.equal(seed?.pinned, true);
  assert.equal(seed?.folderId, DEFAULT_FOLDER_ID);
  assert.match(seed?.content || '', /内容会先自动保存到本地，登录后再同步到云端/);
  assert.match(seed?.content || '', /<ul data-type="taskList">/);
  assert.match(seed?.content || '', /<li data-type="taskItem" data-checked="true"><p>支持 Markdown 语法<\/p><\/li>/);
  await updateNote(seedId, {
    title: '我自己的欢迎笔记',
    content: '<p>不要被启动模板覆盖</p>',
  });
  await ensureSeedNote();
  const editedSeed = await db.notes.get(seedId);
  assert.equal(editedSeed?.title, '我自己的欢迎笔记');
  assert.equal(editedSeed?.content, '<p>不要被启动模板覆盖</p>');

  const customizedWelcomeContent = (seed?.content || '').replace(
    '这是一个支持图文混排、代码块、标签、导入导出的跨平台笔记应用。',
    '这是我改过的欢迎说明，启动时不能被模板覆盖。',
  );
  await db.notes.put({
    ...seed!,
    content: customizedWelcomeContent,
    rawContent: '用户改过默认欢迎说明',
  });
  await ensureSeedNote();
  const customizedWelcome = await db.notes.get(seedId);
  assert.match(customizedWelcome?.content || '', /这是我改过的欢迎说明/);
  assert.doesNotMatch(customizedWelcome?.content || '', /这是一个支持图文混排/);

  await db.notes.clear();
  const toggledWelcomeContent = (seed?.content || '').replace(
    '<li data-type="taskItem" data-checked="false"><p>支持多端同步</p></li>',
    '<li data-type="taskItem" data-checked="true"><p>支持多端同步</p></li>',
  );
  await db.notes.put({
    ...seed!,
    content: toggledWelcomeContent,
    rawContent: '用户只改了欢迎清单勾选状态',
    version: 2,
  });
  await ensureSeedNote();
  const toggledWelcome = await db.notes.get(seedId);
  assert.match(toggledWelcome?.content || '', /<li data-type="taskItem" data-checked="true"><p>支持多端同步<\/p><\/li>/);

  await db.notes.clear();
  const oldWelcomeContent = (seed?.content || '').replace(
    '<li>内容会先自动保存到本地，登录后再同步到云端</li>',
    '<li>所有内容会自动保存到云端</li>',
  );
  await db.notes.put({
    ...seed!,
    content: oldWelcomeContent,
    rawContent: '旧欢迎内容',
  });
  await ensureSeedNote();
  const migratedSeed = await db.notes.get(seedId);
  assert.match(migratedSeed?.content || '', /内容会先自动保存到本地，登录后再同步到云端/);
  assert.doesNotMatch(migratedSeed?.content || '', /所有内容会自动保存到云端/);
  assert.match(migratedSeed?.content || '', /<li data-type="taskItem" data-checked="true"><p>支持 Markdown 语法<\/p><\/li>/);

  await db.notes.clear();
  await db.notes.put({
    ...seed!,
    content: (seed?.content || '')
      .replace(/<li data-type="taskItem" data-checked="(true|false)">/g, '<li data-checked="$1">')
      .replace('<li>内容会先自动保存到本地，登录后再同步到云端</li>', '<li>所有内容会自动保存到云端</li>'),
    rawContent: '旧欢迎任务列表',
  });
  await ensureSeedNote();
  const migratedTaskListSeed = await db.notes.get(seedId);
  assert.match(migratedTaskListSeed?.content || '', /内容会先自动保存到本地，登录后再同步到云端/);
  assert.match(migratedTaskListSeed?.content || '', /<li data-type="taskItem" data-checked="false"><p>支持多端同步<\/p><\/li>/);

  await db.notes.clear();
  await db.notes.put({
    ...seed!,
    content: (seed?.content || '')
      .replace('<ul data-type="taskList">\n', '<ul>\n')
      .replace(/<li data-type="taskItem" data-checked="(?:true|false)">/g, '<li>'),
    rawContent: '旧编辑器降级欢迎任务列表',
  });
  await ensureSeedNote();
  const migratedPlainTaskListSeed = await db.notes.get(seedId);
  assert.match(migratedPlainTaskListSeed?.content || '', /<ul data-type="taskList">/);
  assert.match(migratedPlainTaskListSeed?.content || '', /<li data-type="taskItem" data-checked="true"><p>支持代码高亮<\/p><\/li>/);

  await db.notes.clear();
  await db.notes.put({
    ...seed!,
    content: (seed?.content || '')
      .replace('<li>内容会先自动保存到本地，登录后再同步到云端</li>', '<li><p>所有内容会自动保存到云端</p></li>')
      .replace(/<li data-type="taskItem" data-checked="(true|false)">/g, '<li data-checked="$1" data-type="taskItem">'),
    rawContent: '旧编辑器规范化欢迎内容',
  });
  await ensureSeedNote();
  const migratedNormalizedWelcome = await db.notes.get(seedId);
  assert.match(migratedNormalizedWelcome?.content || '', /内容会先自动保存到本地，登录后再同步到云端/);
  assert.doesNotMatch(migratedNormalizedWelcome?.content || '', /所有内容会自动保存到云端/);

  const defaultFolders = await db.folders.toArray();
  assert.ok(defaultFolders.length >= 3);
  assert.ok(defaultFolders.some((folder) => folder.id === DEFAULT_FOLDER_ID));

  const note = await createNote({
    title: '搜索测试',
    content: '<h1>Hello</h1><p>IndexedDB body</p>',
    tags: ['工作'],
  });
  assert.equal(note.rawContent, 'Hello IndexedDB body');
  assert.equal(note.folderId, DEFAULT_FOLDER_ID);

  const folder = await createFolder('项目资料');
  assert.equal(folder.name, '项目资料');
  await renameFolder(folder.id, '项目归档');
  assert.equal((await db.folders.get(folder.id))?.name, '项目归档');
  await moveNoteToFolder(note.id, folder.id);
  assert.equal((await db.notes.get(note.id))?.folderId, folder.id);
  await deleteFolder(folder.id);
  assert.equal(await db.folders.get(folder.id), undefined);
  assert.equal((await db.notes.get(note.id))?.folderId, DEFAULT_FOLDER_ID);

  await ensureDefaultFolders();
  assert.ok(await db.folders.get(DEFAULT_FOLDER_ID));

  await updateNote(note.id, { content: '<p>updated content</p>' });
  const updated = await db.notes.get(note.id);
  assert.equal(updated?.rawContent, 'updated content');

  const attachment = await createImageAttachment({
    noteId: note.id,
    data: 'data:image/png;base64,aGVsbG8=',
    mimeType: 'image/png',
    sizeBytes: 5,
  });
  assert.equal((await db.images.get(attachment.id))?.syncStatus, 'pending');
  assert.ok(await db.syncQueue.where('[entity+entityId]').equals(['attachment', attachment.id]).first());
  await updateImageAttachment(attachment.id, {
    data: 'data:image/jpeg;base64,d29ybGQ=',
    mimeType: 'image/jpeg',
    sizeBytes: 5,
  });
  const updatedAttachment = await db.images.get(attachment.id);
  assert.equal(updatedAttachment?.mimeType, 'image/jpeg');
  assert.equal(updatedAttachment?.storagePath, undefined);

  await updateImageAttachment(attachment.id, {
    storagePath: 'user-1/note-1/image-1',
    syncStatus: 'synced',
  }, { enqueueSync: false });

  const fileAttachment = await createImageAttachment({
    noteId: note.id,
    data: 'data:application/pdf;base64,aGVsbG8=',
    mimeType: 'application/pdf',
    sizeBytes: 5,
  });
  await updateImageAttachment(fileAttachment.id, {
    storagePath: `user-1/${note.id}/${fileAttachment.id}`,
    syncStatus: 'synced',
  }, { enqueueSync: false });
  await updateNote(note.id, {
    content: `<p>kept</p><file-attachment href="data:application/pdf;base64,aGVsbG8=" filename="brief.pdf" data-attachment-id="${fileAttachment.id}"></file-attachment>`,
  });
  assert.equal((await db.images.get(fileAttachment.id))?.deletedAt, null);
  await updateNote(note.id, { content: '<p>removed attachment</p>' });
  const detachedAttachment = await db.images.get(fileAttachment.id);
  assert.equal(detachedAttachment?.deletedAt !== null, true);
  assert.equal(detachedAttachment?.data, '');
  assert.ok(await db.syncQueue.where('[entity+entityId]').equals(['attachment', fileAttachment.id]).first());

  await softDeleteNote(note.id);
  const trashed = await db.notes.get(note.id);
  assert.equal(typeof trashed?.deletedAt, 'number');
  assert.equal(trashed?.pinned, false);

  await upsertNote({
    id: 'backup-note',
    title: '备份恢复',
    content: '<p>restored</p>',
    createdAt: 10,
    updatedAt: 20,
    tags: ['个人'],
    pinned: true,
  });
  await upsertNote({
    id: 'backup-note',
    title: '备份覆盖',
    content: '<p>restored again</p>',
    createdAt: 10,
    updatedAt: 30,
    tags: ['代码片段'],
    pinned: false,
  });
  const restored = await db.notes.get('backup-note');
  assert.equal(restored?.title, '备份覆盖');
  assert.equal(restored?.updatedAt, 30);
  assert.deepEqual(restored?.tags, ['代码片段']);

  const oldTrash = await createNote({
    id: 'old-trash',
    title: '旧回收站',
    content: '<p>delete me</p>',
    deletedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
  });
  await purgeExpiredTrash();
  assert.equal(await db.notes.get(oldTrash.id), undefined);

  await permanentlyDeleteNote(note.id);
  assert.equal(await db.notes.get(note.id), undefined);
  const attachmentTombstone = await db.images.get(attachment.id);
  assert.equal(attachmentTombstone?.deletedAt !== null, true);
  assert.equal(attachmentTombstone?.storagePath, 'user-1/note-1/image-1');
  assert.ok(await db.syncQueue.where('[entity+entityId]').equals(['attachment', attachment.id]).first());

  console.log('db tests passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    db.close();
  });
