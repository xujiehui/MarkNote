import { clearSyncQueueItem, db, deleteFolderLocally, enqueueSync, markSynced, upsertFolder, upsertNote } from '../lib/db';
import { extractAttachmentRefIds, replaceAttachmentDataUrlsWithRefs, restoreAttachmentRefs } from '../lib/attachmentContent';
import type { Folder, ImageAttachment, Note, SyncEntity, SyncQueueItem, SyncState } from '../types';
import type { PushPayload, RemoteSnapshot, RemoteSyncAdapter, SyncResult } from './types';
import { getOrCreateDevice } from './device';

const STATE_ID_PREFIX = 'sync-state';

export class SyncEngine {
  constructor(private readonly adapter: RemoteSyncAdapter) {}

  async syncNow(): Promise<SyncResult> {
    if (!this.adapter.configured) {
      return {
        ok: false,
        pushed: 0,
        pulled: 0,
        error: 'Sync provider is not configured.',
      };
    }

    let currentSyncStateId = '';
    try {
      const session = await this.adapter.getSession();
      if (!session) {
        return {
          ok: false,
          pushed: 0,
          pulled: 0,
          error: 'Please sign in before syncing.',
        };
      }

      const device = getOrCreateDevice(this.adapter.id);
      await db.syncDevices.put(device);
      const state = await ensureSyncState(this.adapter.id, session.user.id, device.id);
      currentSyncStateId = state.id;
      await this.adapter.registerDevice(device);
      await ensureLocalChangesQueued({ forceAll: state.lastSyncedAt === 0 });

      const prePushSnapshot = await this.adapter.pull(state.lastPulledAt);
      const prePushApply = await applyRemoteSnapshot(prePushSnapshot, this.adapter);
      const prePushPulledAt = Math.max(maxRemoteUpdatedAt(prePushSnapshot), state.lastPulledAt);
      await clearRemoteResolvedQueueItems(prePushApply.applied);

      const queueItems = await db.syncQueue.orderBy('updatedAt').toArray();
      let payload: PushPayload;
      try {
        payload = await buildPushPayload(queueItems, this.adapter);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not prepare local changes.';
        await markQueueItemsFailed(queueItems, message);
        throw error;
      }
      const pushedCount = payload.folders.length + payload.notes.length + payload.attachments.length
        + payload.deleted.folders.length + payload.deleted.notes.length + payload.deleted.attachments.length;

      let pushedAt = Date.now();
      try {
        pushedAt = pushedCount ? (await this.adapter.push(payload)).syncedAt : Date.now();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Push failed.';
        await markQueueItemsFailed(queueItems, message);
        throw error;
      }
      for (const item of queueItems) {
        await markEntitySynced(item, pushedAt);
        await clearSyncQueueItem(item.id);
      }
      await markPayloadEntitiesSynced(payload, pushedAt);

      const postPushSnapshot = await this.adapter.pull(prePushPulledAt);
      const postPushApply = await applyRemoteSnapshot(postPushSnapshot, this.adapter);
      const syncedAt = Date.now();
      await putSyncState({
        id: state.id,
        provider: this.adapter.id,
        userId: session.user.id,
        deviceId: device.id,
        lastPulledAt: Math.max(maxRemoteUpdatedAt(postPushSnapshot), prePushPulledAt),
        lastPushedAt: pushedAt,
        lastSyncedAt: syncedAt,
        status: 'synced',
      });

      return {
        ok: true,
        pushed: pushedCount,
        pulled: prePushApply.changed + postPushApply.changed,
        syncedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed.';
      if (currentSyncStateId) {
        await rememberSyncStateError(currentSyncStateId, message);
      }
      return {
        ok: false,
        pushed: 0,
        pulled: 0,
        error: message,
      };
    }
  }
}

export function createSyncEngine(adapter: RemoteSyncAdapter): SyncEngine {
  return new SyncEngine(adapter);
}

async function ensureLocalChangesQueued(options?: { forceAll?: boolean }): Promise<void> {
  const forceAll = options?.forceAll ?? false;
  const [folders, notes, attachments] = await Promise.all([
    db.folders.toArray(),
    db.notes.toArray(),
    db.images.toArray(),
  ]);

  await db.transaction('rw', db.folders, db.notes, db.images, db.syncQueue, async () => {
    for (const folder of folders) {
      if (!forceAll && folder.syncStatus === 'synced') {
        continue;
      }
      await enqueueSync('folder', folder.id, 'upsert');
      await db.folders.update(folder.id, { syncStatus: 'pending' });
    }
    for (const note of notes) {
      if (!forceAll && note.syncStatus === 'synced') {
        continue;
      }
      await enqueueSync('note', note.id, 'upsert');
      await db.notes.update(note.id, { syncStatus: 'pending' });
    }
    for (const attachment of attachments) {
      if (!forceAll && attachment.syncStatus === 'synced') {
        continue;
      }
      await enqueueSync('attachment', attachment.id, attachment.deletedAt ? 'delete' : 'upsert');
      await db.images.update(attachment.id, { syncStatus: 'pending' });
    }
  });
}

async function buildPushPayload(queueItems: SyncQueueItem[], adapter: RemoteSyncAdapter): Promise<PushPayload> {
  const payload: PushPayload = {
    folders: [],
    notes: [],
    attachments: [],
    deleted: {
      folders: [],
      notes: [],
      attachments: [],
    },
  };

  for (const item of queueItems) {
    if (item.operation === 'delete') {
      await pushDeleted(payload, item.entity, item.entityId);
      continue;
    }

    if (item.entity === 'folder') {
      const folder = await db.folders.get(item.entityId);
      if (folder) {
        if (folder.deletedAt) {
          payload.deleted.folders.push(folder.id);
          continue;
        }
        payload.folders.push(folder);
      }
    }
    if (item.entity === 'note') {
      const note = await db.notes.get(item.entityId);
      if (note) {
        if (note.deletedAt) {
          payload.deleted.notes.push(note.id);
          continue;
        }
        await addFolderDependency(payload, note.folderId);
        payload.notes.push(prepareNoteForPush(note));
      }
    }
    if (item.entity === 'attachment') {
      const attachment = await db.images.get(item.entityId);
      if (attachment) {
        if (attachment.deletedAt) {
          payload.deleted.attachments.push(attachment);
          continue;
        }
        await addNoteDependency(payload, attachment.noteId);
        payload.attachments.push(await prepareAttachmentForPush(attachment, adapter));
      }
    }
  }

  return payload;
}

async function addNoteDependency(payload: PushPayload, noteId: string): Promise<void> {
  if (payload.notes.some((note) => note.id === noteId) || payload.deleted.notes.includes(noteId)) {
    return;
  }
  const note = await db.notes.get(noteId);
  if (!note || note.deletedAt) {
    return;
  }
  await addFolderDependency(payload, note.folderId);
  payload.notes.push(prepareNoteForPush(note));
}

async function addFolderDependency(payload: PushPayload, folderId: string): Promise<void> {
  if (payload.folders.some((folder) => folder.id === folderId) || payload.deleted.folders.includes(folderId)) {
    return;
  }
  const folder = await db.folders.get(folderId);
  if (!folder || folder.deletedAt) {
    return;
  }
  payload.folders.push(folder);
}

async function prepareAttachmentForPush(attachment: ImageAttachment, adapter: RemoteSyncAdapter): Promise<ImageAttachment> {
  if (attachment.storagePath || !attachment.data || !adapter.uploadAttachment) {
    return attachment;
  }
  const uploaded = await adapter.uploadAttachment(attachment);
  const now = Date.now();
  const nextAttachment: ImageAttachment = {
    ...attachment,
    storagePath: uploaded.storagePath,
    data: attachment.data,
    updatedAt: attachment.updatedAt ?? now,
  };
  await db.images.put(nextAttachment);
  return nextAttachment;
}

function prepareNoteForPush(note: Note): Note {
  const content = replaceAttachmentDataUrlsWithRefs(note.content);
  return {
    ...note,
    content,
    rawContent: note.rawContent,
  };
}

async function pushDeleted(payload: PushPayload, entity: SyncEntity, entityId: string): Promise<void> {
  if (entity === 'folder') {
    payload.deleted.folders.push(entityId);
  }
  if (entity === 'note') {
    payload.deleted.notes.push(entityId);
  }
  if (entity === 'attachment') {
    payload.deleted.attachments.push((await db.images.get(entityId)) || entityId);
  }
}

interface RemoteApplyResult {
  changed: number;
  applied: Set<string>;
}

async function applyRemoteSnapshot(snapshot: RemoteSnapshot, adapter: RemoteSyncAdapter): Promise<RemoteApplyResult> {
  let changed = 0;
  const applied = new Set<string>();
  const attachments = await hydrateRemoteAttachments(snapshot.attachments, adapter);
  const attachmentRestoreSources = await restoreSourcesForAttachments(attachments);
  for (const folder of snapshot.folders) {
    const didApply = await applyRemoteFolder(folder);
    changed += didApply;
    if (didApply) {
      applied.add(remoteQueueKey('folder', folder.id));
    }
  }
  for (const note of snapshot.notes) {
    const didApply = await applyRemoteNote(note, attachmentRestoreSources);
    changed += didApply;
    if (didApply) {
      applied.add(remoteQueueKey('note', note.id));
    }
  }
  for (const attachment of attachments) {
    const didApply = await applyRemoteAttachment(attachment);
    changed += didApply;
    if (didApply) {
      applied.add(remoteQueueKey('attachment', attachment.id));
    }
  }
  changed += await restoreExistingNoteAttachmentRefs(attachments);
  return { changed, applied };
}

async function hydrateRemoteAttachments(attachments: ImageAttachment[], adapter: RemoteSyncAdapter): Promise<ImageAttachment[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.deletedAt || attachment.data || !attachment.storagePath || !adapter.downloadAttachment) {
        return attachment;
      }
      const downloaded = await adapter.downloadAttachment(attachment);
      return {
        ...attachment,
        data: downloaded.data,
      };
    }),
  );
}

async function restoreSourcesForAttachments(remoteAttachments: ImageAttachment[]): Promise<ImageAttachment[]> {
  const localAttachments = await db.images.toArray();
  return [...localAttachments, ...remoteAttachments];
}

async function applyRemoteFolder(remote: Folder): Promise<number> {
  const local = await db.folders.get(remote.id);
  if (!shouldApplyRemote(local, remote.updatedAt)) {
    return 0;
  }
  if (remote.deletedAt) {
    await deleteFolderLocally(remote.id);
    return 1;
  }
  await upsertFolder(remote, { enqueueSync: false });
  return 1;
}

async function applyRemoteNote(remote: Note, attachments: ImageAttachment[]): Promise<number> {
  const local = await db.notes.get(remote.id);
  if (!shouldApplyRemote(local, remote.updatedAt)) {
    return 0;
  }
  await upsertNote(
    {
      ...remote,
      content: restoreAttachmentRefs(remote.content, attachments),
    },
    { enqueueSync: false },
  );
  return 1;
}

async function applyRemoteAttachment(remote: ImageAttachment): Promise<number> {
  const local = await db.images.get(remote.id);
  if (!shouldApplyRemote(local, remote.updatedAt ?? remote.createdAt ?? 0)) {
    return 0;
  }
  if (remote.deletedAt) {
    await db.images.delete(remote.id);
    return 1;
  }
  await db.images.put(remote);
  return 1;
}

async function restoreExistingNoteAttachmentRefs(attachments: ImageAttachment[]): Promise<number> {
  const sources = attachments.filter((attachment) => attachment.data && !attachment.deletedAt);
  if (!sources.length) {
    return 0;
  }

  const sourceIds = new Set(sources.map((attachment) => attachment.id));
  const notes = await db.notes.toArray();
  let changed = 0;
  for (const note of notes) {
    const refs = extractAttachmentRefIds(note.content);
    if (![...refs].some((id) => sourceIds.has(id))) {
      continue;
    }

    const content = restoreAttachmentRefs(note.content, sources);
    if (content === note.content) {
      continue;
    }

    await upsertNote({ ...note, content }, { enqueueSync: false });
    changed += 1;
  }
  return changed;
}

function shouldApplyRemote(local: { updatedAt?: number; syncStatus?: string } | undefined, remoteUpdatedAt: number): boolean {
  if (!local) {
    return true;
  }
  if (local.syncStatus === 'pending' && (local.updatedAt || 0) > remoteUpdatedAt) {
    return false;
  }
  return remoteUpdatedAt >= (local.updatedAt || 0);
}

async function markEntitySynced(item: SyncQueueItem, syncedAt: number): Promise<void> {
  if (item.operation === 'delete') {
    if (item.entity === 'attachment') {
      await db.images.delete(item.entityId);
    }
    return;
  }
  if (item.entity === 'attachment' && (await db.images.get(item.entityId))?.deletedAt) {
    await db.images.delete(item.entityId);
    return;
  }
  await markSynced(item.entity, item.entityId, syncedAt);
}

async function markPayloadEntitiesSynced(payload: PushPayload, syncedAt: number): Promise<void> {
  await Promise.all([
    ...payload.folders.map((folder) => markSynced('folder', folder.id, syncedAt)),
    ...payload.notes.map((note) => markSynced('note', note.id, syncedAt)),
    ...payload.attachments.map((attachment) => markSynced('attachment', attachment.id, syncedAt)),
  ]);
}

async function getSyncState(provider: string, userId: string, deviceId: string): Promise<SyncState> {
  const id = syncStateId(provider, userId, deviceId);
  const existing = await db.syncStates.get(id);
  if (existing) {
    return existing;
  }
  return {
    id,
    provider,
    userId,
    deviceId,
    lastPulledAt: 0,
    lastPushedAt: 0,
    lastSyncedAt: 0,
    status: 'local',
  };
}

async function ensureSyncState(provider: string, userId: string, deviceId: string): Promise<SyncState> {
  const state = await getSyncState(provider, userId, deviceId);
  await putSyncState(state);
  return state;
}

async function putSyncState(state: SyncState): Promise<void> {
  await db.syncStates.put(state);
}

async function rememberSyncStateError(stateId: string, message: string): Promise<void> {
  const now = Date.now();
  await db.syncStates.update(stateId, {
    status: 'error',
    lastError: message,
    lastSyncedAt: now,
  });
}

async function markQueueItemsFailed(items: SyncQueueItem[], message: string): Promise<void> {
  const failedAt = Date.now();
  await db.transaction('rw', db.folders, db.notes, db.images, db.syncQueue, async () => {
    for (const item of items) {
      await db.syncQueue.update(item.id, {
        attempts: (item.attempts || 0) + 1,
        lastError: message,
        updatedAt: failedAt,
      });
      await markQueuedEntityFailed(item);
    }
  });
}

async function markQueuedEntityFailed(item: SyncQueueItem): Promise<void> {
  if (item.operation === 'delete') {
    return;
  }
  const table = item.entity === 'folder' ? db.folders : item.entity === 'note' ? db.notes : db.images;
  await table.update(item.entityId, { syncStatus: 'error' });
}

async function clearRemoteResolvedQueueItems(appliedRemoteItems: Set<string>): Promise<void> {
  if (!appliedRemoteItems.size) {
    return;
  }
  const queueItems = await db.syncQueue.toArray();
  await db.transaction('rw', db.folders, db.notes, db.images, db.syncQueue, async () => {
    for (const item of queueItems) {
      if (appliedRemoteItems.has(remoteQueueKey(item.entity, item.entityId))) {
        await db.syncQueue.delete(item.id);
        continue;
      }

      const local = await getQueuedEntity(item);
      if (local?.syncStatus === 'synced' || (!local && item.operation !== 'delete')) {
        await db.syncQueue.delete(item.id);
      }
    }
  });
}

async function getQueuedEntity(item: SyncQueueItem): Promise<{ syncStatus?: string } | undefined> {
  if (item.entity === 'folder') {
    return db.folders.get(item.entityId);
  }
  if (item.entity === 'note') {
    return db.notes.get(item.entityId);
  }
  return db.images.get(item.entityId);
}

function remoteQueueKey(entity: SyncEntity, entityId: string): string {
  return `${entity}:${entityId}`;
}

function syncStateId(provider: string, userId: string, deviceId: string): string {
  return `${STATE_ID_PREFIX}:${provider}:${userId}:${deviceId}`;
}

function maxRemoteUpdatedAt(snapshot: RemoteSnapshot): number {
  return Math.max(
    0,
    ...snapshot.folders.map((folder) => folder.updatedAt),
    ...snapshot.notes.map((note) => note.updatedAt),
    ...snapshot.attachments.map((attachment) => attachment.updatedAt ?? attachment.createdAt ?? 0),
  );
}
