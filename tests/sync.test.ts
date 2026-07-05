import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import {
  createFolder,
  createImageAttachment,
  createNote,
  db,
  ensureDefaultFolders,
  enqueueSync,
  softDeleteNote,
  updateImageAttachment,
} from '../src/lib/db';
import { createSyncEngine } from '../src/sync/engine';
import type { OAuthProvider, PushPayload, RemoteSnapshot, RemoteSyncAdapter } from '../src/sync/types';
import type { ImageAttachment, SyncDevice } from '../src/types';
import { installDomGlobals } from './domGlobals';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1/',
});

installDomGlobals({
  localStorage: dom.window.localStorage,
  navigator: dom.window.navigator,
  DOMParser: dom.window.DOMParser,
  HTMLElement: dom.window.HTMLElement,
});

class MemoryAdapter implements RemoteSyncAdapter {
  readonly id = 'custom' as const;
  readonly name = 'Memory';
  readonly configured = true;
  pushed: PushPayload[] = [];
  uploadedAttachments: ImageAttachment[] = [];
  downloadedAttachments: ImageAttachment[] = [];
  failRegisterMessage = '';
  failPushMessage = '';
  failUploadMessage = '';
  signedOut = false;
  userId = 'user-1';
  email = 'sync@example.com';
  snapshot: RemoteSnapshot = {
    folders: [],
    notes: [],
    attachments: [],
    serverTime: 0,
  };

  async getSession() {
    if (this.signedOut) {
      return null;
    }
    return { user: { id: this.userId, email: this.email } };
  }

  async signInWithOAuth(_provider: OAuthProvider) {
    void _provider;
    return undefined;
  }

  async completeOAuthSignIn(_callbackUrl: string) {
    void _callbackUrl;
    return this.getSession();
  }

  async signOut() {
    return undefined;
  }

  async registerDevice(_device: SyncDevice) {
    void _device;
    if (this.failRegisterMessage) {
      throw new Error(this.failRegisterMessage);
    }
    return undefined;
  }

  async pull(lastPulledAt: number) {
    return {
      ...this.snapshot,
      folders: this.snapshot.folders.filter((folder) => folder.updatedAt > lastPulledAt),
      notes: this.snapshot.notes.filter((note) => note.updatedAt > lastPulledAt),
      attachments: this.snapshot.attachments.filter((attachment) => (attachment.updatedAt ?? attachment.createdAt ?? 0) > lastPulledAt),
    };
  }

  async push(payload: PushPayload) {
    if (this.failPushMessage) {
      throw new Error(this.failPushMessage);
    }
    this.pushed.push(payload);
    return { syncedAt: 1000 };
  }

  async uploadAttachment(attachment: ImageAttachment) {
    if (this.failUploadMessage) {
      throw new Error(this.failUploadMessage);
    }
    this.uploadedAttachments.push(attachment);
    return { storagePath: `user-1/${attachment.noteId}/${attachment.id}` };
  }

  async downloadAttachment(attachment: ImageAttachment) {
    this.downloadedAttachments.push(attachment);
    return { data: `data:${attachment.mimeType};base64,cmVtb3Rl` };
  }
}

async function main() {
  await db.delete();
  await db.open();
  await ensureDefaultFolders();

  const folder = await createFolder('Sync folder');
  const note = await createNote({
    title: 'Local note',
    content: '<p>local</p>',
    folderId: folder.id,
  });

  const adapter = new MemoryAdapter();
  const engine = createSyncEngine(adapter);
  const first = await engine.syncNow();
  assert.equal(first.ok, true);
  assert.equal(first.pushed, 5);
  assert.equal(adapter.pushed[0].folders.length, 4);
  assert.equal(adapter.pushed[0].notes.length, 1);
  assert.equal(await db.syncQueue.count(), 0);
  assert.equal((await db.notes.get(note.id))?.syncStatus, 'synced');

  const cleanPushCount = adapter.pushed.length;
  const clean = await engine.syncNow();
  assert.equal(clean.ok, true);
  assert.equal(clean.pushed, 0);
  assert.equal(adapter.pushed.length, cleanPushCount);

  adapter.snapshot = {
    folders: [],
    notes: [
      {
        id: note.id,
        title: 'Remote wins',
        content: '<p>remote</p>',
        rawContent: 'remote',
        folderId: folder.id,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt + 10,
        tags: [],
        pinned: false,
        deletedAt: null,
        syncStatus: 'synced',
      },
    ],
    attachments: [],
    serverTime: 3000,
  };
  const second = await engine.syncNow();
  assert.equal(second.ok, true);
  assert.equal((await db.notes.get(note.id))?.title, 'Remote wins');

  adapter.snapshot = {
    folders: [],
    notes: [
      {
        id: note.id,
        title: 'Remote deleted',
        content: '<p>deleted</p>',
        rawContent: 'deleted',
        folderId: folder.id,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt + 20,
        tags: [],
        pinned: false,
        deletedAt: note.updatedAt + 20,
        syncStatus: 'synced',
      },
    ],
    attachments: [],
    serverTime: 4000,
  };
  const third = await engine.syncNow();
  assert.equal(third.ok, true);
  assert.equal((await db.notes.get(note.id))?.deletedAt, note.updatedAt + 20);

  const conflictLocalUpdatedAt = Date.now() + 1000;
  const conflictRemoteUpdatedAt = conflictLocalUpdatedAt + 1000;
  const conflictingNote = await createNote({
    id: 'conflicting-note',
    title: 'Local stale edit',
    content: '<p>local stale</p>',
    rawContent: 'local stale',
    folderId: folder.id,
    createdAt: conflictLocalUpdatedAt,
    updatedAt: conflictLocalUpdatedAt,
  });
  adapter.snapshot = {
    folders: [],
    notes: [
      {
        id: conflictingNote.id,
        title: 'Remote newer edit',
        content: '<p>remote newer</p>',
        rawContent: 'remote newer',
        folderId: folder.id,
        createdAt: conflictingNote.createdAt,
        updatedAt: conflictRemoteUpdatedAt,
        tags: [],
        pinned: false,
        deletedAt: null,
        syncStatus: 'synced',
      },
    ],
    attachments: [],
    serverTime: conflictRemoteUpdatedAt,
  };
  const pushedBeforeConflict = adapter.pushed.length;
  const conflict = await engine.syncNow();
  assert.equal(conflict.ok, true);
  assert.equal(conflict.pushed, 0);
  assert.equal(adapter.pushed.length, pushedBeforeConflict);
  assert.equal((await db.notes.get(conflictingNote.id))?.title, 'Remote newer edit');
  assert.equal((await db.notes.get(conflictingNote.id))?.syncStatus, 'synced');
  assert.equal(await db.syncQueue.where('[entity+entityId]').equals(['note', conflictingNote.id]).count(), 0);

  await softDeleteNote(note.id);
  adapter.snapshot = {
    folders: [],
    notes: [],
    attachments: [],
    serverTime: 5000,
  };
  const fourth = await engine.syncNow();
  assert.equal(fourth.ok, true);
  const fourthPayload = adapter.pushed.at(-1);
  assert.ok(fourthPayload);
  assert.deepEqual(fourthPayload.notes.map((item) => item.id), []);
  assert.deepEqual(fourthPayload.deleted.notes, [note.id]);

  const imageNote = await createNote({
    title: 'Image note',
    content: '<p>image</p>',
    folderId: folder.id,
  });
  const attachment = await createImageAttachment({
    noteId: imageNote.id,
    data: 'data:image/png;base64,aGVsbG8=',
    mimeType: 'image/png',
    sizeBytes: 5,
  });
  await db.notes.update(imageNote.id, {
    content: `<p>image</p><img src="data:image/png;base64,aGVsbG8=" data-attachment-id="${attachment.id}">`,
  });
  const fifth = await engine.syncNow();
  assert.equal(fifth.ok, true);
  assert.equal(adapter.uploadedAttachments.at(-1)?.id, attachment.id);
  const syncedAttachment = await db.images.get(attachment.id);
  assert.equal(syncedAttachment?.storagePath, `user-1/${imageNote.id}/${attachment.id}`);
  assert.equal(syncedAttachment?.syncStatus, 'synced');
  const fifthPayload = adapter.pushed.at(-1);
  assert.ok(fifthPayload);
  assert.deepEqual(fifthPayload.attachments.map((item) => item.id), [attachment.id]);
  assert.equal(fifthPayload.notes[0].content.includes('data:image/png'), false);
  assert.equal(fifthPayload.notes[0].content.includes(`marknote-attachment://${attachment.id}`), true);

  await updateImageAttachment(attachment.id, { deletedAt: Date.now() });
  const sixth = await engine.syncNow();
  assert.equal(sixth.ok, true);
  const sixthPayload = adapter.pushed.at(-1);
  assert.ok(sixthPayload);
  assert.equal(typeof sixthPayload.deleted.attachments[0], 'object');
  assert.equal((sixthPayload.deleted.attachments[0] as ImageAttachment).id, attachment.id);
  assert.equal((sixthPayload.deleted.attachments[0] as ImageAttachment).storagePath, `user-1/${imageNote.id}/${attachment.id}`);
  assert.equal(await db.images.get(attachment.id), undefined);

  const fileNote = await createNote({
    title: 'File note',
    content: '<p>file</p>',
    folderId: folder.id,
  });
  const fileAttachment = await createImageAttachment({
    noteId: fileNote.id,
    data: 'data:application/pdf;base64,aGVsbG8=',
    mimeType: 'application/pdf',
    sizeBytes: 5,
  });
  const seventh = await engine.syncNow();
  assert.equal(seventh.ok, true);
  assert.equal(adapter.uploadedAttachments.at(-1)?.id, fileAttachment.id);
  assert.equal(adapter.uploadedAttachments.at(-1)?.mimeType, 'application/pdf');
  const syncedFileAttachment = await db.images.get(fileAttachment.id);
  assert.equal(syncedFileAttachment?.storagePath, `user-1/${fileNote.id}/${fileAttachment.id}`);
  const seventhPayload = adapter.pushed.at(-1);
  assert.ok(seventhPayload);
  assert.deepEqual(seventhPayload.attachments.map((item) => item.id), [fileAttachment.id]);

  const remoteAttachmentUpdatedAt = Date.now() + 3000;
  adapter.snapshot = {
    folders: [],
    notes: [
      {
        id: fileNote.id,
        title: 'File note from remote',
        content: `<p>remote file</p><file-attachment href="marknote-attachment://${fileAttachment.id}" filename="brief.pdf" data-attachment-id="${fileAttachment.id}"></file-attachment>`,
        rawContent: 'remote file',
        folderId: folder.id,
        createdAt: fileNote.createdAt,
        updatedAt: remoteAttachmentUpdatedAt,
        tags: [],
        pinned: false,
        deletedAt: null,
        syncStatus: 'synced',
      },
    ],
    attachments: [
      {
        id: fileAttachment.id,
        noteId: fileNote.id,
        data: '',
        mimeType: 'application/pdf',
        storagePath: `user-1/${fileNote.id}/${fileAttachment.id}`,
        createdAt: fileAttachment.createdAt,
        updatedAt: remoteAttachmentUpdatedAt,
        syncStatus: 'synced',
      },
    ],
    serverTime: remoteAttachmentUpdatedAt,
  };
  const eighth = await engine.syncNow();
  assert.equal(eighth.ok, true);
  assert.equal(adapter.downloadedAttachments.at(-1)?.id, fileAttachment.id);
  assert.match((await db.notes.get(fileNote.id))?.content || '', /data:application\/pdf;base64,cmVtb3Rl/);
  assert.equal((await db.images.get(fileAttachment.id))?.data, 'data:application/pdf;base64,cmVtb3Rl');

  const delayedNoteUpdatedAt = remoteAttachmentUpdatedAt + 1000;
  const delayedAttachmentUpdatedAt = delayedNoteUpdatedAt + 1000;
  adapter.snapshot = {
    folders: [],
    notes: [
      {
        id: 'delayed-file-note',
        title: 'Delayed file note',
        content: '<file-attachment href="marknote-attachment://delayed-file" filename="delayed.pdf" data-attachment-id="delayed-file"></file-attachment>',
        rawContent: 'delayed file',
        folderId: folder.id,
        createdAt: delayedNoteUpdatedAt,
        updatedAt: delayedNoteUpdatedAt,
        tags: [],
        pinned: false,
        deletedAt: null,
        syncStatus: 'synced',
      },
    ],
    attachments: [],
    serverTime: delayedNoteUpdatedAt,
  };
  const delayedNotePull = await engine.syncNow();
  assert.equal(delayedNotePull.ok, true);
  assert.match((await db.notes.get('delayed-file-note'))?.content || '', /marknote-attachment:\/\/delayed-file/);

  adapter.snapshot = {
    folders: [],
    notes: [],
    attachments: [
      {
        id: 'delayed-file',
        noteId: 'delayed-file-note',
        data: '',
        mimeType: 'application/pdf',
        storagePath: 'user-1/delayed-file-note/delayed-file',
        createdAt: delayedAttachmentUpdatedAt,
        updatedAt: delayedAttachmentUpdatedAt,
        syncStatus: 'synced',
      },
    ],
    serverTime: delayedAttachmentUpdatedAt,
  };
  const delayedAttachmentPull = await engine.syncNow();
  assert.equal(delayedAttachmentPull.ok, true);
  assert.equal(adapter.downloadedAttachments.at(-1)?.id, 'delayed-file');
  assert.match((await db.notes.get('delayed-file-note'))?.content || '', /data:application\/pdf;base64,cmVtb3Rl/);
  assert.equal((await db.images.get('delayed-file'))?.data, 'data:application/pdf;base64,cmVtb3Rl');

  const failingAdapter = new MemoryAdapter();
  failingAdapter.failPushMessage = 'network down';
  const failingEngine = createSyncEngine(failingAdapter);
  const failingNote = await createNote({
    title: 'Will retry',
    content: '<p>retry me</p>',
    folderId: folder.id,
  });
  const failingResult = await failingEngine.syncNow();
  assert.equal(failingResult.ok, false);
  assert.match(failingResult.error || '', /network down/);
  const retryItem = await db.syncQueue.where('[entity+entityId]').equals(['note', failingNote.id]).first();
  assert.ok(retryItem);
  assert.equal(retryItem.attempts, 1);
  assert.equal(retryItem.lastError, 'network down');
  assert.equal((await db.notes.get(failingNote.id))?.syncStatus, 'error');

  const failingUploadAdapter = new MemoryAdapter();
  failingUploadAdapter.failUploadMessage = 'storage offline';
  const failingUploadEngine = createSyncEngine(failingUploadAdapter);
  const uploadFailNote = await createNote({
    title: 'Upload retry',
    content: '<p>upload retry</p>',
    folderId: folder.id,
  });
  const uploadFailAttachment = await createImageAttachment({
    noteId: uploadFailNote.id,
    data: 'data:image/png;base64,aGVsbG8=',
    mimeType: 'image/png',
    sizeBytes: 5,
  });
  const uploadFailResult = await failingUploadEngine.syncNow();
  assert.equal(uploadFailResult.ok, false);
  assert.match(uploadFailResult.error || '', /storage offline/);
  const uploadRetryItem = await db.syncQueue.where('[entity+entityId]').equals(['attachment', uploadFailAttachment.id]).first();
  assert.ok(uploadRetryItem);
  assert.equal(uploadRetryItem.attempts, 1);
  assert.equal(uploadRetryItem.lastError, 'storage offline');
  const retryAttachment = await db.images.get(uploadFailAttachment.id);
  assert.equal(retryAttachment?.syncStatus, 'error');
  assert.equal(retryAttachment?.storagePath, undefined);

  const pushAfterUploadFailAdapter = new MemoryAdapter();
  pushAfterUploadFailAdapter.failPushMessage = 'table write down';
  const pushAfterUploadFailEngine = createSyncEngine(pushAfterUploadFailAdapter);
  const pushAfterUploadFailNote = await createNote({
    title: 'Upload once then retry push',
    content: '<p>upload once</p>',
    folderId: folder.id,
  });
  const pushAfterUploadFailAttachment = await createImageAttachment({
    noteId: pushAfterUploadFailNote.id,
    data: 'data:image/png;base64,aGVsbG8=',
    mimeType: 'image/png',
    sizeBytes: 5,
  });
  const firstPushAfterUploadFail = await pushAfterUploadFailEngine.syncNow();
  assert.equal(firstPushAfterUploadFail.ok, false);
  assert.match(firstPushAfterUploadFail.error || '', /table write down/);
  assert.equal(pushAfterUploadFailAdapter.uploadedAttachments.filter((item) => item.id === pushAfterUploadFailAttachment.id).length, 1);
  assert.equal(
    (await db.images.get(pushAfterUploadFailAttachment.id))?.storagePath,
    `user-1/${pushAfterUploadFailNote.id}/${pushAfterUploadFailAttachment.id}`,
  );

  const secondPushAfterUploadFail = await pushAfterUploadFailEngine.syncNow();
  assert.equal(secondPushAfterUploadFail.ok, false);
  assert.equal(pushAfterUploadFailAdapter.uploadedAttachments.filter((item) => item.id === pushAfterUploadFailAttachment.id).length, 1);
  assert.equal((await db.images.get(pushAfterUploadFailAttachment.id))?.syncStatus, 'error');

  const previousAccountAdapter = new MemoryAdapter();
  previousAccountAdapter.userId = 'user-previous';
  previousAccountAdapter.email = 'previous@example.com';
  const previousAccountEngine = createSyncEngine(previousAccountAdapter);
  const previousAccountClean = await previousAccountEngine.syncNow();
  assert.equal(previousAccountClean.ok, true);
  const previousAccountState = await db.syncStates.where('userId').equals('user-previous').first();
  assert.ok(previousAccountState);

  const currentAccountFailAdapter = new MemoryAdapter();
  currentAccountFailAdapter.userId = 'user-current';
  currentAccountFailAdapter.email = 'current@example.com';
  currentAccountFailAdapter.failPushMessage = 'current account write down';
  const currentAccountFailEngine = createSyncEngine(currentAccountFailAdapter);
  await createNote({
    title: 'Current account failure',
    content: '<p>fail current account only</p>',
    folderId: folder.id,
  });
  const currentAccountFail = await currentAccountFailEngine.syncNow();
  assert.equal(currentAccountFail.ok, false);
  const cleanPreviousAccountState = await db.syncStates.get(previousAccountState.id);
  const failedCurrentAccountState = await db.syncStates.where('userId').equals('user-current').first();
  assert.equal(cleanPreviousAccountState?.lastError, undefined);
  assert.equal(failedCurrentAccountState?.lastError, 'current account write down');

  const earlyFailPreviousAdapter = new MemoryAdapter();
  earlyFailPreviousAdapter.userId = 'early-previous';
  earlyFailPreviousAdapter.email = 'early-previous@example.com';
  const earlyFailPreviousEngine = createSyncEngine(earlyFailPreviousAdapter);
  const earlyFailPreviousClean = await earlyFailPreviousEngine.syncNow();
  assert.equal(earlyFailPreviousClean.ok, true);
  const earlyFailPreviousState = await db.syncStates.where('userId').equals('early-previous').first();
  assert.ok(earlyFailPreviousState);

  const earlyFailCurrentAdapter = new MemoryAdapter();
  earlyFailCurrentAdapter.userId = 'early-current';
  earlyFailCurrentAdapter.email = 'early-current@example.com';
  earlyFailCurrentAdapter.failRegisterMessage = 'device registration down';
  const earlyFailCurrentEngine = createSyncEngine(earlyFailCurrentAdapter);
  const earlyFailCurrent = await earlyFailCurrentEngine.syncNow();
  assert.equal(earlyFailCurrent.ok, false);
  const cleanEarlyFailPreviousState = await db.syncStates.get(earlyFailPreviousState.id);
  const failedEarlyFailCurrentState = await db.syncStates.where('userId').equals('early-current').first();
  assert.equal(cleanEarlyFailPreviousState?.lastError, undefined);
  assert.equal(failedEarlyFailCurrentState?.lastError, 'device registration down');

  const signedOutPreviousAdapter = new MemoryAdapter();
  signedOutPreviousAdapter.userId = 'signed-out-previous';
  signedOutPreviousAdapter.email = 'signed-out-previous@example.com';
  const signedOutPreviousClean = await createSyncEngine(signedOutPreviousAdapter).syncNow();
  assert.equal(signedOutPreviousClean.ok, true);
  const signedOutPreviousState = await db.syncStates.where('userId').equals('signed-out-previous').first();
  assert.ok(signedOutPreviousState);

  const signedOutAdapter = new MemoryAdapter();
  signedOutAdapter.signedOut = true;
  const signedOutResult = await createSyncEngine(signedOutAdapter).syncNow();
  assert.equal(signedOutResult.ok, false);
  assert.equal(signedOutResult.error, 'Please sign in before syncing.');
  const cleanSignedOutPreviousState = await db.syncStates.get(signedOutPreviousState.id);
  assert.equal(cleanSignedOutPreviousState?.lastError, undefined);

  const crossAccountAdapter = new MemoryAdapter();
  crossAccountAdapter.userId = 'account-a';
  crossAccountAdapter.email = 'account-a@example.com';
  const crossAccountFirst = await createSyncEngine(crossAccountAdapter).syncNow();
  assert.equal(crossAccountFirst.ok, true);
  const syncedForAccountA = crossAccountAdapter.pushed.at(-1);
  assert.ok(syncedForAccountA);
  assert.ok(syncedForAccountA.folders.length > 0);

  const crossAccountSecondAdapter = new MemoryAdapter();
  crossAccountSecondAdapter.userId = 'account-b';
  crossAccountSecondAdapter.email = 'account-b@example.com';
  const crossAccountSecond = await createSyncEngine(crossAccountSecondAdapter).syncNow();
  assert.equal(crossAccountSecond.ok, true);
  const accountBPayload = crossAccountSecondAdapter.pushed.at(-1);
  assert.ok(accountBPayload);
  assert.ok(accountBPayload.folders.some((item) => item.id === folder.id));
  assert.ok(accountBPayload.notes.length > 0);

  await db.syncQueue.clear();
  const dependencyAdapter = new MemoryAdapter();
  dependencyAdapter.userId = 'dependency-account';
  dependencyAdapter.email = 'dependency@example.com';
  const dependencyFolder = await createFolder('Dependency folder');
  const dependencyNote = await createNote({
    title: 'Dependency note',
    content: '<p>dependency</p>',
    folderId: dependencyFolder.id,
  });
  const dependencyAttachment = await createImageAttachment({
    noteId: dependencyNote.id,
    data: 'data:image/png;base64,aGVsbG8=',
    mimeType: 'image/png',
    sizeBytes: 5,
  });
  await db.folders.update(dependencyFolder.id, { syncStatus: 'synced' });
  await db.notes.update(dependencyNote.id, { syncStatus: 'synced' });
  await db.images.update(dependencyAttachment.id, { syncStatus: 'pending' });
  const dependencyDeviceId = localStorage.getItem('marknote-sync-device-id') || 'manual-device';
  await db.syncStates.put({
    id: `sync-state:custom:dependency-account:${dependencyDeviceId}`,
    provider: 'custom',
    userId: 'dependency-account',
    deviceId: dependencyDeviceId,
    lastPulledAt: 1,
    lastPushedAt: 1,
    lastSyncedAt: 1,
    status: 'synced',
  });
  await enqueueSync('attachment', dependencyAttachment.id, 'upsert');
  const dependencySync = await createSyncEngine(dependencyAdapter).syncNow();
  assert.equal(dependencySync.ok, true);
  const dependencyPayload = dependencyAdapter.pushed.at(-1);
  assert.ok(dependencyPayload);
  assert.equal(dependencyPayload.folders.filter((item) => item.id === dependencyFolder.id).length, 1);
  assert.equal(dependencyPayload.notes.filter((item) => item.id === dependencyNote.id).length, 1);
  assert.deepEqual(dependencyPayload.attachments.map((item) => item.id), [dependencyAttachment.id]);
  assert.equal((await db.folders.get(dependencyFolder.id))?.syncStatus, 'synced');
  assert.equal((await db.notes.get(dependencyNote.id))?.syncStatus, 'synced');
  assert.equal((await db.images.get(dependencyAttachment.id))?.syncStatus, 'synced');

  console.log('sync tests passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    db.close();
  });
