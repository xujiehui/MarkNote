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

function createClientStub() {
  const calls: OAuthCall[] = [];
  const codes: string[] = [];
  const sessions: Array<{ access_token: string; refresh_token: string }> = [];
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
    },
  };
  return { calls, client, codes, sessions };
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

  console.log('supabase adapter tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
});
