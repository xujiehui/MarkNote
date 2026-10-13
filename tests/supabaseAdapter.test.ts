import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SupabaseSyncAdapter } from '../src/sync/supabaseAdapter';
import type { SyncMutation } from '../src/sync/protocol';

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
  storageDownloadBlob?: Blob;
  storageRejectDuplicate?: boolean;
  rpcHandler?: (name: string, args?: Record<string, unknown>, headers?: Record<string,string>) => { data: unknown; error: StubError };
  deleteErrors?: Record<string, { code?: string; message: string }>;
  leftoverRows?: Record<string, boolean>;
  remoteRows?: Record<string, unknown[]>;
  storageDeleteLeavesObject?: boolean;
  storageRemoveError?: { code?: string; message: string };
  tableErrors?: Record<string, { code?: string; message: string }>;
  storageError?: { code?: string; message: string };
}

type StubError = { code?: string; message: string } | null;

function deferredRequest<T>(producer: () => T, headers: Record<string,string> = {}) {
  return {
    setHeader(name: string,value: string) { headers[name] = value; return this; },
    abortSignal(signal: AbortSignal) { assert.ok(signal instanceof AbortSignal); return this; },
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value:T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason:unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> { return Promise.resolve().then(producer).then(onfulfilled,onrejected); },
  };
}

function createClientStub(options: ClientStubOptions = {}) {
  const calls: OAuthCall[] = [];
  const rpcCalls: Array<{ name: string; args?: Record<string, unknown>; headers:Record<string,string> }> = [];
  let rpcSequence = 0;
  const codes: string[] = [];
  const sessions: Array<{ access_token: string; refresh_token: string; userId?: string }> = [];
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
    rpc(name: string, args?: Record<string, unknown>) {
      const headers: Record<string,string> = {};
      rpcCalls.push({ name, args,headers });
      return deferredRequest(() => {
        assert.ok(headers.Authorization,'RPC requests must bind a captured access token');
        if (options.rpcHandler) return options.rpcHandler(name,args,headers);
        if (name === 'marknote_sync_check_v2') return { data: { protocolVersion: 2, capabilities: ['cas','idempotency','sequence','tombstones','snapshot-paging'] }, error: null };
        if (name === 'marknote_sync_collect_storage_v2') return { data: [], error: null };
        if (name === 'marknote_sync_ack_storage_v2') return { data: null, error: null };
        if (name === 'marknote_sync_pull_v2') return { data: { changes: [], nextSequence: args?.p_after_seq ?? 0, upperBound: args?.p_after_seq ?? 0, hasMore: false, serverTime: 10 }, error: null };
        const mutations = args?.p_mutations as SyncMutation[];
        return { data: mutations.map((mutation) => ({ ...mutation, status: 'applied', revision: mutation.expectedRevision + 1, sequence: ++rpcSequence, replayed: false, value: mutation.operation === 'delete' ? null : { ...mutation.value, createdAt: 10, updatedAt: 20 } })), error: null };
      },headers);
    },
    auth: {
      async getSession() {
        return {
          data: {
            session: sessions.length
              ? {
                  access_token: sessions.at(-1)?.access_token,
                  user: {
                    id: sessions.at(-1)?.userId ?? 'user-1',
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
        upsert(_rows: unknown, upsertOptions?: { onConflict?: string }) {
          void _rows;
          return deferredRequest(() => { upserts.push({ table, options: upsertOptions }); return { data: null, error: options.tableErrors?.[table] || null }; });
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
            if (options.storageRejectDuplicate && storagePaths.has(path)) return { data: null,error:{code:'409',message:'already exists'} };
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
            return { data: options.storageDownloadBlob ?? new Blob(['hello'], { type: 'image/png' }), error: options.storageError || null };
          },
        };
      },
    },
  };
  return {
    calls,
    rpcCalls,
    authHandlers,
    get authUnsubscribeCount() {
      return authUnsubscribeCount;
    },
    client,
    storageFactory: () => client.storage as never,
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
  const webAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', webStub.client as never, { storageFactory: webStub.storageFactory });
  await webAdapter.signInWithOAuth('google');
  assert.equal(webStub.calls.length, 1);
  assert.equal(webStub.calls[0].provider, 'google');
  assert.equal(webStub.calls[0].options?.redirectTo, 'http://127.0.0.1:5173/?app=1');
  assert.equal(webStub.calls[0].options?.skipBrowserRedirect, false);

  dom.reconfigure({
    url: 'https://xujiehui.github.io/MarkNote/?app=1&v=deployment-cache-bust#app',
  });
  const pagesStub = createClientStub();
  const pagesAdapter = new SupabaseSyncAdapter(
    'https://example.supabase.co',
    'sb_publishable_test',
    pagesStub.client as never, { storageFactory: pagesStub.storageFactory });
  await pagesAdapter.signInWithOAuth('google');
  assert.equal(pagesStub.calls[0].options?.redirectTo, 'https://xujiehui.github.io/MarkNote/?app=1');
  dom.reconfigure({ url: 'http://127.0.0.1:5173/?app=1' });

  const configuredRedirectStub = createClientStub();
  const configuredRedirectAdapter = new SupabaseSyncAdapter(
    'https://example.supabase.co',
    'sb_publishable_test',
    configuredRedirectStub.client as never,
    { authRedirectUrl: 'https://app.example.test/?app=1', storageFactory:configuredRedirectStub.storageFactory },
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
  const desktopAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', desktopStub.client as never, { storageFactory: desktopStub.storageFactory });
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
  const noSessionAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', noSessionStub.client as never, { storageFactory: noSessionStub.storageFactory });
  const noSessionCheck = await noSessionAdapter.checkBackend();
  assert.equal(noSessionCheck.ok, false);
  assert.equal(noSessionCheck.items.some((item) => item.status === 'warning' && item.name === 'Auth session'), true);
  assert.equal(noSessionStub.tableSelects.length, 0);

  const checkStub = createClientStub();
  checkStub.sessions.push({ access_token: 'access-ok', refresh_token: 'refresh-ok' });
  const checkAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', checkStub.client as never, { storageFactory: checkStub.storageFactory });
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
  assert.equal(checkStub.inserts.length, 0);
  assert.equal(checkStub.updates.length, 0);
  assert.equal(checkStub.deletes.length, 0);
  assert.deepEqual(checkStub.rpcCalls, [{ name: 'marknote_sync_check_v2', args: {},headers:{Authorization:'Bearer access-ok'} }]);
  assert.equal(check.items.some((item) => item.name === 'Sync table writes' && item.status === 'ok'), true);
  assert.equal(check.items.some((item) => item.name === 'Versioned sync protocol' && item.status === 'ok'), true);
  assert.equal(checkStub.storageUploads.length, 2);
  assert.equal(checkStub.storageUploads[0].upsert, false);
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
  const failingAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', failingStub.client as never, { storageFactory: failingStub.storageFactory });
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
  const networkFailAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'sb_publishable_test', networkFailStub.client as never, { storageFactory: networkFailStub.storageFactory });
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
    rejectedSessionStub.client as never, { storageFactory: rejectedSessionStub.storageFactory });
  const rejectedSessionCheck = await rejectedSessionAdapter.checkBackend();
  assert.equal(rejectedSessionCheck.ok, false);
  const rejectedSessionItem = rejectedSessionCheck.items.find((item) => item.name === 'Devices table');
  assert.equal(rejectedSessionItem?.code, 'PGRST301');
  assert.match(rejectedSessionItem?.message || '', /Sign out and sign in again/);
  assert.equal(rejectedSessionStub.inserts.length, 0);
  assert.equal(rejectedSessionStub.storageUploads.length, 0);

  const unsupportedStub = createClientStub({ rpcHandler: () => ({ data: null, error: { code: 'PGRST202', message: 'Function missing' } }) });
  unsupportedStub.sessions.push({ access_token: 'ok', refresh_token: 'ok' });
  const unsupportedAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'key', unsupportedStub.client as never, { storageFactory: unsupportedStub.storageFactory });
  const unsupportedCheck = await unsupportedAdapter.checkBackend();
  assert.equal(unsupportedCheck.ok, false);
  assert.match(unsupportedCheck.items.find((item) => item.name === 'Sync table writes')?.message ?? '', /202610130001_marknote_sync_v2/);
  assert.equal(unsupportedStub.storageUploads.length, 0);
  await assert.rejects(() => unsupportedAdapter.pushMutations([folderMutation('f-1')]), /202610130001_marknote_sync_v2/);
  assert.equal(unsupportedStub.upserts.length, 0);

  const storageLeftoverStub = createClientStub({ storageDeleteLeavesObject: true });
  storageLeftoverStub.sessions.push({ access_token: 'ok', refresh_token: 'ok' });
  const storageLeftoverAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'key', storageLeftoverStub.client as never, { storageFactory: storageLeftoverStub.storageFactory });
  const storageLeftoverCheck = await storageLeftoverAdapter.checkBackend();
  assert.equal(storageLeftoverCheck.ok, false);
  assert.match(storageLeftoverCheck.items.find((item) => item.name === 'Attachment storage delete')?.message ?? '', /still downloadable/);

  const pushStub = createClientStub();
  pushStub.sessions.push({ access_token: 'ok', refresh_token: 'ok' });
  const adapter = new SupabaseSyncAdapter('https://example.supabase.co', 'key', pushStub.client as never, { storageFactory: pushStub.storageFactory });
  const mutation = folderMutation('folder-1');
  const receipts = await adapter.pushMutations([mutation]);
  assert.equal(receipts[0].mutationId, mutation.mutationId);
  assert.equal(receipts[0].localRevision, 2);
  assert.equal(receipts[0].value?.remoteRevision, 1);
  assert.equal(pushStub.upserts.length, 0);
  assert.equal(pushStub.rpcCalls[0].name, 'marknote_sync_push_v2');
  const wireDocument = (pushStub.rpcCalls[0].args?.p_mutations as SyncMutation[])[0].value;
  assert.equal(wireDocument?.syncStatus, undefined);
  await assert.rejects(() => adapter.pushMutations([mutation,mutation]), /unique/);
  await assert.rejects(() => adapter.pushMutations([{ ...mutation, expectedRevision: -1 }]), /safe integer/);
  await assert.rejects(() => adapter.pull(0), /Versioned sync protocol is required/);
  await assert.rejects(() => adapter.push({ folders: [], notes: [], attachments: [], deleted: { folders: [], notes: [], attachments: [] } }), /Versioned sync protocol is required/);
  await assert.rejects(() => adapter.pushMutations([{ ...mutation, entity: 'attachment', value: { id: mutation.entityId, noteId: 'n', data: '', mimeType: 'image/png' } }]), /storage path is missing/);
  await assert.rejects(() => adapter.pushMutations([{ ...mutation, entity: 'attachment', value: { id: mutation.entityId, noteId: 'n', data: '', mimeType: 'image/png', storagePath: 'another-user/n/a' } }]), /another account/);

  const deleted = { ...mutation, operation: 'delete' as const };
  await adapter.pushMutations([deleted]);
  assert.equal((pushStub.rpcCalls.filter((call)=>call.name==='marknote_sync_push_v2').at(-1)?.args?.p_mutations as SyncMutation[])[0].value, null);
  await adapter.pushMutations(Array.from({ length: 205 }, (_, index) => folderMutation(`many-${index}`)));
  const batches = pushStub.rpcCalls.slice(-3).map((call) => (call.args?.p_mutations as unknown[]).length);
  assert.deepEqual(batches,[100,100,5]);

  const corruptStub = createClientStub({ rpcHandler: (_name,args) => ({ data: [{ ...(args?.p_mutations as SyncMutation[])[0], mutationId: 'wrong-generation', status: 'applied', revision: 1, sequence: 1, value: null, replayed: false }], error: null }) });
  corruptStub.sessions.push({ access_token: 'ok', refresh_token: 'ok' });
  await assert.rejects(() => new SupabaseSyncAdapter('https://example.supabase.co', 'key', corruptStub.client as never, { storageFactory: corruptStub.storageFactory }).pushMutations([mutation]), /frozen generation/);

  const pullPagesStub = createClientStub({ rpcHandler: (_name,args) => ({ data: { changes: [{ entity: 'folder', entityId: 'folder-1', revision: 3, sequence: Number(args?.p_after_seq) + 1, operation: 'upsert', value: { id: 'folder-1', name: 'remote', sortOrder: 0, createdAt: 1, updatedAt: 2 } }], nextSequence: Number(args?.p_after_seq) + 1, upperBound: args?.p_upper_bound ?? 5, hasMore: true, serverTime: 123 }, error: null }) });
  pullPagesStub.sessions.push({ access_token:'ok',refresh_token:'ok' });
  const pullPagesAdapter = new SupabaseSyncAdapter('https://example.supabase.co', 'key', pullPagesStub.client as never, { storageFactory: pullPagesStub.storageFactory });
  const firstPage = await pullPagesAdapter.pullChanges(0);
  const nextPage = await pullPagesAdapter.pullChanges(firstPage.nextSequence,firstPage.upperBound);
  assert.equal(firstPage.changes[0].value?.remoteRevision,3);
  assert.equal(nextPage.upperBound,5);
  assert.equal(pullPagesStub.rpcCalls[1].args?.p_upper_bound,5);
  await assert.rejects(() => pullPagesAdapter.pullChanges(Number.MAX_SAFE_INTEGER + 1), /safe integer/);

  const corruptPageStub = createClientStub({ rpcHandler: () => ({ data: { changes: [], nextSequence: 0, upperBound: 1, hasMore: true, serverTime: 1 }, error: null }) });
  corruptPageStub.sessions.push({ access_token:'ok',refresh_token:'ok' });
  await assert.rejects(() => new SupabaseSyncAdapter('https://example.supabase.co', 'key', corruptPageStub.client as never, { storageFactory: corruptPageStub.storageFactory }).pullChanges(0), /paging progress/);

  const uploaded = await adapter.uploadAttachment({ id: 'a', noteId: 'n', data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' });
  assert.match(uploaded.storagePath,/^user-1\/n\/a\/[a-f0-9]{64}$/);
  assert.equal(pushStub.storageUploads.at(-1)?.upsert,false);
  const sameUpload = await adapter.uploadAttachment({ id: 'a', noteId: 'n', data: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' });
  assert.equal(uploaded.storagePath,sameUpload.storagePath);
  const changedUpload = await adapter.uploadAttachment({ id: 'a', noteId: 'n', data: 'data:image/png;base64,aGVsbG8h', mimeType: 'image/png' });
  assert.notEqual(uploaded.storagePath,changedUpload.storagePath);
  const downloaded = await adapter.downloadAttachment({ id: 'a', noteId: 'n', data: '', mimeType: 'image/png', storagePath: uploaded.storagePath });
  assert.equal(downloaded.data,'data:image/png;base64,aGVsbG8=');
  await assert.rejects(() => adapter.downloadAttachment({ id: 'a', noteId: 'n', data: '', mimeType: 'image/png', storagePath: 'other/n/a' }), /another account/);
  await assert.rejects(() => noSessionAdapter.pushMutations([mutation]), /sign in/);
  await assert.rejects(() => noSessionAdapter.downloadAttachment({ id: 'a', noteId: 'n', data: '', mimeType: 'image/png', storagePath: 'user-1/n/a' }), /sign in/);
  await assert.rejects(() => adapter.uploadAttachment({ id: 'a', noteId: 'n', data: 'data:text/html;base64,aGVsbG8=', mimeType: 'text/html' }), /Unsafe attachment/);
  await assert.rejects(() => adapter.uploadAttachment({ id: 'a', noteId: 'n', data: 'data:text/html;base64,aGVsbG8=', mimeType: 'image/png' }), /Unsafe attachment/);
  await assert.rejects(() => adapter.downloadAttachment({ id: 'a', noteId: 'n', data: '', mimeType: 'image/svg+xml', storagePath: 'user-1/n/a' }), /Unsafe attachment/);
  await assert.rejects(() => adapter.downloadAttachment({ id: 'a', noteId: 'n', data: '', mimeType: 'image/png', storagePath: `user-1/n/a/${'0'.repeat(64)}` }), /integrity verification/);
  const maliciousBlobStub = createClientStub({ storageDownloadBlob: new Blob(['<script>bad</script>'], { type: 'text/html' }) });
  maliciousBlobStub.sessions.push({ access_token: 'ok', refresh_token: 'ok' });
  await assert.rejects(() => new SupabaseSyncAdapter('https://example.supabase.co','key',maliciousBlobStub.client as never, { storageFactory: maliciousBlobStub.storageFactory }).downloadAttachment({ id: 'a', noteId: 'n', data: '', mimeType: 'image/png', storagePath: 'user-1/n/a' }), /MIME type does not match/);
  const oversizedBlobStub = createClientStub({ storageDownloadBlob: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/png' }) });
  oversizedBlobStub.sessions.push({ access_token: 'ok', refresh_token: 'ok' });
  await assert.rejects(() => new SupabaseSyncAdapter('https://example.supabase.co','key',oversizedBlobStub.client as never, { storageFactory: oversizedBlobStub.storageFactory }).downloadAttachment({ id: 'a', noteId: 'n', data: '', mimeType: 'image/png', storagePath: 'user-1/n/a' }), /size limit/);

  let gcPath = '';
  let gcAcknowledged = false;
  const gcStub = createClientStub({ storageRejectDuplicate: true, rpcHandler: (name) => {
    if (name === 'marknote_sync_collect_storage_v2') return { data:gcAcknowledged ? [] : [gcPath],error:null };
    if (name === 'marknote_sync_ack_storage_v2') { gcAcknowledged = true; return { data:null,error:null }; }
    throw new Error('Unexpected garbage collection RPC');
  } });
  gcStub.sessions.push({ access_token:'gc-a',refresh_token:'a' });
  const gcAdapter = new SupabaseSyncAdapter('https://example.supabase.co','key',gcStub.client as never,{storageFactory:gcStub.storageFactory});
  const image = {id:'a',noteId:'n',data:'data:image/png;base64,aGVsbG8=',mimeType:'image/png'};
  await assert.rejects(() => gcAdapter.uploadAttachment({ ...image, historyOnly:true }, 'user-1'), /History-only/);
  await assert.rejects(() => gcAdapter.pushMutations([{ mutationId:'history-rejected',entity:'attachment',entityId:image.id,
    operation:'upsert',expectedRevision:0,localRevision:1,value:{ ...image,historyOnly:true,storagePath:'user-1/n/a' } }], 'user-1'), /History-only/);
  assert.equal(gcStub.storageUploads.length,0);
  assert.equal(gcStub.rpcCalls.length,0);
  gcPath = (await gcAdapter.uploadAttachment(image,'user-1')).storagePath;
  assert.equal((await gcAdapter.uploadAttachment(image,'user-1')).storagePath,gcPath,'immutable blob retries verify rather than overwrite the existing file');
  assert.equal(gcStub.storageDownloads.length,1);
  await gcAdapter.flushAttachmentGarbage('user-1');
  assert.equal(gcAcknowledged,true);
  assert.equal(gcStub.storageRemoves.length,1);
  assert.deepEqual(gcStub.rpcCalls.map(call=>call.name),['marknote_sync_collect_storage_v2','marknote_sync_ack_storage_v2','marknote_sync_collect_storage_v2']);

  const leftoverGcStub = createClientStub({ storageDeleteLeavesObject:true, rpcHandler: (name) => {
    assert.equal(name,'marknote_sync_collect_storage_v2','visible blobs must never be acknowledged as removed');
    return {data:[gcPath],error:null};
  } });
  leftoverGcStub.sessions.push({ access_token:'gc-a',refresh_token:'a' });
  const leftoverGcAdapter = new SupabaseSyncAdapter('https://example.supabase.co','key',leftoverGcStub.client as never,{storageFactory:leftoverGcStub.storageFactory});
  await leftoverGcAdapter.uploadAttachment(image,'user-1');
  await assert.rejects(()=>leftoverGcAdapter.flushAttachmentGarbage('user-1'),/remains visible/);
  assert.equal(leftoverGcStub.rpcCalls.length,1);

  const switchingStub = createClientStub({ rpcHandler: (_name,args,headers) => {
    assert.equal(headers?.Authorization,'Bearer captured-a');
    switchingStub.sessions.push({ access_token:'captured-b',refresh_token:'b',userId:'user-b' });
    return { data:(args?.p_mutations as SyncMutation[]).map((item,index)=>({ ...item,status:'applied',revision:1,sequence:index+1,value:{...item.value,createdAt:1,updatedAt:2},replayed:false })),error:null };
  } });
  switchingStub.sessions.push({ access_token:'captured-a',refresh_token:'a' });
  const switchingAdapter = new SupabaseSyncAdapter('https://example.supabase.co','key',switchingStub.client as never,{storageFactory:switchingStub.storageFactory});
  await assert.rejects(() => switchingAdapter.pushMutations(Array.from({length:150},(_,index)=>folderMutation(`switch-${index}`)),'user-1'),/Account changed/);
  assert.equal(switchingStub.rpcCalls.length,1,'account switch stops later batches before they can use a new identity');
  await assert.rejects(() => switchingAdapter.pushMutations([mutation],'user-1'),/Account changed/);
  await assert.rejects(() => switchingAdapter.uploadAttachment({id:'a',noteId:'n',data:'data:image/png;base64,aGVsbG8=',mimeType:'image/png'},'user-1'),/Account changed/);
  assert.equal(switchingStub.storageUploads.length,0,'a changed account never receives old workspace bytes');

  console.log('Supabase adapter tests passed');
}

function folderMutation(id: string): SyncMutation {
  return { mutationId: `mutation-${id}`, entity: 'folder', entityId: id, operation: 'upsert', expectedRevision: 0,
    localRevision: 2, value: { id, name: 'Folder', sortOrder: 1, createdAt: 1, updatedAt: 2, syncStatus: 'pending' } };
}

main().finally(() => { globalThis.fetch = originalFetch; dom.window.close(); });
