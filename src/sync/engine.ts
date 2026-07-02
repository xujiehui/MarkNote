import { clearSyncQueueItem, db, deleteFolderLocally, enqueueSync, markSynced, upsertFolder, upsertNote } from '../lib/db';
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
      await this.adapter.registerDevice(device);
      await ensureLocalChangesQueued();

      const state = await getSyncState(this.adapter.id, session.user.id, device.id);
      const queueItems = await db.syncQueue.orderBy('updatedAt').toArray();
      const payload = await buildPushPayload(queueItems, this.adapter);
      const pushedCount = payload.folders.length + payload.notes.length + payload.attachments.length
        + payload.deleted.folders.length + payload.deleted.notes.length + payload.deleted.attachments.length;

      const pushedAt = pushedCount ? (await this.adapter.push(payload)).syncedAt : Date.now();
      for (const item of queueItems) {
        await markEntitySynced(item, pushedAt);
        await clearSyncQueueItem(item.id);
      }

      const snapshot = await this.adapter.pull(state.lastPulledAt);
      const pulledCount = await applyRemoteSnapshot(snapshot);
      const syncedAt = Date.now();
      await putSyncState({
        id: state.id,
        provider: this.adapter.id,
        userId: session.user.id,
        deviceId: device.id,
        lastPulledAt: Math.max(maxRemoteUpdatedAt(snapshot), state.lastPulledAt),
        lastPushedAt: pushedAt,
        lastSyncedAt: syncedAt,
        status: 'synced',
      });

      return {
        ok: true,
        pushed: pushedCount,
        pulled: pulledCount,
        syncedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed.';
      await rememberSyncError(this.adapter.id, message);
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

async function ensureLocalChangesQueued(): Promise<void> {
  const [folders, notes, attachments] = await Promise.all([
    db.folders.toArray(),
    db.notes.toArray(),
    db.images.toArray(),
  ]);

  await db.transaction('rw', db.folders, db.notes, db.images, db.syncQueue, async () => {
    for (const folder of folders) {
      if (folder.syncStatus === 'synced') {
        continue;
      }
      await enqueueSync('folder', folder.id, 'upsert');
      await db.folders.update(folder.id, { syncStatus: 'pending' });
    }
    for (const note of notes) {
      if (note.syncStatus === 'synced') {
        continue;
      }
      await enqueueSync('note', note.id, 'upsert');
      await db.notes.update(note.id, { syncStatus: 'pending' });
    }
    for (const attachment of attachments) {
      if (attachment.syncStatus === 'synced') {
        continue;
      }
      await enqueueSync('attachment', attachment.id, 'upsert');
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
      pushDeleted(payload, item.entity, item.entityId);
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
        payload.notes.push(note);
      }
    }
    if (item.entity === 'attachment') {
      const attachment = await db.images.get(item.entityId);
      if (attachment) {
        if (attachment.deletedAt) {
          payload.deleted.attachments.push(attachment.id);
          continue;
        }
        payload.attachments.push(await prepareAttachmentForPush(attachment, adapter));
      }
    }
  }

  return payload;
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

function pushDeleted(payload: PushPayload, entity: SyncEntity, entityId: string): void {
  if (entity === 'folder') {
    payload.deleted.folders.push(entityId);
  }
  if (entity === 'note') {
    payload.deleted.notes.push(entityId);
  }
  if (entity === 'attachment') {
    payload.deleted.attachments.push(entityId);
  }
}

async function applyRemoteSnapshot(snapshot: RemoteSnapshot): Promise<number> {
  let changed = 0;
  for (const folder of snapshot.folders) {
    changed += await applyRemoteFolder(folder);
  }
  for (const note of snapshot.notes) {
    changed += await applyRemoteNote(note);
  }
  for (const attachment of snapshot.attachments) {
    changed += await applyRemoteAttachment(attachment);
  }
  return changed;
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

async function applyRemoteNote(remote: Note): Promise<number> {
  const local = await db.notes.get(remote.id);
  if (!shouldApplyRemote(local, remote.updatedAt)) {
    return 0;
  }
  await upsertNote(remote, { enqueueSync: false });
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
    return;
  }
  await markSynced(item.entity, item.entityId, syncedAt);
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

async function putSyncState(state: SyncState): Promise<void> {
  await db.syncStates.put(state);
}

async function rememberSyncError(provider: string, message: string): Promise<void> {
  const now = Date.now();
  const latest = await db.syncStates.where('provider').equals(provider).last();
  if (!latest) {
    return;
  }
  await db.syncStates.update(latest.id, {
    status: 'error',
    lastError: message,
    lastSyncedAt: now,
  });
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
