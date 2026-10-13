import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import Dexie from 'dexie';
import {
  addNoteHistory, createImageAttachment, createNote, db, ensureSeedNote, getActiveDatabase,
  getDraft, getNoteHistory, getWorkspaceEpoch, getWorkspaceSnapshot, isWorkspaceCurrent,
  migrateLegacyNoteHistory, permanentlyDeleteNote, registerWorkspaceSwitchGuard,
  removeDraft, saveDraft, subscribeWorkspace, switchWorkspaceAccount, updateNote, workspaceStorageKey, MarkNoteDatabase,
} from '../src/lib/db';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://marknote.test/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, HTMLElement: dom.window.HTMLElement });

async function main() {
  const legacySchema = new Dexie('marknote-upgrade-fixture');
  legacySchema.version(3).stores({
    folders: '&id, sortOrder, updatedAt, deletedAt, syncStatus',
    notes: '&id, folderId, updatedAt, createdAt, pinned, deletedAt, syncStatus, *tags',
    images: '&id, noteId, updatedAt, deletedAt, syncStatus',
    syncQueue: '&id, entity, entityId, [entity+entityId], operation, updatedAt, createdAt',
    syncStates: '&id, provider, userId, deviceId, lastSyncedAt',
    syncDevices: '&id, provider, lastSeenAt',
  });
  await legacySchema.open();
  await legacySchema.table('notes').put({ id: 'old-schema-note', title: 'Do not lose me', content: '<p>Legacy v3</p>',
    folderId: 'folder-library', tags: [], pinned: false, createdAt: 1, updatedAt: 1 });
  await legacySchema.table('syncQueue').put({ id: 'old-schema-outbox', entity: 'note', entityId: 'old-schema-note', operation: 'upsert', createdAt: 1, updatedAt: 1, attempts: 0 });
  legacySchema.close();
  const upgraded = new MarkNoteDatabase('marknote-upgrade-fixture');
  await upgraded.open();
  assert.equal((await upgraded.notes.get('old-schema-note'))?.content, '<p>Legacy v3</p>', 'schema upgrade never rewrites user content');
  assert.equal(await upgraded.syncQueue.count(), 1, 'schema upgrade retains the legacy outbox for recovery');
  assert.equal(await upgraded.drafts.count(), 0);
  assert.equal(await upgraded.noteHistory.count(), 0);
  assert.equal(await upgraded.tombstones.count(), 0);
  await upgraded.delete();

  const guest = getActiveDatabase();
  await guest.delete();
  await guest.open();
  const legacy = await createNote({ id: 'guest-secret', title: 'Local only', content: '<p>Unassigned legacy data</p>' });
  await saveDraft({ noteId: legacy.id, title: 'Local draft', content: '<p>recover me</p>', updatedAt: 1, revision: 1 });
  await addNoteHistory({ id: 'history-guest', noteId: legacy.id, title: legacy.title, content: legacy.content, createdAt: 1 });

  dom.window.localStorage.setItem('marknote-note-snapshots', JSON.stringify({
    [legacy.id]: [{ id: 'old-history', title: 'Older', content: '<p>legacy snapshot</p>', createdAt: 0 }],
  }));
  await migrateLegacyNoteHistory();
  await migrateLegacyNoteHistory();
  assert.equal((await getNoteHistory(legacy.id)).length, 2, 'legacy migration is idempotent');
  assert.ok(dom.window.localStorage.getItem('marknote-note-snapshots'), 'recoverable legacy source retained');

  let notifications = 0;
  const unsubscribe = subscribeWorkspace(() => { notifications += 1; });
  const guestEpoch = getWorkspaceEpoch();
  const accountA = await switchWorkspaceAccount('account-a');
  assert.equal(accountA.kind, 'account');
  assert.equal(isWorkspaceCurrent(guestEpoch), false, 'switch invalidates old sync work');
  assert.equal(await db.notes.get(legacy.id), undefined, 'guest data is not copied on login');
  assert.equal(await db.syncQueue.count(), 0, 'guest outbox cannot enter the account');
  assert.equal(await getDraft(legacy.id), undefined);
  assert.deepEqual(await getNoteHistory(legacy.id), []);
  assert.equal(await ensureSeedNote(), '', 'accounts do not silently create guest samples');

  const databaseA = getActiveDatabase();
  const noteA = await createNote({ id: 'shared-note-id', title: 'A secret', content: '<p>A private note</p>', remoteRevision: 7 });
  await saveDraft({ noteId: noteA.id, title: 'A draft', content: '<p>A newer</p>', revision: 2, updatedAt: 2 });
  await addNoteHistory({ id: 'shared-history-id', noteId: noteA.id, title: noteA.title, content: noteA.content, createdAt: 2 });
  const queueA = await databaseA.syncQueue.where('[entity+entityId]').equals(['note', noteA.id]).first();
  assert.equal(queueA?.baseRemoteRevision, 7);
  assert.ok(queueA?.mutationId);

  const accountB = await switchWorkspaceAccount('account-b');
  assert.notEqual(accountA.databaseName, accountB.databaseName);
  assert.equal(await db.notes.get(noteA.id), undefined, 'A records cannot be read by B');
  assert.equal(await db.images.count(), 0);
  assert.equal(await db.syncQueue.count(), 0, 'A outbox cannot be uploaded by B');
  assert.equal(await db.noteHistory.count(), 0);
  assert.equal(await getDraft(noteA.id), undefined);
  assert.notEqual(workspaceStorageKey('marknote-recent-notes', accountA), workspaceStorageKey('marknote-recent-notes', accountB));
  const noteB = await createNote({ id: noteA.id, title: 'B only', content: '<p>B private note</p>' });

  // A late captured save stays in A even after B becomes active.
  await updateNote(noteA.id, { title: 'A late save' }, { database: databaseA });
  assert.equal((await db.notes.get(noteB.id))?.title, 'B only');
  const newerQueueA = await databaseA.syncQueue.where('[entity+entityId]').equals(['note', noteA.id]).first();
  assert.notEqual(newerQueueA?.mutationId, queueA?.mutationId, 'new edits cannot be acknowledged by an old upload');
  assert.equal(newerQueueA?.snapshot && 'title' in newerQueueA.snapshot && newerQueueA.snapshot.title, 'A late save');
  assert.equal(newerQueueA?.localRevision, 2);
  assert.equal(queueA?.snapshot && 'title' in queueA.snapshot && queueA.snapshot.title, 'A secret', 'captured outbox snapshot stays immutable');
  await Promise.all([
    updateNote(noteA.id, { title: 'A concurrent first' }, { database: databaseA }),
    updateNote(noteA.id, { title: 'A late save' }, { database: databaseA }),
  ]);
  assert.equal((await databaseA.notes.get(noteA.id))?.version, 4, 'concurrent local writes each increase their revision atomically');
  assert.equal((await databaseA.notes.get(noteA.id))?.rawContent, 'A private note', 'metadata edits retain search content');
  await assert.rejects(() => updateNote('missing-note', { title: 'Ghost' }), /no longer exists/);
  assert.equal(await db.syncQueue.where('[entity+entityId]').equals(['note', 'missing-note']).count(), 0);

  await switchWorkspaceAccount('account-a');
  assert.equal((await db.notes.get(noteA.id))?.title, 'A late save');
  assert.equal((await getDraft(noteA.id))?.title, 'A draft');
  assert.equal((await getNoteHistory(noteA.id))[0]?.title, 'A secret');
  await saveDraft({ noteId: noteA.id, title: 'A newest draft', content: '<p>A newest</p>', revision: 3, updatedAt: 3 });
  await saveDraft({ noteId: noteA.id, title: 'Stale draft', content: '<p>old</p>', revision: 2, updatedAt: 2 });
  assert.equal(await removeDraft(noteA.id, 2), false, 'old save cannot remove a newer persisted draft');
  assert.equal((await getDraft(noteA.id))?.revision, 3);

  const image = await createImageAttachment({ id: 'unsynced-image', noteId: noteA.id, data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' });
  await permanentlyDeleteNote(noteA.id);
  assert.equal(await db.notes.get(noteA.id), undefined);
  assert.equal((await db.tombstones.get(`note:${noteA.id}`))?.remoteRevision, 7);
  assert.equal(await db.images.get(image.id), undefined, 'permanent purge leaves no orphan data rows');
  const deletedImage = await db.syncQueue.where('[entity+entityId]').equals(['attachment', image.id]).first();
  assert.equal(deletedImage?.snapshot && 'data' in deletedImage.snapshot && deletedImage.snapshot.data, '', 'delete retains remote metadata without retaining bytes');
  assert.ok(await db.tombstones.get(`attachment:${image.id}`));
  assert.equal((await db.syncQueue.where('[entity+entityId]').equals(['note', noteA.id]).first())?.operation, 'delete');
  const deletion = await db.syncQueue.where('[entity+entityId]').equals(['note', noteA.id]).first();
  assert.equal(deletion?.snapshot && 'content' in deletion.snapshot && deletion.snapshot.content, '', 'permanent deletion does not retain note body in the outbox');
  assert.equal(await getDraft(noteA.id), undefined);

  await switchWorkspaceAccount(null);
  assert.equal(getActiveDatabase(), guest, 'legacy guest DB remains usable after sign-out');
  assert.equal((await db.notes.get(legacy.id))?.title, 'Local only');
  assert.equal((await getNoteHistory(legacy.id)).length, 2);

  const initialEpoch = getWorkspaceEpoch();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const unregister = registerWorkspaceSwitchGuard(async ({ fromDatabase }) => {
    assert.equal(fromDatabase, guest);
    await blocked;
  });
  const firstSwitch = switchWorkspaceAccount('account-c');
  assert.equal(isWorkspaceCurrent(initialEpoch), false, 'auth changes cancel remote work before draft flushing finishes');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const latestSwitch = switchWorkspaceAccount('account-d');
  release();
  await Promise.all([firstSwitch, latestSwitch]);
  assert.equal(getWorkspaceSnapshot().userId, 'account-d', 'latest session wins over a delayed workspace open');
  unregister();

  await switchWorkspaceAccount(null);
  const failGuard = registerWorkspaceSwitchGuard(() => { throw new Error('Draft write failed'); });
  await assert.rejects(() => switchWorkspaceAccount('account-failure'), /Draft write failed/);
  assert.equal(getActiveDatabase(), guest, 'failed old draft persistence cannot discard the old workspace');
  assert.equal(isWorkspaceCurrent(getWorkspaceSnapshot().epoch), true, 'failed guard leaves the old workspace usable with a fresh network epoch');
  failGuard();
  await switchWorkspaceAccount('account-d');
  assert.equal(getWorkspaceSnapshot().userId, 'account-d', 'subsequent switch recovers after a rejected guard');
  assert.ok(notifications >= 5);
  unsubscribe();
  await switchWorkspaceAccount(null);
  const oldEpoch = getWorkspaceEpoch();
  const originalOpen = MarkNoteDatabase.prototype.open;
  Object.defineProperty(MarkNoteDatabase.prototype, 'open', { configurable: true, writable: true,
    value: function (this: MarkNoteDatabase) {
      if (this.name.includes('account-open-failure')) return Promise.reject(new Error('QuotaExceededError'));
      return originalOpen.call(this);
    } });
  try {
    await assert.rejects(() => switchWorkspaceAccount('account-open-failure'), /QuotaExceededError/);
    assert.equal(getActiveDatabase(), guest);
    assert.equal(isWorkspaceCurrent(oldEpoch), false, 'failed opening still cancels previous network work');
    assert.equal(isWorkspaceCurrent(getWorkspaceSnapshot().epoch), true, 'quota failure cannot strand the old workspace');
    await updateNote(legacy.id, { title: 'Still editable after failed opening' });
    assert.equal((await guest.notes.get(legacy.id))?.title, 'Still editable after failed opening');
  } finally {
    Object.defineProperty(MarkNoteDatabase.prototype, 'open', { configurable: true, writable: true, value: originalOpen });
  }
  await switchWorkspaceAccount('account-open-failure');
  assert.equal(getWorkspaceSnapshot().userId, 'account-open-failure', 'opening can be retried after quota diagnosis changes');
  await switchWorkspaceAccount(null);
  console.log('workspace isolation tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { db.close(); });
