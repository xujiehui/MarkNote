import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SupabaseSyncAdapter } from '../src/sync/supabaseAdapter';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:5173/?app=1',
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
});

const originalFetch = globalThis.fetch;

interface OAuthCall {
  provider: string;
  options?: {
    redirectTo?: string;
    skipBrowserRedirect?: boolean;
  };
}

interface ClientStubOptions {
  deleteErrors?: Record<string, { code?: string; message: string }>;
  leftoverRows?: Record<string, boolean>;
  remoteRows?: Record<string, unknown[]>;
  storageDeleteLeavesObject?: boolean;
  storageRemoveError?: { code?: string; message: string };
  tableErrors?: Record<string, { code?: string; message: string }>;
  storageError?: { code?: string; message: string };
}

type StubError = { code?: string; message: string } | null;

function createClientStub(options: ClientStubOptions = {}) {
  const calls: OAuthCall[] = [];
  const codes: string[] = [];
  const sessions: Array<{ access_token: string; refresh_token: string }> = [];
  const authHandlers: Array<(event: string, session: { access_token?: string; user: { id: string; email?: string } } | null) => void> = [];
  let authUnsubscribeCount = 0;
  const inserts: Array<{ table: string; row: unknown }> = [];
  const tableSelects: Array<{ table: string; columns: string }> = [];
  const deletes: Array<{ table: string; filters: string[] }> = [];
  const updates: Array<{ table: string; changes: unknown; filters: string[] }> = [];
  const upserts: Array<{ table: string; options?: { onConflict?: string } }> = [];
  const storageLists: Array<{ bucket: string; path: string; limit?: number }> = [];
  const storageUploads: Array<{ bucket: string; path: string; upsert?: boolean }> = [];
  const storageRemoves: Array<{ bucket: string; paths: string[] }> = [];
  const storageDownloads: Array<{ bucket: string; path: string }> = [];
  const storagePaths = new Set<string>();
  const removedStoragePaths = new Set<string>();
  const client = {
    auth: {
      async getSession() {
        return {
          data: {
            session: sessions.length
              ? {
                  access_token: sessions.at(-1)?.access_token,
                  user: {
                    id: 'user-1',
                    email: 'google@example.com',
                  },
                }
              : null,
          },
          error: null,
        };
      },
      async signInWithOAuth(call: OAuthCall) {
        calls.push(call);
        return {
          data: {
            url: 'https://example.supabase.co/auth/v1/authorize?provider=google',
          },
          error: null,
        };
      },
      async setSession(session: { access_token: string; refresh_token: string }) {
        sessions.push(session);
        return { data: { session }, error: null };
      },
      async exchangeCodeForSession(code: string) {
        codes.push(code);
        sessions.push({ access_token: `access-${code}`, refresh_token: `refresh-${code}` });
        return { data: { session: sessions.at(-1) }, error: null };
      },
      async signOut() {
        return { error: null };
      },
      onAuthStateChange(handler: (event: string, session: { access_token?: string; user: { id: string; email?: string } } | null) => void) {
        authHandlers.push(handler);
        return {
          data: {
            subscription: {
              unsubscribe() {
                authUnsubscribeCount += 1;
              },
            },
          },
        };
      },
    },
    from(table: string) {
      return {
        select(columns: string) {
          tableSelects.push({ table, columns });
          const filters: string[] = [];
          return {
            async limit() {
              const hasLeftover = options.leftoverRows?.[table] && filters.some((filter) => filter.startsWith('id:marknote-diagnostic-'));
              return { data: hasLeftover ? [{ id: 'leftover' }] : [], error: options.tableErrors?.[table] || null };
            },
            async gt() {
              return { data: options.remoteRows?.[table] || [], error: options.tableErrors?.[table] || null };
            },
            eq(column: string, value: string) {
              filters.push(`${column}:${value}`);
              return this;
            },
          };
        },
        async insert(row: unknown) {
          inserts.push({ table, row });
          return { data: null, error: options.tableErrors?.[table] || null };
        },
        async upsert(_rows: unknown, upsertOptions?: { onConflict?: string }) {
          void _rows;
          upserts.push({ table, options: upsertOptions });
          return { data: null, error: options.tableErrors?.[table] || null };
        },
        update(_changes: unknown) {
          const filters: string[] = [];
          return {
            eq(column: string, value: string) {
              filters.push(`${column}:${value}`);
              return this;
            },
            then(resolve: (value: { data: null; error: StubError }) => void) {
              updates.push({ table, changes: _changes, filters });
              resolve({ data: null, error: options.tableErrors?.[table] || null });
            },
          };
        },
        delete() {
          const filters: string[] = [];
          return {
            eq(column: string, value: string) {
              filters.push(`${column}:${value}`);
              return this;
            },
            then(resolve: (value: { data: null; error: StubError }) => void) {
              deletes.push({ table, filters });
              resolve({ data: null, error: options.deleteErrors?.[table] || options.tableErrors?.[table] || null });
            },
          };
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async list(path: string, listOptions?: { limit?: number }) {
            storageLists.push({ bucket, path, limit: listOptions?.limit });
            const search = (listOptions as { search?: string } | undefined)?.search;
            const data = [...storagePaths]
              .filter((storagePath) => storagePath.startsWith(`${path}/`))
              .filter((storagePath) => !search || storagePath.endsWith(search))
              .map((storagePath) => ({ name: storagePath.slice(storagePath.lastIndexOf('/') + 1) }));
            return { data, error: options.storageError || null };
          },
          async upload(path: string, _body: Blob, uploadOptions?: { upsert?: boolean }) {
            void _body;
            storageUploads.push({ bucket, path, upsert: uploadOptions?.upsert });
            if (!options.storageError) {
              storagePaths.add(path);
            }
            return { data: null, error: options.storageError || null };
          },
          async remove(paths: string[]) {
            storageRemoves.push({ bucket, paths });
            if (!options.storageDeleteLeavesObject && !options.storageError && !options.storageRemoveError) {
              for (const path of paths) {
                removedStoragePaths.add(path);
                storagePaths.delete(path);
              }
            }
            return { data: [], error: options.storageRemoveError || options.storageError || null };
          },
          async download(path: string) {
            storageDownloads.push({ bucket, path });
            if (removedStoragePaths.has(path)) {
              return { data: null, error: { code: '404', message: 'Object not found' } };
            }
            return { data: new Blob(['hello'], { type: 'image/png' }), error: options.storageError || null };
          },
        };
      },
    },
  };
  return {
    calls,
    authHandlers,
    get authUnsubscribeCount() {
      return authUnsubscribeCount;
    },
    client,
    codes,
    deletes,
    inserts,
    sessions,
    storageDownloads,
    storageLists,
    storageRemoves,
    storageUploads,
    tableSelects,
    updates,
    upserts,
  };
}

async function main() {
  globalThis.fetch = (async () => undefined as never) as typeof fetch;

  const webStub = createClientStub();
  const webAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', webStub.client as never);
  await webAdapter.signInWithOAuth('google');
  assert.equal(webStub.calls.length, 1);
  assert.equal(webStub.calls[0].provider, 'google');
  assert.equal(webStub.calls[0].options?.redirectTo, 'http://127.0.0.1:5173/?app=1');
  assert.equal(webStub.calls[0].options?.skipBrowserRedirect, false);

  const configuredRedirectStub = createClientStub();
  const configuredRedirectAdapter = new SupabaseSyncAdapter(
    'https://example.supabase.co',
    'sb_publishable_test',
    configuredRedirectStub.client as never,
    { authRedirectUrl: 'https://app.example.test/?app=1' },
  );
  await configuredRedirectAdapter.signInWithOAuth('google');
  assert.equal(configuredRedirectStub.calls[0].options?.redirectTo, 'https://app.example.test/?app=1');

  const opened: string[] = [];
  window.marknoteDesktop = {
    platform: 'darwin',
    openExternal: async (url) => {
      opened.push(url);
    },
  };

  const desktopStub = createClientStub();
  const desktopAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', desktopStub.client as never);
  await desktopAdapter.signInWithOAuth('google');
  assert.equal(desktopStub.calls.length, 1);
  assert.equal(desktopStub.calls[0].provider, 'google');
  assert.equal(desktopStub.calls[0].options?.redirectTo, 'marknote://auth/callback');
  assert.equal(desktopStub.calls[0].options?.skipBrowserRedirect, true);
  assert.deepEqual(opened, ['https://example.supabase.co/auth/v1/authorize?provider=google']);

  const session = await desktopAdapter.completeOAuthSignIn('marknote://auth/callback#access_token=access-1&refresh_token=refresh-1');
  assert.equal(desktopStub.sessions.length, 1);
  assert.equal(desktopStub.sessions[0].access_token, 'access-1');
  assert.equal(desktopStub.sessions[0].refresh_token, 'refresh-1');
  assert.equal(session?.user.email, 'google@example.com');

  const authEvents: Array<{ event: string; userId?: string; email?: string; accessToken?: string }> = [];
  const unsubscribeAuth = desktopAdapter.onSessionChange((nextSession, event) => {
    authEvents.push({
      event,
      userId: nextSession?.user.id,
      email: nextSession?.user.email,
      accessToken: nextSession?.accessToken,
    });
  });
  assert.equal(desktopStub.authHandlers.length, 1);
  desktopStub.authHandlers[0]('TOKEN_REFRESHED', {
    access_token: 'access-refreshed',
    user: { id: 'user-refreshed', email: 'fresh@example.com' },
  });
  desktopStub.authHandlers[0]('SIGNED_OUT', null);
  unsubscribeAuth();
  assert.deepEqual(authEvents, [
    {
      event: 'TOKEN_REFRESHED',
      userId: 'user-refreshed',
      email: 'fresh@example.com',
      accessToken: 'access-refreshed',
    },
    {
      event: 'SIGNED_OUT',
      userId: undefined,
      email: undefined,
      accessToken: undefined,
    },
  ]);
  assert.equal(desktopStub.authUnsubscribeCount, 1);

  const codeSession = await desktopAdapter.completeOAuthSignIn('marknote://auth/callback?code=code-1');
  assert.deepEqual(desktopStub.codes, ['code-1']);
  assert.equal(codeSession?.accessToken, 'access-code-1');

  await assert.rejects(
    () => desktopAdapter.completeOAuthSignIn('marknote://auth/callback?error_description=Provider%20denied'),
    /Provider denied/,
  );
  await assert.rejects(
    () => desktopAdapter.completeOAuthSignIn('marknote://auth/callback#error=access_denied'),
    /access_denied/,
  );

  globalThis.fetch = (async () => {
    throw new TypeError('getaddrinfo ENOTFOUND missing.supabase.co');
  }) as typeof fetch;
  await assert.rejects(
    () => webAdapter.signInWithOAuth('google'),
    /Supabase project URL cannot be resolved/,
  );

  globalThis.fetch = (async () => undefined as never) as typeof fetch;

  const noSessionStub = createClientStub();
  const noSessionAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', noSessionStub.client as never);
  const noSessionCheck = await noSessionAdapter.checkBackend();
  assert.equal(noSessionCheck.ok, false);
  assert.equal(noSessionCheck.items.some((item) => item.status === 'warning' && item.name === 'Auth session'), true);
  assert.equal(noSessionStub.tableSelects.length, 0);

  const checkStub = createClientStub();
  checkStub.sessions.push({ access_token: 'access-ok', refresh_token: 'refresh-ok' });
  const checkAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', checkStub.client as never);
  const check = await checkAdapter.checkBackend();
  assert.equal(check.ok, true);
  const authCheck = check.items.find((item) => item.name === 'Auth session');
  assert.equal(authCheck?.status, 'ok');
  assert.doesNotMatch(authCheck?.message || '', /google@example\.com|user-1/);
  assert.deepEqual(checkStub.tableSelects.slice(0, 5).map((item) => item.table), [
    'profiles',
    'devices',
    'folders',
    'notes',
    'attachments',
  ]);
  assert.deepEqual(checkStub.inserts.map((item) => item.table), ['folders', 'notes', 'attachments']);
  assert.deepEqual(checkStub.updates.map((item) => item.table), ['notes']);
  assert.deepEqual(checkStub.deletes.map((item) => item.table), [
    'attachments',
    'notes',
    'folders',
    'attachments',
    'notes',
    'folders',
  ]);
  assert.equal(check.items.some((item) => item.name === 'Sync table writes' && item.status === 'ok'), true);
  assert.deepEqual(checkStub.storageLists, [{ bucket: 'attachments', path: 'user-1', limit: 1 }]);
  assert.equal(checkStub.storageUploads.length, 2);
  assert.equal(checkStub.storageUploads[0].bucket, 'attachments');
  assert.equal(checkStub.storageUploads[0].upsert, false);
  assert.equal(checkStub.storageUploads[1].upsert, true);
  assert.equal(checkStub.storageDownloads.length, 2);
  assert.equal(checkStub.storageRemoves.length, 1);
  assert.equal(check.items.some((item) => item.name === 'Attachment storage canary' && item.status === 'ok'), true);

  const failingStub = createClientStub({
    tableErrors: {
      notes: {
        code: 'PGRST205',
        message: "Could not find the table 'public.notes' in the schema cache",
      },
    },
  });
  failingStub.sessions.push({ access_token: 'access-fail', refresh_token: 'refresh-fail' });
  const failingAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', failingStub.client as never);
  const failingCheck = await failingAdapter.checkBackend();
  assert.equal(failingCheck.ok, false);
  const notesCheck = failingCheck.items.find((item) => item.name === 'Notes table');
  assert.equal(notesCheck?.code, 'PGRST205');
  assert.match(notesCheck?.message || '', /marknote_sync_schema/);
  assert.equal(failingStub.inserts.length, 0);
  assert.equal(failingStub.storageUploads.length, 0);
  assert.equal(failingCheck.items.some((item) => item.name === 'Sync table writes'), false);
  assert.equal(failingCheck.items.some((item) => item.name === 'Attachment storage canary'), false);

  globalThis.fetch = (async () => {
    const cause = new Error('Client network socket disconnected before secure TLS connection was established') as Error & {
      code?: string;
    };
    cause.code = 'ECONNRESET';
    const error = new Error('fetch failed') as Error & { cause?: unknown };
    error.cause = cause;
    throw error;
  }) as typeof fetch;
  const networkFailStub = createClientStub();
  networkFailStub.sessions.push({ access_token: 'access-network-fail', refresh_token: 'refresh-network-fail' });
  const networkFailAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', networkFailStub.client as never);
  const networkFailCheck = await networkFailAdapter.checkBackend();
  assert.equal(networkFailCheck.ok, false);
  const projectHealthCheck = networkFailCheck.items.find((item) => item.name === 'Supabase project');
  assert.match(projectHealthCheck?.message || '', /before Auth\/Data API checks could run/);
  assert.match(projectHealthCheck?.message || '', /TLS connection was reset/);
  assert.match(projectHealthCheck?.message || '', /caused by: ECONNRESET/);
  globalThis.fetch = (async () => undefined as never) as typeof fetch;

  const rejectedSessionStub = createClientStub({
    tableErrors: {
      devices: {
        code: 'PGRST301',
        message: 'JWT expired',
      },
    },
  });
  rejectedSessionStub.sessions.push({ access_token: 'access-expired', refresh_token: 'refresh-expired' });
  const rejectedSessionAdapter = new SupabaseSyncAdapter(
    'https://example.supabase.co',
    'sb_publishable_test',
    rejectedSessionStub.client as never,
  );
  const rejectedSessionCheck = await rejectedSessionAdapter.checkBackend();
  assert.equal(rejectedSessionCheck.ok, false);
  const rejectedSessionItem = rejectedSessionCheck.items.find((item) => item.name === 'Devices table');
  assert.equal(rejectedSessionItem?.code, 'PGRST301');
  assert.match(rejectedSessionItem?.message || '', /Sign out and sign in again/);
  assert.equal(rejectedSessionStub.inserts.length, 0);
  assert.equal(rejectedSessionStub.storageUploads.length, 0);

  const failingDeleteStub = createClientStub({
    deleteErrors: {
      folders: {
        code: '42501',
        message: 'permission denied for table folders',
      },
    },
  });
  failingDeleteStub.sessions.push({ access_token: 'access-delete-fail', refresh_token: 'refresh-delete-fail' });
  const failingDeleteAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', failingDeleteStub.client as never);
  const failingDeleteCheck = await failingDeleteAdapter.checkBackend();
  assert.equal(failingDeleteCheck.ok, false);
  const deleteCheck = failingDeleteCheck.items.find((item) => item.name === 'Sync table folder delete');
  assert.equal(deleteCheck?.code, '42501');
  assert.equal(failingDeleteStub.storageUploads.length, 0);

  const leftoverStub = createClientStub({
    leftoverRows: {
      notes: true,
    },
  });
  leftoverStub.sessions.push({ access_token: 'access-leftover', refresh_token: 'refresh-leftover' });
  const leftoverAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', leftoverStub.client as never);
  const leftoverCheck = await leftoverAdapter.checkBackend();
  assert.equal(leftoverCheck.ok, false);
  const leftoverItem = leftoverCheck.items.find((item) => item.name === 'Sync table note delete');
  assert.match(leftoverItem?.message || '', /still visible/);
  assert.equal(leftoverStub.storageUploads.length, 0);

  const storageLeftoverStub = createClientStub({
    storageDeleteLeavesObject: true,
  });
  storageLeftoverStub.sessions.push({ access_token: 'access-storage-leftover', refresh_token: 'refresh-storage-leftover' });
  const storageLeftoverAdapter = new SupabaseSyncAdapter(
    'https://example.supabase.co',
    'sb_publishable_test',
    storageLeftoverStub.client as never,
  );
  const storageLeftoverCheck = await storageLeftoverAdapter.checkBackend();
  assert.equal(storageLeftoverCheck.ok, false);
  const storageLeftoverItem = storageLeftoverCheck.items.find((item) => item.name === 'Attachment storage delete');
  assert.match(storageLeftoverItem?.message || '', /still downloadable/);
  assert.equal(storageLeftoverStub.storageDownloads.length, 2);
  assert.equal(storageLeftoverStub.storageLists.length, 2);
  assert.equal(storageLeftoverStub.storageRemoves.length, 2);

  const pullStub = createClientStub({
    remoteRows: {
      folders: [
        {
          id: 'folder-remote',
          name: 'Remote folder',
          sort_order: 7,
          created_at: '1970-01-01T00:00:01.000Z',
          updated_at: '1970-01-01T00:00:02.000Z',
          deleted_at: null,
          version: null,
        },
      ],
      notes: [
        {
          id: 'note-remote',
          folder_id: 'folder-remote',
          title: 'Remote note',
          content: '<p>Remote</p>',
          raw_content: null,
          tags: null,
          pinned: true,
          created_at: '1970-01-01T00:00:03.000Z',
          updated_at: '1970-01-01T00:00:04.000Z',
          deleted_at: '1970-01-01T00:00:05.000Z',
          version: 9,
        },
      ],
      attachments: [
        {
          id: 'attachment-remote',
          note_id: 'note-remote',
          storage_path: 'user-1/note-remote/attachment-remote',
          mime_type: 'application/pdf',
          size_bytes: null,
          created_at: '1970-01-01T00:00:06.000Z',
          updated_at: '1970-01-01T00:00:07.000Z',
          deleted_at: null,
        },
      ],
    },
  });
  const pullAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', pullStub.client as never);
  const pulled = await pullAdapter.pull(500);
  assert.deepEqual(pullStub.tableSelects.slice(-3).map((item) => [item.table, item.columns]), [
    ['folders', '*'],
    ['notes', '*'],
    ['attachments', '*'],
  ]);
  assert.equal(pulled.folders[0].createdAt, 1000);
  assert.equal(pulled.folders[0].updatedAt, 2000);
  assert.equal(pulled.folders[0].version, 1);
  assert.equal(pulled.notes[0].rawContent, undefined);
  assert.deepEqual(pulled.notes[0].tags, []);
  assert.equal(pulled.notes[0].deletedAt, 5000);
  assert.equal(pulled.notes[0].version, 9);
  assert.equal(pulled.attachments[0].data, '');
  assert.equal(pulled.attachments[0].mimeType, 'application/pdf');
  assert.equal(pulled.attachments[0].sizeBytes, undefined);
  assert.equal(pulled.attachments[0].createdAt, 6000);
  assert.equal(pulled.attachments[0].updatedAt, 7000);

  const missingPathStub = createClientStub();
  missingPathStub.sessions.push({ access_token: 'access-missing-path', refresh_token: 'refresh-missing-path' });
  const missingPathAdapter = new SupabaseSyncAdapter(
    'https://example.supabase.co',
    'sb_publishable_test',
    missingPathStub.client as never,
  );
  await assert.rejects(
    () =>
      missingPathAdapter.push({
        folders: [],
        notes: [],
        attachments: [
          {
            id: 'image-missing-path',
            noteId: 'note-1',
            data: '',
            mimeType: 'image/png',
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        deleted: {
          folders: [],
          notes: [],
          attachments: [],
        },
      }),
    /Attachment storage path is missing for image-missing-path/,
  );
  assert.equal(missingPathStub.upserts.length, 0);

  const pushStub = createClientStub();
  pushStub.sessions.push({ access_token: 'access-push', refresh_token: 'refresh-push' });
  const pushAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', pushStub.client as never);
  await pushAdapter.registerDevice({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test device',
    provider: 'supabase',
    createdAt: 1,
    lastSeenAt: 2,
  });
  await pushAdapter.push({
    folders: [
      {
        id: 'folder-1',
        name: 'Folder',
        createdAt: 1,
        updatedAt: 2,
        sortOrder: 1,
      },
    ],
    notes: [
      {
        id: 'note-1',
        folderId: 'folder-1',
        title: 'Note',
        content: '<p>Note</p>',
        rawContent: 'Note',
        createdAt: 1,
        updatedAt: 2,
        tags: [],
        pinned: false,
      },
    ],
    attachments: [
      {
        id: 'image-1',
        noteId: 'note-1',
        data: '',
        mimeType: 'image/png',
        storagePath: 'user-1/note-1/image-1',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    deleted: {
      folders: [],
      notes: [],
      attachments: [
        {
          id: 'image-deleted',
          noteId: 'note-1',
          data: '',
          mimeType: 'image/png',
          storagePath: 'user-1/note-1/image-deleted',
          createdAt: 1,
          updatedAt: 2,
          deletedAt: 3,
        },
      ],
    },
  });
  assert.deepEqual(pushStub.storageRemoves, [
    { bucket: 'attachments', paths: ['user-1/note-1/image-deleted'] },
  ]);
  assert.deepEqual(pushStub.upserts.map((item) => [item.table, item.options?.onConflict]), [
    ['devices', 'user_id,id'],
    ['folders', 'user_id,id'],
    ['notes', 'user_id,id'],
    ['attachments', 'user_id,id'],
  ]);

  const missingStorageDeleteStub = createClientStub({
    storageRemoveError: {
      code: '404',
      message: 'Object not found',
    },
  });
  missingStorageDeleteStub.sessions.push({ access_token: 'access-delete-missing-storage', refresh_token: 'refresh-delete-missing-storage' });
  const missingStorageDeleteAdapter = new SupabaseSyncAdapter(
    'https://example.supabase.co',
    'sb_publishable_test',
    missingStorageDeleteStub.client as never,
  );
  await missingStorageDeleteAdapter.push({
    folders: [],
    notes: [],
    attachments: [],
    deleted: {
      folders: [],
      notes: [],
      attachments: [
        {
          id: 'image-already-removed',
          noteId: 'note-1',
          data: '',
          mimeType: 'image/png',
          storagePath: 'user-1/note-1/image-already-removed',
          createdAt: 1,
          updatedAt: 2,
          deletedAt: 3,
        },
      ],
    },
  });
  assert.deepEqual(missingStorageDeleteStub.storageRemoves, [
    { bucket: 'attachments', paths: ['user-1/note-1/image-already-removed'] },
  ]);
  assert.deepEqual(missingStorageDeleteStub.updates.map((item) => item.table), ['attachments']);

  const deniedStorageDeleteStub = createClientStub({
    storageRemoveError: {
      code: '42501',
      message: 'permission denied for storage object',
    },
  });
  deniedStorageDeleteStub.sessions.push({ access_token: 'access-delete-denied-storage', refresh_token: 'refresh-delete-denied-storage' });
  const deniedStorageDeleteAdapter = new SupabaseSyncAdapter(
    'https://example.supabase.co',
    'sb_publishable_test',
    deniedStorageDeleteStub.client as never,
  );
  await assert.rejects(
    () =>
      deniedStorageDeleteAdapter.push({
        folders: [],
        notes: [],
        attachments: [],
        deleted: {
          folders: [],
          notes: [],
          attachments: [
            {
              id: 'image-denied',
              noteId: 'note-1',
              data: '',
              mimeType: 'image/png',
              storagePath: 'user-1/note-1/image-denied',
              createdAt: 1,
              updatedAt: 2,
              deletedAt: 3,
            },
          ],
        },
      }),
    /Could not push deletes/,
  );
  assert.equal(deniedStorageDeleteStub.updates.some((item) => item.table === 'attachments'), false);

  const downloaded = await pushAdapter.downloadAttachment({
    id: 'image-1',
    noteId: 'note-1',
    data: '',
    mimeType: 'image/png',
    storagePath: 'user-1/note-1/image-1',
  });
  assert.deepEqual(pushStub.storageDownloads, [
    { bucket: 'attachments', path: 'user-1/note-1/image-1' },
  ]);
  assert.equal(downloaded.data, 'data:image/png;base64,aGVsbG8=');

  console.log('supabase adapter tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
});
