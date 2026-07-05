import assert from 'node:assert/strict';
import {
  ATTACHMENT_STORAGE_CANARY_CHECK_NAME,
  resolveBackendVerification,
  SYNC_TABLE_WRITES_CHECK_NAME,
} from '../src/sync/backendVerification';
import type { SyncBackendCheckItem } from '../src/sync/types';

const okItem = (name: string): SyncBackendCheckItem => ({
  name,
  status: 'ok',
  message: `${name} ok`,
});

const verified = resolveBackendVerification([
  okItem('Auth session'),
  okItem(SYNC_TABLE_WRITES_CHECK_NAME),
  okItem(ATTACHMENT_STORAGE_CANARY_CHECK_NAME),
]);
assert.equal(verified.status, 'verified');
assert.equal(verified.failedItem, null);
assert.deepEqual(verified.missingChecks, []);

const pending = resolveBackendVerification([okItem('Auth session'), okItem(SYNC_TABLE_WRITES_CHECK_NAME)]);
assert.equal(pending.status, 'pending');
assert.deepEqual(pending.missingChecks, [ATTACHMENT_STORAGE_CANARY_CHECK_NAME]);

const failedItem: SyncBackendCheckItem = {
  name: 'Notes table',
  status: 'error',
  code: 'PGRST205',
  message: 'Apply the MarkNote sync schema migration.',
};
const failed = resolveBackendVerification([okItem('Auth session'), failedItem]);
assert.equal(failed.status, 'failed');
assert.equal(failed.failedItem, failedItem);
assert.deepEqual(failed.missingChecks, [SYNC_TABLE_WRITES_CHECK_NAME, ATTACHMENT_STORAGE_CANARY_CHECK_NAME]);

console.log('backend verification tests passed');
