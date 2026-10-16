import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ImageAttachment, SyncDevice, SyncEntity } from '../types';
import { isSafeContentMimeType, MAX_ATTACHMENT_BYTES, sanitizeContentUrl } from '../lib/sanitizeContent';
import { assertSyncInteger, SYNC_PROTOCOL_CHECK_NAME, SYNC_PROTOCOL_VERSION, SYNC_PULL_RPC, SYNC_PUSH_RPC } from './protocol';
import type { MutationReceipt, RemoteChange, RemoteChangePage, RemoteEntityValue, SyncMutation } from './protocol';
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
  CloudStorageUsage,
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
  storageFactory?: (session: AuthSession) => SupabaseClient['storage'];
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
  private readonly publishableKey: string | undefined;
  private readonly storageFactory: ((session: AuthSession) => SupabaseClient['storage']) | undefined;
  private readonly url: string | undefined;
  private readonly authRedirectUrl: string | undefined;

  constructor(
    url: string | undefined,
    publishableKey: string | undefined,
    client?: SupabaseClient,
    options: SupabaseSyncAdapterOptions = {},
  ) {
    this.url = url;
    this.publishableKey = publishableKey;
    this.storageFactory = options.storageFactory;
    this.authRedirectUrl = options.authRedirectUrl;
    this.configured = Boolean(url && publishableKey);
    this.client =
      client ??
      (this.configured && url && publishableKey
        ? createClient(url, publishableKey, {
            global: { fetch: fetchWithSyncTimeout },
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

    const tableWriteCheck = await checkSyncTableWrites(client, session);
    items.push(tableWriteCheck);
    items.push(checkItem(SYNC_PROTOCOL_CHECK_NAME, tableWriteCheck.status, tableWriteCheck.message, tableWriteCheck.code));
    if (tableWriteCheck.status === 'error') {
      return checkResult(checkedAt, items);
    }
    await this.assertSessionStillUser(session.user.id);
    items.push(...(await checkAttachmentStorage(client, this.storageForSession(session), session)));
    await this.assertSessionStillUser(session.user.id);

    return checkResult(checkedAt, items);
  }

  async registerDevice(device: SyncDevice, expectedUserId?: string): Promise<void> {
    const deadline = Date.now() + 28_000;
    const client = this.requireClient();
    const session = await this.getSession();
    if (session && expectedUserId && session.user.id !== expectedUserId) throw new Error('Account changed; the previous request was discarded.');
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
    const { error } = await rpcWithTimeout(client.from(DEVICES_TABLE).upsert(row, { onConflict: 'user_id,id' }).setHeader('Authorization', sessionAuthorization(session)), remainingSyncTime(deadline));
    await this.assertSessionStillUser(session.user.id);
    if (error) {
      throw supabaseSyncError(error, 'Could not register this device');
    }
  }

  /** Old timestamp/upsert clients must never bypass the versioned protocol. */
  async pull(_lastPulledAt: number): Promise<RemoteSnapshot> {
    void _lastPulledAt;
    throw new Error('Versioned sync protocol is required. Use pullChanges with a sequence cursor.');
  }

  async push(_payload: PushPayload): Promise<{ syncedAt: number }> {
    void _payload;
    throw new Error('Versioned sync protocol is required. Use pushMutations with immutable mutation ids and expected revisions.');
  }

  async pullChanges(afterSequence: number, upperBound?: number, expectedUserId?: string): Promise<RemoteChangePage> {
    const deadline = Date.now() + 28_000;
    assertSyncInteger(afterSequence, 'Sync cursor');
    if (upperBound !== undefined) {
      assertSyncInteger(upperBound, 'Sync snapshot bound');
      if (upperBound < afterSequence) throw new Error('Sync snapshot bound precedes the cursor.');
    }
    const client = this.requireClient();
    const session = await this.getSession();
    if (!session || (expectedUserId && session.user.id !== expectedUserId)) throw new Error('Account changed or signed out; the previous request was discarded.');
    const { data, error } = await rpcForSession(client, SYNC_PULL_RPC, {
      p_after_seq: afterSequence,
      p_upper_bound: upperBound ?? null,
      p_limit: 200,
    }, session, deadline);
    await this.assertSessionStillUser(session.user.id);
    if (error) throw protocolError(error, 'Could not pull versioned changes');
    const page = record(data, 'sync page');
    const nextSequence = integer(page.nextSequence, 'Next sync cursor');
    const bound = integer(page.upperBound, 'Sync snapshot bound');
    const serverTime = integer(page.serverTime, 'Server time');
    if (typeof page.hasMore !== 'boolean' || !Array.isArray(page.changes)
      || bound < afterSequence || nextSequence < afterSequence || nextSequence > bound
      || (upperBound !== undefined && upperBound !== bound)) {
      throw new Error('Invalid versioned sync page.');
    }
    const changes = page.changes.map(changeFromWire);
    let previousSequence = afterSequence;
    for (const change of changes) {
      if (change.sequence <= previousSequence || change.sequence > nextSequence) {
        throw new Error('Versioned sync changes are out of sequence.');
      }
      previousSequence = change.sequence;
    }
    if ((page.hasMore && (changes.length === 0 || nextSequence !== previousSequence))
      || (!page.hasMore && nextSequence !== bound)) {
      throw new Error('Invalid versioned sync paging progress.');
    }
    return { changes, nextSequence, upperBound: bound, hasMore: page.hasMore, serverTime };
  }

  async pushMutations(mutations: SyncMutation[], expectedUserId?: string): Promise<MutationReceipt[]> {
    const deadline = Date.now() + 28_000;
    const client = this.requireClient();
    const session = await this.getSession();
    if (session && expectedUserId && session.user.id !== expectedUserId) throw new Error('Account changed; the previous request was discarded.');
    if (!session) throw new Error('Please sign in before syncing.');
    sessionAuthorization(session);
    const ids = new Set<string>();
    const wire = mutations.map((mutation) => {
      assertSyncInteger(mutation.expectedRevision, 'Expected remote revision');
      assertSyncInteger(mutation.localRevision, 'Local revision');
      if (!mutation.mutationId || ids.has(mutation.mutationId)) throw new Error('Mutation ids must be unique and nonempty.');
      ids.add(mutation.mutationId);
      if (mutation.operation === 'upsert' && (!mutation.value || mutation.value.id !== mutation.entityId)) {
        throw new Error('Mutation entity id does not match its document.');
      }
      if (mutation.operation === 'upsert' && mutation.entity === 'attachment') {
        if ((mutation.value as ImageAttachment).historyOnly) throw new Error('History-only attachments must remain local.');
        const path = (mutation.value as ImageAttachment).storagePath;
        if (!path) throw new Error(`Attachment storage path is missing for ${mutation.entityId}.`);
        assertOwnedStoragePath(path, session.user.id);
      }
      return { ...mutation, value: mutation.operation === 'delete' ? null : documentForWire(mutation.entity, mutation.value!) };
    });
    const receipts: MutationReceipt[] = [];
    for (let offset = 0; offset < wire.length; offset += 100) {
      const batch = wire.slice(offset, offset + 100);
      await this.assertSessionStillUser(session.user.id);
      const { data, error } = await rpcForSession(client, SYNC_PUSH_RPC, { p_mutations: batch }, session, deadline);
      await this.assertSessionStillUser(session.user.id);
      if (error) throw protocolError(error, 'Could not push versioned mutations');
      if (!Array.isArray(data) || data.length !== batch.length) throw new Error('Incomplete versioned mutation receipts.');
      for (let index = 0; index < batch.length; index += 1) {
        const receipt = receiptFromWire(data[index]);
        const sent = batch[index];
        if (receipt.mutationId !== sent.mutationId || receipt.localRevision !== sent.localRevision
          || receipt.entity !== sent.entity || receipt.entityId !== sent.entityId) {
          throw new Error('Versioned mutation receipt does not match its frozen generation.');
        }
        receipts.push(receipt);
      }
    }
    if (receipts.some((receipt) => receipt.status === 'applied' && receipt.value === null)) {
      await this.flushAttachmentGarbage(session.user.id, deadline);
    }
    return receipts;
  }

  async flushAttachmentGarbage(expectedUserId?: string, deadline = Date.now() + 28_000): Promise<void> {
    const client = this.requireClient();
    const session = await this.getSession();
    if (session && expectedUserId && session.user.id !== expectedUserId) throw new Error('Account changed; the previous request was discarded.');
    if (!session) throw new Error('Please sign in before removing attachments.');
    // Bound each pass; a later automatic sync resumes remaining jobs.
    for (let page = 0; page < 10; page += 1) {
      await this.assertSessionStillUser(session.user.id);
      const { data, error } = await rpcForSession(client, 'marknote_sync_collect_storage_v2', { p_limit: 100 }, session, deadline);
      await this.assertSessionStillUser(session.user.id);
      if (error) throw protocolError(error, 'Could not collect purged attachment files');
      if (!Array.isArray(data) || data.some((path) => typeof path !== 'string')) throw new Error('Invalid attachment cleanup jobs.');
      if (data.length === 0) return;
      const paths = data as string[];
      paths.forEach((path) => assertOwnedStoragePath(path, session.user.id));
      const bucket = this.storageForSession(session, deadline).from(ATTACHMENTS_BUCKET);
      const removed = await bucket.remove(paths);
      await this.assertSessionStillUser(session.user.id);
      if (removed.error && !isSupabaseStorageObjectMissingError(removed.error)) {
        throw supabaseSyncError(removed.error, 'Could not remove purged attachment files');
      }
      for (const path of paths) {
        const verify = await bucket.list(storagePathDirectory(path),
          { limit: 1, search: storagePathFilename(path) }, { signal: AbortSignal.timeout(remainingSyncTime(deadline)) });
        if (verify.error || (verify.data || []).some((entry) => entry.name === storagePathFilename(path))) {
          throw new Error('Purged attachment file remains visible; cleanup will be retried.');
        }
      }
      const acknowledged = await rpcForSession(client, 'marknote_sync_ack_storage_v2', { p_paths: paths }, session, deadline);
      await this.assertSessionStillUser(session.user.id);
      if (acknowledged.error) throw protocolError(acknowledged.error, 'Could not acknowledge removed attachment files');
    }
  }

  async getStorageUsage(expectedUserId?: string): Promise<CloudStorageUsage> {
    const client = this.requireClient();
    const session = await this.getSession();
    if (!session || (expectedUserId && session.user.id !== expectedUserId)) {
      throw new Error('Account changed or signed out; the storage request was discarded.');
    }
    const { data, error } = await rpcForSession(client, 'marknote_sync_storage_usage_v2', {}, session);
    await this.assertSessionStillUser(session.user.id);
    if (error) throw supabaseSyncError(error, 'Could not load cloud attachment usage');
    return cloudStorageUsageFromWire(data);
  }

  async uploadAttachment(attachment: ImageAttachment, expectedUserId?: string): Promise<{ storagePath: string; publicUrl?: string }> {
    const deadline = Date.now() + 28_000;
    const client = this.requireClient();
    const session = await this.getSession();
    if (session && expectedUserId && session.user.id !== expectedUserId) throw new Error('Account changed; the previous request was discarded.');
    if (!session) {
      throw new Error('Please sign in before uploading attachments.');
    }
    if (attachment.historyOnly) throw new Error('History-only attachments must remain local.');
    if (!isSafeContentMimeType(attachment.mimeType, 'file') || !sanitizeContentUrl(attachment.data, 'file')
      || attachment.data.slice(5, attachment.data.indexOf(';')).toLowerCase() !== attachment.mimeType.toLowerCase()) {
      throw new Error('Unsafe attachment content or mismatched MIME type.');
    }
    remainingSyncTime(deadline);
    const blob = dataUrlToBlob(attachment.data, attachment.mimeType);
    if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds the 20 MiB size limit.');
    if (!attachment.noteId || !attachment.id || [attachment.noteId, attachment.id].some((id) => /[\\/]|^\.\.?$/.test(id))) {
      throw new Error('Invalid attachment identity.');
    }
    const hash = await blobHash(blob);
    const storagePath = `${session.user.id}/${attachment.noteId}/${attachment.id}/${hash}`;
    await this.assertSessionStillUser(session.user.id);
    const reservation = await rpcForSession(client, 'marknote_sync_reserve_storage_v2', {
      p_path: storagePath,
      p_size_bytes: blob.size,
      p_mime_type: attachment.mimeType,
    }, session, deadline);
    if (reservation.error) throw supabaseSyncError(reservation.error, 'Could not reserve cloud attachment storage');
    try {
      const bucket = this.storageForSession(session, deadline).from(ATTACHMENTS_BUCKET);
      const { error } = await bucket.upload(storagePath, await blob.arrayBuffer(), {
        contentType: attachment.mimeType,
        upsert: false,
        headers: { Authorization: sessionAuthorization(session) },
      });
      await this.assertSessionStillUser(session.user.id);
      if (error) {
        if (!isStorageObjectAlreadyExists(error)) throw supabaseSyncError(error, 'Could not upload attachment');
        // A retry may find the immutable blob. Confirm integrity before reusing it.
        const existing = await bucket.download(storagePath);
        if (existing.error || !existing.data || await blobHash(existing.data) !== hash) {
          throw new Error('Existing immutable attachment failed integrity verification.');
        }
      }
      return { storagePath };
    } finally {
      await releaseStorageReservation(client, session, storagePath);
    }
  }

  async downloadAttachment(attachment: ImageAttachment, expectedUserId?: string): Promise<{ data: string }> {
    const deadline = Date.now() + 28_000;
    this.requireClient();
    if (!isSafeContentMimeType(attachment.mimeType, 'file')) throw new Error('Unsafe attachment MIME type.');
    if (!attachment.storagePath) {
      throw new Error('Attachment storage path is missing.');
    }
    const session = await this.getSession();
    if (session && expectedUserId && session.user.id !== expectedUserId) throw new Error('Account changed; the previous request was discarded.');
    if (!session) throw new Error('Please sign in before downloading attachments.');
    assertOwnedStoragePath(attachment.storagePath, session.user.id);
    const { data, error } = await this.storageForSession(session, deadline).from(ATTACHMENTS_BUCKET).download(attachment.storagePath, {}, { signal: AbortSignal.timeout(remainingSyncTime(deadline)) });
    await this.assertSessionStillUser(session.user.id);
    if (error) {
      throw supabaseSyncError(error, 'Could not download attachment');
    }
    if (!data) {
      throw new Error('Could not download attachment: Storage returned no data.');
    }
    if (data.size > MAX_ATTACHMENT_BYTES) throw new Error('Downloaded attachment exceeds the 20 MiB size limit.');
    if (data.type && data.type.toLowerCase() !== attachment.mimeType.toLowerCase() && data.type !== 'application/octet-stream') {
      throw new Error('Downloaded attachment MIME type does not match its metadata.');
    }
    const expectedHash = attachment.storagePath.split('/').at(-1);
    if (expectedHash && /^[a-f0-9]{64}$/.test(expectedHash) && await blobHash(data) !== expectedHash) {
      throw new Error('Downloaded attachment failed integrity verification.');
    }
    return { data: await blobToDataUrl(data, attachment.mimeType) };
  }

  private async assertSessionStillUser(userId: string): Promise<void> {
    const session = await this.getSession();
    if (session?.user.id !== userId) throw new Error('Account changed; the previous request was discarded.');
  }

  private storageForSession(session: AuthSession, deadline = Date.now() + 28_000): SupabaseClient['storage'] {
    sessionAuthorization(session);
    remainingSyncTime(deadline);
    if (this.storageFactory) return this.storageFactory(session);
    if (!this.url || !this.publishableKey) throw new Error('Supabase storage is not configured.');
    // A separate non-persistent client binds every storage operation (including
    // remove, whose SDK has no per-request headers) to this captured identity.
    return createClient(this.url, this.publishableKey, {
      global: { headers: { Authorization: sessionAuthorization(session) }, fetch: (input,options) => fetchWithSyncDeadline(input,options,deadline) },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }).storage;
  }

  private requireClient(): SupabaseClient {
    if (!this.client) {
      throw new Error('Supabase sync is not configured. Check the sync configuration backend API.');
    }
    return this.client;
  }
}

const fetchWithSyncTimeout: typeof fetch = (input, options = {}) => {
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return globalThis.fetch(input, { ...options, signal });
};

function remainingSyncTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Sync request timed out. Retry safely using the same immutable mutation ids.');
  return remaining;
}

function fetchWithSyncDeadline(input: Parameters<typeof fetch>[0], options: RequestInit = {}, deadline: number) {
  const timeout = AbortSignal.timeout(remainingSyncTime(deadline));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return globalThis.fetch(input, { ...options, signal });
}

function rpcWithTimeout<T>(request: PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> }, timeout = 28_000): PromiseLike<T> {
  return typeof request.abortSignal === 'function' ? request.abortSignal(AbortSignal.timeout(timeout)) : request;
}

function sessionAuthorization(session: AuthSession): string {
  if (!session.accessToken) throw new Error('The authenticated sync session has no access token. Sign in again.');
  return `Bearer ${session.accessToken}`;
}

function rpcForSession(client: SupabaseClient, name: string, args: Record<string, unknown>, session: AuthSession, deadline = Date.now() + 28_000) {
  const timeout = remainingSyncTime(deadline);
  return rpcWithTimeout(client.rpc(name, args).setHeader('Authorization', sessionAuthorization(session)), timeout);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number') throw new Error(`Invalid ${label}.`);
  assertSyncInteger(value, label);
  return value;
}

function cloudStorageUsageFromWire(value: unknown): CloudStorageUsage {
  const usage = record(value, 'cloud storage usage');
  const result = {
    usedBytes: integer(usage.usedBytes, 'Cloud storage used bytes'),
    quotaBytes: integer(usage.quotaBytes, 'Cloud storage quota'),
    objectCount: integer(usage.objectCount, 'Cloud storage object count'),
    objectLimit: integer(usage.objectLimit, 'Cloud storage object limit'),
    maxFileBytes: integer(usage.maxFileBytes, 'Cloud storage file limit'),
    reservedBytes: integer(usage.reservedBytes, 'Cloud storage reserved bytes'),
    reservedObjects: integer(usage.reservedObjects, 'Cloud storage reserved objects'),
  };
  if (result.quotaBytes <= 0 || result.objectLimit <= 0 || result.maxFileBytes <= 0) {
    throw new Error('Invalid cloud storage limits.');
  }
  return result;
}

function entityFromWire(value: unknown): SyncEntity {
  if (value !== 'folder' && value !== 'note' && value !== 'attachment') throw new Error('Invalid remote entity kind.');
  return value;
}

function valueFromWire(entity: SyncEntity, value: unknown, revision: number, entityId: string): RemoteEntityValue | null {
  if (value === null) return null;
  const document = record(value, 'remote document');
  if (document.id !== entityId) throw new Error('Remote document identity mismatch.');
  integer(document.createdAt, 'Remote creation time');
  integer(document.updatedAt, 'Remote update time');
  if (document.deletedAt !== undefined && document.deletedAt !== null) integer(document.deletedAt, 'Remote deletion time');
  if (entity === 'folder' && (typeof document.name !== 'string' || typeof document.sortOrder !== 'number')
    || entity === 'note' && (typeof document.title !== 'string' || typeof document.content !== 'string'
      || typeof document.folderId !== 'string' || typeof document.pinned !== 'boolean'
      || !Array.isArray(document.tags) || document.tags.some((tag) => typeof tag !== 'string'))
    || entity === 'attachment' && (typeof document.noteId !== 'string' || typeof document.storagePath !== 'string'
      || typeof document.mimeType !== 'string')) throw new Error('Invalid remote entity document.');
  return {
    ...document,
    ...(entity === 'attachment' ? { data: '', sizeBytes: document.sizeBytes ?? undefined } : {}),
    ...(entity === 'note' && document.rawContent === null ? { rawContent: undefined } : {}),
    syncStatus: 'synced', remoteRevision: revision, version: revision, lastSyncedAt: Date.now(),
  } as unknown as RemoteEntityValue;
}

function changeFromWire(value: unknown): RemoteChange {
  const wire = record(value, 'remote change');
  const entity = entityFromWire(wire.entity);
  if (typeof wire.entityId !== 'string' || (wire.operation !== 'upsert' && wire.operation !== 'delete')) {
    throw new Error('Invalid remote change identity or operation.');
  }
  const revision = integer(wire.revision, 'Remote revision');
  const sequence = integer(wire.sequence, 'Remote sequence');
  if (!revision || !sequence) throw new Error('Remote change revision and sequence must be positive.');
  const document = valueFromWire(entity, wire.value, revision, wire.entityId);
  if ((wire.operation === 'delete') !== (document === null)) throw new Error('Invalid remote tombstone.');
  return { entity, entityId: wire.entityId, operation: wire.operation, revision, sequence, value: document };
}

function receiptFromWire(value: unknown): MutationReceipt {
  const wire = record(value, 'mutation receipt');
  const entity = entityFromWire(wire.entity);
  if (typeof wire.entityId !== 'string' || typeof wire.mutationId !== 'string'
    || (wire.status !== 'applied' && wire.status !== 'conflict') || typeof wire.replayed !== 'boolean') {
    throw new Error('Invalid mutation receipt identity or status.');
  }
  const revision = integer(wire.revision, 'Remote revision');
  const sequence = integer(wire.sequence, 'Remote sequence');
  if (wire.status === 'applied' && (!revision || !sequence)) throw new Error('Invalid applied mutation receipt.');
  return { entity, entityId: wire.entityId, mutationId: wire.mutationId,
    localRevision: integer(wire.localRevision, 'Local revision'), status: wire.status,
    revision, sequence, value: valueFromWire(entity, wire.value, revision, wire.entityId), replayed: wire.replayed };
}

function documentForWire(entity: SyncEntity, value: RemoteEntityValue): Record<string, unknown> {
  const keys = entity === 'folder' ? ['id','name','sortOrder','createdAt','updatedAt','deletedAt']
    : entity === 'note' ? ['id','folderId','title','content','rawContent','tags','pinned','createdAt','updatedAt','deletedAt']
    : ['id','noteId','storagePath','mimeType','sizeBytes','createdAt','updatedAt','deletedAt'];
  const source = value as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key,source[key]]));
}

function assertOwnedStoragePath(path: string, userId: string): void {
  if (!path.startsWith(`${userId}/`) || path.split('/').some((part) => !part || part === '.' || part === '..')
    || /[\\?#]/.test(path)) throw new Error('Attachment storage path belongs to another account or is invalid.');
}

async function blobHash(blob: Blob): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isStorageObjectAlreadyExists(error: unknown): boolean {
  const code = supabaseErrorCode(error);
  return code === '409' || code === 'Duplicate' || /already exists/i.test(errorMessage(error));
}

function protocolError(error: unknown, fallback: string): Error {
  const message = supabaseSyncError(error, fallback);
  message.message += ' Apply the latest Supabase migrations; unsafe legacy writes are never used as a fallback.';
  return message;
}

async function releaseStorageReservation(client: SupabaseClient, session: AuthSession, storagePath: string): Promise<void> {
  try {
    await rpcForSession(client, 'marknote_sync_release_storage_v2', { p_path: storagePath }, session, Date.now() + 5_000);
  } catch {
    // Reservations expire after 15 minutes; cleanup must not hide the upload result.
  }
}

function toIso(value: number): string {
  return new Date(value || 0).toISOString();
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
  return `data:${fallbackMimeType};base64,${btoa(binary)}`;
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

async function checkAttachmentStorage(
  client: SupabaseClient,
  storage: SupabaseClient['storage'],
  session: AuthSession,
): Promise<SyncBackendCheckItem[]> {
  const bucket = storage.from(ATTACHMENTS_BUCKET);
  const { error: listError } = await bucket.list(session.user.id, { limit: 1 });
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
    await checkAttachmentStorageCanary(client, storage, session),
  ];
}

async function checkSyncTableWrites(client: SupabaseClient, session: AuthSession): Promise<SyncBackendCheckItem> {
  const { data, error } = await rpcForSession(client, 'marknote_sync_check_v2', {}, session);
  if (error) return checkItem(SYNC_TABLE_WRITES_CHECK_NAME, 'error', protocolError(error, 'Versioned sync readiness check failed').message, supabaseErrorCode(error));
  const readiness = data as { protocolVersion?: number; capabilities?: unknown } | null;
  const required = ['cas', 'idempotency', 'sequence', 'tombstones', 'snapshot-paging', 'storage-quota'];
  if (readiness?.protocolVersion !== SYNC_PROTOCOL_VERSION || !Array.isArray(readiness.capabilities)
    || required.some((capability) => !(readiness.capabilities as unknown[]).includes(capability))) {
    return checkItem(SYNC_TABLE_WRITES_CHECK_NAME, 'error', 'Versioned sync readiness returned an unsupported protocol.');
  }
  return checkItem(SYNC_TABLE_WRITES_CHECK_NAME, 'ok', 'Versioned sync CAS, replay, and tombstone writes passed inside a rolled back diagnostic transaction.');
}

async function checkAttachmentStorageCanary(
  client: SupabaseClient,
  storage: SupabaseClient['storage'],
  session: AuthSession,
): Promise<SyncBackendCheckItem> {
  const bucket = storage.from(ATTACHMENTS_BUCKET);
  const blob = new Blob(['marknote storage diagnostic v2'], { type: 'text/plain' });
  const canaryId = `storage-canary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${session.user.id}/.marknote-diagnostics/${canaryId}/${await blobHash(blob)}`;
  let shouldCleanup = false;

  try {
    const reservation = await rpcForSession(client, 'marknote_sync_reserve_storage_v2', {
      p_path: path,
      p_size_bytes: blob.size,
      p_mime_type: 'text/plain',
    }, session);
    if (reservation.error) {
      return storageCanaryError(reservation.error, 'Attachment storage quota');
    }
    const firstUpload = await bucket.upload(path, await blob.arrayBuffer(), {
      contentType: 'text/plain',
      upsert: false,
    });
    if (firstUpload.error) {
      return storageCanaryError(firstUpload.error, 'Attachment storage upload');
    }
    shouldCleanup = true;

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
          'Attachment storage quota can reserve, upload, download, and delete immutable files for the signed-in user.',
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
      'Attachment storage quota can reserve, upload, download, and delete immutable files for the signed-in user.',
    );
  } finally {
    if (shouldCleanup) {
      await bucket.remove([path]).catch(() => undefined);
    }
    await releaseStorageReservation(client, session, path);
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
