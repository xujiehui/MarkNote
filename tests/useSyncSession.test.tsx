import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createNote, db, ensureDefaultFolders, switchWorkspaceAccount } from '../src/lib/db';
import { useSyncSession, type SyncSessionState } from '../src/sync/useSyncSession';
import type { AuthSessionChangeHandler, RemoteSyncAdapter, SyncBackendCheckResult } from '../src/sync/types';
import { installDomGlobals } from './domGlobals';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://127.0.0.1/?app=1' });
installDomGlobals({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  localStorage: dom.window.localStorage, DOMParser: dom.window.DOMParser, HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true });
let nextTimer = 0;
const pendingTimeouts = new Map<number, () => void>();
const intervals = new Map<number, () => void>();
window.setTimeout = ((callback: TimerHandler) => { const id = ++nextTimer; if (typeof callback === 'function') pendingTimeouts.set(id, callback as () => void); return id; }) as typeof window.setTimeout;
window.clearTimeout = ((id: number) => { pendingTimeouts.delete(id); }) as typeof window.clearTimeout;
window.setInterval = ((callback: TimerHandler) => { const id = ++nextTimer; if (typeof callback === 'function') intervals.set(id, callback as () => void); return id; }) as typeof window.setInterval;
window.clearInterval = ((id: number) => { intervals.delete(id); }) as typeof window.clearInterval;

class HookAdapter implements RemoteSyncAdapter {
  readonly id = 'custom' as const;
  readonly name = 'Hook mock';
  readonly configured = true;
  userId = 'hook-account';
  backendOk = false;
  backendChecks = 0;
  pushes = 0;
  failPush = true;
  failPull = false;
  handler: AuthSessionChangeHandler | undefined;
  async getSession() { return { user: { id: this.userId } }; }
  onSessionChange(handler: AuthSessionChangeHandler) { this.handler = handler; return () => { this.handler = undefined; }; }
  async signInWithOAuth() { return undefined; }
  async completeOAuthSignIn() { return this.getSession(); }
  async signOut() { this.handler?.(null, 'SIGNED_OUT'); }
  async registerDevice() { return undefined; }
  async pull() { if (this.failPull) throw new Error('remote temporarily unavailable'); return { folders: [], notes: [], attachments: [], serverTime: Date.now() }; }
  async push() { this.pushes++; if (this.failPush) throw new Error('network temporarily unavailable'); return { syncedAt: Date.now() }; }
  async checkBackend(): Promise<SyncBackendCheckResult> {
    this.backendChecks++;
    return { ok: this.backendOk, checkedAt: Date.now(), items: [
      { name: 'Sync table writes', status: this.backendOk ? 'ok' : 'error', message: this.backendOk ? 'ready' : 'offline' },
      { name: 'Attachment storage canary', status: this.backendOk ? 'ok' : 'error', message: this.backendOk ? 'ready' : 'offline' },
    ] };
  }
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 75));
async function main() {
  await switchWorkspaceAccount('hook-account', 'custom');
  await db.delete(); await db.open(); await ensureDefaultFolders();
  await createNote({ title: 'retry fixture' });
  const adapter = new HookAdapter();
  let current!: SyncSessionState;
  function Harness() { current = useSyncSession(adapter); return <span>{current.error}</span>; }
  const root = createRoot(document.getElementById('root')!);
  await act(async () => { root.render(<Harness />); await flush(); });
  await act(async () => { await flush(); });
  assert.equal(adapter.backendChecks, 1, 'initial failed diagnostics do not loop after checkingBackend becomes false');
  assert.equal(pendingTimeouts.size, 0);
  adapter.backendOk = true;
  await act(async () => { await current.checkBackend(); await flush(); });
  assert.equal(adapter.pushes, 1, 'manual successful diagnosis starts the pending sync once');
  for (let retry = 0; retry < 5; retry++) {
    const next = [...pendingTimeouts.entries()][0];
    assert.ok(next, `retry ${retry + 1} is scheduled`);
    pendingTimeouts.delete(next[0]);
    await act(async () => { next[1](); await flush(); });
  }
  assert.equal(adapter.pushes, 6, 'initial attempt plus five retries');
  assert.equal(pendingTimeouts.size, 0, 'automatic retries stop at the configured bound');
  assert.equal(adapter.backendChecks, 2, 'sync failures do not repeatedly invoke diagnostic writes');
  adapter.failPush = false;
  await act(async () => { window.dispatchEvent(new dom.window.Event('online')); await flush(); });
  assert.equal(await db.syncQueue.count(), 0, 'reconnection resumes queued mutations');
  const pullResult = current.lastResult;
  await act(async () => { for (const callback of [...intervals.values()]) callback(); await flush(); });
  assert.notEqual(current.lastResult, pullResult, 'idle periodic sync still pulls with no queued local edits');
  adapter.failPull = true;
  await act(async () => { for (const callback of [...intervals.values()]) callback(); await flush(); });
  assert.equal(current.lastResult?.ok, false);
  assert.equal(await db.syncQueue.count(), 0);
  assert.ok(pendingTimeouts.size > 0, 'failed idle pull schedules bounded retries even with an empty outbox');
  adapter.failPull = false;
  const pullRetry = [...pendingTimeouts.entries()][0];
  pendingTimeouts.delete(pullRetry[0]);
  await act(async () => { pullRetry[1](); await flush(); });
  assert.equal(current.lastResult?.ok, true);
  assert.equal(pendingTimeouts.size, 0);
  const epochBefore = current.session?.user.id;
  adapter.userId = 'hook-account-B';
  await act(async () => { adapter.handler?.({ user: { id: adapter.userId } }, 'SIGNED_IN'); await flush(); });
  assert.notEqual(current.session?.user.id, epochBefore);
  assert.equal(await db.notes.count(), 0, 'session switch publishes isolated account DB before new session');
  await act(async () => { root.unmount(); });
  assert.equal(intervals.size, 0);
  assert.equal(pendingTimeouts.size, 0);
  db.close();
  console.log('sync session integration tests passed (diagnostic loop, bounded retries, idle pull, identity switch)');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
