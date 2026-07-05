import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  backendCheckStorageKey,
  backendCheckStorageKeyForUser,
  clearStoredBackendCheck,
  readStoredBackendCheck,
  writeStoredBackendCheck,
} from '../src/sync/backendCheckStorage';
import type { SyncBackendCheckResult } from '../src/sync/types';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:5173/?app=1',
});

Object.assign(globalThis, {
  window: dom.window,
  localStorage: dom.window.localStorage,
});

const key = backendCheckStorageKey('supabase');
assert.equal(key, 'marknote-sync-backend-check:supabase');
assert.equal(readStoredBackendCheck(key), null);

const userKey = backendCheckStorageKeyForUser('supabase', 'user-1');
const otherUserKey = backendCheckStorageKeyForUser('supabase', 'user-2');
assert.equal(userKey, 'marknote-sync-backend-check:supabase:user-1');
assert.equal(otherUserKey, 'marknote-sync-backend-check:supabase:user-2');

const result: SyncBackendCheckResult = {
  ok: false,
  checkedAt: 123,
  items: [
    {
      name: 'Notes table',
      status: 'error',
      message: 'Missing table',
      code: 'PGRST205',
    },
    {
      name: 'Auth session',
      status: 'ok',
      message: 'Signed in.',
    },
  ],
};

writeStoredBackendCheck(key, result);
assert.deepEqual(readStoredBackendCheck(key), result);

writeStoredBackendCheck(userKey, result);
assert.deepEqual(readStoredBackendCheck(userKey), result);
assert.equal(readStoredBackendCheck(otherUserKey), null);

localStorage.setItem(key, JSON.stringify({ ok: false, checkedAt: 456, items: [{ name: 'bad', status: 'oops', message: 'nope' }] }));
assert.deepEqual(readStoredBackendCheck(key), { ok: false, checkedAt: 456, items: [] });

localStorage.setItem(key, '{');
assert.equal(readStoredBackendCheck(key), null);

writeStoredBackendCheck(key, result);
clearStoredBackendCheck(key);
assert.equal(readStoredBackendCheck(key), null);
assert.deepEqual(readStoredBackendCheck(userKey), result);

clearStoredBackendCheck(userKey);
assert.equal(readStoredBackendCheck(userKey), null);

console.log('backend check storage tests passed');
