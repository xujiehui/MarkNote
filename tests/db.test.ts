import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import {
  createFolder,
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
  await updateNote(seedId, {
    title: '我自己的欢迎笔记',
    content: '<p>不要被启动模板覆盖</p>',
  });
  await ensureSeedNote();
  const editedSeed = await db.notes.get(seedId);
  assert.equal(editedSeed?.title, '我自己的欢迎笔记');
  assert.equal(editedSeed?.content, '<p>不要被启动模板覆盖</p>');

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
