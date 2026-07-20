import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Folder, ImageAttachment, Note, SyncDevice } from '../types';
import { ATTACHMENT_STORAGE_CANARY_CHECK_NAME, SYNC_TABLE_WRITES_CHECK_NAME } from './backendVerification';
import {
  errorWithCauseMessage,
  isSupabaseNameResolutionError,
  isSupabaseStorageObjectMissingError,
  supabaseBackendErrorMessage,
  supabaseErrorCode,
  supabaseProjectReachabilityMessage,
} from './supabaseError';
import type {
  AuthSessionChangeHandler,
  AuthSession,
  OAuthProvider,
  PushPayload,
  RemoteSnapshot,
  RemoteSyncAdapter,
  SyncBackendCheckItem,
  SyncBackendCheckResult,
} from './types';

const FOLDERS_TABLE = 'folders';
const NOTES_TABLE = 'notes';
const ATTACHMENTS_TABLE = 'attachments';
const DEVICES_TABLE = 'devices';
const PROFILES_TABLE = 'profiles';
const ATTACHMENTS_BUCKET = 'attachments';
const TABLE_CHECKS = [
  { table: PROFILES_TABLE, label: 'Profiles table' },
  { table: DEVICES_TABLE, label: 'Devices table' },
  { table: FOLDERS_TABLE, label: 'Folders table' },
  { table: NOTES_TABLE, label: 'Notes table' },
  { table: ATTACHMENTS_TABLE, label: 'Attachments table' },
];

interface SupabaseSyncAdapterOptions {
  authRedirectUrl?: string;
}

interface RemoteFolderRow {
  id: string;
  user_id?: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number | null;
}

interface RemoteNoteRow {
  id: string;
  user_id?: string;
  folder_id: string;
  title: string;
  content: string;
  raw_content: string | null;
  tags: string[] | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number | null;
}

interface RemoteAttachmentRow {
  id: string;
  user_id?: string;
  note_id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface RemoteDeviceRow {
  id: string;
  name: string;
  platform: string;
  last_seen_at: string;
}

export class SupabaseSyncAdapter implements RemoteSyncAdapter {
  readonly id = 'supabase' as const;
  readonly name = 'Supabase';
  readonly configured: boolean;
  private readonly client: SupabaseClient | null;
  private readonly url: string | undefined;
  private readonly authRedirectUrl: string | undefined;

  constructor(
    url: string | undefined,
    publishableKey: string | undefined,
    client?: SupabaseClient,
    options: SupabaseSyncAdapterOptions = {},
  ) {
    this.url = url;
    this.authRedirectUrl = options.authRedirectUrl;
    this.configured = Boolean(url && publishableKey);
    this.client =
      client ??
      (this.configured && url && publishableKey
        ? createClient(url, publishableKey, {
            auth: {
              detectSessionInUrl: false,
              flowType: 'pkce',
            },
          })
        : null);
  }

  async getSession(): Promise<AuthSession | null> {
    const client = this.requireClient();
    const {
      data: { session },
      error,
    } = await client.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }
    if (!session?.user) {
      return null;
    }
    return sessionFromSupabaseSession(session);
  }

  onSessionChange(handler: AuthSessionChangeHandler): () => void {
    const client = this.requireClient();
    const { data } = client.auth.onAuthStateChange((event, session) => {
      handler(session?.user ? sessionFromSupabaseSession(session) : null, event);
    });
    return () => data.subscription.unsubscribe();
  }

  async signInWithOAuth(provider: OAuthProvider): Promise<void> {
    await assertSupabaseProjectReachable(this.url);
    const client = this.requireClient();
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: oauthRedirectUrl(this.authRedirectUrl),
        skipBrowserRedirect: Boolean(window.marknoteDesktop),
      },
    });
    if (error) {
      throw new Error(error.message);
    }
    if (window.marknoteDesktop && data.url) {
      await window.marknoteDesktop.openExternal(data.url);
    }
  }

  async completeOAuthSignIn(callbackUrl: string): Promise<AuthSession | null> {
    const client = this.requireClient();
    const url = new URL(callbackUrl);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const code = url.searchParams.get('code');
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    const errorDescription =
      url.searchParams.get('error_description') ||
      url.searchParams.get('error') ||
      hash.get('error_description') ||
      hash.get('error');
    if (errorDescription) {
      throw new Error(errorDescription);
    }
    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) {
        throw new Error(error.message);
      }
    } else if (accessToken && refreshToken) {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        throw new Error(error.message);
      }
    }
    return this.getSession();
  }

  async signOut(): Promise<void> {
    const client = this.requireClient();
    const { error } = await client.auth.signOut();
    if (error) {
      throw new Error(error.message);
    }
  }

  async checkBackend(): Promise<SyncBackendCheckResult> {
    const checkedAt = Date.now();
    if (!this.configured || !this.client) {
      return {
        ok: false,
        checkedAt,
        items: [
          checkItem(
            'Supabase configuration',
            'error',
            'Supabase sync is not configured. Check the sync configuration backend API.',
          ),
        ],
      };
    }

    const client = this.requireClient();
    const items: SyncBackendCheckItem[] = [await checkProjectHealth(this.url)];
    let session: AuthSession | null = null;
    try {
      session = await this.getSession();
    } catch (error) {
      items.push(checkItem('Auth session', 'error', errorMessage(error)));
      return checkResult(checkedAt, items);
    }

    if (!session) {
      items.push(
        checkItem(
          'Auth session',
          'warning',
          'Sign in before checking sync tables. MarkNote sync tables are intentionally not exposed to anonymous clients.',
        ),
      );
      return checkResult(checkedAt, items);
    }

    items.push(checkItem('Auth session', 'ok', 'Signed-in session is available for backend checks.'));
    let tablesReachable = true;
    for (const { table, label } of TABLE_CHECKS) {
      const { error } = await client.from(table).select('id').limit(1);
      if (error) {
        tablesReachable = false;
        items.push(checkItem(label, 'error', supabaseBackendErrorMessage(error, label), supabaseErrorCode(error)));
      } else {
        items.push(checkItem(label, 'ok', `${label} is reachable for the signed-in user.`));
      }
    }
    if (!tablesReachable) {
      return checkResult(checkedAt, items);
    }

    const tableWriteCheck = await checkSyncTableWrites(client, session.user.id);
    items.push(tableWriteCheck);
    if (tableWriteCheck.status === 'error') {
      return checkResult(checkedAt, items);
    }
    items.push(...(await checkAttachmentStorage(client, session.user.id)));

    return checkResult(checkedAt, items);
  }

  async registerDevice(device: SyncDevice): Promise<void> {
    const client = this.requireClient();
    const session = await this.getSession();
    if (!session) {
      return;
    }
    const row: RemoteDeviceRow & { user_id: string } = {
      id: device.id,
      user_id: session.user.id,
      name: device.name,
      platform: device.provider,
      last_seen_at: toIso(device.lastSeenAt),
    };
    const { error } = await client.from(DEVICES_TABLE).upsert(row, { onConflict: 'user_id,id' });
    if (error) {
      throw supabaseSyncError(error, 'Could not register this device');
    }
  }

  async pull(lastPulledAt: number): Promise<RemoteSnapshot> {
    const client = this.requireClient();
    const since = toIso(lastPulledAt || 0);
    const [folders, notes, attachments] = await Promise.all([
      client.from(FOLDERS_TABLE).select('*').gt('updated_at', since),
      client.from(NOTES_TABLE).select('*').gt('updated_at', since),
      client.from(ATTACHMENTS_TABLE).select('*').gt('updated_at', since),
    ]);

    if (folders.error) {
      throw supabaseSyncError(folders.error, 'Could not pull folders');
    }
    if (notes.error) {
      throw supabaseSyncError(notes.error, 'Could not pull notes');
    }
    if (attachments.error) {
      throw supabaseSyncError(attachments.error, 'Could not pull attachments');
    }

    return {
      folders: ((folders.data || []) as RemoteFolderRow[]).map(folderFromRow),
      notes: ((notes.data || []) as RemoteNoteRow[]).map(noteFromRow),
      attachments: ((attachments.data || []) as RemoteAttachmentRow[]).map(attachmentFromRow),
      serverTime: Date.now(),
    };
  }

  async push(payload: PushPayload): Promise<{ syncedAt: number }> {
    const client = this.requireClient();
    const session = await this.getSession();
    if (!session) {
      throw new Error('Please sign in before syncing.');
    }

    const userId = session.user.id;
    const missingStoragePath = payload.attachments.find((attachment) => !attachment.storagePath);
    if (missingStoragePath) {
      throw new Error(`Could not push attachments: Attachment storage path is missing for ${missingStoragePath.id}.`);
    }

    const folderRows = payload.folders.map((folder) => folderToRow(folder, userId));
    const noteRows = payload.notes.map((note) => noteToRow(note, userId));
    const attachmentRows = payload.attachments.map((attachment) => attachmentToRow(attachment, userId));

    if (folderRows.length) {
      const { error } = await client.from(FOLDERS_TABLE).upsert(folderRows, { onConflict: 'user_id,id' });
      if (error) {
        throw supabaseSyncError(error, 'Could not push folders');
      }
    }
    if (noteRows.length) {
      const { error } = await client.from(NOTES_TABLE).upsert(noteRows, { onConflict: 'user_id,id' });
      if (error) {
        throw supabaseSyncError(error, 'Could not push notes');
      }
    }
    if (attachmentRows.length) {
      const { error } = await client.from(ATTACHMENTS_TABLE).upsert(attachmentRows, { onConflict: 'user_id,id' });
      if (error) {
        throw supabaseSyncError(error, 'Could not push attachments');
      }
    }

    const deletedAt = new Date().toISOString();
    await Promise.all([
      ...payload.deleted.folders.map((id) => softDeleteRemote(client, FOLDERS_TABLE, id, deletedAt, userId)),
      ...payload.deleted.notes.map((id) => softDeleteRemote(client, NOTES_TABLE, id, deletedAt, userId)),
      ...payload.deleted.attachments.map((attachment) => softDeleteAttachmentRemote(client, attachment, deletedAt, userId)),
    ]).then((results) => {
      const failed = results.find((result) => result.error);
      if (failed?.error) {
        throw supabaseSyncError(failed.error, 'Could not push deletes');
      }
    });

    return { syncedAt: Date.now() };
  }

  async uploadAttachment(attachment: ImageAttachment): Promise<{ storagePath: string; publicUrl?: string }> {
    const client = this.requireClient();
    const session = await this.getSession();
    if (!session) {
      throw new Error('Please sign in before uploading attachments.');
    }
    const blob = dataUrlToBlob(attachment.data, attachment.mimeType);
    const storagePath = attachment.storagePath || `${session.user.id}/${attachment.noteId}/${attachment.id}`;
    const { error } = await client.storage.from(ATTACHMENTS_BUCKET).upload(storagePath, blob, {
      contentType: attachment.mimeType,
      upsert: true,
    });
    if (error) {
      throw supabaseSyncError(error, 'Could not upload attachment');
    }
    return { storagePath };
  }

  async downloadAttachment(attachment: ImageAttachment): Promise<{ data: string }> {
    const client = this.requireClient();
    if (!attachment.storagePath) {
      throw new Error('Attachment storage path is missing.');
    }
    const { data, error } = await client.storage.from(ATTACHMENTS_BUCKET).download(attachment.storagePath);
    if (error) {
      throw supabaseSyncError(error, 'Could not download attachment');
    }
    if (!data) {
      throw new Error('Could not download attachment: Storage returned no data.');
    }
    return { data: await blobToDataUrl(data, attachment.mimeType) };
  }

  private requireClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase sync is not configured. Check the sync configuration backend API.');
    }
    return this.client;
  }
}

function folderFromRow(row: RemoteFolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: fromIso(row.created_at),
    updatedAt: fromIso(row.updated_at),
    deletedAt: row.deleted_at ? fromIso(row.deleted_at) : null,
    syncStatus: 'synced',
    lastSyncedAt: Date.now(),
    version: row.version ?? 1,
  };
}

function noteFromRow(row: RemoteNoteRow): Note {
  return {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    content: row.content,
    rawContent: row.raw_content || undefined,
    tags: row.tags || [],
    pinned: row.pinned,
    createdAt: fromIso(row.created_at),
    updatedAt: fromIso(row.updated_at),
    deletedAt: row.deleted_at ? fromIso(row.deleted_at) : null,
    syncStatus: 'synced',
    lastSyncedAt: Date.now(),
    version: row.version ?? 1,
  };
}

function attachmentFromRow(row: RemoteAttachmentRow): ImageAttachment {
  return {
    id: row.id,
    noteId: row.note_id,
    data: '',
    mimeType: row.mime_type,
    storagePath: row.storage_path,
    sizeBytes: row.size_bytes ?? undefined,
    createdAt: fromIso(row.created_at),
    updatedAt: fromIso(row.updated_at),
    deletedAt: row.deleted_at ? fromIso(row.deleted_at) : null,
    syncStatus: 'synced',
    lastSyncedAt: Date.now(),
  };
}

function folderToRow(folder: Folder, userId: string): RemoteFolderRow {
  return {
    id: folder.id,
    user_id: userId,
    name: folder.name,
    sort_order: folder.sortOrder,
    created_at: toIso(folder.createdAt),
    updated_at: toIso(folder.updatedAt),
    deleted_at: folder.deletedAt ? toIso(folder.deletedAt) : null,
    version: folder.version ?? 1,
  };
}

function noteToRow(note: Note, userId: string): RemoteNoteRow {
  return {
    id: note.id,
    user_id: userId,
    folder_id: note.folderId,
    title: note.title,
    content: note.content,
    raw_content: note.rawContent || null,
    tags: note.tags,
    pinned: note.pinned,
    created_at: toIso(note.createdAt),
    updated_at: toIso(note.updatedAt),
    deleted_at: note.deletedAt ? toIso(note.deletedAt) : null,
    version: note.version ?? 1,
  };
}

function attachmentToRow(attachment: ImageAttachment, userId: string): RemoteAttachmentRow {
  return {
    id: attachment.id,
    user_id: userId,
    note_id: attachment.noteId,
    storage_path: attachment.storagePath || '',
    mime_type: attachment.mimeType,
    size_bytes: attachment.sizeBytes ?? null,
    created_at: toIso(attachment.createdAt ?? Date.now()),
    updated_at: toIso(attachment.updatedAt ?? attachment.createdAt ?? Date.now()),
    deleted_at: attachment.deletedAt ? toIso(attachment.deletedAt) : null,
  };
}

function toIso(value: number): string {
  return new Date(value || 0).toISOString();
}

function fromIso(value: string): number {
  return new Date(value).getTime();
}

function sessionFromSupabaseSession(session: { access_token?: string; user: { id: string; email?: string } }): AuthSession {
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
    },
    accessToken: session.access_token,
  };
}

function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  const [, encoded = ''] = dataUrl.split(',');
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function blobToDataUrl(blob: Blob, fallbackMimeType: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${blob.type || fallbackMimeType};base64,${btoa(binary)}`;
}

async function assertSupabaseProjectReachable(url: string | undefined): Promise<void> {
  if (!url) {
    return;
  }
  let healthUrl: URL;
  try {
    healthUrl = new URL('/auth/v1/health', url);
  } catch {
    throw new Error('Supabase project URL is invalid. Check the sync configuration backend API.');
  }
  if (!healthUrl.hostname.endsWith('.supabase.co')) {
    return;
  }
  try {
    await fetch(healthUrl, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
    });
  } catch (error) {
    if (isSupabaseNameResolutionError(error)) {
      throw new Error('Supabase project URL cannot be resolved. Check that the backend API returns an active Supabase project URL.');
    }
  }
}

async function checkProjectHealth(url: string | undefined): Promise<SyncBackendCheckItem> {
  if (!url) {
    return checkItem('Supabase project', 'error', 'Supabase project URL is missing.');
  }
  let healthUrl: URL;
  try {
    healthUrl = new URL('/auth/v1/health', url);
  } catch {
    return checkItem('Supabase project', 'error', 'Supabase project URL is invalid.');
  }
  if (!healthUrl.hostname.endsWith('.supabase.co')) {
    return checkItem('Supabase project', 'ok', 'Custom Supabase URL is configured.');
  }
  try {
    await fetch(healthUrl, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
    });
    return checkItem('Supabase project', 'ok', 'Supabase project is reachable.');
  } catch (error) {
    const message = isSupabaseNameResolutionError(error)
      ? 'Supabase project URL cannot be resolved. Check that the backend API returns an active Supabase project URL.'
      : supabaseProjectReachabilityMessage(error);
    return checkItem('Supabase project', 'error', message);
  }
}

async function checkAttachmentStorage(client: SupabaseClient, userId: string): Promise<SyncBackendCheckItem[]> {
  const bucket = client.storage.from(ATTACHMENTS_BUCKET);
  const { error: listError } = await bucket.list(userId, { limit: 1 });
  if (listError) {
    return [
      checkItem(
        'Attachments bucket',
        'error',
        supabaseBackendErrorMessage(listError, 'Attachments bucket'),
        supabaseErrorCode(listError),
      ),
    ];
  }

  return [
    checkItem('Attachments bucket', 'ok', 'Attachments bucket is reachable for the signed-in user.'),
    await checkAttachmentStorageCanary(client, userId),
  ];
}

async function checkSyncTableWrites(client: SupabaseClient, userId: string): Promise<SyncBackendCheckItem> {
  const now = new Date().toISOString();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const folderId = `marknote-diagnostic-folder-${suffix}`;
  const noteId = `marknote-diagnostic-note-${suffix}`;
  const attachmentId = `marknote-diagnostic-attachment-${suffix}`;
  const storagePath = `${userId}/.marknote-diagnostics/${attachmentId}.txt`;
  const cleanup = async () => {
    const attachmentDelete = await client.from(ATTACHMENTS_TABLE).delete().eq('user_id', userId).eq('id', attachmentId);
    const noteDelete = await client.from(NOTES_TABLE).delete().eq('user_id', userId).eq('id', noteId);
    const folderDelete = await client.from(FOLDERS_TABLE).delete().eq('user_id', userId).eq('id', folderId);
    return [
      { resource: 'Sync table attachment delete', error: attachmentDelete.error },
      { resource: 'Sync table note delete', error: noteDelete.error },
      { resource: 'Sync table folder delete', error: folderDelete.error },
    ];
  };

  try {
    const folderInsert = await client.from(FOLDERS_TABLE).insert({
      id: folderId,
      user_id: userId,
      name: 'MarkNote diagnostic folder',
      sort_order: 0,
      created_at: now,
      updated_at: now,
      version: 1,
    });
    if (folderInsert.error) {
      return syncTableWriteError(folderInsert.error, 'Sync table folder insert');
    }

    const noteInsert = await client.from(NOTES_TABLE).insert({
      id: noteId,
      user_id: userId,
      folder_id: folderId,
      title: 'MarkNote diagnostic note',
      content: '<p>diagnostic</p>',
      raw_content: 'diagnostic',
      tags: [],
      pinned: false,
      created_at: now,
      updated_at: now,
      version: 1,
    });
    if (noteInsert.error) {
      return syncTableWriteError(noteInsert.error, 'Sync table note insert');
    }

    const attachmentInsert = await client.from(ATTACHMENTS_TABLE).insert({
      id: attachmentId,
      user_id: userId,
      note_id: noteId,
      storage_path: storagePath,
      mime_type: 'text/plain',
      size_bytes: 0,
      created_at: now,
      updated_at: now,
    });
    if (attachmentInsert.error) {
      return syncTableWriteError(attachmentInsert.error, 'Sync table attachment insert');
    }

    const noteUpdate = await client
      .from(NOTES_TABLE)
      .update({
        title: 'MarkNote diagnostic note updated',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('id', noteId);
    if (noteUpdate.error) {
      return syncTableWriteError(noteUpdate.error, 'Sync table note update');
    }

    const cleanupResults = await cleanup();
    const cleanupFailure = cleanupResults.find((result) => result.error);
    if (cleanupFailure) {
      return syncTableWriteError(cleanupFailure.error, cleanupFailure.resource);
    }
    const leftover = await findDiagnosticRowLeftover(client, userId, [
      { table: ATTACHMENTS_TABLE, id: attachmentId, resource: 'Sync table attachment delete' },
      { table: NOTES_TABLE, id: noteId, resource: 'Sync table note delete' },
      { table: FOLDERS_TABLE, id: folderId, resource: 'Sync table folder delete' },
    ]);
    if (leftover) {
      return checkItem(leftover.resource, 'error', `${leftover.resource} returned success, but the diagnostic row is still visible.`);
    }
    return checkItem(
      SYNC_TABLE_WRITES_CHECK_NAME,
      'ok',
      'Sync tables can insert, update, and delete folder, note, and attachment rows for the signed-in user.',
    );
  } finally {
    await cleanup().catch(() => undefined);
  }
}

async function findDiagnosticRowLeftover(
  client: SupabaseClient,
  userId: string,
  rows: Array<{ table: string; id: string; resource: string }>,
): Promise<{ resource: string } | null> {
  for (const row of rows) {
    const { data, error } = await client
      .from(row.table)
      .select('id')
      .eq('user_id', userId)
      .eq('id', row.id)
      .limit(1);
    if (error) {
      return { resource: row.resource };
    }
    if (Array.isArray(data) && data.length > 0) {
      return { resource: row.resource };
    }
  }
  return null;
}

function syncTableWriteError(error: unknown, resource: string): SyncBackendCheckItem {
  return checkItem(resource, 'error', supabaseBackendErrorMessage(error, resource), supabaseErrorCode(error));
}

async function checkAttachmentStorageCanary(client: SupabaseClient, userId: string): Promise<SyncBackendCheckItem> {
  const bucket = client.storage.from(ATTACHMENTS_BUCKET);
  const path = `${userId}/.marknote-diagnostics/storage-canary-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  let shouldCleanup = false;

  try {
    const firstUpload = await bucket.upload(path, new Blob(['marknote storage diagnostic v1'], { type: 'text/plain' }), {
      contentType: 'text/plain',
      upsert: false,
    });
    if (firstUpload.error) {
      return storageCanaryError(firstUpload.error, 'Attachment storage upload');
    }
    shouldCleanup = true;

    const overwrite = await bucket.upload(path, new Blob(['marknote storage diagnostic v2'], { type: 'text/plain' }), {
      contentType: 'text/plain',
      upsert: true,
    });
    if (overwrite.error) {
      return storageCanaryError(overwrite.error, 'Attachment storage overwrite');
    }

    const download = await bucket.download(path);
    if (download.error || !download.data) {
      return storageCanaryError(download.error || new Error('Storage returned no data.'), 'Attachment storage download');
    }

    const remove = await bucket.remove([path]);
    if (remove.error) {
      return storageCanaryError(remove.error, 'Attachment storage delete');
    }

    const deletedDownload = await bucket.download(
      path,
      { cacheNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}` },
      { cache: 'no-store' },
    );
    if (deletedDownload.error && !isSupabaseStorageObjectMissingError(deletedDownload.error)) {
      return storageCanaryError(deletedDownload.error, 'Attachment storage delete verification');
    }
    if (!deletedDownload.error && deletedDownload.data) {
      const deletionCheck = await bucket.list(storagePathDirectory(path), {
        limit: 1,
        search: storagePathFilename(path),
      });
      if (deletionCheck.error) {
        return storageCanaryError(deletionCheck.error, 'Attachment storage delete verification');
      }
      const objectStillListed = (deletionCheck.data || []).some((entry) => entry.name === storagePathFilename(path));
      if (!objectStillListed) {
        shouldCleanup = false;
        return checkItem(
          ATTACHMENT_STORAGE_CANARY_CHECK_NAME,
          'ok',
          'Attachment storage can upload, overwrite, download, and delete files for the signed-in user.',
        );
      }
      return storageCanaryError(
        new Error('Diagnostic object is still downloadable after delete.'),
        'Attachment storage delete',
      );
    }
    shouldCleanup = false;

    return checkItem(
      ATTACHMENT_STORAGE_CANARY_CHECK_NAME,
      'ok',
      'Attachment storage can upload, overwrite, download, and delete files for the signed-in user.',
    );
  } finally {
    if (shouldCleanup) {
      await bucket.remove([path]).catch(() => undefined);
    }
  }
}

function storageCanaryError(error: unknown, resource: string): SyncBackendCheckItem {
  return checkItem(resource, 'error', supabaseBackendErrorMessage(error, resource), supabaseErrorCode(error));
}

function storagePathDirectory(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator >= 0 ? path.slice(0, separator) : '';
}

function storagePathFilename(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator >= 0 ? path.slice(separator + 1) : path;
}

function errorMessage(error: unknown): string {
  return errorWithCauseMessage(error);
}

function oauthRedirectUrl(configuredRedirectUrl?: string): string | undefined {
  if (window.marknoteDesktop) {
    return 'marknote://auth/callback';
  }

  if (configuredRedirectUrl) {
    return configuredRedirectUrl;
  }

  if (typeof window === 'undefined' || !window.location.origin.startsWith('http')) {
    return undefined;
  }

  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('app', '1');
  return url.toString();
}

async function softDeleteRemote(client: SupabaseClient, table: string, id: string, deletedAt: string, userId: string) {
  return client
    .from(table)
    .update({
      deleted_at: deletedAt,
      updated_at: deletedAt,
    })
    .eq('user_id', userId)
    .eq('id', id);
}

async function softDeleteAttachmentRemote(
  client: SupabaseClient,
  attachment: string | ImageAttachment,
  deletedAt: string,
  userId: string,
) {
  const id = typeof attachment === 'string' ? attachment : attachment.id;
  const storagePath = typeof attachment === 'string' ? '' : attachment.storagePath;
  if (storagePath) {
    const { error } = await client.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
    if (error && !isSupabaseStorageObjectMissingError(error)) {
      return { data: null, error };
    }
  }
  return softDeleteRemote(client, ATTACHMENTS_TABLE, id, deletedAt, userId);
}

function checkItem(
  name: string,
  status: SyncBackendCheckItem['status'],
  message: string,
  code?: string,
): SyncBackendCheckItem {
  return {
    name,
    status,
    message,
    code,
  };
}

function checkResult(checkedAt: number, items: SyncBackendCheckItem[]): SyncBackendCheckResult {
  return {
    ok: items.every((item) => item.status === 'ok'),
    checkedAt,
    items,
  };
}

function supabaseSyncError(error: unknown, fallback: string): Error {
  const code = supabaseErrorCode(error);
  const next = new Error(`${fallback}: ${supabaseBackendErrorMessage(error, fallback)}`);
  if (code) {
    (next as Error & { code?: string }).code = code;
  }
  return next;
}
