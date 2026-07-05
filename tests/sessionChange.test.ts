import assert from 'node:assert/strict';
import { patchSessionChangeState, resolveSessionChangeState } from '../src/sync/sessionChange';
import type { AuthSession, SyncBackendCheckResult, SyncResult } from '../src/sync/types';

const backendCheck: SyncBackendCheckResult = {
  ok: false,
  checkedAt: 1,
  items: [{ name: 'Notes table', status: 'error', message: 'missing table' }],
};

const lastResult: SyncResult = { ok: true, pushed: 1, pulled: 0, syncedAt: 2 };
const oldSession: AuthSession = { user: { id: 'old-user', email: 'old@example.com' }, accessToken: 'access-old' };

function main() {
  assert.deepEqual(
    resolveSessionChangeState(
      {
        session: oldSession,
        authPending: true,
        lastResult,
        backendCheck,
        error: 'permission denied',
        queueError: 'storage offline',
        clearStoredBackendCheck: false,
      },
      null,
    ),
    {
      session: null,
      authPending: false,
      lastResult: null,
      backendCheck: null,
      error: '',
      queueError: '',
      clearStoredBackendCheck: true,
    },
  );

  assert.deepEqual(
    resolveSessionChangeState(
      {
        session: null,
        authPending: true,
        lastResult: null,
        backendCheck: null,
        error: 'waiting',
        queueError: 'old queue error',
        clearStoredBackendCheck: false,
      },
      { user: { id: 'new-user', email: 'new@example.com' }, accessToken: 'access-new' },
    ),
    {
      session: { user: { id: 'new-user', email: 'new@example.com' }, accessToken: 'access-new' },
      authPending: false,
      lastResult: null,
      backendCheck: null,
      error: '',
      queueError: '',
      clearStoredBackendCheck: true,
    },
  );

  assert.deepEqual(
    resolveSessionChangeState(
      {
        session: oldSession,
        authPending: true,
        lastResult,
        backendCheck,
        error: 'token expired',
        queueError: 'old queue error',
        clearStoredBackendCheck: false,
      },
      { user: { id: 'old-user', email: 'old@example.com' }, accessToken: 'access-refreshed' },
    ),
    {
      session: { user: { id: 'old-user', email: 'old@example.com' }, accessToken: 'access-refreshed' },
      authPending: false,
      lastResult,
      backendCheck,
      error: '',
      queueError: '',
      clearStoredBackendCheck: false,
    },
  );

  assert.deepEqual(
    resolveSessionChangeState(
      {
        session: oldSession,
        authPending: true,
        lastResult,
        backendCheck,
        error: 'permission denied',
        queueError: 'old queue error',
        clearStoredBackendCheck: false,
      },
      { user: { id: 'new-user', email: 'new@example.com' }, accessToken: 'access-new' },
    ),
    {
      session: { user: { id: 'new-user', email: 'new@example.com' }, accessToken: 'access-new' },
      authPending: false,
      lastResult: null,
      backendCheck: null,
      error: '',
      queueError: '',
      clearStoredBackendCheck: true,
    },
  );

  assert.deepEqual(
    resolveSessionChangeState(
      {
        session: null,
        authPending: true,
        lastResult,
        backendCheck,
        error: 'waiting',
        queueError: 'old queue error',
        clearStoredBackendCheck: false,
      },
      { user: { id: 'new-user', email: 'new@example.com' }, accessToken: 'access-new' },
    ),
    {
      session: { user: { id: 'new-user', email: 'new@example.com' }, accessToken: 'access-new' },
      authPending: false,
      lastResult: null,
      backendCheck: null,
      error: '',
      queueError: '',
      clearStoredBackendCheck: true,
    },
  );

  assert.deepEqual(
    resolveSessionChangeState(
      {
        session: null,
        authPending: false,
        lastResult: null,
        backendCheck: null,
        error: '',
        queueError: '',
        clearStoredBackendCheck: false,
      },
      null,
    ),
    {
      session: null,
      authPending: false,
      lastResult: null,
      backendCheck: null,
      error: '',
      queueError: '',
      clearStoredBackendCheck: true,
    },
  );

  assert.deepEqual(
    patchSessionChangeState(
      {
        session: oldSession,
        authPending: false,
        lastResult: null,
        backendCheck,
        error: 'old error',
        queueError: '',
        clearStoredBackendCheck: true,
      },
      {
        lastResult,
        error: '',
      },
    ),
    {
      session: oldSession,
      authPending: false,
      lastResult,
      backendCheck,
      error: '',
      queueError: '',
      clearStoredBackendCheck: false,
    },
  );

  console.log('session change tests passed');
}

main();
