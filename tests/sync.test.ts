import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import {
  addNoteHistory, createFolder, createImageAttachment, createNote, db, ensureDefaultFolders,
  enqueueSync, getEditorDrafts, getNoteHistory, hydrateNoteHistoryContent, permanentlyDeleteNote, recoverAllEditorDrafts, saveEditorDraft, softDeleteNote, switchWorkspaceAccount, updateImageAttachment, updateNote,
} from '../src/lib/db';
import { createSyncEngine } from '../src/sync/engine';
import { createDatabaseSaveStore, NoteSaveCoordinator } from '../src/services/noteSave';
import type { OAuthProvider, PushPayload, RemoteSnapshot, RemoteSyncAdapter } from '../src/sync/types';
import type { Folder, ImageAttachment, Note, SyncDevice, SyncEntity } from '../src/types';
import type { MutationReceipt, RemoteChange, RemoteChangePage, SyncMutation } from '../src/sync/protocol';
import { installDomGlobals } from './domGlobals';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
installDomGlobals({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  navigator: dom.window.navigator, DOMParser: dom.window.DOMParser, HTMLElement: dom.window.HTMLElement });

type Entity = Folder | Note | ImageAttachment;
class MemoryAdapter implements RemoteSyncAdapter {
  readonly id = 'custom' as const;
  readonly name = 'Memory';
  readonly configured = true;
  userId = 'user-1';
  signedOut = false;
  pushed: PushPayload[] = [];
  uploadedAttachments: ImageAttachment[] = [];
  downloadedAttachments: ImageAttachment[] = [];
  failRegisterMessage = '';
  failPushMessage = '';
  failUploadMessage = '';
  beforePush: (() => Promise<void>) | undefined;
  beforeUpload: (() => Promise<void>) | undefined;
  snapshot: RemoteSnapshot = { folders: [], notes: [], attachments: [], serverTime: 0 };
  async getSession() { return this.signedOut ? null : { user: { id: this.userId } }; }
  async signInWithOAuth(_provider: OAuthProvider) { void _provider; }
  async completeOAuthSignIn(_url: string) { void _url; return this.getSession(); }
  async signOut() { this.signedOut = true; }
  async registerDevice(_device: SyncDevice) { void _device; if (this.failRegisterMessage) throw new Error(this.failRegisterMessage); }
  async pull(after: number) {
    return { ...this.snapshot,
      folders: this.snapshot.folders.filter((value) => value.updatedAt > after),
      notes: this.snapshot.notes.filter((value) => value.updatedAt > after),
      attachments: this.snapshot.attachments.filter((value) => (value.updatedAt ?? 0) > after) };
  }
  async push(payload: PushPayload) {
    await this.beforePush?.();
    if (this.failPushMessage) throw new Error(this.failPushMessage);
    this.pushed.push(payload);
    return { syncedAt: Date.now() };
  }
  async uploadAttachment(value: ImageAttachment) {
    await this.beforeUpload?.();
    if (this.failUploadMessage) throw new Error(this.failUploadMessage);
    this.uploadedAttachments.push(value);
    return { storagePath: `${this.userId}/${value.noteId}/${value.id}/${value.version ?? 1}` };
  }
  async downloadAttachment(value: ImageAttachment) {
    this.downloadedAttachments.push(value);
    return { data: `data:${value.mimeType};base64,cmVtb3Rl` };
  }
}

class VersionedMemoryAdapter extends MemoryAdapter {
  changes: RemoteChange[] = [];
  values = new Map<string, { revision: number; value: Entity | null }>();
  receipts = new Map<string, MutationReceipt>();
  sent: SyncMutation[][] = [];
  pullCalls = 0;
  failPullCall = 0;
  mutationWhilePulling: (() => void) | undefined;
  key(entity: SyncEntity, id: string) { return `${entity}:${id}`; }
  commit(entity: SyncEntity, id: string, value: Entity | null): RemoteChange {
    const key = this.key(entity, id);
    const revision = (this.values.get(key)?.revision ?? 0) + 1;
    const next = value ? { ...value, remoteRevision: revision, syncStatus: 'synced' as const } : null;
    this.values.set(key, { revision, value: next });
    const change: RemoteChange = { entity, entityId: id, revision, sequence: this.changes.length + 1,
      operation: value ? 'upsert' : 'delete', value: next };
    this.changes.push(change);
    return change;
  }
  async pullChanges(after: number, upperBound?: number): Promise<RemoteChangePage> {
    this.pullCalls++;
    if (this.pullCalls === this.failPullCall) throw new Error('page download failed');
    const bound = upperBound ?? this.changes.length;
    const changes = this.changes.filter((change) => change.sequence > after && change.sequence <= bound).slice(0, 200);
    const last = changes.at(-1)?.sequence ?? after;
    const hasMore = last < bound;
    this.mutationWhilePulling?.();
    this.mutationWhilePulling = undefined;
    return { changes, upperBound: bound, hasMore, nextSequence: hasMore ? last : bound, serverTime: Date.now() };
  }
  async pushMutations(mutations: SyncMutation[]): Promise<MutationReceipt[]> {
    this.sent.push(structuredClone(mutations));
    await this.beforePush?.();
    if (this.failPushMessage) throw new Error(this.failPushMessage);
    return mutations.map((mutation) => {
      const replay = this.receipts.get(mutation.mutationId);
      if (replay) return { ...replay, replayed: true };
      const current = this.values.get(this.key(mutation.entity, mutation.entityId));
      const conflict = (current?.revision ?? 0) !== mutation.expectedRevision || (current?.value === null && mutation.operation === 'upsert');
      const change = conflict ? null : this.commit(mutation.entity, mutation.entityId, mutation.operation === 'delete' ? null : mutation.value);
      const receipt: MutationReceipt = { mutationId: mutation.mutationId, entity: mutation.entity, entityId: mutation.entityId,
        localRevision: mutation.localRevision, status: conflict ? 'conflict' : 'applied',
        revision: change?.revision ?? current?.revision ?? 0, sequence: change?.sequence ?? this.changes.length,
        value: change?.value ?? current?.value ?? null, replayed: false };
      this.receipts.set(mutation.mutationId, receipt);
      return receipt;
    });
  }
}

async function fixture(name: string, versioned = true) {
  const adapter = versioned ? new VersionedMemoryAdapter() : new MemoryAdapter();
  adapter.userId = name;
  await switchWorkspaceAccount(name, 'custom');
  await db.delete(); await db.open(); await ensureDefaultFolders();
  const folder = await createFolder('Sync folder');
  const note = await createNote({ title: 'Local note', content: '<p>local</p>', folderId: folder.id });
  return { adapter, engine: createSyncEngine(adapter), folder, note };
}

async function baselineAndAttachments() {
  const { adapter, engine, note, folder } = await fixture('basic');
  const remote = adapter as VersionedMemoryAdapter;
  const first = await engine.syncNow();
  assert.equal(first.ok, true, first.error); assert.equal(first.pushed, 5);
  assert.equal(await db.syncQueue.count(), 0);
  assert.equal((await db.notes.get(note.id))?.syncStatus, 'synced');
  assert.equal((await db.notes.get(note.id))?.remoteRevision, 1);
  assert.equal((await engine.syncNow()).pushed, 0);
  remote.commit('note', note.id, { ...note, title: 'Remote edit', updatedAt: note.updatedAt - 1000 });
  assert.equal((await engine.syncNow()).ok, true);
  assert.equal((await db.notes.get(note.id))?.title, 'Remote edit', 'server revision wins despite client clock skew');
  await softDeleteNote(note.id);
  assert.equal((await engine.syncNow()).ok, true);
  const softDelete = remote.sent.at(-1)?.find((mutation) => mutation.entityId === note.id);
  assert.equal(softDelete?.operation, 'upsert', 'trash is not permanent deletion');
  assert.ok((softDelete?.value as Note).deletedAt);
  assert.ok((await db.notes.get(note.id))?.deletedAt, 'trash content remains recoverable');
  const fileNote = await createNote({ title: 'Images and files', folderId: folder.id });
  for (const mimeType of ['image/png', 'application/pdf']) {
    const image = await createImageAttachment({ noteId: fileNote.id, data: `data:${mimeType};base64,aGVsbG8=`, mimeType });
    await updateNote(fileNote.id, { content: mimeType === 'image/png'
      ? `<p>file</p><img src="data:${mimeType};base64,aGVsbG8=" data-attachment-id="${image.id}">`
      : `<file-attachment href="data:${mimeType};base64,aGVsbG8=" filename="brief.pdf" data-attachment-id="${image.id}"></file-attachment>` });
    const result = await engine.syncNow(); assert.equal(result.ok, true, result.error);
    assert.equal(adapter.uploadedAttachments.at(-1)?.id, image.id);
    assert.ok((await db.images.get(image.id))?.storagePath);
    assert.equal((await db.images.get(image.id))?.syncStatus, 'synced');
    const pushedNote = remote.sent.at(-1)?.find((mutation) => mutation.entityId === fileNote.id)?.value as Note;
    assert.ok(pushedNote.content.includes(`marknote-attachment://${image.id}`));
  }
}

async function editingDuringPushAndSingleFlight() {
  const { adapter, engine, note } = await fixture('push-race');
  assert.equal((await engine.syncNow()).ok, true);
  await updateNote(note.id, { content: '<p>generation N</p>' });
  const queuedN = await db.syncQueue.where('[entity+entityId]').equals(['note', note.id]).first();
  let started!: () => void; let release!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  adapter.beforePush = async () => { started(); await gate; };
  const run = engine.syncNow();
  await entered;
  assert.equal(engine.syncNow(), run, 'concurrent callers share a single run');
  await updateNote(note.id, { content: '<p>generation N+1</p>' });
  const newer = await db.syncQueue.where('[entity+entityId]').equals(['note', note.id]).first();
  assert.notEqual(newer?.mutationId, queuedN?.mutationId);
  release();
  const result = await run; assert.equal(result.ok, true, result.error);
  assert.equal((await db.notes.get(note.id))?.content, '<p>generation N+1</p>');
  assert.equal((await db.notes.get(note.id))?.syncStatus, 'pending');
  const retained = await db.syncQueue.where('[entity+entityId]').equals(['note', note.id]).first();
  assert.equal(retained?.mutationId, newer?.mutationId);
  assert.equal(retained?.baseRemoteRevision, 2);
  adapter.beforePush = undefined;
  assert.equal((await engine.syncNow()).ok, true);
  assert.equal(await db.syncQueue.count(), 0);
  assert.equal((await db.notes.get(note.id))?.syncStatus, 'synced');
  assert.equal((adapter as VersionedMemoryAdapter).values.get(`note:${note.id}`)?.value && ((adapter as VersionedMemoryAdapter).values.get(`note:${note.id}`)?.value as Note).content, '<p>generation N+1</p>');
}

async function conflictsAndDeletes() {
  const { adapter, engine, note } = await fixture('conflict-delete');
  const remote = adapter as VersionedMemoryAdapter;
  assert.equal((await engine.syncNow()).ok, true);
  await updateNote(note.id, { title: 'Local concurrent', content: '<p>local kept</p>', updatedAt: Date.now() + 100_000 });
  remote.commit('note', note.id, { ...note, title: 'Remote concurrent', content: '<p>remote kept</p>', updatedAt: 1 });
  const conflict = await engine.syncNow(); assert.equal(conflict.ok, true, conflict.error);
  assert.equal((await db.notes.get(note.id))?.content, '<p>remote kept</p>');
  const copies = await db.notes.filter((value) => value.title.includes('冲突副本')).toArray();
  assert.equal(copies.length, 1); assert.equal(copies[0].content, '<p>local kept</p>');
  const staleRemote = { ...(await db.notes.get(note.id))! };
  await permanentlyDeleteNote(note.id);
  // A newer remote live row arriving after local purge still cannot resurrect it.
  remote.commit('note', note.id, { ...staleRemote, content: '<p>stale remote</p>', updatedAt: Date.now() + 200_000 });
  const purge = await engine.syncNow(); assert.equal(purge.ok, true, purge.error);
  assert.equal(await db.notes.get(note.id), undefined);
  assert.equal(remote.values.get(`note:${note.id}`)?.value, null);
  assert.equal(await db.syncQueue.where('[entity+entityId]').equals(['note', note.id]).count(), 0);
  assert.ok(await db.tombstones.get(`note:${note.id}`));
  remote.commit('note', note.id, staleRemote); // bad/old remote protocol must not recreate a purged local id
  assert.equal((await engine.syncNow()).ok, true);
  assert.equal(await db.notes.get(note.id), undefined);
}

async function conflictArrivingDuringPush() {
  const { adapter, engine, note } = await fixture('cas-conflict');
  const remote = adapter as VersionedMemoryAdapter;
  await engine.syncNow();
  await updateNote(note.id, { content: '<p>local version</p>' });
  adapter.beforePush = async () => {
    adapter.beforePush = undefined;
    remote.commit('note', note.id, { ...note, content: '<p>remote during push</p>' });
    await updateNote(note.id, { content: '<p>latest local version</p>' });
  };
  const result = await engine.syncNow(); assert.equal(result.ok, true, result.error);
  assert.equal((await db.notes.get(note.id))?.content, '<p>remote during push</p>');
  assert.equal(await db.notes.filter((value) => value.content === '<p>latest local version</p>').count(), 1);
}

async function conflictAttachmentsAreIndependent() {
  const { adapter, engine, note } = await fixture('conflict-attachments');
  const remote = adapter as VersionedMemoryAdapter;
  const image = await createImageAttachment({ noteId: note.id, data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' });
  await updateNote(note.id, { content: `<p>with image</p><img src="${image.data}" data-attachment-id="${image.id}">` });
  await engine.syncNow();
  await updateNote(note.id, { title: 'Local image note' });
  remote.commit('note', note.id, { ...(await db.notes.get(note.id))!, title: 'Remote image note', content: '<p>remote removed image</p>' });
  const result = await engine.syncNow(); assert.equal(result.ok, true, result.error);
  const copy = await db.notes.filter((value) => value.title.includes('冲突副本')).first();
  assert.ok(copy);
  const copiedImage = await db.images.where('noteId').equals(copy.id).first();
  assert.ok(copiedImage); assert.notEqual(copiedImage.id, image.id);
  assert.equal(copiedImage.data, image.data);
  assert.ok(copy.content.includes(copiedImage.id));
  assert.equal(copy.content.includes(`data-attachment-id="${image.id}"`), false);
}

async function paginatedPullAndResume() {
  const { adapter, engine, note, folder } = await fixture('pages');
  const remote = adapter as VersionedMemoryAdapter;
  await engine.syncNow();
  for (let index = 0; index < 1001; index++) remote.commit('note', `page-${index}`, { ...note, id: `page-${index}`, title: `Row ${index}`, folderId: folder.id, updatedAt: 7 });
  remote.failPullCall = remote.pullCalls + 3;
  const failed = await engine.syncNow(); assert.equal(failed.ok, false);
  assert.equal(await db.notes.filter((value) => value.id.startsWith('page-')).count(), 400);
  const state = await db.syncStates.where('userId').equals(adapter.userId).first();
  assert.equal(state?.lastPulledSeq, 405, 'cursor commits only successful pages');
  remote.failPullCall = 0;
  remote.mutationWhilePulling = () => remote.commit('note', 'during-pages', { ...note, id: 'during-pages', updatedAt: 7 });
  const recovered = await engine.syncNow(); assert.equal(recovered.ok, true, recovered.error);
  assert.equal(await db.notes.filter((value) => value.id.startsWith('page-')).count(), 1001);
  assert.ok(await db.notes.get('during-pages'), 'next pull includes concurrent writes above fixed bound');
  assert.equal((await db.syncStates.get(state!.id))?.lastPulledSeq, remote.changes.length);
}

async function boundedPushBatchesResume() {
  const { adapter, engine, folder } = await fixture('push-batches');
  const remote = adapter as VersionedMemoryAdapter;
  await engine.syncNow();
  for (let index = 0; index < 205; index++) await createNote({ id: `batch-${index}`, title: `Batch ${index}`, folderId: folder.id });
  let batches = 0;
  adapter.beforePush = async () => { if (++batches === 2) throw new Error('second batch failed'); };
  const failed = await engine.syncNow(); assert.equal(failed.ok, false);
  assert.equal(await db.syncQueue.count(), 105, 'first acknowledged batch is not queued again');
  assert.equal(await db.notes.filter((value) => value.id.startsWith('batch-') && value.syncStatus === 'synced').count(), 100);
  adapter.beforePush = undefined;
  const retried = await engine.syncNow(); assert.equal(retried.ok, true, retried.error);
  assert.equal(await db.syncQueue.count(), 0);
  assert.ok(remote.sent.every((batch) => batch.length <= 100));
  assert.equal(await db.notes.filter((value) => value.id.startsWith('batch-') && value.syncStatus === 'synced').count(), 205);
}

async function failuresAndIdentity() {
  const { adapter, engine, note } = await fixture('failure');
  adapter.failPushMessage = 'network down';
  const before = await db.syncQueue.where('[entity+entityId]').equals(['note', note.id]).first();
  assert.equal((await engine.syncNow()).ok, false);
  const failed = await db.syncQueue.get(before!.id);
  assert.equal(failed?.attempts, 1); assert.equal(failed?.lastError, 'network down');
  assert.equal(failed?.mutationId, before?.mutationId, 'retry preserves frozen generation identity');
  assert.equal((await db.notes.get(note.id))?.syncStatus, 'error');
  adapter.failPushMessage = '';
  assert.equal((await engine.syncNow()).ok, true);
  await updateNote(note.id, { content: '<p>account A queued</p>' });
  const accountADatabase = db;
  adapter.beforePush = async () => { adapter.beforePush = undefined; await switchWorkspaceAccount('other-user', 'custom'); adapter.userId = 'other-user'; };
  const late = await engine.syncNow(); assert.equal(late.ok, false); assert.match(late.error || '', /Workspace changed/);
  assert.equal(await db.notes.count(), 0, 'late account A response does not write B');
  assert.equal(await accountADatabase.syncQueue.where('[entity+entityId]').equals(['note', note.id]).count(), 1);
  assert.equal((await accountADatabase.notes.get(note.id))?.syncStatus, 'pending');
  await switchWorkspaceAccount('failure', 'custom'); adapter.userId = 'failure';
  assert.equal((await engine.syncNow()).ok, true, 'same immutable mutation can be confirmed after returning to A');
  adapter.signedOut = true;
  assert.equal((await engine.syncNow()).error, 'Please sign in before syncing.');
}

async function uploadRacesAndDownloads() {
  const { adapter, engine, note } = await fixture('upload-race');
  await engine.syncNow();
  const attachment = await createImageAttachment({ noteId: note.id, data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' });
  adapter.beforeUpload = async () => {
    adapter.beforeUpload = undefined;
    await updateImageAttachment(attachment.id, { data: 'data:image/png;base64,bmV3' });
  };
  const result = await engine.syncNow(); assert.equal(result.ok, true, result.error);
  assert.equal((await db.images.get(attachment.id))?.data, 'data:image/png;base64,bmV3');
  assert.equal((await db.images.get(attachment.id))?.storagePath, undefined, 'old upload cannot replace new bytes/storage path');
  assert.equal((await db.images.get(attachment.id))?.syncStatus, 'pending');
  assert.equal((await engine.syncNow()).ok, true);
  const remote = adapter as VersionedMemoryAdapter;
  remote.commit('note', 'download-note', { ...note, id: 'download-note', content: '<p>remote</p><file-attachment href="marknote-attachment://download-file" filename="brief.pdf" data-attachment-id="download-file"></file-attachment>' });
  remote.commit('attachment', 'download-file', { id: 'download-file', noteId: 'download-note', mimeType: 'application/pdf', data: '', storagePath: `${adapter.userId}/download-note/download-file`, createdAt: 1, updatedAt: 2 });
  assert.equal((await engine.syncNow()).ok, true);
  assert.ok((await db.notes.get('download-note'))?.content.includes('data:application/pdf;base64,cmVtb3Rl'));
}

async function unflushedDraftSurvivesRemotePurge() {
  const { adapter, engine, note } = await fixture('remote-draft-purge');
  const remote = adapter as VersionedMemoryAdapter;
  const attachment = await createImageAttachment({ noteId: note.id, data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' });
  await updateNote(note.id, { content: `<p>base</p><img src="${attachment.data}" data-attachment-id="${attachment.id}">` });
  await engine.syncNow();
  const current = (await db.notes.get(note.id))!;
  const store = createDatabaseSaveStore(db);
  const coordinator = new NoteSaveCoordinator(store);
  const snapshot = coordinator.stage(note.id, 'Typing before debounce', `<p>unflushed latest</p><img src="${attachment.data}" data-attachment-id="${attachment.id}">`, current.version);
  await store.persistDraft(snapshot);
  // A second tab has its own unsent generation, with no note queue yet.
  await saveEditorDraft({ noteId: note.id, title: 'Other tab latest', content: '<p>other tab unflushed</p>', revision: 77, updatedAt: Date.now() }, 'other-tab');
  assert.equal(await db.syncQueue.where('[entity+entityId]').equals(['note', note.id]).count(), 0);
  remote.commit('note', note.id, null);
  const result = await engine.syncNow(); assert.equal(result.ok, true, result.error);
  assert.equal(await db.notes.get(note.id), undefined);
  const recovered = await db.notes.filter((value) => value.content.includes('unflushed latest')).first();
  assert.ok(recovered, 'typing staged before debounce survives remote purge as independent recovery note');
  assert.equal(await db.notes.filter((value) => value.content === '<p>other tab unflushed</p>').count(), 1);
  const copiedAttachment = await db.images.where('noteId').equals(recovered.id).first();
  assert.ok(copiedAttachment); assert.notEqual(copiedAttachment.id, attachment.id);
  assert.equal(copiedAttachment.data, attachment.data);
  const foreign = (await getEditorDrafts(note.id)).find((draft) => draft.editorId === 'other-tab');
  assert.equal(foreign?.content, '<p>other tab unflushed</p>'); assert.ok(foreign?.recoveredNoteId);
  const afterReload = await recoverAllEditorDrafts('new-tab-after-reload');
  assert.deepEqual(afterReload.recoveredNoteIds, [], 'already-preserved generations are not copied again after reload');
  assert.ok((await db.notes.get(recovered.id))?.content.includes('unflushed latest'));
}

async function historicalAttachmentsStayLocal() {
  const { adapter, engine, note } = await fixture('history-local');
  const remote = adapter as VersionedMemoryAdapter;
  const active = await createImageAttachment({ noteId: note.id, data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' });
  await updateNote(note.id, { content: `<p>current</p><img src="${active.data}" data-attachment-id="${active.id}">` });
  await addNoteHistory({ id: 'local-image-history', noteId: note.id, title: note.title, content: (await db.notes.get(note.id))!.content, createdAt: Date.now() }, { force: true });
  const history = (await getNoteHistory(note.id))[0];
  const historyAsset = await db.images.filter((value) => value.noteId === note.id && Boolean(value.historyOnly)).first();
  assert.ok(historyAsset);
  assert.ok(history.content.includes(historyAsset.id));
  const first = await engine.syncNow(); assert.equal(first.ok, true, first.error);
  assert.equal(adapter.uploadedAttachments.some((value) => value.id === historyAsset.id), false);
  assert.equal(remote.sent.flat().some((mutation) => mutation.entityId === historyAsset.id), false);
  assert.equal((await db.images.get(historyAsset.id))?.syncStatus, 'local');
  // A stale or manually inserted queue entry must not bypass the local-history boundary.
  await enqueueSync('attachment', historyAsset.id, 'upsert');
  assert.equal((await engine.syncNow()).ok, true);
  assert.equal(await db.syncQueue.where('[entity+entityId]').equals(['attachment', historyAsset.id]).count(), 0);
  assert.equal(adapter.uploadedAttachments.some((value) => value.id === historyAsset.id), false);
  await updateNote(note.id, { content: '<p>current without old image</p>' });
  assert.equal((await engine.syncNow()).ok, true);
  const hydrated = await hydrateNoteHistoryContent(history.content, note.id);
  await updateNote(note.id, { content: hydrated });
  const restoredNote = (await db.notes.get(note.id))!;
  const document = new DOMParser().parseFromString(restoredNote.content, 'text/html');
  const restoredId = document.querySelector('img')?.getAttribute('data-attachment-id');
  assert.ok(restoredId); assert.notEqual(restoredId, historyAsset.id);
  const restored = (await db.images.get(restoredId))!;
  assert.equal(restored.historyOnly, false);
  assert.equal(restored.data, active.data);
  const historyAfter = (await db.images.get(historyAsset.id))!;
  assert.equal(historyAfter.historyOnly, true);
  assert.equal(historyAfter.data, historyAsset.data, 'restoring does not mutate immutable historical bytes');
  const second = await engine.syncNow(); assert.equal(second.ok, true, second.error);
  assert.ok(adapter.uploadedAttachments.some((value) => value.id === restoredId));
  assert.equal(adapter.uploadedAttachments.some((value) => value.id === historyAsset.id), false);
  assert.equal((await db.images.get(restoredId))?.syncStatus, 'synced');
}

async function remoteContentSecurity() {
  const { adapter, engine, note } = await fixture('remote-security');
  const remote = adapter as VersionedMemoryAdapter;
  await engine.syncNow();
  remote.commit('note', 'unsafe-remote-note', { ...note, id: 'unsafe-remote-note', content: '<p>keep</p><img src=x onerror="window.__active=true"><a href="javascript:alert(1)">link</a><script>window.__active=true</script>' });
  assert.equal((await engine.syncNow()).ok, true);
  const safe = (await db.notes.get('unsafe-remote-note'))?.content || '';
  assert.match(safe, /keep/);
  assert.doesNotMatch(safe, /onerror|javascript:|<script/i);
  const cursor = (await db.syncStates.where('userId').equals(adapter.userId).first())?.lastPulledSeq;
  remote.commit('attachment', 'active-svg', { id: 'active-svg', noteId: note.id, mimeType: 'image/svg+xml', data: '', storagePath: `${adapter.userId}/${note.id}/active-svg`, createdAt: 1, updatedAt: 2 });
  const rejected = await engine.syncNow();
  assert.equal(rejected.ok, false); assert.match(rejected.error || '', /Unsafe remote attachment/);
  assert.equal(await db.images.get('active-svg'), undefined);
  assert.equal((await db.syncStates.where('userId').equals(adapter.userId).first())?.lastPulledSeq, cursor, 'unsafe page cannot advance cursor');
}

async function legacyCompatibility() {
  const { adapter, engine, note } = await fixture('legacy', false);
  assert.equal((await engine.syncNow()).ok, true);
  assert.equal(await db.syncQueue.count(), 0);
  await updateNote(note.id, { content: '<p>legacy N</p>' });
  adapter.beforePush = async () => { adapter.beforePush = undefined; await updateNote(note.id, { content: '<p>legacy N+1</p>' }); };
  assert.equal((await engine.syncNow()).ok, true);
  assert.equal((await db.notes.get(note.id))?.syncStatus, 'pending');
  assert.equal((await db.notes.get(note.id))?.content, '<p>legacy N+1</p>');
  assert.equal((await engine.syncNow()).ok, true);
  assert.equal(await db.syncQueue.count(), 0);
  await permanentlyDeleteNote(note.id);
  adapter.snapshot.notes = [{ ...note, updatedAt: Date.now() + 100000 }];
  assert.equal((await engine.syncNow()).ok, true);
  assert.equal(await db.notes.get(note.id), undefined);
}

async function accountBoundaries() {
  await switchWorkspaceAccount(null);
  await db.delete(); await db.open();
  const guest = await createNote({ title: 'guest secret' });
  const adapter = new VersionedMemoryAdapter(); adapter.userId = 'boundary-A';
  const mismatch = await createSyncEngine(adapter).syncNow(); assert.equal(mismatch.ok, false);
  assert.equal(adapter.sent.length, 0, 'guest is never automatically uploaded into signed-in account');
  await switchWorkspaceAccount('boundary-A', 'custom'); await ensureDefaultFolders();
  const accountA = await createNote({ title: 'A secret' });
  assert.equal((await createSyncEngine(adapter).syncNow()).ok, true);
  assert.equal(adapter.sent.flat().some((item) => item.entityId === guest.id), false);
  await switchWorkspaceAccount('boundary-B', 'custom'); await ensureDefaultFolders();
  const b = new VersionedMemoryAdapter(); b.userId = 'boundary-B';
  assert.equal((await createSyncEngine(b).syncNow()).ok, true);
  assert.equal(b.sent.flat().some((item) => item.entityId === guest.id || item.entityId === accountA.id), false);
  await switchWorkspaceAccount('boundary-A', 'custom'); assert.ok(await db.notes.get(accountA.id));
  await enqueueSync('note', accountA.id, 'upsert');
  const queue = await db.syncQueue.where('[entity+entityId]').equals(['note', accountA.id]).first();
  assert.ok(queue?.snapshot); assert.ok(queue?.mutationId);
}

async function main() {
  await baselineAndAttachments();
  await editingDuringPushAndSingleFlight();
  await conflictsAndDeletes();
  await conflictArrivingDuringPush();
  await conflictAttachmentsAreIndependent();
  await paginatedPullAndResume();
  await boundedPushBatchesResume();
  await failuresAndIdentity();
  await uploadRacesAndDownloads();
  await unflushedDraftSurvivesRemotePurge();
  await historicalAttachmentsStayLocal();
  await remoteContentSecurity();
  await legacyCompatibility();
  await accountBoundaries();
  console.log('sync tests passed (versioned ACK races, conflict copies, purge, paging, identity, attachments)');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
