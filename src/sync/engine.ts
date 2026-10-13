import { nanoid } from 'nanoid';
import { db, enqueueSync, recoverEditorDrafts, type MarkNoteDatabase } from '../lib/db';
import { getWorkspaceSnapshot, isWorkspaceCurrent } from '../workspace/state';
import { extractAttachmentRefIds, replaceAttachmentDataUrlsWithRefs, restoreAttachmentRefs } from '../lib/attachmentContent';
import type { Folder, ImageAttachment, Note, SyncEntity, SyncQueueItem, SyncState } from '../types';
import type { PushPayload, RemoteSnapshot, RemoteSyncAdapter, SyncResult } from './types';
import type { MutationReceipt, RemoteChangePage, SyncMutation } from './protocol';
import { getOrCreateDevice } from './device';
import { isSafeContentMimeType, sanitizeContentUrl, sanitizeNoteContent } from '../lib/sanitizeContent';

const STATE_ID_PREFIX = 'sync-state';
const LOCK_TTL_MS = 45_000;
const runningSyncs = new Map<string, Promise<SyncResult>>();
type Entity = Folder | Note | ImageAttachment;
interface LeaseState extends SyncState { leaseOwner?: string; leaseExpiresAt?: number }

/** A sync run owns one database and one identity, including across every network wait. */
interface SyncContext {
  database: MarkNoteDatabase;
  adapter: RemoteSyncAdapter;
  epoch: number;
  userId: string;
  conflicts: number;
  leaseId?: string;
  leaseOwner?: string;
  assertCurrent(): void;
  check(): Promise<void>;
  network<T>(operation: () => Promise<T>): Promise<T>;
}

export class SyncEngine {
  constructor(private readonly adapter: RemoteSyncAdapter) {}

  syncNow(): Promise<SyncResult> {
    const database = db;
    const workspace = getWorkspaceSnapshot();
    const key = `${database.name}:${this.adapter.id}`;
    const existing = runningSyncs.get(key);
    if (existing) return existing;
    const run = this.run(database, workspace.epoch).finally(() => {
      if (runningSyncs.get(key) === run) runningSyncs.delete(key);
    });
    runningSyncs.set(key, run);
    return run;
  }

  private async run(database: MarkNoteDatabase, epoch: number): Promise<SyncResult> {
    if (!this.adapter.configured) return failure('Sync provider is not configured.');
    if (this.adapter.id === 'supabase' && (!this.adapter.pullChanges || !this.adapter.pushMutations)) return failure('Versioned sync protocol is required for this provider.');
    let stateId = '';
    let context: SyncContext | undefined;
    try {
      const session = await this.adapter.getSession();
      if (!session) return failure('Please sign in before syncing.');
      const workspace = getWorkspaceSnapshot();
      if (!isWorkspaceCurrent(epoch) || workspace.kind !== 'account' || workspace.userId !== session.user.id || workspace.provider !== this.adapter.id) {
        return failure('The signed-in account does not own the active workspace.');
      }
      context = createContext(database, this.adapter, epoch, session.user.id);
      const device = getOrCreateDevice(this.adapter.id);
      stateId = `${STATE_ID_PREFIX}:${this.adapter.id}:${session.user.id}:${device.id}`;
      const operation = async () => {
        await context!.check();
        await database.syncDevices.put(device);
        let state = await database.syncStates.get(stateId);
        if (!state) {
          state = { id: stateId, provider: this.adapter.id, userId: session.user.id, deviceId: device.id,
            lastPulledAt: 0, lastPulledSeq: 0, lastPushedAt: 0, lastSyncedAt: 0, status: 'local' };
          await database.syncStates.put(state);
        }
        await context!.network(() => this.adapter.registerDevice(device, session.user.id));
        await ensureLocalChangesQueued(context!, Boolean(this.adapter.pushMutations));
        const result = this.adapter.pullChanges && this.adapter.pushMutations
          ? await syncVersioned(context!, state)
          : await syncLegacy(context!, state);
        return result;
      };
      if (typeof navigator !== 'undefined' && navigator.locks) {
        return await navigator.locks.request(`marknote-sync:${database.name}`, { ifAvailable: true }, async (lock) => {
          if (!lock) return failure('Another tab is currently syncing this workspace.');
          return operation();
        });
      }
      return await withDatabaseLease(context, operation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed.';
      // A late failure from account A must not affect account B's state or display.
      if (stateId && context && isWorkspaceCurrent(epoch)) {
        await database.syncStates.update(stateId, { status: 'error', lastError: message }).catch(() => undefined);
      }
      return failure(message);
    }
  }
}

export function createSyncEngine(adapter: RemoteSyncAdapter): SyncEngine { return new SyncEngine(adapter); }
function failure(error: string): SyncResult { return { ok: false, pushed: 0, pulled: 0, error }; }

function createContext(database: MarkNoteDatabase, adapter: RemoteSyncAdapter, epoch: number, userId: string): SyncContext {
  const context: SyncContext = {
    database, adapter, epoch, userId, conflicts: 0,
    assertCurrent() {
      if (!isWorkspaceCurrent(epoch)) throw new Error('Workspace changed; the previous sync response was discarded.');
    },
    async check() {
      context.assertCurrent();
      const session = await adapter.getSession();
      context.assertCurrent();
      if (session?.user.id !== userId) throw new Error('Account changed; the previous sync response was discarded.');
      if (context.leaseId) {
        const lease = await database.syncStates.get(context.leaseId) as LeaseState | undefined;
        if (lease?.leaseOwner !== context.leaseOwner || (lease?.leaseExpiresAt || 0) <= Date.now()) {
          throw new Error('Sync lock expired; the previous response was discarded.');
        }
      }
    },
    async network<T>(operation: () => Promise<T>) {
      await context.check();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Sync request timed out. Local changes remain queued for retry.')), 30_000); }),
      ]).finally(() => { if (timeout !== undefined) clearTimeout(timeout); });
      await context.check();
      return result;
    },
  };
  return context;
}

async function withDatabaseLease(context: SyncContext, operation: () => Promise<SyncResult>): Promise<SyncResult> {
  const { database } = context;
  const leaseId = `sync-lock:${database.name}`;
  const owner = nanoid();
  const acquired = await database.transaction('rw', database.syncStates, async () => {
    const previous = await database.syncStates.get(leaseId) as LeaseState | undefined;
    if (previous?.leaseOwner && (previous.leaseExpiresAt || 0) > Date.now()) return false;
    const next: LeaseState = { id: leaseId, provider: context.adapter.id, userId: context.userId, deviceId: '',
      lastPulledAt: 0, lastPushedAt: 0, lastSyncedAt: 0, status: 'local', leaseOwner: owner,
      leaseExpiresAt: Date.now() + LOCK_TTL_MS };
    await database.syncStates.put(next);
    return true;
  });
  if (!acquired) return failure('Another tab is currently syncing this workspace.');
  context.leaseId = leaseId;
  context.leaseOwner = owner;
  const renewal = setInterval(() => {
    void database.transaction('rw', database.syncStates, async () => {
      const lease = await database.syncStates.get(leaseId) as LeaseState | undefined;
      if (lease?.leaseOwner === owner && isWorkspaceCurrent(context.epoch)) {
        await database.syncStates.update(leaseId, { leaseExpiresAt: Date.now() + LOCK_TTL_MS } as Partial<LeaseState>);
      }
    }).catch(() => undefined);
  }, 10_000);
  try { return await operation(); }
  finally {
    clearInterval(renewal);
    await database.transaction('rw', database.syncStates, async () => {
      const lease = await database.syncStates.get(leaseId) as LeaseState | undefined;
      if (lease?.leaseOwner === owner) await database.syncStates.delete(leaseId);
    }).catch(() => undefined);
  }
}

async function ensureLocalChangesQueued(context: SyncContext, versioned: boolean): Promise<void> {
  const { database } = context;
  await database.transaction('rw', database.folders, database.notes, database.images, database.syncQueue, async () => {
    context.assertCurrent();
    for (const entity of ['folder', 'note', 'attachment'] as const) {
      for (const value of await entityTable(database, entity).toArray()) {
        if (entity === 'attachment' && (value as ImageAttachment).historyOnly) continue;
        const queued = await queueFor(database, entity, value.id);
        if (queued) continue; // Never replace an immutable failed/sending snapshot during a retry.
        if (value.syncStatus === 'synced' && (!versioned || value.remoteRevision !== undefined)) continue;
        await enqueueSync(entity, value.id, 'upsert', { database });
        await entityTable(database, entity).update(value.id, { syncStatus: 'pending' });
      }
    }
  });
}

async function syncVersioned(context: SyncContext, state: SyncState): Promise<SyncResult> {
  let pulled = await pullChanges(context, state);
  const items = await context.database.syncQueue.orderBy('updatedAt').toArray();
  let mutations: SyncMutation[];
  try { mutations = await buildMutations(context, items); }
  catch (error) { await markQueueItemsFailed(context, items, messageOf(error)); throw error; }
  const receipts: MutationReceipt[] = [];
  for (let offset = 0; offset < mutations.length; offset += 100) {
    const batch = mutations.slice(offset, offset + 100);
    let acknowledged: MutationReceipt[];
    try { acknowledged = await context.network(() => context.adapter.pushMutations!(batch, context.userId)); }
    catch (error) { await markQueueItemsFailed(context, items, messageOf(error)); throw error; }
    // Each request and acknowledgement transaction is bounded. A later failed batch
    // does not force thousands of already confirmed generations to be sent again.
    if (acknowledged.length !== batch.length || batch.some((mutation) => !acknowledged.some((receipt) => receipt.mutationId === mutation.mutationId))) {
      throw new Error('The server did not acknowledge every submitted mutation. Local changes remain queued.');
    }
    await context.database.transaction('rw', context.database.tables, async () => {
        context.assertCurrent();
        for (const receipt of acknowledged) {
          const mutation = batch.find((candidate) => candidate.mutationId === receipt.mutationId)!;
          if (receipt.entity !== mutation.entity || receipt.entityId !== mutation.entityId || receipt.localRevision !== mutation.localRevision) {
            throw new Error('The server acknowledgement does not match the submitted mutation.');
          }
          await acknowledgeMutation(context, items.find((item) => item.mutationId === receipt.mutationId || item.id === receipt.mutationId)!, mutation, receipt);
        }
        context.assertCurrent();
      });
    receipts.push(...acknowledged);
  }
  pulled += await pullChanges(context, state);
  if (context.adapter.flushAttachmentGarbage) await context.network(() => context.adapter.flushAttachmentGarbage!(context.userId));
  await context.check();
  const syncedAt = Date.now();
  await context.database.syncStates.update(state.id, { lastPushedAt: syncedAt, lastSyncedAt: syncedAt,
    status: 'synced', lastError: undefined });
  return { ok: true, pushed: receipts.filter((receipt) => receipt.status === 'applied').length, pulled, conflicts: context.conflicts, syncedAt };
}

async function pullChanges(context: SyncContext, state: SyncState): Promise<number> {
  let sequence = state.lastPulledSeq ?? 0;
  let upperBound: number | undefined;
  let changed = 0;
  while (true) {
    const page = await context.network(() => context.adapter.pullChanges!(sequence, upperBound, context.userId));
    validatePage(page, sequence, upperBound);
    upperBound = page.upperBound;
    const hydrated = await hydrateRemoteAttachments(context, page.changes.filter((change) => change.entity === 'attachment' && change.value)
      .map((change) => change.value as ImageAttachment));
    const attachments = new Map(hydrated.map((value) => [value.id, value]));
    await context.database.transaction('rw', context.database.tables, async () => {
        context.assertCurrent();
        for (const change of page.changes) {
          const value = change.entity === 'attachment' ? attachments.get(change.entityId) || change.value : change.value;
          changed += await applyRemote(context, change.entity, change.entityId, value, change.revision, change.operation === 'delete');
        }
        changed += await restoreExistingNoteAttachmentRefs(context, hydrated);
        // Applying a page and committing its cursor are one transaction: interruption replays a whole page.
        await context.database.syncStates.update(state.id, { lastPulledSeq: page.nextSequence });
        context.assertCurrent();
      });
    sequence = page.nextSequence;
    state.lastPulledSeq = sequence;
    if (!page.hasMore) break;
  }
  return changed;
}

function validatePage(page: RemoteChangePage, sequence: number, upperBound: number | undefined): void {
  if (!Number.isSafeInteger(page.nextSequence) || !Number.isSafeInteger(page.upperBound) || page.nextSequence < sequence
    || page.nextSequence > page.upperBound || (upperBound !== undefined && page.upperBound !== upperBound)
    || (page.hasMore && page.nextSequence === sequence)) throw new Error('The server returned an invalid sync cursor.');
  let previous = sequence;
  for (const change of page.changes) {
    if (!Number.isSafeInteger(change.sequence) || change.sequence <= previous || change.sequence > page.nextSequence
      || !Number.isSafeInteger(change.revision) || change.revision < 1) throw new Error('The server returned unordered sync changes.');
    previous = change.sequence;
  }
}

async function buildMutations(context: SyncContext, items: SyncQueueItem[]): Promise<SyncMutation[]> {
  const mutations: SyncMutation[] = [];
  for (const item of items) {
    const current = await entityTable(context.database, item.entity).get(item.entityId);
    let value: Entity | null = item.snapshot ?? current ?? null;
    if (item.entity === 'attachment' && ((value as ImageAttachment | null)?.historyOnly || (current as ImageAttachment | undefined)?.historyOnly)) {
      await discardHistoryOnlyQueueItem(context, item);
      continue;
    }
    if (item.operation === 'upsert' && !value) continue;
    if (item.entity === 'attachment' && value && item.operation !== 'delete') {
      value = await prepareAttachment(context, value as ImageAttachment);
    }
    if (item.entity === 'note' && value) value = prepareNoteForPush(value as Note);
    mutations.push({ mutationId: item.mutationId || item.id, entity: item.entity, entityId: item.entityId,
      operation: item.operation, expectedRevision: item.baseRemoteRevision ?? value?.remoteRevision ?? 0,
      localRevision: item.localRevision ?? value?.version ?? item.updatedAt,
      value: item.operation === 'delete' ? null : value });
  }
  return mutations.sort((a, b) => {
    if (a.operation !== b.operation) return a.operation === 'upsert' ? -1 : 1;
    const rank = { folder: 0, note: 1, attachment: 2 };
    return a.operation === 'upsert' ? rank[a.entity] - rank[b.entity] : rank[b.entity] - rank[a.entity];
  });
}

async function acknowledgeMutation(context: SyncContext, sentItem: SyncQueueItem, mutation: SyncMutation, receipt: MutationReceipt): Promise<void> {
  const { database } = context;
  const queued = await queueFor(database, mutation.entity, mutation.entityId);
  const exact = queued && sameQueueGeneration(queued, sentItem);
  if (receipt.status === 'conflict') {
    if (receipt.revision === 0 && receipt.value === null && queued) {
      // A missing remote record is not a purge tombstone; retry the retained local data as a creation.
      await database.syncQueue.update(queued.id, { baseRemoteRevision: 0, mutationId: nanoid(), attempts: 0, lastError: undefined });
      return;
    }
    // Keep the current local edit, including edits made while this upload was waiting.
    const local = await entityTable(database, mutation.entity).get(mutation.entityId);
    if (local && !sameLogicalEntity(local, receipt.value)) await preserveConflict(context, mutation.entity, local, queued?.mutationId || mutation.mutationId, receipt.revision);
    // A local purge intent remains queued against the current remote revision.
    if (queued?.operation === 'delete') {
      await database.syncQueue.update(queued.id, { baseRemoteRevision: receipt.revision, mutationId: nanoid(), attempts: 0, lastError: undefined });
      await rememberTombstone(context, mutation.entity, mutation.entityId, receipt.revision);
      return;
    }
    if (queued) await database.syncQueue.delete(queued.id);
    await storeRemote(context, mutation.entity, mutation.entityId, receipt.value, receipt.revision, !receipt.value);
    return;
  }
  const local = await entityTable(database, mutation.entity).get(mutation.entityId);
  if (mutation.operation === 'delete') {
    await rememberTombstone(context, mutation.entity, mutation.entityId, receipt.revision);
    if (exact) {
      await storeRemote(context, mutation.entity, mutation.entityId, null, receipt.revision, true);
      await database.syncQueue.delete(queued.id);
    }
    return;
  }
  if (local) {
    await entityTable(database, mutation.entity).update(local.id, { remoteRevision: receipt.revision,
      ...(exact && sameLogicalEntity(local, mutation.value) ? { syncStatus: 'synced', lastSyncedAt: Date.now() } : {}) });
  }
  if (exact && sameLogicalEntity(local, mutation.value)) await database.syncQueue.delete(queued.id);
  else if (queued) {
    // A new generation has not been sent yet; advance its CAS base after acknowledging the earlier one.
    await database.syncQueue.update(queued.id, { baseRemoteRevision: receipt.revision,
      snapshot: queued.snapshot ? { ...queued.snapshot, remoteRevision: receipt.revision } : undefined });
  }
}

async function syncLegacy(context: SyncContext, state: SyncState): Promise<SyncResult> {
  const first = await context.network(() => context.adapter.pull(state.lastPulledAt));
  let pulled = await applyLegacySnapshot(context, first);
  const firstPulledAt = Math.max(state.lastPulledAt, maxRemoteUpdatedAt(first));
  const items = await context.database.syncQueue.orderBy('updatedAt').toArray();
  let payload: PushPayload;
  try { payload = await buildLegacyPayload(context, items); }
  catch (error) { await markQueueItemsFailed(context, items, messageOf(error)); throw error; }
  const pushed = payload.folders.length + payload.notes.length + payload.attachments.length
    + payload.deleted.folders.length + payload.deleted.notes.length + payload.deleted.attachments.length;
  let pushedAt = Date.now();
  if (pushed) {
    try { pushedAt = (await context.network(() => context.adapter.push(payload))).syncedAt; }
    catch (error) { await markQueueItemsFailed(context, items, messageOf(error)); throw error; }
  }
  await context.database.transaction('rw', context.database.folders, context.database.notes, context.database.images, context.database.syncQueue, async () => {
    context.assertCurrent();
    for (const item of items) {
      const queued = await context.database.syncQueue.get(item.id);
      if (!queued || !sameQueueGeneration(queued, item)) continue;
      const local = await entityTable(context.database, item.entity).get(item.entityId);
      const sent = item.entity === 'note' ? payload.notes.find((value) => value.id === item.entityId)
        : item.entity === 'folder' ? payload.folders.find((value) => value.id === item.entityId)
          : payload.attachments.find((value) => value.id === item.entityId);
      if (item.operation === 'delete') {
        if (item.entity === 'attachment') await context.database.images.delete(item.entityId);
        await context.database.syncQueue.delete(item.id);
      } else if (sameLogicalEntity(local, sent ?? (item.snapshot?.deletedAt ? item.snapshot : undefined))) {
        await entityTable(context.database, item.entity).update(item.entityId, { syncStatus: 'synced', lastSyncedAt: pushedAt });
        await context.database.syncQueue.delete(item.id);
      }
    }
  });
  const second = await context.network(() => context.adapter.pull(firstPulledAt));
  pulled += await applyLegacySnapshot(context, second);
  const syncedAt = Date.now();
  await context.database.syncStates.update(state.id, { lastPulledAt: Math.max(firstPulledAt, maxRemoteUpdatedAt(second)),
    lastPushedAt: pushedAt, lastSyncedAt: syncedAt, status: 'synced', lastError: undefined });
  return { ok: true, pushed, pulled, conflicts: context.conflicts, syncedAt };
}

async function buildLegacyPayload(context: SyncContext, items: SyncQueueItem[]): Promise<PushPayload> {
  const payload: PushPayload = { folders: [], notes: [], attachments: [], deleted: { folders: [], notes: [], attachments: [] } };
  for (const item of items) {
    const current = await entityTable(context.database, item.entity).get(item.entityId);
    const value = item.snapshot ?? current;
    if (item.entity === 'attachment' && ((value as ImageAttachment | undefined)?.historyOnly || (current as ImageAttachment | undefined)?.historyOnly)) {
      await discardHistoryOnlyQueueItem(context, item);
      continue;
    }
    if (item.operation === 'delete') {
      if (item.entity === 'folder') payload.deleted.folders.push(item.entityId);
      if (item.entity === 'note') payload.deleted.notes.push(item.entityId);
      if (item.entity === 'attachment') payload.deleted.attachments.push(value as ImageAttachment || item.entityId);
      continue;
    }
    if (!value) continue;
    if (item.entity === 'folder') {
      if (value.deletedAt) payload.deleted.folders.push(value.id);
      else if (!payload.folders.some((folder) => folder.id === value.id)) payload.folders.push(value as Folder);
    }
    if (item.entity === 'note') {
      if (value.deletedAt) payload.deleted.notes.push(value.id);
      else {
        const note = value as Note;
        await addLegacyFolder(context, payload, note.folderId);
        if (!payload.notes.some((candidate) => candidate.id === note.id)) payload.notes.push(prepareNoteForPush(note));
      }
    }
    if (item.entity === 'attachment') {
      const attachment = value as ImageAttachment;
      if (attachment.deletedAt) payload.deleted.attachments.push(attachment);
      else {
        if (!payload.notes.some((note) => note.id === attachment.noteId)) {
          const note = await context.database.notes.get(attachment.noteId);
          if (note && !note.deletedAt) { await addLegacyFolder(context, payload, note.folderId); payload.notes.push(prepareNoteForPush(note)); }
        }
        payload.attachments.push(await prepareAttachment(context, attachment));
      }
    }
  }
  return payload;
}

async function addLegacyFolder(context: SyncContext, payload: PushPayload, id: string): Promise<void> {
  if (payload.folders.some((value) => value.id === id)) return;
  const folder = await context.database.folders.get(id);
  if (folder && !folder.deletedAt) payload.folders.push(folder);
}

async function discardHistoryOnlyQueueItem(context: SyncContext, item: SyncQueueItem): Promise<void> {
  await context.database.transaction('rw', context.database.syncQueue, async () => {
    context.assertCurrent();
    const queued = await context.database.syncQueue.get(item.id);
    if (queued && sameQueueGeneration(queued, item)) await context.database.syncQueue.delete(item.id);
    context.assertCurrent();
  });
}

async function prepareAttachment(context: SyncContext, attachment: ImageAttachment): Promise<ImageAttachment> {
  if (attachment.historyOnly) throw new Error('History-only attachments must remain local.');
  if (!isSafeContentMimeType(attachment.mimeType, 'file') || (attachment.data && !sanitizeContentUrl(attachment.data, 'file'))) throw new Error('Unsafe attachment content.');
  if (attachment.storagePath || !attachment.data || !context.adapter.uploadAttachment) return attachment;
  const uploaded = await context.network(() => context.adapter.uploadAttachment!(attachment, context.userId));
  const next = { ...attachment, storagePath: uploaded.storagePath };
  await context.database.transaction('rw', context.database.images, context.database.syncQueue, async () => {
    context.assertCurrent();
    const local = await context.database.images.get(attachment.id);
    if (sameLogicalEntity(local, attachment)) {
      await context.database.images.update(attachment.id, { storagePath: uploaded.storagePath });
      const queued = await queueFor(context.database, 'attachment', attachment.id);
      if (queued?.snapshot && sameLogicalEntity(queued.snapshot, attachment)) await context.database.syncQueue.update(queued.id, { snapshot: next });
    }
    context.assertCurrent();
  });
  return next;
}

function prepareNoteForPush(note: Note): Note { return { ...note, content: replaceAttachmentDataUrlsWithRefs(sanitizeNoteContent(note.content)) }; }

async function applyLegacySnapshot(context: SyncContext, snapshot: RemoteSnapshot): Promise<number> {
  const attachments = await hydrateRemoteAttachments(context, snapshot.attachments);
  let changed = 0;
  await context.database.transaction('rw', context.database.tables, async () => {
      context.assertCurrent();
      for (const folder of snapshot.folders) changed += await applyRemote(context, 'folder', folder.id, folder, folder.remoteRevision, Boolean(folder.deletedAt), true);
      for (const note of snapshot.notes) changed += await applyRemote(context, 'note', note.id, note, note.remoteRevision, false, true);
      for (const attachment of attachments) changed += await applyRemote(context, 'attachment', attachment.id, attachment, attachment.remoteRevision, Boolean(attachment.deletedAt), true);
      changed += await restoreExistingNoteAttachmentRefs(context, attachments);
      context.assertCurrent();
    });
  return changed;
}

async function applyRemote(context: SyncContext, entity: SyncEntity, id: string, remote: Entity | null, revision: number | undefined, deleted: boolean, legacy = false): Promise<number> {
  const { database } = context;
  if (entity === 'attachment' && remote && !deleted) {
    const attachment = remote as ImageAttachment;
    const parentQueue = await queueFor(database, 'note', attachment.noteId);
    if (parentQueue?.operation === 'delete' || await database.tombstones.get(`note:${attachment.noteId}`)) {
      const alreadyQueued = await queueFor(database, 'attachment', id);
      if (!alreadyQueued || alreadyQueued.baseRemoteRevision !== revision) {
        await enqueueSync('attachment', id, 'delete', { database, snapshot: { ...attachment, data: '' }, baseRemoteRevision: revision ?? 0 });
      }
      await rememberTombstone(context, 'attachment', id, revision ?? 0);
      return 0;
    }
  }
  const queued = await queueFor(database, entity, id);
  const local = await entityTable(database, entity).get(id);
  const tombstone = await database.tombstones.get(`${entity}:${id}`);
  // A pending purge, or a confirmed purge tombstone, never accepts a live remote row.
  if ((queued?.operation === 'delete' || tombstone) && !deleted) {
    if (revision !== undefined && queued && revision > (queued.baseRemoteRevision ?? 0)) {
      await database.syncQueue.update(queued.id, { baseRemoteRevision: revision, mutationId: nanoid() });
    }
    return 0;
  }
  if (!legacy && revision !== undefined && revision <= (local?.remoteRevision ?? tombstone?.remoteRevision ?? 0)) return 0;
  if (legacy && local && entityUpdatedAt(local) > entityUpdatedAt(remote) && !queued) return 0;
  if (queued && local) {
    // Same server base is an echo, so keep the newer unsent local generation.
    if (!legacy && revision === (queued.baseRemoteRevision ?? 0)) return 0;
    if (sameLogicalEntity(local, remote)) return 0;
    await preserveConflict(context, entity, local, queued.mutationId || queued.id, revision ?? entityUpdatedAt(remote));
    await database.syncQueue.delete(queued.id);
  } else if (queued?.operation === 'delete') {
    // A remote purge satisfies a pending local purge without recreating the removed row.
    await database.syncQueue.delete(queued.id);
  }
  await storeRemote(context, entity, id, remote, revision, deleted);
  return 1;
}

async function storeRemote(context: SyncContext, entity: SyncEntity, id: string, value: Entity | null, revision: number | undefined, deleted: boolean): Promise<void> {
  if (entity === 'note' && (await context.database.drafts.get(id)
    || await context.database.editorDrafts.where('noteId').equals(id).count())) {
    // A durable editor draft is a local modification even before a Note/Outbox commit.
    // Preserve every editor's generation and independent attachment bytes before replacing the original.
    const recovered = await recoverEditorDrafts(id, 'remote-recovery', { database: context.database });
    context.conflicts += recovered.recoveredNoteIds.length;
  }
  if (deleted || !value) {
    if (entity === 'note') {
      await context.database.noteHistory.where('noteId').equals(id).delete();
      for (const attachment of await context.database.images.where('noteId').equals(id).toArray()) {
        await context.database.images.delete(attachment.id);
        const queued = await queueFor(context.database, 'attachment', attachment.id);
        if (queued) await context.database.syncQueue.delete(queued.id);
        await rememberTombstone(context, 'attachment', attachment.id, attachment.remoteRevision ?? 0);
      }
    }
    const retained = entity === 'attachment' ? await context.database.images.get(id) : undefined;
    if (retained?.retainedForHistory && retained.data) {
      await context.database.images.update(id, { deletedAt: Date.now(), storagePath: undefined, remoteRevision: revision, syncStatus: 'synced' });
    } else await entityTable(context.database, entity).delete(id);
    await rememberTombstone(context, entity, id, revision ?? 0);
    return;
  }
  let next: Entity = { ...value, remoteRevision: revision ?? value.remoteRevision, syncStatus: 'synced', lastSyncedAt: Date.now() };
  if (entity === 'note') {
    const local = await context.database.notes.get(id);
    next = { ...(next as Note), version: local ? Math.max(local.version ?? 0, next.version ?? 0) + 1 : next.version ?? 1, content: sanitizeNoteContent(restoreAttachmentRefs((next as Note).content, await context.database.images.toArray())) };
  }
  await entityTable(context.database, entity).put(next);
}

async function rememberTombstone(context: SyncContext, entity: SyncEntity, id: string, remoteRevision: number): Promise<void> {
  const key = `${entity}:${id}`;
  const existing = await context.database.tombstones.get(key);
  await context.database.tombstones.put({ ...existing, id: key, entity, entityId: id,
    deletedAt: existing?.deletedAt ?? Date.now(), remoteRevision: Math.max(existing?.remoteRevision ?? 0, remoteRevision) });
}

async function preserveConflict(context: SyncContext, entity: SyncEntity, local: Entity, generation: string, revision: number): Promise<void> {
  const id = `${local.id}-conflict-${generation}-${revision}`;
  if (await entityTable(context.database, entity).get(id)) return;
  context.conflicts++;
  const copy: Entity = { ...local, id, remoteRevision: 0, syncStatus: 'conflict', version: 1, lastSyncedAt: null,
    ...(entity === 'note' ? { title: `${(local as Note).title}（冲突副本）`, content: sanitizeNoteContent((local as Note).content), deletedAt: null } : {}),
    ...(entity === 'folder' ? { name: `${(local as Folder).name}（冲突副本）`, deletedAt: null } : {}),
    ...(entity === 'attachment' ? { storagePath: undefined } : {}) };
  if (entity === 'note') {
    const note = copy as Note;
    const doc = new DOMParser().parseFromString(note.content, 'text/html');
    for (const attachment of await context.database.images.where('noteId').equals(local.id).toArray()) {
      const targets = Array.from(doc.querySelectorAll('[data-attachment-id]')).filter((element) => element.getAttribute('data-attachment-id') === attachment.id);
      if (!targets.length) continue;
      const attachmentCopy: ImageAttachment = { ...attachment, id: `${attachment.id}-conflict-${generation}-${revision}`,
        noteId: id, storagePath: undefined, deletedAt: null, historyOnly: false, retainedForHistory: false, remoteRevision: 0, version: 1, syncStatus: 'pending', lastSyncedAt: null };
      await context.database.images.put(attachmentCopy);
      await enqueueSync('attachment', attachmentCopy.id, 'upsert', { database: context.database, snapshot: attachmentCopy, baseRemoteRevision: 0 });
      for (const target of targets) {
        target.setAttribute('data-attachment-id', attachmentCopy.id);
        const attribute = ['IMG', 'VIDEO', 'AUDIO'].includes(target.tagName) ? 'src' : 'href';
        target.setAttribute(attribute, attachmentCopy.data || `marknote-attachment://${encodeURIComponent(attachmentCopy.id)}`);
      }
    }
    note.content = sanitizeNoteContent(doc.body.innerHTML);
  }
  if (entity === 'attachment') {
    const attachment = copy as ImageAttachment;
    const parent = await context.database.notes.get((local as ImageAttachment).noteId);
    if (parent) {
      const parentCopy = { ...parent, id: `${parent.id}-attachment-conflict-${generation}-${revision}`, title: `${parent.title}（附件冲突副本）`,
        content: '', remoteRevision: 0, version: 1, syncStatus: 'conflict' as const, lastSyncedAt: null, deletedAt: null };
      const doc = new DOMParser().parseFromString(parent.content, 'text/html');
      let copiedTarget = false;
      for (const sibling of await context.database.images.where('noteId').equals(parent.id).toArray()) {
        const targets = Array.from(doc.querySelectorAll('[data-attachment-id]')).filter((element) => element.getAttribute('data-attachment-id') === sibling.id);
        if (!targets.length) continue;
        const siblingCopy: ImageAttachment = sibling.id === local.id ? attachment : { ...sibling,
          id: `${sibling.id}-conflict-${generation}-${revision}`, storagePath: undefined, remoteRevision: 0, historyOnly: false, retainedForHistory: false,
          deletedAt: null, version: 1, syncStatus: 'pending', lastSyncedAt: null };
        siblingCopy.noteId = parentCopy.id;
        if (sibling.id === local.id) copiedTarget = true;
        else {
          await context.database.images.put(siblingCopy);
          await enqueueSync('attachment', siblingCopy.id, 'upsert', { database: context.database, snapshot: siblingCopy, baseRemoteRevision: 0 });
        }
        for (const target of targets) {
          target.setAttribute('data-attachment-id', siblingCopy.id);
          target.setAttribute(['IMG', 'VIDEO', 'AUDIO'].includes(target.tagName) ? 'src' : 'href', siblingCopy.data || `marknote-attachment://${encodeURIComponent(siblingCopy.id)}`);
        }
      }
      if (!copiedTarget) {
        const file = doc.createElement('file-attachment');
        file.setAttribute('href', attachment.data || `marknote-attachment://${encodeURIComponent(id)}`);
        file.setAttribute('filename', '附件冲突副本');
        file.setAttribute('data-attachment-id', id);
        doc.body.append(file);
      }
      parentCopy.content = sanitizeNoteContent(doc.body.innerHTML);
      attachment.noteId = parentCopy.id;
      await context.database.notes.put(parentCopy);
      await enqueueSync('note', parentCopy.id, 'upsert', { database: context.database, snapshot: parentCopy, baseRemoteRevision: 0 });
    }
  }
  await entityTable(context.database, entity).put(copy);
  await enqueueSync(entity, id, 'upsert', { database: context.database, snapshot: copy, baseRemoteRevision: 0 });
}

async function hydrateRemoteAttachments(context: SyncContext, attachments: ImageAttachment[]): Promise<ImageAttachment[]> {
  const result: ImageAttachment[] = [];
  // Bounded concurrency also avoids a single large pull spawning thousands of downloads.
  for (let offset = 0; offset < attachments.length; offset += 3) {
    result.push(...await Promise.all(attachments.slice(offset, offset + 3).map(async (attachment) => {
      if (!attachment.deletedAt && (!isSafeContentMimeType(attachment.mimeType, 'file') || (attachment.data && !sanitizeContentUrl(attachment.data, 'file')))) throw new Error('Unsafe remote attachment content.');
      if (attachment.deletedAt || attachment.data || !attachment.storagePath || !context.adapter.downloadAttachment) return attachment;
      const queued = await queueFor(context.database, 'attachment', attachment.id);
      const parentQueue = await queueFor(context.database, 'note', attachment.noteId);
      if (queued?.operation === 'delete' || parentQueue?.operation === 'delete'
        || await context.database.tombstones.get(`note:${attachment.noteId}`)) return attachment;
      const local = await context.database.images.get(attachment.id);
      if (local?.storagePath === attachment.storagePath && local.data) return { ...attachment, data: local.data };
      const downloaded = await context.network(() => context.adapter.downloadAttachment!(attachment, context.userId));
      if (!sanitizeContentUrl(downloaded.data, 'file')) throw new Error('Unsafe downloaded attachment content.');
      return { ...attachment, data: downloaded.data };
    })));
  }
  return result;
}

async function restoreExistingNoteAttachmentRefs(context: SyncContext, attachments: ImageAttachment[]): Promise<number> {
  const sources = attachments.filter((attachment) => attachment.data && !attachment.deletedAt);
  if (!sources.length) return 0;
  const sourceIds = new Set(sources.map((attachment) => attachment.id));
  let changed = 0;
  for (const note of await context.database.notes.toArray()) {
    if (![...extractAttachmentRefIds(note.content)].some((id) => sourceIds.has(id))) continue;
    const content = sanitizeNoteContent(restoreAttachmentRefs(note.content, sources));
    if (content === note.content) continue;
    // Restoring a local attachment is representation-only: never clears dirty/sync status.
    await context.database.notes.update(note.id, { content });
    changed++;
  }
  return changed;
}

async function markQueueItemsFailed(context: SyncContext, items: SyncQueueItem[], message: string): Promise<void> {
  context.assertCurrent();
  await context.database.transaction('rw', context.database.folders, context.database.notes, context.database.images,
    context.database.syncQueue, async () => {
      context.assertCurrent();
      for (const item of items) {
        const queued = await context.database.syncQueue.get(item.id);
        if (!queued || !sameQueueGeneration(queued, item)) continue;
        await context.database.syncQueue.update(item.id, { attempts: (queued.attempts || 0) + 1, lastError: message });
        if (item.operation !== 'delete') await entityTable(context.database, item.entity).update(item.entityId, { syncStatus: 'error' });
      }
    });
}

function entityTable(database: MarkNoteDatabase, entity: SyncEntity) {
  return (entity === 'folder' ? database.folders : entity === 'note' ? database.notes : database.images) as import('dexie').Table<Entity, string>;
}
async function queueFor(database: MarkNoteDatabase, entity: SyncEntity, id: string) {
  return database.syncQueue.where('[entity+entityId]').equals([entity, id]).first();
}
function sameQueueGeneration(a: SyncQueueItem, b: SyncQueueItem): boolean {
  return a.id === b.id && (a.mutationId || a.id) === (b.mutationId || b.id) && a.operation === b.operation
    && a.localRevision === b.localRevision && a.updatedAt === b.updatedAt;
}
function sameLogicalEntity(a: Entity | null | undefined, b: Entity | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return JSON.stringify(logicalValue(a)) === JSON.stringify(logicalValue(b));
}
function logicalValue(value: Entity): Record<string, unknown> {
  if ('content' in value) return { id: value.id, title: value.title, content: replaceAttachmentDataUrlsWithRefs(value.content),
    rawContent: value.rawContent || '', folderId: value.folderId, tags: value.tags, pinned: value.pinned,
    deletedAt: value.deletedAt || null };
  if ('noteId' in value) return { id: value.id, noteId: value.noteId, data: value.data, mimeType: value.mimeType,
    deletedAt: value.deletedAt || null };
  return { id: value.id, name: value.name, sortOrder: value.sortOrder, deletedAt: value.deletedAt || null };
}
function entityUpdatedAt(value: Entity | null): number { return value?.updatedAt ?? value?.createdAt ?? 0; }
function maxRemoteUpdatedAt(snapshot: RemoteSnapshot): number {
  return Math.max(0, ...snapshot.folders.map(entityUpdatedAt), ...snapshot.notes.map(entityUpdatedAt), ...snapshot.attachments.map(entityUpdatedAt));
}
function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Sync failed.'; }
