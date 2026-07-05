import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nContext } from '../src/i18n-context';
import { SyncPanel } from '../src/components/SyncPanel';
import type { SyncSessionState } from '../src/sync/useSyncSession';
import { installDomGlobals } from './domGlobals';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:5173/?app=1',
});

installDomGlobals({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const translations: Record<string, string> = {
  'sync.account': 'Account',
  'sync.backendCheck': 'Backend check',
  'sync.backendCheckedAt': 'Last {time}',
  'sync.copyBackendReport': 'Copy diagnosis report',
  'sync.backendReportCopied': 'Copied',
  'sync.backendReportCopyFailed': 'Copy failed',
  'sync.backendVerified': 'Backend verified',
  'sync.backendVerifiedDetail': 'Signed-in table writes and the attachment Storage canary both passed.',
  'sync.backendVerificationFailed': 'Backend verification failed',
  'sync.backendVerificationFailedDetail': 'Run Diagnose sync to see the specific backend failure.',
  'sync.backendVerificationPending': 'Backend verification pending',
  'sync.backendVerificationPendingDetail': 'Run Diagnose sync to verify signed-in table writes and the attachment Storage canary.',
  'sync.backendVerificationCheckingDetail': 'Verifying signed-in table writes and the attachment Storage canary.',
  'sync.diagnose': 'Diagnose sync',
  'sync.failed': 'Sync failed',
  'sync.lastResult': 'Pushed {pushed}, pulled {pulled}',
  'sync.loading': 'Working',
  'sync.oauthHint': 'Sign in with Google to sync notes across devices through Supabase.',
  'sync.oauthPending': 'Browser authorization is open. MarkNote will continue syncing after Google sign-in finishes.',
  'sync.oauthWaiting': 'Waiting for authorization',
  'sync.queueFailed': '{count} failed change(s), waiting to retry',
  'sync.queuePending': '{count} pending change(s)',
  'sync.ready': 'Signed in, ready to sync',
  'sync.signInTitle': 'Account sync',
  'sync.signInWithGoogle': 'Sign in with Google',
  'sync.signOut': 'Sign out',
  'sync.syncNow': 'Sync',
  'sync.syncing': 'Syncing',
};

function createSyncState(overrides: Partial<SyncSessionState> = {}): SyncSessionState {
  return {
    configured: true,
    providerName: 'Supabase',
    session: null,
    loading: false,
    authPending: false,
    syncing: false,
    checkingBackend: false,
    lastResult: null,
    backendCheck: null,
    queue: { pending: 0, failed: 0, firstError: '' },
    error: '',
    signInWithOAuth: async () => undefined,
    signOut: async () => undefined,
    syncNow: async () => ({ ok: true, pushed: 0, pulled: 0 }),
    checkBackend: async () => ({ ok: true, checkedAt: Date.now(), items: [] }),
    ...overrides,
  };
}

async function renderSyncPanel(sync: SyncSessionState): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nContext.Provider
        value={{
          language: 'en',
          locale: 'en-US',
          setLanguage: () => undefined,
          t: (key, values) => {
            let message = translations[key] || key;
            for (const [name, value] of Object.entries(values || {})) {
              message = message.replace(`{${name}}`, String(value));
            }
            return message;
          },
        }}
      >
        <SyncPanel sync={sync} />
      </I18nContext.Provider>,
    );
  });
  return { container, root };
}

async function main() {
  const clicked: string[] = [];
  const clipboardWrites: string[] = [];
  Object.assign(navigator, {
    clipboard: {
      writeText: async (value: string) => {
        clipboardWrites.push(value);
      },
    },
  });
  const signedIn = createSyncState({
    session: { user: { id: 'user-1', email: 'google@example.com' } },
    queue: { pending: 2, failed: 1, firstError: 'storage offline' },
    error: 'storage offline',
    lastResult: { ok: true, pushed: 2, pulled: 1, syncedAt: 1_725_000_000_000 },
    backendCheck: {
      ok: false,
      checkedAt: 1_725_000_000_000,
      items: [
        {
          name: 'Notes table',
          status: 'error',
          code: 'PGRST205',
          message: 'Apply the marknote sync schema migration.',
        },
      ],
    },
    syncNow: async () => {
      clicked.push('sync');
      return { ok: true, pushed: 1, pulled: 0 };
    },
    checkBackend: async () => {
      clicked.push('diagnose');
      return { ok: true, checkedAt: Date.now(), items: [] };
    },
    signOut: async () => {
      clicked.push('sign-out');
    },
  });
  let mounted = await renderSyncPanel(signedIn);
  assert.match(mounted.container.textContent || '', /google@example\.com/);
  assert.match(mounted.container.textContent || '', /Sync failed/);
  assert.match(mounted.container.textContent || '', /storage offline/);
  assert.doesNotMatch(mounted.container.textContent || '', /Pushed 2, pulled 1/);
  assert.match(mounted.container.textContent || '', /2 pending change/);
  assert.match(mounted.container.textContent || '', /1 failed change/);
  assert.match(mounted.container.textContent || '', /Backend verification failed/);
  assert.match(mounted.container.textContent || '', /Backend check/);
  assert.match(mounted.container.textContent || '', /PGRST205/);
  assert.match(mounted.container.textContent || '', /Apply the marknote sync schema migration/);
  const copyReportButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Copy diagnosis report"]');
  assert.ok(copyReportButton);
  await act(async () => {
    copyReportButton.click();
  });
  assert.equal(clipboardWrites.length, 1);
  assert.match(clipboardWrites[0], /MarkNote sync diagnosis/);
  assert.match(clipboardWrites[0], /Provider: Supabase/);
  assert.match(clipboardWrites[0], /Configured: yes/);
  assert.match(clipboardWrites[0], /Signed in: yes/);
  assert.match(clipboardWrites[0], /- Pending: 2/);
  assert.match(clipboardWrites[0], /- Failed: 1/);
  assert.match(clipboardWrites[0], /- First error: storage offline/);
  assert.match(clipboardWrites[0], /Last sync:/);
  assert.match(clipboardWrites[0], /- Overall: ok/);
  assert.match(clipboardWrites[0], /- Pushed: 2/);
  assert.match(clipboardWrites[0], /- Pulled: 1/);
  assert.match(clipboardWrites[0], /Current error: storage offline/);
  assert.match(clipboardWrites[0], /Backend check:/);
  assert.match(clipboardWrites[0], /Notes table \(PGRST205\): Apply the marknote sync schema migration/);
  assert.match(clipboardWrites[0], /Next steps:/);
  assert.match(clipboardWrites[0], /SUPABASE_MANAGEMENT_TOKEN=sbp_\.\.\. npm run verify:release:online:apply/);
  assert.match(clipboardWrites[0], /npm run print:supabase-migration/);
  assert.match(clipboardWrites[0], /npm run verify:release:online:manual/);
  assert.match(mounted.container.textContent || '', /Copied/);

  const syncButton = mounted.container.querySelector<HTMLButtonElement>('button:not([aria-label])');
  assert.ok(syncButton);
  await act(async () => {
    syncButton.click();
  });
  const diagnoseButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Diagnose sync"]');
  assert.ok(diagnoseButton);
  await act(async () => {
    diagnoseButton.click();
  });
  const signOutButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Sign out"]');
  assert.ok(signOutButton);
  await act(async () => {
    signOutButton.click();
  });
  assert.deepEqual(clicked, ['sync', 'diagnose', 'sign-out']);
  await act(async () => {
    mounted.root.unmount();
  });

  const originalSetTimeout = window.setTimeout;
  const originalClearTimeout = window.clearTimeout;
  try {
    const clearedTimers: number[] = [];
    let nextTimer = 5000;
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      assert.equal(typeof handler, 'function');
      assert.equal(timeout, 1600);
      assert.deepEqual(args, []);
      return nextTimer++;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((timerId?: number) => {
      if (typeof timerId === 'number') {
        clearedTimers.push(timerId);
      }
    }) as typeof window.clearTimeout;
    mounted = await renderSyncPanel(signedIn);
    const timedCopyReportButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Copy diagnosis report"]');
    assert.ok(timedCopyReportButton);
    await act(async () => {
      timedCopyReportButton.click();
    });
    await act(async () => {
      timedCopyReportButton.click();
    });
    await act(async () => {
      mounted.root.unmount();
    });
    assert.deepEqual(clearedTimers, [5000, 5001]);
  } finally {
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
  }

  Object.assign(navigator, {
    clipboard: {
      writeText: async () => {
        throw new Error('clipboard denied');
      },
    },
  });
  mounted = await renderSyncPanel(signedIn);
  const failedCopyReportButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Copy diagnosis report"]');
  assert.ok(failedCopyReportButton);
  await act(async () => {
    failedCopyReportButton.click();
  });
  assert.match(mounted.container.textContent || '', /Copy failed/);
  await act(async () => {
    mounted.root.unmount();
  });

  Object.assign(navigator, {
    clipboard: {
      writeText: async (value: string) => {
        clipboardWrites.push(value);
      },
    },
  });

  mounted = await renderSyncPanel(
    createSyncState({
      session: { user: { id: 'user-1', email: 'google@example.com' } },
      queue: { pending: 1, failed: 1, firstError: 'network down' },
      error: 'network down',
      lastResult: { ok: false, pushed: 0, pulled: 0, error: 'network down' },
      backendCheck: null,
    }),
  );
  const noBackendCheckCopyButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Copy diagnosis report"]');
  assert.ok(noBackendCheckCopyButton);
  await act(async () => {
    noBackendCheckCopyButton.click();
  });
  const noBackendCheckReport = clipboardWrites.at(-1) || '';
  assert.match(noBackendCheckReport, /MarkNote sync diagnosis/);
  assert.match(noBackendCheckReport, /Signed in: yes/);
  assert.match(noBackendCheckReport, /- First error: network down/);
  assert.match(noBackendCheckReport, /Backend check:\n- Overall: not run/);
  await act(async () => {
    mounted.root.unmount();
  });

  mounted = await renderSyncPanel(
    createSyncState({
      session: { user: { id: 'user-1', email: 'google@example.com' } },
      backendCheck: {
        ok: true,
        checkedAt: 1_725_000_000_000,
        items: [
          {
            name: 'Sync table writes',
            status: 'ok',
            message: 'Sync tables can insert, update, and delete rows.',
          },
          {
            name: 'Attachment storage canary',
            status: 'ok',
            message: 'Attachment storage can upload, overwrite, download, and delete files.',
          },
        ],
      },
    }),
  );
  assert.match(mounted.container.textContent || '', /Backend verified/);
  assert.match(mounted.container.textContent || '', /Signed-in table writes and the attachment Storage canary both passed/);
  await act(async () => {
    mounted.root.unmount();
  });

  mounted = await renderSyncPanel(
    createSyncState({
      session: { user: { id: 'user-1', email: 'google@example.com' } },
      lastResult: { ok: true, pushed: 2, pulled: 1, syncedAt: 1_725_000_000_000 },
      queue: { pending: 1, failed: 0, firstError: '' },
      backendCheck: {
        ok: true,
        checkedAt: 1_725_000_000_000,
        items: [
          {
            name: 'Sync table writes',
            status: 'ok',
            message: 'Sync tables can insert, update, and delete rows.',
          },
          {
            name: 'Attachment storage canary',
            status: 'ok',
            message: 'Attachment storage can upload, overwrite, download, and delete files.',
          },
        ],
      },
    }),
  );
  assert.match(mounted.container.textContent || '', /Signed in, ready to sync/);
  assert.match(mounted.container.textContent || '', /1 pending change/);
  assert.doesNotMatch(mounted.container.textContent || '', /Pushed 2, pulled 1/);
  await act(async () => {
    mounted.root.unmount();
  });

  mounted = await renderSyncPanel(
    createSyncState({
      session: { user: { id: 'user-1', email: 'google@example.com' } },
      backendCheck: {
        ok: true,
        checkedAt: 1_725_000_000_000,
        items: [
          {
            name: 'Auth session',
            status: 'ok',
            message: 'Signed-in session is available for backend checks.',
          },
        ],
      },
    }),
  );
  assert.match(mounted.container.textContent || '', /Backend verification pending/);
  assert.doesNotMatch(mounted.container.textContent || '', /Backend verified/);
  await act(async () => {
    mounted.root.unmount();
  });

  const signInClicks: string[] = [];
  mounted = await renderSyncPanel(
    createSyncState({
      authPending: true,
      queue: { pending: 1, failed: 0, firstError: '' },
      signInWithOAuth: async (provider) => {
        signInClicks.push(provider);
      },
    }),
  );
  assert.match(mounted.container.textContent || '', /Browser authorization is open/);
  assert.match(mounted.container.textContent || '', /Waiting for authorization/);
  const signInButton = mounted.container.querySelector<HTMLButtonElement>('button:not([aria-label])');
  assert.ok(signInButton);
  await act(async () => {
    signInButton.click();
  });
  assert.deepEqual(signInClicks, ['google']);
  await act(async () => {
    mounted.root.unmount();
  });

  mounted = await renderSyncPanel(
    createSyncState({
      error: 'Please sign in before syncing.',
    }),
  );
  assert.match(mounted.container.textContent || '', /Sync failed/);
  assert.match(mounted.container.textContent || '', /Please sign in before syncing/);
  const signedOutCopyButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Copy diagnosis report"]');
  assert.ok(signedOutCopyButton);
  await act(async () => {
    signedOutCopyButton.click();
  });
  const signedOutReport = clipboardWrites.at(-1) || '';
  assert.match(signedOutReport, /Signed in: no/);
  assert.match(signedOutReport, /Current error: Please sign in before syncing\./);
  await act(async () => {
    mounted.root.unmount();
  });

  console.log('sync panel diagnostics tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
